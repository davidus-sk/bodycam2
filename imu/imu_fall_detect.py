#!/usr/bin/env python3
"""
ICM-42605 Fall Detection with MQTT Publishing.
Production service for bodycam fall detection.

Hardware:
    ICM-42605 IMU on I2C bus 1, address 0x69
    Interrupt line: GPIO 16 (falling edge, DATA_READY)

Algorithm: 3-phase threshold-based fall detection (research-backed)
    Phase 1: Free-fall detection (accel magnitude < 0.4g)
    Phase 2: Impact detection (accel > 3.0g or gyro > 300 deg/s)
    Phase 3: Inactivity + posture change confirmation

Log file: /tmp/imu.log

References:
    - Analog Devices AN-1023: Detecting Human Falls with a 3-Axis Accelerometer
    - Kangas et al: Evaluation of Accelerometer-Based Fall Detection Algorithms
    - PMC6412321: Pre-Impact Fall Detection Using IMU Sensors
"""

import argparse
import json
import logging
import math
import os
import random
import signal
import socket
import struct
import subprocess
import sys
import threading
import time
import traceback
from datetime import datetime, timedelta

import smbus2

try:
    import paho.mqtt.client as mqtt
except ImportError:
    mqtt = None

# ---------------------------------------------------------------------------
#  Logging
# ---------------------------------------------------------------------------
LOG_FILE = "/tmp/imu.log"

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    handlers=[
        logging.FileHandler(LOG_FILE),
        logging.StreamHandler(),
    ],
)
log = logging.getLogger("imu")

# ---------------------------------------------------------------------------
#  ICM-42605 Register Map (Bank 0)
# ---------------------------------------------------------------------------
ICM42605_ADDR = 0x69

WHO_AM_I_REG = 0x75
WHO_AM_I_EXPECTED = 0x42

DEVICE_CONFIG = 0x11
INT_CONFIG = 0x14
INTF_CONFIG0 = 0x4C
INTF_CONFIG1 = 0x4D
PWR_MGMT0 = 0x4E
GYRO_CONFIG0 = 0x4F
ACCEL_CONFIG0 = 0x50
INT_CONFIG1 = 0x64
INT_SOURCE0 = 0x65
INT_STATUS = 0x2D
ACCEL_DATA_X1 = 0x1F
REG_BANK_SEL = 0x76

# ---------------------------------------------------------------------------
#  Sensor Configuration
# ---------------------------------------------------------------------------
I2C_BUS = 1

ACCEL_FS_SEL = 1
ACCEL_SCALE = 4096.0

GYRO_FS_SEL = 2
GYRO_SCALE = 65.5

SENSOR_ODR = 0x08

# ---------------------------------------------------------------------------
#  GPIO
# ---------------------------------------------------------------------------
IMU_INT_GPIO = 16

# ---------------------------------------------------------------------------
#  Fall Detection Thresholds (research-backed)
# ---------------------------------------------------------------------------
FREE_FALL_THRESHOLD_G = 0.4
IMPACT_THRESHOLD_G = 3.0
IMPACT_THRESHOLD_GYRO = 300.0

INACTIVITY_GYRO_THRESHOLD = 20.0
INACTIVITY_PERIOD_SEC = 2.0
INACTIVITY_ALLOWED_MOVEMENT_FRAC = 0.2

POSTURE_CHANGE_THRESHOLD_G = 0.4

IMPACT_STABILIZATION_DELAY = 0.2
FREE_FALL_IMPACT_WINDOW = 1.0
MIN_EVENT_INTERVAL = 5.0

GRAVITY_EMA_ALPHA = 0.02
GRAVITY_MIN_SAMPLES = 50

# ---------------------------------------------------------------------------
#  Operational
# ---------------------------------------------------------------------------
MIN_VALID_ACCEL_SUM = 0.05
I2C_ERROR_COOLDOWN_SEC = 1.0
WATCHDOG_INTERVAL_SEC = 5.0
INTERRUPT_TIMEOUT_SEC = 0.5
SENSOR_HEALTH_CHECK_SEC = 10.0

CONFIG_PATH = "/app/bodycam2/camera/conf/config.json"

exit_event = threading.Event()


# =========================================================================
#  Systemd Watchdog
# =========================================================================
def sd_notify(state):
    """Send notification to systemd service manager."""
    addr = os.environ.get("NOTIFY_SOCKET")
    if not addr:
        return
    sock = socket.socket(socket.AF_UNIX, socket.SOCK_DGRAM)
    try:
        if addr[0] == "@":
            addr = "\0" + addr[1:]
        sock.sendto(state.encode(), addr)
    finally:
        sock.close()


# =========================================================================
#  Utility Functions
# =========================================================================
def magnitude(x, y, z):
    return math.sqrt(x * x + y * y + z * z)


def shell_output(command):
    try:
        return subprocess.check_output(
            command, shell=True, stderr=subprocess.STDOUT, universal_newlines=True
        ).strip()
    except Exception as e:
        log.error("Shell command failed: '%s' -> %s", command, e)
        return None


# =========================================================================
#  ICM-42605 Driver
# =========================================================================
class ICM42605:
    """Low-level driver for the ICM-42605 6-axis IMU over I2C."""

    def __init__(self, bus, addr=ICM42605_ADDR):
        self.bus = bus
        self.addr = addr

    def _r(self, reg):
        return self.bus.read_byte_data(self.addr, reg)

    def _w(self, reg, val):
        self.bus.write_byte_data(self.addr, reg, val)

    def verify_who_am_i(self):
        wai = self._r(WHO_AM_I_REG)
        if wai != WHO_AM_I_EXPECTED:
            raise RuntimeError(
                f"WHO_AM_I mismatch: got 0x{wai:02X}, "
                f"expected 0x{WHO_AM_I_EXPECTED:02X}"
            )
        return wai

    def init_sensor(self):
        """Full init sequence. Call once after bus open."""
        wai = self.verify_who_am_i()
        log.info("ICM-42605 detected (WHO_AM_I=0x%02X)", wai)

        # Soft reset
        self._w(DEVICE_CONFIG, 0x01)
        time.sleep(0.002)

        self.verify_who_am_i()
        self._w(REG_BANK_SEL, 0x00)

        # Clock source
        val = self._r(INTF_CONFIG1)
        self._w(INTF_CONFIG1, (val & 0xFC) | 0x01)

        # Accel config
        self._w(ACCEL_CONFIG0, (ACCEL_FS_SEL << 5) | SENSOR_ODR)

        # Gyro config
        self._w(GYRO_CONFIG0, (GYRO_FS_SEL << 5) | SENSOR_ODR)

        # Interrupt: push-pull, active-low, pulsed
        self._w(INT_CONFIG, 0x02)

        # Route DATA_READY to INT1
        self._w(INT_SOURCE0, 0x08)

        # Power on accel + gyro in Low-Noise mode
        self._w(PWR_MGMT0, 0x0F)
        time.sleep(0.001)

        # Wait for gyro startup
        time.sleep(0.050)

        log.info("ICM-42605 ready: +/-8g accel, +/-500 deg/s gyro, 100 Hz ODR")

    def read_sensor_data(self):
        """Burst-read accel + gyro (12 bytes, atomic).
        Returns (ax, ay, az, gx, gy, gz) in g and deg/s.
        """
        raw = self.bus.read_i2c_block_data(self.addr, ACCEL_DATA_X1, 12)
        ax_r, ay_r, az_r, gx_r, gy_r, gz_r = struct.unpack(">hhhhhh", bytes(raw))
        return (
            ax_r / ACCEL_SCALE,
            ay_r / ACCEL_SCALE,
            az_r / ACCEL_SCALE,
            gx_r / GYRO_SCALE,
            gy_r / GYRO_SCALE,
            gz_r / GYRO_SCALE,
        )

    def is_healthy(self):
        try:
            return self._r(WHO_AM_I_REG) == WHO_AM_I_EXPECTED
        except Exception:
            return False


# =========================================================================
#  GPIO interrupt (gpiod v2)
# =========================================================================
def setup_gpio_interrupt(gpio_pin):
    """Return a gpiod LineRequest for falling-edge events, or None on failure."""
    try:
        import gpiod
        from gpiod.line import Edge

        chip = gpiod.Chip("/dev/gpiochip0")
        settings = gpiod.LineSettings(edge_detection=Edge.FALLING)
        request = chip.request_lines(
            config={gpio_pin: settings}, consumer="imu-fall-detect"
        )
        log.info("GPIO %d interrupt ready (gpiod v2, falling edge)", gpio_pin)
        return request
    except Exception as e:
        log.warning("GPIO setup failed: %s -- falling back to polling mode", e)
        return None


# =========================================================================
#  MQTT
# =========================================================================
def load_config(path=CONFIG_PATH):
    try:
        with open(path, "r") as f:
            return json.load(f)
    except FileNotFoundError:
        log.error("Config file not found at %s. Exiting.", path)
        sys.exit(100)
    except Exception as e:
        log.error("Failed to read config: %s", e)
        sys.exit(101)


def build_mqtt_settings(cfg):
    for k in ("server", "port_s", "username", "client_id"):
        if k not in cfg:
            log.error("Missing key '%s' in config.", k)
            sys.exit(102)
    try:
        port = int(cfg["port_s"])
    except (ValueError, TypeError):
        log.error("port_s must be an integer.")
        sys.exit(103)

    base_id = shell_output(cfg["client_id"])
    if not base_id:
        log.error("Could not determine base client_id.")
        sys.exit(104)

    client_id = f"{base_id}-{random.randint(10, 99)}"
    topic = f"device/{base_id}/fall"

    log.info("MQTT TOPIC: %s", topic)
    log.info("MQTT CLIENT: %s", client_id)

    return dict(
        broker=cfg["server"],
        port=port,
        username=cfg["username"],
        password=cfg.get("password", ""),
        keepalive=int(cfg.get("keepalive", 20)),
        ws_path=cfg.get("path", "/mqtt"),
        use_ws=True,
        protocol=mqtt.MQTTv5,
        topic=topic,
        client_id=client_id,
        device_id=base_id,
    )


class MQTTPublisher:
    def __init__(self, settings):
        self.connected = False
        self._closed = False
        self._tls_configured = False
        self.settings = settings
        self.client = mqtt.Client(
            mqtt.CallbackAPIVersion.VERSION2,
            client_id=settings["client_id"],
            protocol=settings["protocol"],
            transport="websockets" if settings["use_ws"] else "tcp",
        )
        if settings["username"]:
            self.client.username_pw_set(settings["username"], settings["password"])
        self._setup_callbacks()

    def _setup_callbacks(self):
        def on_connect(_c, _u, _f, rc, _p):
            ok = (hasattr(rc, "value") and rc.value == 0) or rc == 0
            if ok:
                log.info("MQTT connected.")
                self.connected = True
            else:
                log.error("MQTT connect failed: %s", rc)
                self.connected = False

        def on_disconnect(_c, _u, _f, rc, _p):
            log.warning("MQTT disconnected: %s", rc)
            self.connected = False

        self.client.on_connect = on_connect
        self.client.on_disconnect = on_disconnect

    def connect(self):
        while not self.connected and not exit_event.is_set():
            try:
                if self.settings["use_ws"] and not self._tls_configured:
                    self.client.tls_set()
                    self.client.ws_set_options(path=self.settings["ws_path"])
                    self._tls_configured = True
                self.client.connect(
                    self.settings["broker"],
                    self.settings["port"],
                    keepalive=self.settings["keepalive"],
                )
                self.client.loop_start()
                for _ in range(100):
                    if self.connected or exit_event.is_set():
                        break
                    time.sleep(0.1)
                if not self.connected:
                    log.warning("MQTT waiting for broker...")
            except Exception as e:
                log.error("MQTT connect error: %s. Retrying in 5s.", e)
                time.sleep(5)

    def publish(self, payload):
        if not self.connected and not exit_event.is_set():
            self.connect()
        try:
            data = json.dumps(payload) if isinstance(payload, dict) else payload
            result = self.client.publish(self.settings["topic"], data, qos=1)
            if result.rc != mqtt.MQTT_ERR_SUCCESS:
                log.error("MQTT publish failed: rc=%s", result.rc)
            else:
                log.info("MQTT published: %s", data)
        except Exception as e:
            log.error("MQTT publish error: %s", e)

    def close(self):
        if not self._closed:
            try:
                self.client.loop_stop()
            except Exception:
                pass
            try:
                self.client.disconnect()
            except Exception:
                pass
            self._closed = True


# =========================================================================
#  Signal Handling
# =========================================================================
def handle_exit_signal(signum, _frame):
    log.info("Signal %d received, shutting down.", signum)
    exit_event.set()


# =========================================================================
#  Fall Detector
# =========================================================================
class FallDetector:
    def __init__(self, imu, gpio_request, mqtt_pub, mqtt_settings, verbose=False):
        self.imu = imu
        self.gpio = gpio_request
        self.mqtt_pub = mqtt_pub
        self.mqtt_settings = mqtt_settings
        self.verbose = verbose
        self.use_interrupts = gpio_request is not None

        # State machine
        self.state = "IDLE"
        self.free_fall_time = None
        self.impact_time = None
        self.inactivity_start_time = None
        self.inactivity_buffer = []
        self.last_event_time = 0
        self.posture_acc_x = 0.0
        self.posture_acc_y = 0.0
        self.posture_acc_z = 0.0
        self.posture_acc_n = 0

        # Gravity EMA
        self.grav_x = 0.0
        self.grav_y = 0.0
        self.grav_z = 1.0
        self.grav_samples = 0
        self.pre_fall_grav = None

        # Housekeeping
        self.last_watchdog = time.time()
        self.last_health_check = time.time()
        self.sample_count = 0
        self.i2c_errors = 0

        mode = "interrupt-driven" if self.use_interrupts else "polling"
        log.info("Fall detector started (%s)", mode)
        log.info("Thresholds: freefall=%.1fg  impact=%.1fg/%.0f deg/s  "
                 "inactivity=%.1fs  posture=%.1fg",
                 FREE_FALL_THRESHOLD_G, IMPACT_THRESHOLD_G,
                 IMPACT_THRESHOLD_GYRO, INACTIVITY_PERIOD_SEC,
                 POSTURE_CHANGE_THRESHOLD_G)

    def reset_state(self):
        """Reset state machine but preserve last_event_time for debounce."""
        self.state = "IDLE"
        self.free_fall_time = None
        self.impact_time = None
        self.inactivity_start_time = None
        self.inactivity_buffer = []
        self.pre_fall_grav = None
        self.posture_acc_x = 0.0
        self.posture_acc_y = 0.0
        self.posture_acc_z = 0.0
        self.posture_acc_n = 0

    def _update_gravity_ema(self, ax, ay, az):
        if self.grav_samples == 0:
            self.grav_x, self.grav_y, self.grav_z = ax, ay, az
        else:
            a = GRAVITY_EMA_ALPHA
            self.grav_x += a * (ax - self.grav_x)
            self.grav_y += a * (ay - self.grav_y)
            self.grav_z += a * (az - self.grav_z)
        self.grav_samples += 1

    def _posture_changed(self, ax, ay, az):
        """Compare current gravity direction to the pre-fall reference."""
        if self.pre_fall_grav is None or self.grav_samples < GRAVITY_MIN_SAMPLES:
            log.info("Posture check skipped (insufficient samples)")
            return True
        rx, ry, rz = self.pre_fall_grav
        change = magnitude(ax - rx, ay - ry, az - rz)
        log.info("Posture delta=%.2fg (threshold=%.1fg)", change, POSTURE_CHANGE_THRESHOLD_G)
        return change >= POSTURE_CHANGE_THRESHOLD_G

    def process_sample(self, ax, ay, az, gx, gy, gz):
        a_mag = magnitude(ax, ay, az)
        g_mag = magnitude(gx, gy, gz)
        now = time.time()

        if abs(ax) + abs(ay) + abs(az) < MIN_VALID_ACCEL_SUM:
            log.warning("Skipping invalid accel (near zero)")
            return

        if self.state == "IDLE":
            self._update_gravity_ema(ax, ay, az)

        if self.verbose:
            log.debug("|a|=%.2fg  |g|=%.1f deg/s  state=%s", a_mag, g_mag, self.state)

        # ==============================================================
        #  STATE MACHINE
        # ==============================================================

        if self.state == "IDLE":
            if (
                a_mag < FREE_FALL_THRESHOLD_G
                and (now - self.last_event_time) > MIN_EVENT_INTERVAL
            ):
                self.state = "FREE_FALL"
                self.free_fall_time = now
                self.pre_fall_grav = (self.grav_x, self.grav_y, self.grav_z)
                log.info(">>> Free-fall detected  |a|=%.2fg", a_mag)

        elif self.state == "FREE_FALL":
            if (now - self.free_fall_time) > FREE_FALL_IMPACT_WINDOW:
                log.info("Free-fall expired (no impact within window)")
                self.reset_state()

            elif a_mag > IMPACT_THRESHOLD_G or g_mag > IMPACT_THRESHOLD_GYRO:
                self.state = "POST_IMPACT"
                self.impact_time = now
                self.inactivity_start_time = now + IMPACT_STABILIZATION_DELAY
                self.inactivity_buffer.clear()
                log.info(">>> Impact  |a|=%.2fg  |g|=%.1f deg/s  (stabilizing %.1fs)",
                         a_mag, g_mag, IMPACT_STABILIZATION_DELAY)

        elif self.state == "POST_IMPACT":
            if now < self.inactivity_start_time:
                return

            self.inactivity_buffer.append(g_mag > INACTIVITY_GYRO_THRESHOLD)

            self.posture_acc_x += ax
            self.posture_acc_y += ay
            self.posture_acc_z += az
            self.posture_acc_n += 1

            elapsed = now - self.inactivity_start_time

            if elapsed >= INACTIVITY_PERIOD_SEC:
                avg_ax = self.posture_acc_x / self.posture_acc_n
                avg_ay = self.posture_acc_y / self.posture_acc_n
                avg_az = self.posture_acc_z / self.posture_acc_n
                posture_changed = self._posture_changed(avg_ax, avg_ay, avg_az)

                n = len(self.inactivity_buffer) or 1
                movement = sum(self.inactivity_buffer) / n
                is_motionless = movement <= INACTIVITY_ALLOWED_MOVEMENT_FRAC

                if posture_changed:
                    severe = is_motionless
                    if severe:
                        log.info(">>> FALL CONFIRMED -- SEVERE (posture changed + motionless)")
                    else:
                        log.info(">>> FALL CONFIRMED (posture changed, movement=%.1f%%)",
                                 movement * 100)
                    self._publish_fall_event(severe=severe)
                else:
                    log.info("False alarm: posture unchanged (recovered/caught self)")

                self.last_event_time = now
                self.reset_state()

    def _publish_fall_event(self, severe=False):
        payload = {
            "device_id": self.mqtt_settings.get("device_id", "unknown"),
            "device_type": "camera",
            "ts": int(time.time()),
            "fall": True,
        }
        if severe:
            log.info("NOTE: fall appears severe (motionless)")
        if self.mqtt_pub is None:
            log.info("FALL EVENT (MQTT skipped): %s", payload)
            return
        try:
            self.mqtt_pub.publish(payload)
        except Exception as e:
            log.error("MQTT publish error: %s", e)

    # ==================================================================
    #  Main Loop
    # ==================================================================
    def run(self):
        poll_interval = 1.0 / 100.0

        while not exit_event.is_set():
            try:
                got_data = False

                if self.use_interrupts:
                    if self.gpio.wait_edge_events(
                        timeout=timedelta(seconds=INTERRUPT_TIMEOUT_SEC)
                    ):
                        self.gpio.read_edge_events()
                        got_data = True
                else:
                    time.sleep(poll_interval)
                    got_data = True

                if got_data:
                    ax, ay, az, gx, gy, gz = self.imu.read_sensor_data()
                    self.sample_count += 1
                    self.process_sample(ax, ay, az, gx, gy, gz)

                # Watchdog ping
                now = time.time()
                if now - self.last_watchdog >= WATCHDOG_INTERVAL_SEC:
                    sd_notify("WATCHDOG=1")
                    self.last_watchdog = now

                # Periodic sensor health check
                if now - self.last_health_check >= SENSOR_HEALTH_CHECK_SEC:
                    if not self.imu.is_healthy():
                        log.warning("Sensor health check failed")
                        self.i2c_errors += 1
                    self.last_health_check = now

            except OSError as e:
                self.i2c_errors += 1
                log.error("I2C error: %s", e)
                self.reset_state()
                time.sleep(I2C_ERROR_COOLDOWN_SEC)

            except Exception as e:
                log.error("Unexpected error: %s", e)
                traceback.print_exc()
                self.reset_state()
                time.sleep(I2C_ERROR_COOLDOWN_SEC)


# =========================================================================
#  Main
# =========================================================================
def main():
    parser = argparse.ArgumentParser(
        description="ICM-42605 Fall Detection (Production)"
    )
    parser.add_argument("--verbose", action="store_true", help="Print every sample")
    parser.add_argument("--no-interrupt", action="store_true", help="Force polling mode")
    parser.add_argument("--skip-mqtt", action="store_true", help="Skip MQTT (local testing)")
    args = parser.parse_args()

    if args.verbose:
        logging.getLogger("imu").setLevel(logging.DEBUG)

    # Signals
    for sig in (signal.SIGTERM, signal.SIGINT):
        signal.signal(sig, handle_exit_signal)
    if hasattr(signal, "SIGHUP"):
        signal.signal(signal.SIGHUP, handle_exit_signal)

    # MQTT
    mqtt_pub = None
    mqtt_settings = {}
    if not args.skip_mqtt:
        if mqtt is None:
            log.error("paho-mqtt not installed. Use --skip-mqtt or install it.")
            sys.exit(105)
        cfg = load_config()
        mqtt_settings = build_mqtt_settings(cfg)
        mqtt_pub = MQTTPublisher(mqtt_settings)
    else:
        log.info("MQTT skipped (--skip-mqtt)")

    gpio_request = None

    try:
        with smbus2.SMBus(I2C_BUS) as bus:
            imu = ICM42605(bus)
            imu.init_sensor()

            if not args.no_interrupt:
                gpio_request = setup_gpio_interrupt(IMU_INT_GPIO)

            if mqtt_pub:
                mqtt_pub.connect()

            sd_notify("READY=1")

            detector = FallDetector(
                imu, gpio_request, mqtt_pub, mqtt_settings, args.verbose
            )
            detector.run()

    except KeyboardInterrupt:
        log.info("Interrupted.")
    except Exception as e:
        log.error("FATAL: %s", e)
        traceback.print_exc()
        sys.exit(1)
    finally:
        if gpio_request:
            try:
                gpio_request.release()
            except Exception:
                pass
        if mqtt_pub:
            mqtt_pub.close()
        log.info("Shutdown complete.")


if __name__ == "__main__":
    main()
