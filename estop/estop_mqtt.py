import time
import sys
import traceback
import json
import random
import subprocess
import threading
import signal
import os
from smbus2 import SMBus
import paho.mqtt.client as mqtt

# =================== CONFIGURATION ===================
I2C_BUS = 1
ADS1115_ADDR = 0x48

REG_CONVERSION = 0x00
REG_CONFIG = 0x01

# ADS1115 single-ended MUX values:
# AIN0=0x4000, AIN1=0x5000, AIN2=0x6000, AIN3=0x7000
MUX_CH0 = 0x4000
MUX_CH1 = 0x5000
MUX_CH2 = 0x6000
MUX_CH3 = 0x7000

CONFIG_OS_SINGLE         = 0x8000
# PGA bits (FSR): 6.144=0x0000, 4.096=0x0200, 2.048=0x0400, 1.024=0x0600, 0.512=0x0800, 0.256=0x0A00
CONFIG_PGA_6_144V        = 0x0000
CONFIG_PGA_4_096V        = 0x0200
CONFIG_PGA_2_048V        = 0x0400
CONFIG_PGA_1_024V        = 0x0600
CONFIG_PGA_0_512V        = 0x0800
CONFIG_PGA_0_256V        = 0x0A00

CONFIG_MODE_SINGLE       = 0x0100
CONFIG_DR_128SPS         = 0x0080
CONFIG_COMP_QUE_DISABLE  = 0x0003

# Map PGA bits -> FSR volts for proper V/bit per-channel math
PGA_TO_FSR = {
    CONFIG_PGA_6_144V: 6.144,
    CONFIG_PGA_4_096V: 4.096,
    CONFIG_PGA_2_048V: 2.048,
    CONFIG_PGA_1_024V: 1.024,
    CONFIG_PGA_0_512V: 0.512,
    CONFIG_PGA_0_256V: 0.256,
}

# --------- BUTTON/THRESHOLD DEFAULTS (can be overridden by JSON) ---------
# Defaults preserved here, but actual values will be read from config.
DEFAULT_PRESS_THRESHOLD_V   = 0.4
DEFAULT_RELEASE_THRESHOLD_V = 0.7
DEFAULT_BUTTON_HOLD_TIME_S  = 0.25

# Poll and other timings
POLL_INTERVAL_SEC = 0.05
I2C_ERROR_COOLDOWN_SEC = 1.0
MIN_EVENT_INTERVAL = 5.0      # Minimum seconds between events to avoid spam

CONFIG_PATH = "/app/bodycam2/camera/conf/config.json"

# --------- BATTERY MONITOR CONFIG ---------
BATTERY_CHANNEL = 0                 # Read battery on CH0
BATTERY_SAMPLE_INTERVAL_SEC = 1.0   # One burst per second
BATTERY_BURST_SAMPLES = 10          # N samples per burst (median used)
BATTERY_AVG_WINDOW = 30             # 30 bursts (~30 s) for steady output
BATTERY_WRITE_PERIOD_SEC = 10.0     # Write every 10 s
BATTERY_OUTPUT_PATH = "/tmp/battery.dat"
BATTERY_DECIMAL_PLACES = 4          # e.g. "3.1150"

# Divider is currently reversed on hardware:
# Rtop = 4.7k (battery -> AIN0), Rbottom = 30k (AIN0 -> GND)
RTOP_OHMS = 4700.0
RBOT_OHMS = 30000.0

# Calibrated scale: true_battery_volts = node_volts * DIVIDER_SCALE
# (Replace this with V_fluke / node if you re-calibrate later.)
DIVIDER_SCALE = 1.158241

# Per-channel PGA selections:
# - Battery on CH0: keep ±4.096 V for headroom (reversed divider can put node ~3.6V at 4.2V battery)
# - Pressure pad on CH3: ±4.096 V as before
PGA_CH0 = CONFIG_PGA_4_096V
PGA_CH3 = CONFIG_PGA_4_096V

# ADS1115 timing (settle + conversion at 128 SPS). Slightly generous for stability.
CONVERSION_DELAY_SEC = 0.015

# Absolute input warning threshold: with VDD=3.3V, abs max ≈ VDD + 0.3 ≈ 3.6V
AIN_ABSMAX_WARN = 3.55

exit_event = threading.Event()

# =================== UTILITY/MQTT (MATCHES IMU) ===================
def get_shell_output(command):
    try:
        output = subprocess.check_output(
            command, shell=True, stderr=subprocess.STDOUT, universal_newlines=True
        )
        return output.strip()
    except Exception as e:
        print(f"[CONFIG] ERROR: Failed to run shell command for client_id: '{command}' -> {e}")
        return None

def load_config(path=CONFIG_PATH):
    try:
        with open(path, "r") as f:
            cfg = json.load(f)
    except FileNotFoundError:
        print(f"[CONFIG] ERROR: Config file not found at {path}. Exiting.")
        sys.exit(100)
    except Exception as e:
        print(f"[CONFIG] ERROR: Failed to read config: {e}")
        sys.exit(101)
    return cfg

def _get_cfg_float(cfg, key, default, min_ok=None, max_ok=None):
    """
    Safely parse a float from cfg[key]; accept int/float/str; apply bounds if given.
    On any issue, return default and log a warning.
    """
    val = cfg.get(key, default)
    try:
        # Some configs store as strings; int/float are fine too
        f = float(val)
        if (min_ok is not None and f < min_ok) or (max_ok is not None and f > max_ok):
            print(f"[CONFIG] WARN: '{key}'={f} out of range ({min_ok}, {max_ok}); using default {default}.")
            return default
        return f
    except Exception:
        print(f"[CONFIG] WARN: Could not parse '{key}' from config; using default {default}.")
        return default

def build_mqtt_settings(cfg):
    for k in ("server", "port_s", "username", "client_id"):
        if k not in cfg:
            print(f"[CONFIG] ERROR: Missing key '{k}' in config file.")
            sys.exit(102)
    mqtt_broker = cfg.get("server")
    try:
        mqtt_port = int(cfg.get("port_s"))
    except Exception:
        print("[CONFIG] ERROR: Invalid port_s value in config, must be int.")
        sys.exit(103)
    mqtt_username = cfg.get("username")
    mqtt_password = cfg.get("password", "")
    mqtt_keepalive = int(cfg.get("keepalive", 20))
    mqtt_ws_path = cfg.get("path", "/mqtt")
    mqtt_use_ws = True
    mqtt_protocol = mqtt.MQTTv5
    base_id = get_shell_output(cfg.get("client_id"))
    if not base_id:
        print("[CONFIG] ERROR: Could not determine base client_id, exiting.")
        sys.exit(104)
    # NOTE: topic ends with /button
    mqtt_topic = f"device-{base_id}"
    rand_num = random.randint(10, 99)
    mqtt_client_id = f"{mqtt_topic}-{rand_num}"
    mqtt_topic = f"device/{mqtt_topic}/button"
    print(f"[MQTT] INFO: MQTT_TOPIC: {mqtt_topic}.")
    print(f"[MQTT] INFO: MQTT_CLIENT_ID: {mqtt_client_id}.")
    return dict(
        broker=mqtt_broker,
        port=mqtt_port,
        username=mqtt_username,
        password=mqtt_password,
        keepalive=mqtt_keepalive,
        ws_path=mqtt_ws_path,
        use_ws=mqtt_use_ws,
        protocol=mqtt_protocol,
        topic=mqtt_topic,
        client_id=mqtt_client_id,
        device_id=mqtt_client_id
    )

class MQTTPublisher:
    def __init__(self, mqtt_settings):
        self.connected = False
        self._closed = False
        self.settings = mqtt_settings
        self.client = mqtt.Client(
            mqtt.CallbackAPIVersion.VERSION2,
            client_id=self.settings["client_id"],
            protocol=self.settings["protocol"],
            transport="websockets" if self.settings["use_ws"] else "tcp"
        )
        if self.settings["username"]:
            self.client.username_pw_set(self.settings["username"], self.settings["password"])
        self._setup_callbacks()

    def _setup_callbacks(self):
        def on_connect(client, userdata, flags, reason_code, properties):
            if hasattr(reason_code, "value") and reason_code.value == 0:
                print("[MQTT] Connected successfully.")
                self.connected = True
            elif reason_code == 0:
                print("[MQTT] Connected successfully (int reason_code).")
                self.connected = True
            else:
                print(f"[MQTT] Connect failed, reason: {reason_code}")
                self.connected = False

        def on_disconnect(client, userdata, flags, reason_code, properties):
            print(f"[MQTT] Disconnected, reason: {reason_code}")
            self.connected = False

        self.client.on_connect = on_connect
        self.client.on_disconnect = on_disconnect

    def connect(self):
        while not self.connected and not exit_event.is_set():
            try:
                if self.settings["use_ws"]:
                    self.client.tls_set()
                    self.client.ws_set_options(path=self.settings["ws_path"])
                self.client.connect(
                    self.settings["broker"],
                    self.settings["port"],
                    keepalive=self.settings["keepalive"]
                )
                self.client.loop_start()
                for _ in range(100):
                    if self.connected:
                        break
                    time.sleep(0.1)
                if not self.connected:
                    print("[MQTT] Waiting for broker connection...]")
            except Exception as e:
                print(f"[MQTT] Connect error: {e}. Retrying in 5 sec.")
                sys.exit(-1)

    def publish(self, payload):
        if not self.connected and not exit_event.is_set():
            self.connect()
        try:
            if isinstance(payload, dict):
                payload = json.dumps(payload)
            result = self.client.publish(self.settings["topic"], payload, qos=0)
            if result.rc != mqtt.MQTT_ERR_SUCCESS:
                print(f"[MQTT] Publish failed, code: {result.rc}")
        except Exception as e:
            print(f"[MQTT] Publish exception: {e}")

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

def handle_exit_signal(signum, frame):
    print(f"[Main] Received exit signal {signum}, shutting down gracefully.")
    exit_event.set()

# ---------- I2C retry helper ----------
def _i2c_retry(op, retries=3, delay=0.003):
    """
    Retry an I2C operation callable() a few times to ride out transient NACKs.
    Raises the last exception if all retries fail.
    """
    last = None
    for _ in range(retries):
        try:
            return op()
        except OSError as e:
            last = e
            time.sleep(delay)
    raise last if last else RuntimeError("Unknown I2C error")

# ---------- ADS1115 Helpers (thread-safe, per-channel PGA, dummy-read to settle) ----------
def _ads1115_single_ended_voltage(bus, mux_bits, pga_bits, bus_lock):
    """
    Single-shot conversion on the given single-ended channel with the specified PGA.
    We perform a dummy conversion after a mux/PGA change to allow the input cap to
    settle when source impedance is a few kΩ, then read a second time and return it.
    Returns voltage at the ADC pin (not scaled for any external divider).
    """
    fsr = PGA_TO_FSR.get(pga_bits, 4.096)
    lsb = fsr / 32768.0

    def _convert_once():
        config = (CONFIG_OS_SINGLE |
                  mux_bits |
                  pga_bits |
                  CONFIG_MODE_SINGLE |
                  CONFIG_DR_128SPS |
                  CONFIG_COMP_QUE_DISABLE)
        cfg_bytes = config.to_bytes(2, 'big')
        with bus_lock:
            _i2c_retry(lambda: bus.write_i2c_block_data(ADS1115_ADDR, REG_CONFIG, list(cfg_bytes)))
        time.sleep(CONVERSION_DELAY_SEC)  # settle + conversion
        with bus_lock:
            data = _i2c_retry(lambda: bus.read_i2c_block_data(ADS1115_ADDR, REG_CONVERSION, 2))
        raw = (data[0] << 8) | data[1]
        if raw > 0x7FFF:
            raw -= 0x10000
        v = raw * lsb
        return 0.0 if v < 0 else v

    # Dummy then real conversion
    _ = _convert_once()
    return _convert_once()

def read_ads1115_ch3(bus, bus_lock):
    # Pressure pad: keep original ±4.096 V headroom
    return _ads1115_single_ended_voltage(bus, MUX_CH3, PGA_CH3, bus_lock)

def read_ads1115_ch0(bus, bus_lock):
    # Battery (current reversed divider): use ±4.096 V for headroom
    return _ads1115_single_ended_voltage(bus, MUX_CH0, PGA_CH0, bus_lock)

def read_ads1115_ch0_burst(bus, bus_lock, n=10):
    """
    Burst-read CH0 at the SAME mux/PGA without switching channels between samples.
    Uses one dummy+real via helper (to settle), then triggers (n-1) more conversions
    at the same settings and returns the BURST MEDIAN (robust to outliers).
    """
    samples = []

    # First sample path (includes dummy read via helper)
    first = read_ads1115_ch0(bus, bus_lock)
    samples.append(first)

    # Now stay on CH0 at same PGA; repeatedly trigger conversions
    fsr = PGA_TO_FSR[PGA_CH0]
    lsb = fsr / 32768.0
    config = (CONFIG_OS_SINGLE | MUX_CH0 | PGA_CH0 |
              CONFIG_MODE_SINGLE | CONFIG_DR_128SPS | CONFIG_COMP_QUE_DISABLE)
    cfg_bytes = config.to_bytes(2, 'big')

    for _ in range(max(1, n) - 1):
        with bus_lock:
            _i2c_retry(lambda: bus.write_i2c_block_data(ADS1115_ADDR, REG_CONFIG, list(cfg_bytes)))
        time.sleep(CONVERSION_DELAY_SEC)
        with bus_lock:
            data = _i2c_retry(lambda: bus.read_i2c_block_data(ADS1115_ADDR, REG_CONVERSION, 2))
        raw = (data[0] << 8) | data[1]
        if raw > 0x7FFF:
            raw -= 0x10000
        v = raw * lsb
        samples.append(0.0 if v < 0 else v)

    # Median-of-burst
    samples.sort()
    m = samples[len(samples)//2] if len(samples) % 2 == 1 else \
        0.5 * (samples[len(samples)//2 - 1] + samples[len(samples)//2])
    return m

# =================== BUTTON DETECTOR WITH MOVING AVERAGE + HYSTERESIS ===================
class ButtonMonitor:
    def __init__(self, bus, bus_lock, mqtt_pub, mqtt_settings, press_v, release_v, hold_time_s):
        self.bus = bus
        self.bus_lock = bus_lock
        self.mqtt_pub = mqtt_pub
        self.mqtt_settings = mqtt_settings
        self.press_threshold_v = press_v
        self.release_threshold_v = release_v
        self.hold_time_s = hold_time_s

        self.last_press_time = 0
        self.press_start_time = None
        self.moving_window = []
        self.state = 'RELEASED'

    def log(self, msg, important=False):
        print(f"[{time.strftime('%Y-%m-%d %H:%M:%S')}] {msg}")

    def run(self):
        while not exit_event.is_set():
            try:
                voltage = read_ads1115_ch3(self.bus, self.bus_lock)
                # Update moving average window
                self.moving_window.append(voltage)
                if len(self.moving_window) > 5:  # keep same short smoothing for pad
                    self.moving_window.pop(0)
                avg_voltage = sum(self.moving_window) / len(self.moving_window)
                now = time.time()

                # --- Hysteresis-based state machine (using config thresholds) ---
                if self.state == 'RELEASED':
                    if avg_voltage < self.press_threshold_v:
                        self.state = 'PRESSED'
                        self.press_start_time = now
                        self.log(f"Button pressed (avg {avg_voltage:.3f} V)")
                elif self.state == 'PRESSED':
                    if avg_voltage > self.release_threshold_v:
                        self.state = 'RELEASED'
                        self.press_start_time = None
                        self.log(f"Button released (avg {avg_voltage:.3f} V)")
                    else:
                        # Still pressed, check if held long enough and not sent recently
                        held_time = now - self.press_start_time if self.press_start_time else 0
                        if held_time >= self.hold_time_s and (now - self.last_press_time) > MIN_EVENT_INTERVAL:
                            payload = {
                                'device_id': self.mqtt_settings["client_id"][:-3],
                                'device_type': 'camera',
                                'ts': int(now),
                                'status': 'emergency'
                            }
                            self.log(f"EMERGENCY BUTTON HELD {held_time:.1f}s (avg {avg_voltage:.3f}V), Sending MQTT", important=True)
                            try:
                                self.mqtt_pub.publish(payload)
                                self.last_press_time = now
                            except Exception as e:
                                self.log(f"MQTT publish error: {e}", important=True)

                # (Optional: log average voltage in debug)
                # self.log(f"avg_voltage={avg_voltage:.3f} V, raw={voltage:.3f} V")
                time.sleep(POLL_INTERVAL_SEC)
            except Exception as e:
                self.log(f"Error in main loop: {e}", important=True)
                traceback.print_exc()
                time.sleep(I2C_ERROR_COOLDOWN_SEC)

# =================== BATTERY MONITOR ===================
class BatteryMonitor(threading.Thread):
    """
    Once per second, take a short burst on CH0 (median) to reduce noise/outliers.
    Keep a 30-sample moving average for a steady battery figure.
    Write to /tmp/battery.dat every 10 s with 4 decimals, reporting TRUE battery volts.
    Includes a guardrail warning if AIN0 approaches VDD + 0.3 (~3.6 V at 3.3 V supply).
    """
    def __init__(self, bus, bus_lock):
        super().__init__(daemon=True)
        self.bus = bus
        self.bus_lock = bus_lock
        self.window = []
        self.last_write_ts = 0.0

    def safe_write_atomic(self, path, content):
        tmp_path = f"{path}.tmp"
        try:
            with open(tmp_path, "w") as f:
                f.write(content)
                f.flush()
                os.fsync(f.fileno())
            os.replace(tmp_path, path)  # atomic on POSIX
        except Exception as e:
            print(f"[Battery] ERROR writing file '{path}': {e}")

    def run(self):
        next_sample_ts = time.time()
        self.last_write_ts = time.time()
        while not exit_event.is_set():
            now = time.time()
            # Sample once per second cadence
            if now >= next_sample_ts:
                try:
                    v_node = read_ads1115_ch0_burst(self.bus, self.bus_lock, n=BATTERY_BURST_SAMPLES)
                    if v_node < 0.0:
                        v_node = 0.0

                    # Simple outlier guard vs previous sample (rare after median, but cheap)
                    if self.window:
                        last = self.window[-1]
                        if abs(v_node - last) > 0.3:  # clamp crazy jumps at the node
                            v_node = last

                    self.window.append(v_node)
                    if len(self.window) > BATTERY_AVG_WINDOW:
                        self.window.pop(0)

                    # Warn if near absolute input limit
                    if v_node > AIN_ABSMAX_WARN:
                        print(f"[Battery] WARNING: AIN0 high ({v_node:.3f}V) near abs max (~3.6V). Check divider / supply.")
                except Exception as e:
                    print(f"[Battery] I2C read error: {e}")
                    # keep going; just skip this sample
                next_sample_ts += BATTERY_SAMPLE_INTERVAL_SEC

            # Every 10 seconds, write current moving average (scaled to true battery volts)
            if (now - self.last_write_ts) >= BATTERY_WRITE_PERIOD_SEC:
                if self.window:
                    avg_v_node = sum(self.window) / len(self.window)
                    avg_v_batt = avg_v_node * DIVIDER_SCALE  # node -> true battery voltage
                    out = f"{avg_v_batt:.{BATTERY_DECIMAL_PLACES}f}\n"
                    self.safe_write_atomic(BATTERY_OUTPUT_PATH, out)
                    # Optional: print for visibility
                    print(f"[Battery] Wrote {BATTERY_OUTPUT_PATH}: {out.strip()} (node={avg_v_node:.4f}V, scale={DIVIDER_SCALE:.6f})")
                else:
                    out = f"{0.0:.{BATTERY_DECIMAL_PLACES}f}\n"
                    self.safe_write_atomic(BATTERY_OUTPUT_PATH, out)
                    print(f"[Battery] Wrote {BATTERY_OUTPUT_PATH}: {out.strip()} (no samples yet)")
                self.last_write_ts = now

            # Sleep a bit to avoid tight loop; wake early if exit_event set
            exit_event.wait(0.05)

# =================== MAIN ===================
def main():
    # Signals
    signal.signal(signal.SIGTERM, handle_exit_signal)
    signal.signal(signal.SIGINT, handle_exit_signal)
    if hasattr(signal, "SIGHUP"):
        signal.signal(signal.SIGHUP, handle_exit_signal)

    cfg = load_config()
    mqtt_settings = build_mqtt_settings(cfg)

    # --- Read button thresholds from JSON with safe defaults & sanity checks ---
    press_threshold_v   = _get_cfg_float(cfg, "press_threshold_v",   DEFAULT_PRESS_THRESHOLD_V,   0.0, 5.0)
    release_threshold_v = _get_cfg_float(cfg, "release_threshold_v", DEFAULT_RELEASE_THRESHOLD_V, 0.0, 5.0)
    hold_time_s         = _get_cfg_float(cfg, "button_hold_time_s",  DEFAULT_BUTTON_HOLD_TIME_S,  0.0, 10.0)

    # Guard against mis-ordered thresholds (if someone fat-fingers the JSON)
    if release_threshold_v <= press_threshold_v:
        print(f"[CONFIG] WARN: release_threshold_v ({release_threshold_v}) <= press_threshold_v ({press_threshold_v}); adjusting.")
        # Maintain at least 50 mV hysteresis
        release_threshold_v = press_threshold_v + 0.05

    mqtt_pub = MQTTPublisher(mqtt_settings)

    bus_lock = threading.Lock()

    try:
        with SMBus(I2C_BUS) as bus:
            mqtt_pub.connect()

            # Start battery monitor thread
            battery_monitor = BatteryMonitor(bus, bus_lock)
            battery_monitor.start()

            # Run button monitor (blocking loop) with configured thresholds
            monitor = ButtonMonitor(
                bus, bus_lock, mqtt_pub, mqtt_settings,
                press_threshold_v, release_threshold_v, hold_time_s
            )
            monitor.run()

            # If button monitor ever exits, ensure we stop the battery thread
            exit_event.set()
            battery_monitor.join(timeout=2.0)

    except KeyboardInterrupt:
        print("\nExiting gracefully.")
    except Exception as e:
        print(f"Critical error: {e}")
        traceback.print_exc()
        sys.exit(1)
    finally:
        mqtt_pub.close()
        print("[Main] Exiting cleanly.")

if __name__ == "__main__":
    main()

