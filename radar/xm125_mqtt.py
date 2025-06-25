"""
XM125 Distance Detector to MQTT Publisher
Production: Only pushes/prints if peaks are detected.
All MQTT settings, client ID, and topic are dynamically loaded from JSON config and shell command.
"""

import time
import sys
import json
import traceback
import random
import subprocess
import signal
import threading
import os
from smbus2 import SMBus, i2c_msg
import paho.mqtt.client as mqtt

CONFIG_PATH = "/app/bodycam2/camera/conf/config.json"

# ==============================
#         CONFIGURATION
# ==============================
START_MM = 500
END_MM = 6000
THRESHOLD_SENS = 500        # Lower = less sensitive (1–1000)
THRESHOLD_METHOD = 3        # 1 = FIXED AMPLITUDE, 2 = RECORDED, 3 = CFAR, 4 = FIXED STRENGTH
MAX_STEP_LENGTH = 1         # 0 = auto (default/profile-based), or set for speed/precision
SIGNAL_QUALITY = 15000      # Higher = better SNR (and more power). Default 15000
NUM_FRAMES_RECORDED = 100   # Used only if Threshold Method is RECORDED
REFLECTOR_SHAPE = 1         # 1 = GENERIC, 2 = PLANAR
MEASUREMENT_INTERVAL = 1  # (seconds)

# ==============================
#      XM125 I2C Registers
# ==============================
I2C_ADDR = 0x52

REG_DETECTOR_STATUS    = 0x0003
REG_DISTANCE_RESULT    = 0x0010
REG_START              = 0x0040
REG_END                = 0x0041
REG_MAX_STEP_LENGTH    = 0x0042
REG_SIGNAL_QUALITY     = 0x0044
REG_THRESHOLD_METHOD   = 0x0046
REG_PEAK_SORTING       = 0x0047
REG_NUM_FRAMES_REC     = 0x0048
REG_THRESHOLD_SENSITIVITY = 0x004A
REG_REFLECTOR_SHAPE    = 0x004B
REG_MEASURE_ON_WAKEUP  = 0x0080
REG_COMMAND            = 0x0100

PEAK_DIST_BASE      = 0x0011  # Peak0 Distance
PEAK_STRENGTH_BASE  = 0x001B  # Peak0 Strength

CMD_APPLY_CONFIG_AND_CALIB = 1
CMD_MEASURE_DISTANCE       = 2
CMD_APPLY_CONFIGURATION    = 3
CMD_CALIBRATE              = 4
CMD_RECALIBRATE            = 5
CMD_RESET_MODULE           = 1381192737

ERROR_MASK = (
    0x00010000 | 0x00020000 | 0x00040000 | 0x00080000 | 0x00100000 |
    0x00200000 | 0x00400000 | 0x00800000 | 0x01000000 | 0x02000000 | 0x10000000
)

# ==============================
#         GLOBALS
# ==============================
exit_event = threading.Event()

# ==============================
#   CONFIG LOADING FUNCTIONS
# ==============================

def load_config(path=CONFIG_PATH):
    """Load config JSON, return as dict. Exits with log if critical error."""
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

def get_shell_output(command):
    """Runs shell command and returns stdout as string (stripped)."""
    try:
        output = subprocess.check_output(command, shell=True, stderr=subprocess.STDOUT, universal_newlines=True)
        return output.strip()
    except Exception as e:
        print(f"[CONFIG] ERROR: Failed to run shell command for client_id: '{command}' -> {e}")
        return None

def build_mqtt_settings(cfg):
    """Returns dict with all required MQTT settings built from config.json and rules."""
    # Sanity checks and fallbacks
    for k in ("server", "port_s", "username", "client_id"):
        if k not in cfg:
            print(f"[CONFIG] ERROR: Missing key '{k}' in config file.")
            sys.exit(102)

    # Broker/server
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
    mqtt_use_ws = True  # Always True, matches your current logic
    mqtt_protocol = mqtt.MQTTv5  # Or mqtt.MQTTv311 if you need to support old brokers

    # Special: client_id is a shell command
    base_id = get_shell_output(cfg.get("client_id"))
    if not base_id:
        print("[CONFIG] ERROR: Could not determine base client_id, exiting.")
        sys.exit(104)

    mqtt_topic = f"device-{base_id}"     # topic (not a path, just the device ID)
    rand_num = random.randint(10, 99)    # Always 2-digit
    mqtt_client_id = f"{mqtt_topic}-{rand_num}"
    mqtt_topic = f"device/{mqtt_topic}/distance"  # final topic with path
    print(f"[MQTT] INFO: MQTT_TOPIC: {mqtt_topic}.")
    print(f"[MQTT] INFO: MQTT_CLIENT_ID: {mqtt_client_id}.")

    # Return all needed settings
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
        client_id=mqtt_client_id
    )


# ==============================
#       LOW-LEVEL I2C OPS
# ==============================
def write_reg(addr, value):
    """Write a 32-bit register at the given 16-bit address (big-endian)."""
    data = addr.to_bytes(2, 'big') + value.to_bytes(4, 'big', signed=False)
    try:
        with SMBus(1) as bus:
            bus.write_i2c_block_data(I2C_ADDR, data[0], list(data[1:]))
    except Exception as e:
        print(f"[I2C] Write error at reg 0x{addr:04X}: {e}")
        raise

def read_reg(addr):
    """Read an unsigned 32-bit register at the given 16-bit address (big-endian)."""
    try:
        with SMBus(1) as bus:
            addr_bytes = addr.to_bytes(2, 'big')
            bus.i2c_rdwr(i2c_msg.write(I2C_ADDR, addr_bytes))
            read = i2c_msg.read(I2C_ADDR, 4)
            bus.i2c_rdwr(read)
            data = bytes(read)
            return int.from_bytes(data, 'big', signed=False)
    except Exception as e:
        print(f"[I2C] Read error at reg 0x{addr:04X}: {e}")
        raise

def read_reg_signed(addr):
    """Read a signed 32-bit register at the given 16-bit address (big-endian)."""
    try:
        with SMBus(1) as bus:
            addr_bytes = addr.to_bytes(2, 'big')
            bus.i2c_rdwr(i2c_msg.write(I2C_ADDR, addr_bytes))
            read = i2c_msg.read(I2C_ADDR, 4)
            bus.i2c_rdwr(read)
            data = bytes(read)
            return int.from_bytes(data, 'big', signed=True)
    except Exception as e:
        print(f"[I2C] Read (signed) error at reg 0x{addr:04X}: {e}")
        raise

def poll_not_busy(timeout=5.0):
    """Poll until Busy bit clears or timeout, else raise."""
    t0 = time.time()
    while time.time() - t0 < timeout:
        status = read_reg(REG_DETECTOR_STATUS)
        if (status & 0x80000000) == 0:  # Busy bit is bit 31
            return status
        time.sleep(0.05)
    raise TimeoutError("Timeout waiting for busy to clear.")

def check_no_errors(status):
    """Check if status has any error bits set."""
    if status & ERROR_MASK:
        print(f"[XM125] ERROR detected! Status: 0x{status:08X}")
        return False
    return True

def do_reset():
    """Send RESET MODULE command and poll until not busy."""
    print("[XM125] Resetting module...")
    write_reg(REG_COMMAND, CMD_RESET_MODULE)
    time.sleep(0.5)
    try:
        poll_not_busy(8)
    except TimeoutError:
        print("[XM125] Reset busy timeout, may not have completed!")
    status = read_reg(REG_DETECTOR_STATUS)
    print(f"[XM125] Status after reset: 0x{status:08X}")
    return status

def initialize_detector():
    """Fully initialize, configure and calibrate the detector. Retries until success."""
    while not exit_event.is_set():
        try:
            do_reset()
            status = read_reg(REG_DETECTOR_STATUS)
            print(f"[XM125] Initial status: 0x{status:08X}")
            if (status & ERROR_MASK) or (status & 0x80000000):
                print("[XM125] Error/busy on boot, retrying reset.")
                time.sleep(0.5)
                continue
            print(f"[XM125] Writing tunable parameters...")
            write_reg(REG_START, START_MM)
            write_reg(REG_END, END_MM)
            write_reg(REG_THRESHOLD_SENSITIVITY, THRESHOLD_SENS)
            write_reg(REG_THRESHOLD_METHOD, THRESHOLD_METHOD)
            write_reg(REG_MAX_STEP_LENGTH, MAX_STEP_LENGTH)
            write_reg(REG_SIGNAL_QUALITY, SIGNAL_QUALITY)
            write_reg(REG_NUM_FRAMES_REC, NUM_FRAMES_RECORDED)
            write_reg(REG_REFLECTOR_SHAPE, REFLECTOR_SHAPE)
            write_reg(REG_MEASURE_ON_WAKEUP, 0)
            time.sleep(0.1)
            print("[XM125] Applying configuration...")
            write_reg(REG_COMMAND, CMD_APPLY_CONFIGURATION)
            poll_not_busy(6)
            status = read_reg(REG_DETECTOR_STATUS)
            print(f"[XM125] After config: 0x{status:08X}")
            if not check_no_errors(status):
                print("[XM125] Config error, retrying full init.")
                time.sleep(1)
                continue
            print("[XM125] Calibrating...")
            write_reg(REG_COMMAND, CMD_CALIBRATE)
            poll_not_busy(8)
            status = read_reg(REG_DETECTOR_STATUS)
            print(f"[XM125] After calibrate: 0x{status:08X}")
            if not check_no_errors(status):
                print("[XM125] Calibration error, retrying full init.")
                time.sleep(1)
                continue
            print("[XM125] Detector ready.\n")
            return True
        except Exception as e:
            print(f"[XM125] Initialization exception: {e}")
            traceback.print_exc()
            time.sleep(2)
    print("[XM125] Initialization aborted due to exit event.")
    sys.exit(111)


# ==============================
#      MQTT PUBLISHER CLASS
# ==============================
class MQTTPublisher:
    """MQTT publisher for the XM125 data, all params dynamic."""
    def __init__(self, mqtt_settings):
        self.connected = False
        self._closed = False
        self.settings = mqtt_settings

        # Set up the client
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
                    print("[MQTT] Waiting for broker connection...")
            except Exception as e:
                print(f"[MQTT] Connect error: {e}. Retrying in 5 sec.")
                time.sleep(5)

    def publish(self, payload):
        """Publish a payload (dict or string) to the MQTT topic."""
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
            self.client.loop_stop()
            self.client.disconnect()
            self._closed = True


# ==============================
#      MAIN LOGIC LOOP
# ==============================
def get_peaks(num_distances):
    """Return a list of peaks: each is (distance_mm, strength) tuple."""
    peaks = []
    for i in range(num_distances):
        try:
            peak_addr = PEAK_DIST_BASE + i
            strength_addr = PEAK_STRENGTH_BASE + i
            dist_mm = read_reg(peak_addr)
            strength = read_reg_signed(strength_addr)
            peaks.append((dist_mm, strength))
        except Exception as e:
            print(f"[XM125] Error reading peak {i}: {e}")
            peaks.append((None, None))
    return peaks

def handle_exit_signal(signum, frame):
    print(f"[Main] Received exit signal {signum}, shutting down gracefully.")
    exit_event.set()

def main():
    # Register signal handlers for graceful exit on systemd/service
    signal.signal(signal.SIGTERM, handle_exit_signal)
    signal.signal(signal.SIGINT, handle_exit_signal)
    if hasattr(signal, "SIGHUP"):
        signal.signal(signal.SIGHUP, handle_exit_signal)

    print("===== XM125 Distance Detector → MQTT Publisher =====")

    cfg = load_config()
    mqtt_settings = build_mqtt_settings(cfg)
    mqtt_pub = MQTTPublisher(mqtt_settings)

    try:
        initialize_detector()
        mqtt_pub.connect()
        print("Detector initialized. Beginning measurement loop.\n")

        while not exit_event.is_set():
            try:
                # 1. Trigger distance measurement
                write_reg(REG_COMMAND, CMD_MEASURE_DISTANCE)
                poll_not_busy(5)
                status = read_reg(REG_DETECTOR_STATUS)
                if not check_no_errors(status):
                    print("[XM125] Measurement error detected. Re-initializing detector...")
                    initialize_detector()
                    continue

                result = read_reg(REG_DISTANCE_RESULT)
                num_distances = result & 0xF
                near_start = (result >> 8) & 0x1
                calib_needed = (result >> 9) & 0x1
                measure_error = (result >> 10) & 0x1
                temp = (result >> 16) & 0xFFFF

                if measure_error or calib_needed:
                    print("[XM125] Measurement/calibration error. Re-initializing detector...")
                    initialize_detector()
                    continue

                if num_distances > 0:
                    peaks = get_peaks(num_distances)
                    print(f"Status: 0x{status:08X} | Result: 0x{result:08X} | Peaks: {num_distances} | Temp: {temp} | NearEdge: {near_start} | Calib: {calib_needed} | Error: {measure_error}")
                    for i, (dist_mm, strength) in enumerate(peaks):
                        print(f"  Peak {i}: {dist_mm} mm, Strength: {strength}")

                    # --- Find strongest peak ---
                    strongest = None
                    if peaks and all(x is not None for x in peaks):
                        valid = [(i, d, s) for i, (d, s) in enumerate(peaks) if d is not None and s is not None]
                        if valid:
                            i_best, d_best, s_best = min(valid, key=lambda x: abs(x[2]))
                            strongest = {"index": i_best, "distance_mm": d_best, "strength": s_best}

                    # Compose payload and publish only if peaks exist
                    msg = {
                        'device_id': mqtt_settings["client_id"][:-3],
                        'device_type': 'camera',
                        "status": status, 
                        "result": result,
                        "temperature": temp,
                        "num_peaks": num_distances,
                        "near_start_edge": bool(near_start),
                        "calibration_needed": bool(calib_needed),
                        "peaks": [
                            {"index": i, "distance_mm": d, "strength": s}
                            for i, (d, s) in enumerate(peaks)
                        ],
                        'strongest_distance': strongest,
                        'ts': int(time.time()),
                    }
                    mqtt_pub.publish(msg)
                # No peaks: do nothing (no print, no MQTT)

                time.sleep(MEASUREMENT_INTERVAL)

            except Exception as e:
                if exit_event.is_set():
                    break
                print(f"[Main] Unhandled error: {e}")
                traceback.print_exc()
                time.sleep(2)
                initialize_detector()

    except Exception as e:
        print(f"[Main] Fatal error in main loop: {e}")
        traceback.print_exc()
        sys.exit(120)
    finally:
        mqtt_pub.close()
        print("[Main] Exiting cleanly.")

if __name__ == "__main__":
    main()
