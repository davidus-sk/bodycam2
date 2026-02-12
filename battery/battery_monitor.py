#!/usr/bin/env python3
"""
Battery Monitor for Bodycam2
============================
Reads LiPo battery voltage via MCP3021 10-bit ADC over I2C,
converts to percentage using a discharge curve lookup table,
and writes the result to /dev/shm/battery.dat.

Hardware:
  - MCP3021A5T on I2C bus 0, address 0x4D
  - Voltage divider: R9=10k (top), R10=27k (bottom)
  - VDD = 3.3V regulated rail
  - GPIO24 = low battery LED

LED behavior:
  - Above 15%: LED off
  - 15% to 10%: blink (200ms on, 2s off)
  - Below 10%: solid on
  - Hysteresis bands prevent state toggling at boundaries
"""

import os
import sys
import time
import signal
import socket
import threading
import logging


try:
    import smbus2
except ImportError:
    print("FATAL: smbus2 not installed. pip install smbus2", file=sys.stderr)
    sys.exit(1)

try:
    import RPi.GPIO as GPIO
except ImportError:
    GPIO = None

# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------

I2C_BUS = 0
I2C_ADDR = 0x4D

# Voltage divider: V_BAT = V_AIN * (R_TOP + R_BOTTOM) / R_BOTTOM
R_TOP = 10_000
R_BOTTOM = 27_000
DIVIDER_RATIO = (R_TOP + R_BOTTOM) / R_BOTTOM

VDD = 3.3
ADC_RESOLUTION = 1024

SAMPLES_PER_CYCLE = 10
POLL_INTERVAL_S = 60

OUTPUT_PATH = "/dev/shm/battery.dat"
OUTPUT_TMP = OUTPUT_PATH + ".tmp"
LOG_PATH = "/tmp/battery_monitor.log"



LED_PIN = 24
LED_ON_MS = 200
LED_OFF_S = 2.0

THRESH_WARN = 15
THRESH_CRIT = 10
HYSTERESIS = 2

# LiPo discharge curve: (voltage, percentage)
DISCHARGE_CURVE = [
    (4.20, 100),
    (4.15, 95),
    (4.10, 90),
    (4.05, 85),
    (4.00, 80),
    (3.95, 75),
    (3.90, 70),
    (3.85, 65),
    (3.80, 60),
    (3.75, 55),
    (3.70, 50),
    (3.65, 45),
    (3.60, 40),
    (3.55, 30),
    (3.50, 20),
    (3.45, 15),
    (3.40, 10),
    (3.30, 5),
    (3.20, 2),
    (3.00, 0),
]

# ---------------------------------------------------------------------------
# Logging — minimal output, rotate to stay small
# ---------------------------------------------------------------------------

log = logging.getLogger("battery")
log.setLevel(logging.WARNING)

_handler = logging.FileHandler(LOG_PATH)
_handler.setFormatter(logging.Formatter(
    "%(asctime)s %(levelname)s %(message)s",
    datefmt="%Y-%m-%d %H:%M:%S",
))
log.addHandler(_handler)


def log_info(msg):
    """Force an INFO message through the WARNING-level filter.
    Used sparingly: startup, shutdown, LED transitions only."""
    old = log.level
    log.setLevel(logging.INFO)
    log.info(msg)
    log.setLevel(old)


# ---------------------------------------------------------------------------
# Systemd watchdog — no extra packages needed
# ---------------------------------------------------------------------------

def sd_notify(msg):
    """Send a notification to systemd via NOTIFY_SOCKET.
    Does nothing if not running under systemd."""
    addr = os.environ.get("NOTIFY_SOCKET")
    if not addr:
        return
    try:
        if addr[0] == "@":
            addr = "\0" + addr[1:]
        sock = socket.socket(socket.AF_UNIX, socket.SOCK_DGRAM)
        sock.sendto(msg.encode(), addr)
        sock.close()
    except Exception:
        pass


def watchdog_ping():
    sd_notify("WATCHDOG=1")


# ---------------------------------------------------------------------------
# LED state machine
# ---------------------------------------------------------------------------

LED_OFF = 0
LED_BLINK = 1
LED_SOLID = 2

_LED_NAMES = {LED_OFF: "off", LED_BLINK: "blink", LED_SOLID: "solid"}


class LEDController:
    """Manages GPIO24 LED in a background thread."""

    def __init__(self, pin):
        self._pin = pin
        self._state = LED_OFF
        self._lock = threading.Lock()
        self._stop = threading.Event()
        self._thread = None
        self._gpio_ok = GPIO is not None

        if self._gpio_ok:
            try:
                GPIO.setmode(GPIO.BCM)
                GPIO.setwarnings(False)
                GPIO.setup(self._pin, GPIO.OUT, initial=GPIO.LOW)
            except Exception as e:
                log.error(f"GPIO init failed: {e}")
                self._gpio_ok = False

    def start(self):
        self._thread = threading.Thread(target=self._run, daemon=True, name="led")
        self._thread.start()

    def set_state(self, state):
        with self._lock:
            if self._state != state:
                log_info(f"LED {_LED_NAMES.get(self._state)} -> {_LED_NAMES.get(state)}")
                self._state = state

    def cleanup(self):
        self._stop.set()
        if self._thread and self._thread.is_alive():
            self._thread.join(timeout=3)
        self._led_off()
        if self._gpio_ok:
            try:
                GPIO.cleanup(self._pin)
            except Exception:
                pass

    def _led_on(self):
        if self._gpio_ok:
            try:
                GPIO.output(self._pin, GPIO.HIGH)
            except Exception:
                pass

    def _led_off(self):
        if self._gpio_ok:
            try:
                GPIO.output(self._pin, GPIO.LOW)
            except Exception:
                pass

    def _run(self):
        while not self._stop.is_set():
            try:
                with self._lock:
                    state = self._state

                if state == LED_OFF:
                    self._led_off()
                    self._stop.wait(0.5)

                elif state == LED_SOLID:
                    self._led_on()
                    self._stop.wait(0.5)

                elif state == LED_BLINK:
                    self._led_on()
                    self._stop.wait(LED_ON_MS / 1000.0)
                    with self._lock:
                        still_blink = self._state == LED_BLINK
                    if still_blink:
                        self._led_off()
                        self._stop.wait(LED_OFF_S)
            except Exception:
                self._stop.wait(1)


# ---------------------------------------------------------------------------
# ADC
# ---------------------------------------------------------------------------

def read_adc_raw(bus):
    """Read single 10-bit value from MCP3021.

    Byte 0: 0000 D9 D8 D7 D6
    Byte 1: D5 D4 D3 D2 D1 D0 X X
    """
    data = bus.read_i2c_block_data(I2C_ADDR, 0, 2)
    return ((data[0] & 0x0F) << 6) | ((data[1] & 0xFC) >> 2)


def read_battery_voltage(bus):
    """Sample ADC, trim outliers, convert to battery voltage."""
    readings = []
    for _ in range(SAMPLES_PER_CYCLE):
        try:
            readings.append(read_adc_raw(bus))
        except OSError:
            continue
        time.sleep(0.005)

    if len(readings) < 3:
        return None

    readings.sort()
    trimmed = readings[1:-1]
    avg_code = sum(trimmed) / len(trimmed)

    v_ain = (avg_code / ADC_RESOLUTION) * VDD
    return v_ain * DIVIDER_RATIO


# ---------------------------------------------------------------------------
# Voltage to percentage
# ---------------------------------------------------------------------------

def voltage_to_percent(voltage):
    """Convert battery voltage to percentage via discharge curve
    with linear interpolation."""
    if voltage is None:
        return None

    if voltage >= DISCHARGE_CURVE[0][0]:
        return 100
    if voltage <= DISCHARGE_CURVE[-1][0]:
        return 0

    for i in range(len(DISCHARGE_CURVE) - 1):
        v_high, p_high = DISCHARGE_CURVE[i]
        v_low, p_low = DISCHARGE_CURVE[i + 1]
        if v_low <= voltage <= v_high:
            frac = (voltage - v_low) / (v_high - v_low)
            return max(0, min(100, int(round(p_low + frac * (p_high - p_low)))))

    return 0


# ---------------------------------------------------------------------------
# LED state with hysteresis
# ---------------------------------------------------------------------------

def determine_led_state(percent, current):
    """Decide LED state with hysteresis to prevent boundary toggling.

    OFF   -> BLINK  at <= 15%     | BLINK -> OFF   at >= 17%
    BLINK -> SOLID  at <= 10%     | SOLID -> BLINK at >= 12%
    """
    if percent is None:
        return current

    if current == LED_OFF:
        if percent <= THRESH_CRIT:
            return LED_SOLID
        if percent <= THRESH_WARN:
            return LED_BLINK
        return LED_OFF

    if current == LED_BLINK:
        if percent <= THRESH_CRIT:
            return LED_SOLID
        if percent >= THRESH_WARN + HYSTERESIS:
            return LED_OFF
        return LED_BLINK

    if current == LED_SOLID:
        if percent >= THRESH_CRIT + HYSTERESIS:
            return LED_BLINK
        return LED_SOLID

    return LED_OFF


# ---------------------------------------------------------------------------
# File output
# ---------------------------------------------------------------------------

def write_battery_level(percent):
    """Write battery percentage to /dev/shm/battery.dat atomically."""
    if percent is None:
        return
    percent = max(0, min(100, percent))
    try:
        with open(OUTPUT_TMP, "w") as f:
            f.write(str(percent))
        os.rename(OUTPUT_TMP, OUTPUT_PATH)
    except OSError as e:
        log.error(f"Write failed: {e}")


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main():
    log_info(f"Started | bus={I2C_BUS} addr=0x{I2C_ADDR:02X} poll={POLL_INTERVAL_S}s")

    led = LEDController(LED_PIN)
    led.start()

    led_state = LED_OFF
    consecutive_failures = 0

    def shutdown(signum, _frame):
        log_info(f"Shutdown signal={signum}")
        led.cleanup()
        sys.exit(0)

    signal.signal(signal.SIGTERM, shutdown)
    signal.signal(signal.SIGINT, shutdown)

    sd_notify("READY=1")

    while True:
        bus = None
        percent = None
        try:
            bus = smbus2.SMBus(I2C_BUS)
            voltage = read_battery_voltage(bus)
            percent = voltage_to_percent(voltage)

            if percent is not None:
                write_battery_level(percent)
                if consecutive_failures >= 3:
                    log_info("ADC recovered after failures")
                consecutive_failures = 0
            else:
                consecutive_failures += 1
                if consecutive_failures == 3:
                    log.error("No valid ADC reading for 3 consecutive cycles")

        except Exception as e:
            consecutive_failures += 1
            if consecutive_failures == 3:
                log.error(f"Persistent error: {e}")

        finally:
            if bus:
                try:
                    bus.close()
                except Exception:
                    pass

        new_state = determine_led_state(percent, led_state)
        if new_state != led_state:
            led_state = new_state
        led.set_state(led_state)

        watchdog_ping()
        time.sleep(POLL_INTERVAL_S)


if __name__ == "__main__":
    main()
