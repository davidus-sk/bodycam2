import smbus2
import time
import math
import argparse
from datetime import datetime
import sys
import traceback
import signal
import json
import random
import subprocess
import threading
import paho.mqtt.client as mqtt
import os

# --------- CONFIGURATION ---------
I2C_BUS = 1
MPU6050_ADDR = 0x68
PWR_MGMT_1 = 0x6B
ACCEL_XOUT_H = 0x3B
GYRO_XOUT_H = 0x43

ACCEL_SCALE = 16384.0  # ±2g range
GYRO_SCALE = 131.0     # ±250°/s range

FREE_FALL_THRESHOLD_G = 0.5
IMPACT_THRESHOLD_G = 2.0
IMPACT_THRESHOLD_GYRO = 250
INACTIVITY_GYRO_THRESHOLD = 20
INACTIVITY_PERIOD_SEC = 2.0
INACTIVITY_ALLOWED_MOVEMENT_FRAC = 0.2
IMPACT_STABILIZATION_DELAY = 0.2
MIN_VALID_ACCEL_SUM = 0.05
I2C_ERROR_COOLDOWN_SEC = 1.0
FREE_FALL_IMPACT_WINDOW = 1.0
MIN_EVENT_INTERVAL = 5.0

CONFIG_PATH = "/app/bodycam2/camera/conf/config.json"

exit_event = threading.Event()

# --------- UTILITY FUNCTIONS ---------
def read_word(bus, addr, reg):
    high = bus.read_byte_data(addr, reg)
    low = bus.read_byte_data(addr, reg + 1)
    value = (high << 8) + low
    return value if value < 0x8000 else value - 65536

def get_mpu6050(bus):
    ax = read_word(bus, MPU6050_ADDR, ACCEL_XOUT_H) / ACCEL_SCALE
    ay = read_word(bus, MPU6050_ADDR, ACCEL_XOUT_H + 2) / ACCEL_SCALE
    az = read_word(bus, MPU6050_ADDR, ACCEL_XOUT_H + 4) / ACCEL_SCALE
    gx = read_word(bus, MPU6050_ADDR, GYRO_XOUT_H) / GYRO_SCALE
    gy = read_word(bus, MPU6050_ADDR, GYRO_XOUT_H + 2) / GYRO_SCALE
    gz = read_word(bus, MPU6050_ADDR, GYRO_XOUT_H + 4) / GYRO_SCALE
    return ax, ay, az, gx, gy, gz

def magnitude(x, y, z):
    return math.sqrt(x * x + y * y + z * z)

def timestamp():
    return datetime.now().strftime("%Y-%m-%d %H:%M:%S")

def get_shell_output(command):
    try:
        output = subprocess.check_output(command, shell=True, stderr=subprocess.STDOUT, universal_newlines=True)
        return output.strip()
    except Exception as e:
        print(f"[CONFIG] ERROR: Failed to run shell command for client_id: '{command}' -> {e}")
        return None

# --------- MQTT LOADING (mirrors radar code) ---------
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
    mqtt_topic = f"device-{base_id}"
    rand_num = random.randint(10, 99)
    mqtt_client_id = f"{mqtt_topic}-{rand_num}"
    mqtt_topic = f"device/{mqtt_topic}/fall"
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
                    print("[MQTT] Waiting for broker connection...")
            except Exception as e:
                print(f"[MQTT] Connect error: {e}. Retrying in 5 sec.")
                exit(-1)

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
            self.client.loop_stop()
            self.client.disconnect()
            self._closed = True

def handle_exit_signal(signum, frame):
    print(f"[Main] Received exit signal {signum}, shutting down gracefully.")
    exit_event.set()

# --------- FALL DETECTION CLASS ---------
class FallDetector:
    def __init__(self, bus, mqtt_pub, mqtt_settings, sample_rate_hz=100, verbose=False):
        self.bus = bus
        self.sample_rate_hz = sample_rate_hz
        self.verbose = verbose
        self.mqtt_pub = mqtt_pub
        self.mqtt_settings = mqtt_settings
        self.reset_state()
        print(f"[{timestamp()}] Fall detection initialized.")

    def reset_state(self):
        self.state = "IDLE"
        self.free_fall_time = None
        self.impact_time = None
        self.inactivity_start_time = None
        self.last_event_time = 0
        self.inactivity_buffer = []

    def log(self, message, important=False):
        if self.verbose or important:
            print(f"[{timestamp()}] {message}")

    def run(self):
        interval = 1.0 / self.sample_rate_hz
        while not exit_event.is_set():
            try:
                ax, ay, az, gx, gy, gz = get_mpu6050(self.bus)
                a_mag = magnitude(ax, ay, az)
                g_mag = magnitude(gx, gy, gz)

                if abs(ax) + abs(ay) + abs(az) < MIN_VALID_ACCEL_SUM:
                    self.log("Ignoring invalid accel reading (near zero).", important=True)
                    time.sleep(interval)
                    continue

                current_time = time.time()

                if self.verbose:
                    self.log(f"|a|={a_mag:.2f}g |gyro|={g_mag:.1f}°/s State={self.state}")

                if self.state == "IDLE":
                    if a_mag < FREE_FALL_THRESHOLD_G and (current_time - self.last_event_time) > MIN_EVENT_INTERVAL:
                        self.state = "FREE_FALL"
                        self.free_fall_time = current_time
                        self.log(f"Free fall detected |a|={a_mag:.2f}g", important=True)

                elif self.state == "FREE_FALL":
                    if (current_time - self.free_fall_time) > FREE_FALL_IMPACT_WINDOW:
                        self.log("Free fall expired without impact.", important=True)
                        self.reset_state()
                    elif a_mag > IMPACT_THRESHOLD_G or g_mag > IMPACT_THRESHOLD_GYRO:
                        self.state = "POST_IMPACT"
                        self.impact_time = current_time
                        self.log(f"Impact detected |a|={a_mag:.2f}g |gyro|={g_mag:.1f}°/s", important=True)
                        self.log(f"Stabilizing for {IMPACT_STABILIZATION_DELAY:.2f}s...", important=True)
                        time.sleep(IMPACT_STABILIZATION_DELAY)
                        self.inactivity_start_time = time.time()
                        self.inactivity_buffer.clear()

                elif self.state == "POST_IMPACT":
                    rotation_detected = g_mag > INACTIVITY_GYRO_THRESHOLD
                    self.inactivity_buffer.append(rotation_detected)
                    inactivity_elapsed = current_time - self.inactivity_start_time
                    if inactivity_elapsed >= INACTIVITY_PERIOD_SEC:
                        movement_ratio = sum(self.inactivity_buffer) / len(self.inactivity_buffer)
                        if movement_ratio <= INACTIVITY_ALLOWED_MOVEMENT_FRAC:
                            self.log("FALL CONFIRMED!", important=True)
                            # --- MQTT PAYLOAD (only on fall confirm) ---
                            payload = {
                                'device_id': self.mqtt_settings["client_id"][:-3],
                                'device_type': 'camera',
                                'ts': int(time.time()),
                                'fall': True
                            }
                            try:
                                self.mqtt_pub.publish(payload)
                            except Exception as e:
                                self.log(f"MQTT publish error: {e}", important=True)
                        else:
                            self.log(f"False alarm due to post-impact rotation ({movement_ratio*100:.1f}%)", important=True)
                        self.last_event_time = current_time
                        self.reset_state()
            except Exception as e:
                self.log(f"Sensor error: {e}. Resetting...", important=True)
                traceback.print_exc()
                self.reset_state()
                time.sleep(I2C_ERROR_COOLDOWN_SEC)
            time.sleep(interval)

# --------- MAIN ENTRY POINT ---------
def main():
    parser = argparse.ArgumentParser(description="MPU6050 Fall Detection (Production w/ MQTT)")
    parser.add_argument('--verbose', action='store_true', help='Verbose mode (sensor values)')
    parser.add_argument('--rate', type=int, default=100, help='Sample rate (Hz)')
    args = parser.parse_args()

    # Signals
    signal.signal(signal.SIGTERM, handle_exit_signal)
    signal.signal(signal.SIGINT, handle_exit_signal)
    if hasattr(signal, "SIGHUP"):
        signal.signal(signal.SIGHUP, handle_exit_signal)

    cfg = load_config()
    mqtt_settings = build_mqtt_settings(cfg)
    mqtt_pub = MQTTPublisher(mqtt_settings)

    try:
        with smbus2.SMBus(I2C_BUS) as bus:
            bus.write_byte_data(MPU6050_ADDR, PWR_MGMT_1, 0)
            mqtt_pub.connect()
            detector = FallDetector(bus, mqtt_pub, mqtt_settings, args.rate, args.verbose)
            detector.run()
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
