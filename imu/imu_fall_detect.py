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

References:
    - Analog Devices AN-1023: Detecting Human Falls with a 3-Axis Accelerometer
    - Kangas et al: Evaluation of Accelerometer-Based Fall Detection Algorithms
    - PMC6412321: Pre-Impact Fall Detection Using IMU Sensors
"""

import argparse
import json
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
ACCEL_DATA_X1 = 0x1F  # First byte of accel data block
REG_BANK_SEL = 0x76

# ---------------------------------------------------------------------------
#  Sensor Configuration
# ---------------------------------------------------------------------------
I2C_BUS = 1

# Accelerometer: +/- 8g  (ACCEL_FS_SEL = 001)
# Sensitivity: 4096 LSB/g — good resolution, headroom to 8g for real impacts
ACCEL_FS_SEL = 1
ACCEL_SCALE = 4096.0

# Gyroscope: +/- 500 deg/s  (GYRO_FS_SEL = 010)
# Sensitivity: 65.5 LSB/(deg/s) — headroom above 300 deg/s impact threshold
GYRO_FS_SEL = 2
GYRO_SCALE = 65.5

# ODR: 100 Hz for both accel and gyro (register value 0x08)
SENSOR_ODR = 0x08

# ---------------------------------------------------------------------------
#  GPIO
# ---------------------------------------------------------------------------
IMU_INT_GPIO = 16

# ---------------------------------------------------------------------------
#  Fall Detection Thresholds (research-backed)
# ---------------------------------------------------------------------------
# Phase 1 — Free-fall: Literature range 0.4–0.6 g.
# 0.4 g catches trips/slips where free-fall is brief and shallow.
FREE_FALL_THRESHOLD_G = 0.4

# Phase 2 — Impact: Literature uses 2–3 g (PMC, Analog Devices).
# 3.0 g avoids false triggers from sitting hard or jumping.
IMPACT_THRESHOLD_G = 3.0
IMPACT_THRESHOLD_GYRO = 300.0  # deg/s — angular velocity spike on impact

# Phase 3 — Inactivity: person lying still after fall.
INACTIVITY_GYRO_THRESHOLD = 20.0  # deg/s — below this counts as still
INACTIVITY_PERIOD_SEC = 2.0  # must remain still for 2 s (matches literature)
INACTIVITY_ALLOWED_MOVEMENT_FRAC = 0.2  # up to 20 % of samples can have motion

# Phase 3 — Posture change: gravity vector shifted (Analog Devices AN-1023).
# Standing -> lying produces ~1 g change; 0.7 g threshold catches partial falls.
POSTURE_CHANGE_THRESHOLD_G = 0.4

# Timing windows
IMPACT_STABILIZATION_DELAY = 0.2  # seconds — ignore ringing right after impact
FREE_FALL_IMPACT_WINDOW = 1.0  # seconds — impact must follow within 1 s
MIN_EVENT_INTERVAL = 5.0  # seconds — debounce between events

# Gravity reference — exponential moving average
# alpha ~0.02 ≈ 50-sample effective window at 100 Hz (≈ 0.5 s).
GRAVITY_EMA_ALPHA = 0.02
GRAVITY_MIN_SAMPLES = 50  # need this many before posture check is valid

# ---------------------------------------------------------------------------
#  Operational
# ---------------------------------------------------------------------------
MIN_VALID_ACCEL_SUM = 0.05  # reject near-zero (invalid) readings
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


def ts():
    return datetime.now().strftime("%Y-%m-%d %H:%M:%S")


def shell_output(command):
    try:
        return subprocess.check_output(
            command, shell=True, stderr=subprocess.STDOUT, universal_newlines=True
        ).strip()
    except Exception as e:
        print(f"[CONFIG] ERROR: shell command failed: '{command}' -> {e}")
        return None


# =========================================================================
#  ICM-42605 Driver
# =========================================================================
class ICM42605:
    """Low-level driver for the ICM-42605 6-axis IMU over I2C."""

    def __init__(self, bus, addr=ICM42605_ADDR):
        self.bus = bus
        self.addr = addr

    # -- register helpers --------------------------------------------------
    def _r(self, reg):
        return self.bus.read_byte_data(self.addr, reg)

    def _w(self, reg, val):
        self.bus.write_byte_data(self.addr, reg, val)

    # -- identity ----------------------------------------------------------
    def verify_who_am_i(self):
        wai = self._r(WHO_AM_I_REG)
        if wai != WHO_AM_I_EXPECTED:
            raise RuntimeError(
                f"WHO_AM_I mismatch: got 0x{wai:02X}, "
                f"expected 0x{WHO_AM_I_EXPECTED:02X}"
            )
        return wai

    # -- initialisation ----------------------------------------------------
    def init_sensor(self):
        """Full init sequence.  Call once after bus open."""

        # 1. Verify identity
        wai = self.verify_who_am_i()
        print(f"[{ts()}] ICM-42605 detected (WHO_AM_I=0x{wai:02X})")

        # 2. Soft reset
        self._w(DEVICE_CONFIG, 0x01)
        time.sleep(0.002)  # datasheet: wait >= 1 ms

        # 3. Verify again after reset
        self.verify_who_am_i()

        # 4. Select register bank 0 (default, but be explicit)
        self._w(REG_BANK_SEL, 0x00)

        # 5. Clock source — auto-select PLL when gyro active
        #    INTF_CONFIG1 reset value 0x91 already has CLKSEL=01;
        #    read-modify-write to be safe.
        val = self._r(INTF_CONFIG1)
        self._w(INTF_CONFIG1, (val & 0xFC) | 0x01)

        # 6. Accelerometer: FS_SEL in bits [7:5], ODR in bits [3:0]
        self._w(ACCEL_CONFIG0, (ACCEL_FS_SEL << 5) | SENSOR_ODR)

        # 7. Gyroscope: FS_SEL in bits [7:5], ODR in bits [3:0]
        self._w(GYRO_CONFIG0, (GYRO_FS_SEL << 5) | SENSOR_ODR)

        # 8. Interrupt pin: INT1 push-pull, active-low, pulsed
        #    Bits [2:0] = MODE(0) | DRIVE(1=push-pull) | POLARITY(0=active-low)
        self._w(INT_CONFIG, 0x02)

        # 9. Route DATA_READY to INT1
        self._w(INT_SOURCE0, 0x08)

        # 10. Power on — accel + gyro in Low-Noise mode
        #     GYRO_MODE=11, ACCEL_MODE=11  →  0x0F
        self._w(PWR_MGMT0, 0x0F)
        time.sleep(0.001)  # datasheet: no register writes for 200 us

        # 11. Wait for gyro startup (30 ms typical, 45 ms max)
        time.sleep(0.050)

        print(
            f"[{ts()}] ICM-42605 ready: "
            f"+/-8g accel, +/-500 deg/s gyro, 100 Hz ODR"
        )

    # -- data read ---------------------------------------------------------
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

    # -- health ------------------------------------------------------------
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
        print(f"[{ts()}] GPIO {gpio_pin} interrupt ready (gpiod v2, falling edge)")
        return request
    except Exception as e:
        print(f"[{ts()}] WARNING: GPIO setup failed: {e}")
        print(f"[{ts()}] Falling back to polling mode")
        return None


# =========================================================================
#  MQTT — preserved from original, with bug-fixes noted inline
# =========================================================================
def load_config(path=CONFIG_PATH):
    try:
        with open(path, "r") as f:
            return json.load(f)
    except FileNotFoundError:
        print(f"[CONFIG] ERROR: Config file not found at {path}. Exiting.")
        sys.exit(100)
    except Exception as e:
        print(f"[CONFIG] ERROR: Failed to read config: {e}")
        sys.exit(101)


def build_mqtt_settings(cfg):
    for k in ("server", "port_s", "username", "client_id"):
        if k not in cfg:
            print(f"[CONFIG] ERROR: Missing key '{k}' in config.")
            sys.exit(102)
    try:
        port = int(cfg["port_s"])
    except (ValueError, TypeError):
        print("[CONFIG] ERROR: port_s must be an integer.")
        sys.exit(103)

    base_id = shell_output(cfg["client_id"])
    if not base_id:
        print("[CONFIG] ERROR: Could not determine base client_id.")
        sys.exit(104)

    client_id = f"{base_id}-{random.randint(10, 99)}"
    topic = f"device/{base_id}/fall"

    print(f"[MQTT] TOPIC : {topic}")
    print(f"[MQTT] CLIENT: {client_id}")

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
                print("[MQTT] Connected.")
                self.connected = True
            else:
                print(f"[MQTT] Connect failed: {rc}")
                self.connected = False

        def on_disconnect(_c, _u, _f, rc, _p):
            print(f"[MQTT] Disconnected: {rc}")
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
                    print("[MQTT] Waiting for broker…")
            except Exception as e:
                # FIX: original had exit(-1) here — retry instead
                print(f"[MQTT] Connect error: {e}. Retrying in 5 s.")
                time.sleep(5)

    def publish(self, payload):
        if not self.connected and not exit_event.is_set():
            self.connect()
        try:
            data = json.dumps(payload) if isinstance(payload, dict) else payload
            result = self.client.publish(self.settings["topic"], data, qos=1)
            if result.rc != mqtt.MQTT_ERR_SUCCESS:
                print(f"[MQTT] Publish failed: rc={result.rc}")
        except Exception as e:
            print(f"[MQTT] Publish error: {e}")

    def close(self):
        if not self._closed:
            self.client.loop_stop()
            self.client.disconnect()
            self._closed = True


# =========================================================================
#  Signal Handling
# =========================================================================
def handle_exit_signal(signum, _frame):
    print(f"[Main] Signal {signum} received, shutting down.")
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
        self.last_event_time = 0  # persists across reset_state()
        self.posture_acc_x = 0.0
        self.posture_acc_y = 0.0
        self.posture_acc_z = 0.0
        self.posture_acc_n = 0

        # Gravity EMA for posture-change detection
        self.grav_x = 0.0
        self.grav_y = 0.0
        self.grav_z = 1.0  # assume upright at boot
        self.grav_samples = 0
        self.pre_fall_grav = None

        # Housekeeping
        self.last_watchdog = time.time()
        self.last_health_check = time.time()
        self.sample_count = 0
        self.i2c_errors = 0

        mode = "interrupt-driven" if self.use_interrupts else "polling"
        print(f"[{ts()}] Fall detector started ({mode})")
        print(
            f"[{ts()}] Thresholds: freefall={FREE_FALL_THRESHOLD_G}g  "
            f"impact={IMPACT_THRESHOLD_G}g/{IMPACT_THRESHOLD_GYRO} deg/s  "
            f"inactivity={INACTIVITY_PERIOD_SEC}s  "
            f"posture={POSTURE_CHANGE_THRESHOLD_G}g"
        )

    # ------------------------------------------------------------------
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

    # ------------------------------------------------------------------
    def log(self, msg, important=False):
        if self.verbose or important:
            print(f"[{ts()}] {msg}")

    # ------------------------------------------------------------------
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
            # Not enough data — skip posture check, fall back to gyro-only
            self.log("Posture check skipped (insufficient samples)", important=True)
            return True
        rx, ry, rz = self.pre_fall_grav
        change = magnitude(ax - rx, ay - ry, az - rz)
        self.log(
            f"Posture delta={change:.2f}g (threshold={POSTURE_CHANGE_THRESHOLD_G}g)",
            important=True,
        )
        return change >= POSTURE_CHANGE_THRESHOLD_G

    # ------------------------------------------------------------------
    def process_sample(self, ax, ay, az, gx, gy, gz):
        a_mag = magnitude(ax, ay, az)
        g_mag = magnitude(gx, gy, gz)
        now = time.time()

        # ---- Validate reading ----
        if abs(ax) + abs(ay) + abs(az) < MIN_VALID_ACCEL_SUM:
            self.log("Skipping invalid accel (near zero)", important=True)
            return

        # ---- Update gravity reference during normal operation ----
        if self.state == "IDLE":
            self._update_gravity_ema(ax, ay, az)

        if self.verbose:
            self.log(
                f"|a|={a_mag:.2f}g  |g|={g_mag:.1f} deg/s  "
                f"state={self.state}"
            )

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
                self.log(f">>> Free-fall detected  |a|={a_mag:.2f}g", important=True)

        elif self.state == "FREE_FALL":
            if (now - self.free_fall_time) > FREE_FALL_IMPACT_WINDOW:
                self.log("Free-fall expired (no impact within window)", important=True)
                self.reset_state()

            elif a_mag > IMPACT_THRESHOLD_G or g_mag > IMPACT_THRESHOLD_GYRO:
                self.state = "POST_IMPACT"
                self.impact_time = now
                self.inactivity_start_time = now + IMPACT_STABILIZATION_DELAY
                self.inactivity_buffer.clear()
                self.log(
                    f">>> Impact  |a|={a_mag:.2f}g  |g|={g_mag:.1f} deg/s  "
                    f"(stabilizing {IMPACT_STABILIZATION_DELAY}s)",
                    important=True,
                )

        elif self.state == "POST_IMPACT":
            # Skip samples during stabilization window
            if now < self.inactivity_start_time:
                return

            self.inactivity_buffer.append(g_mag > INACTIVITY_GYRO_THRESHOLD)

            # Accumulate accel for averaged posture check
            self.posture_acc_x += ax
            self.posture_acc_y += ay
            self.posture_acc_z += az
            self.posture_acc_n += 1

            elapsed = now - self.inactivity_start_time

            if elapsed >= INACTIVITY_PERIOD_SEC:
                # -- Primary check: averaged orientation over 2s window --
                avg_ax = self.posture_acc_x / self.posture_acc_n
                avg_ay = self.posture_acc_y / self.posture_acc_n
                avg_az = self.posture_acc_z / self.posture_acc_n
                posture_changed = self._posture_changed(avg_ax, avg_ay, avg_az)

                # -- Secondary check: are they motionless? (severity) --
                n = len(self.inactivity_buffer) or 1
                movement = sum(self.inactivity_buffer) / n
                is_motionless = movement <= INACTIVITY_ALLOWED_MOVEMENT_FRAC

                if posture_changed:
                    severe = is_motionless
                    if severe:
                        self.log(
                            ">>> FALL CONFIRMED — SEVERE "
                            "(posture changed + motionless)",
                            important=True,
                        )
                    else:
                        self.log(
                            f">>> FALL CONFIRMED "
                            f"(posture changed, movement={movement * 100:.1f}%)",
                            important=True,
                        )
                    self._publish_fall_event(severe=severe)
                else:
                    self.log(
                        "False alarm: posture unchanged (recovered/caught self)",
                        important=True,
                    )

                self.last_event_time = now
                self.reset_state()

    # ------------------------------------------------------------------
    def _publish_fall_event(self, severe=False):
        payload = {
            "device_id": self.mqtt_settings.get("device_id", "unknown"),
            "device_type": "camera",
            "ts": int(time.time()),
            "fall": True,
        }
        if severe:
            self.log("NOTE: fall appears severe (motionless)", important=True)
        if self.mqtt_pub is None:
            self.log(f"FALL EVENT (MQTT skipped): {payload}", important=True)
            return
        try:
            self.mqtt_pub.publish(payload)
            self.log(f"MQTT published: {payload}", important=True)
        except Exception as e:
            self.log(f"MQTT publish error: {e}", important=True)

    # ==================================================================
    #  Main Loop
    # ==================================================================
    def run(self):
        poll_interval = 1.0 / 100.0  # 100 Hz fallback

        while not exit_event.is_set():
            try:
                got_data = False

                # ---- Wait for data ----
                if self.use_interrupts:
                    if self.gpio.wait_edge_events(
                        timeout=timedelta(seconds=INTERRUPT_TIMEOUT_SEC)
                    ):
                        self.gpio.read_edge_events()  # drain queue
                        got_data = True
                    # timeout is fine — we still do housekeeping below
                else:
                    time.sleep(poll_interval)
                    got_data = True

                # ---- Read & process ----
                if got_data:
                    ax, ay, az, gx, gy, gz = self.imu.read_sensor_data()
                    self.sample_count += 1
                    self.process_sample(ax, ay, az, gx, gy, gz)

                # ---- Watchdog ping ----
                now = time.time()
                if now - self.last_watchdog >= WATCHDOG_INTERVAL_SEC:
                    sd_notify("WATCHDOG=1")
                    self.last_watchdog = now

                # ---- Periodic sensor health check ----
                if now - self.last_health_check >= SENSOR_HEALTH_CHECK_SEC:
                    if not self.imu.is_healthy():
                        self.log("WARNING: sensor health check failed", important=True)
                        self.i2c_errors += 1
                    self.last_health_check = now

            except OSError as e:
                self.i2c_errors += 1
                self.log(f"I2C error: {e}", important=True)
                self.reset_state()
                time.sleep(I2C_ERROR_COOLDOWN_SEC)

            except Exception as e:
                self.log(f"Unexpected error: {e}", important=True)
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
            print("[MQTT] ERROR: paho-mqtt not installed. Use --skip-mqtt or install it.")
            sys.exit(105)
        cfg = load_config()
        mqtt_settings = build_mqtt_settings(cfg)
        mqtt_pub = MQTTPublisher(mqtt_settings)
    else:
        print("[MQTT] Skipped (--skip-mqtt)")

    gpio_request = None

    try:
        with smbus2.SMBus(I2C_BUS) as bus:
            # ---- IMU init ----
            imu = ICM42605(bus)
            imu.init_sensor()

            # ---- GPIO interrupt ----
            if not args.no_interrupt:
                gpio_request = setup_gpio_interrupt(IMU_INT_GPIO)

            # ---- MQTT connect ----
            if mqtt_pub:
                mqtt_pub.connect()

            # ---- Tell systemd we are alive ----
            sd_notify("READY=1")

            # ---- Run ----
            detector = FallDetector(
                imu, gpio_request, mqtt_pub, mqtt_settings, args.verbose
            )
            detector.run()

    except KeyboardInterrupt:
        print("\nInterrupted.")
    except Exception as e:
        print(f"[FATAL] {e}")
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
        print(f"[{ts()}] Shutdown complete.")


if __name__ == "__main__":
    main()
