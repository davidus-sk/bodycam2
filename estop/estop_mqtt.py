#!/usr/bin/env python3
"""
E-STOP Button Monitor for Bodycam
==================================
Safety-critical emergency stop via two redundant tactile switches.

Hardware:
    BTN on GPIO 8  (active-LOW, 10k pull-up + 1k series + 1uF RC debounce)
    BTN on GPIO 11 (active-LOW, 10k pull-up + 1k series + 1uF RC debounce)

Either button fires an emergency MQTT event (QoS 1 for reliable delivery).

Output:
    MQTT publish to  device/{device_id}/button
    Payload: {"device_id": "...", "device_type": "camera", "ts": ..., "status": "emergency"}
    Log file: /tmp/estop.log

Usage:
    python3 estop_mqtt.py              # normal (MQTT required)
    python3 estop_mqtt.py --skip-mqtt  # local testing without broker
"""

import argparse
import json
import logging
import signal
import sys
import threading
import time
import traceback

import gpiod

# ---------------------------------------------------------------------------
#  Path setup -- allow import of shared mqtt_lib module from /app/bodycam2/
# ---------------------------------------------------------------------------
sys.path.insert(0, "/app/bodycam2")

from mqtt_lib import MQTTClient, load_config

# ---------------------------------------------------------------------------
#  Configuration
# ---------------------------------------------------------------------------
ESTOP_GPIO_PINS = [8]               # GPIO 11 disabled until hardware fix
GPIO_CHIP = "/dev/gpiochip0"
LED_GPIO_PIN = 22                    # Optional visual feedback LED

DEBOUNCE_CONFIRM_SEC = 0.100
MIN_EVENT_INTERVAL_SEC = 3.0
HEARTBEAT_INTERVAL_SEC = 60.0

LOG_FILE = "/tmp/estop.log"

MQTT_QOS = 1

# ---------------------------------------------------------------------------
#  Logging
# ---------------------------------------------------------------------------
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    handlers=[
        logging.FileHandler(LOG_FILE),
        logging.StreamHandler(),
    ],
)
log = logging.getLogger("estop")

# ---------------------------------------------------------------------------
#  Globals
# ---------------------------------------------------------------------------
exit_event = threading.Event()


# ---------------------------------------------------------------------------
#  Signal handling
# ---------------------------------------------------------------------------
def handle_exit_signal(signum, frame):
    log.info("Received signal %d, shutting down.", signum)
    exit_event.set()


# ---------------------------------------------------------------------------
#  GPIO helpers
# ---------------------------------------------------------------------------
def read_pin_pressed(request, pin):
    """
    Read the current physical value of a GPIO pin.
    With external pull-up: idle = HIGH, pressed = LOW.
    Returns True if LOW (button pressed), False if HIGH (released).
    """
    try:
        val = request.get_value(pin)
        return val == gpiod.line.Value.INACTIVE  # physical LOW
    except Exception:
        return False


def confirm_press(request, pin, duration=DEBOUNCE_CONFIRM_SEC):
    """
    After an edge event, confirm the pin stays LOW for `duration` seconds.
    Checks every 10 ms. Returns True if the button is genuinely held.
    """
    checks = max(1, int(duration / 0.010))
    for _ in range(checks):
        if exit_event.is_set():
            return False
        time.sleep(0.010)
        if not read_pin_pressed(request, pin):
            return False
    return True


# ---------------------------------------------------------------------------
#  Main loop
# ---------------------------------------------------------------------------
def run(skip_mqtt=False, led_feedback=False, debug=False):
    signal.signal(signal.SIGTERM, handle_exit_signal)
    signal.signal(signal.SIGINT, handle_exit_signal)
    if hasattr(signal, "SIGHUP"):
        signal.signal(signal.SIGHUP, handle_exit_signal)

    # --- Config (always load -- needed for device_id) ---
    config = load_config()
    device_id = config["device_id"]
    topic = f"device/{device_id}/button"

    # --- MQTT setup ---
    mqtt_client = None
    if skip_mqtt:
        log.info("MQTT skipped (--skip-mqtt)")
    else:
        mqtt_client = MQTTClient(config, exit_event)
        mqtt_client.connect()

    # --- GPIO setup (gpiod v2) ---
    log.info("Opening %s, pins %s", GPIO_CHIP, ESTOP_GPIO_PINS)

    led_request = None
    try:
        gpio_config = {
            pin: gpiod.LineSettings(
                direction=gpiod.line.Direction.INPUT,
                bias=gpiod.line.Bias.PULL_UP,
                edge_detection=gpiod.line.Edge.FALLING,
            )
            for pin in ESTOP_GPIO_PINS
        }
        request = gpiod.request_lines(
            GPIO_CHIP,
            consumer="estop-monitor",
            config=gpio_config,
        )
    except Exception as e:
        log.error("Failed to request GPIO lines: %s", e)
        traceback.print_exc()
        if mqtt_client:
            mqtt_client.close()
        sys.exit(1)

    # Optional LED feedback line
    if led_feedback:
        try:
            led_config = {
                LED_GPIO_PIN: gpiod.LineSettings(
                    direction=gpiod.line.Direction.OUTPUT,
                )
            }
            led_request = gpiod.request_lines(
                GPIO_CHIP,
                consumer="estop-led",
                config=led_config,
            )
            led_request.set_value(LED_GPIO_PIN, gpiod.line.Value.INACTIVE)
            log.info("LED feedback enabled on GPIO%d", LED_GPIO_PIN)
        except Exception as e:
            log.warning("Could not setup LED on GPIO%d: %s", LED_GPIO_PIN, e)
            led_request = None

    log.info("GPIO ready on pins %s (pull-up, falling edge = press)", ESTOP_GPIO_PINS)
    log.info("E-STOP monitor started (debounce=%dms, cooldown=%.1fs, QoS=%d)",
             DEBOUNCE_CONFIRM_SEC * 1000, MIN_EVENT_INTERVAL_SEC, MQTT_QOS)

    for pin in ESTOP_GPIO_PINS:
        raw_val = request.get_value(pin)
        pressed = read_pin_pressed(request, pin)
        log.info("GPIO%d initial: raw=%s pressed=%s", pin, raw_val, pressed)

    last_event_time = 0.0
    last_heartbeat = time.time()
    event_count = 0
    led_off_time = [0.0]

    try:
        while not exit_event.is_set():
            wait_timeout = 0.5 if debug else 1.0
            if not request.wait_edge_events(wait_timeout):
                now = time.time()

                if debug:
                    states = []
                    for pin in ESTOP_GPIO_PINS:
                        raw_val = request.get_value(pin)
                        pressed = read_pin_pressed(request, pin)
                        states.append(f"GPIO{pin}: raw={raw_val} pressed={pressed}")
                    log.debug(" | ".join(states))

                if (now - last_heartbeat) >= HEARTBEAT_INTERVAL_SEC:
                    pin_states = []
                    for pin in ESTOP_GPIO_PINS:
                        pressed = read_pin_pressed(request, pin)
                        pin_states.append(f"GPIO{pin}={'PRESSED' if pressed else 'idle'}")
                    mqtt_status = "connected" if (mqtt_client and mqtt_client.connected) else ("skipped" if skip_mqtt else "disconnected")
                    log.info("Heartbeat | events_fired=%d | %s | mqtt=%s",
                             event_count, " ".join(pin_states), mqtt_status)
                    last_heartbeat = now
                continue

            events = request.read_edge_events()
            now = time.time()

            if (now - last_heartbeat) >= HEARTBEAT_INTERVAL_SEC:
                pin_states = []
                for pin in ESTOP_GPIO_PINS:
                    pressed = read_pin_pressed(request, pin)
                    pin_states.append(f"GPIO{pin}={'PRESSED' if pressed else 'idle'}")
                mqtt_status = "connected" if (mqtt_client and mqtt_client.connected) else ("skipped" if skip_mqtt else "disconnected")
                log.info("Heartbeat | events_fired=%d | %s | mqtt=%s",
                         event_count, " ".join(pin_states), mqtt_status)
                last_heartbeat = now

            for event in events:
                pin = event.line_offset

                if debug:
                    log.debug("Edge event on GPIO%d, confirming press...", pin)

                if not confirm_press(request, pin):
                    if debug:
                        log.debug("GPIO%d debounce rejected (bounce or glitch)", pin)
                    continue

                now = time.time()

                elapsed = now - last_event_time
                if elapsed < MIN_EVENT_INTERVAL_SEC:
                    remaining = MIN_EVENT_INTERVAL_SEC - elapsed
                    log.info("GPIO%d pressed but cooldown active (%.1fs remaining), suppressed",
                             pin, remaining)
                    continue

                # --- Fire e-stop ---
                event_count += 1
                payload = {
                    "device_id": device_id,
                    "device_type": "camera",
                    "ts": int(now),
                    "status": "emergency",
                }

                log.info(">>> EMERGENCY TRIGGERED via GPIO%d (event #%d)", pin, event_count)

                # LED feedback: turn ON for 60 seconds (safety visibility)
                if led_request:
                    led_off_time[0] = time.time() + 60.0
                    def _led_flash(expected_off=led_off_time[0]):
                        try:
                            led_request.set_value(LED_GPIO_PIN, gpiod.line.Value.ACTIVE)
                            time.sleep(60.0)
                            if led_off_time[0] <= expected_off:
                                led_request.set_value(LED_GPIO_PIN, gpiod.line.Value.INACTIVE)
                        except Exception:
                            pass
                    threading.Thread(target=_led_flash, daemon=True).start()

                if mqtt_client and not skip_mqtt:
                    try:
                        mqtt_client.publish(topic, payload, qos=MQTT_QOS)
                    except Exception as e:
                        log.error("MQTT publish error: %s", e)
                        traceback.print_exc()
                else:
                    log.info("Event (MQTT skipped): %s", json.dumps(payload))

                last_event_time = now

    except Exception as e:
        log.error("Fatal error in main loop: %s", e)
        traceback.print_exc()
        sys.exit(1)
    finally:
        try:
            request.release()
        except Exception:
            pass
        if led_request:
            try:
                led_request.set_value(LED_GPIO_PIN, gpiod.line.Value.INACTIVE)
                led_request.release()
            except Exception:
                pass
        if mqtt_client:
            mqtt_client.close()
        log.info("Exiting cleanly. Total events fired: %d", event_count)


# ---------------------------------------------------------------------------
#  Entry point
# ---------------------------------------------------------------------------
def main():
    parser = argparse.ArgumentParser(description="E-STOP Button Monitor")
    parser.add_argument(
        "--skip-mqtt", "--no-mqtt",
        action="store_true",
        dest="skip_mqtt",
        help="Run without MQTT connection (local testing)",
    )
    parser.add_argument(
        "--led-feedback",
        action="store_true",
        help="Flash GPIO22 LED on e-stop event",
    )
    parser.add_argument(
        "--debug",
        action="store_true",
        help="Print raw pin state every 0.5s for wiring verification",
    )
    args = parser.parse_args()

    if args.debug:
        logging.getLogger("estop").setLevel(logging.DEBUG)

    run(skip_mqtt=args.skip_mqtt, led_feedback=args.led_feedback, debug=args.debug)


if __name__ == "__main__":
    main()
