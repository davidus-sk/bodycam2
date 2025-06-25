import time
import sys
import traceback
import json
import random
import subprocess
import threading
import signal
from smbus2 import SMBus
import paho.mqtt.client as mqtt

# =================== CONFIGURATION ===================
I2C_BUS = 1
ADS1115_ADDR = 0x48

REG_CONVERSION = 0x00
REG_CONFIG = 0x01
MUX_CH3 = 0x7000

CONFIG_OS_SINGLE      = 0x8000
CONFIG_PGA_4_096V     = 0x0200
CONFIG_MODE_SINGLE    = 0x0100
CONFIG_DR_128SPS      = 0x0080
CONFIG_COMP_QUE_DISABLE = 0x0003

LSB_SIZE = 4.096 / 32768  # V/bit

# --------- BUTTON/THRESHOLD CONFIG (EDIT HERE) ---------
BUTTON_CHANNEL = 3
MOVING_AVG_WINDOW = 5        # Number of readings for moving average (tuneable)
PRESS_THRESHOLD_V = 1.25       # Below this = pressed
RELEASE_THRESHOLD_V = 3.0     # Above this = released (hysteresis)
BUTTON_HOLD_TIME_SEC = 0.25    # Required "held" time (seconds)
POLL_INTERVAL_SEC = 0.05      # ADC poll interval (seconds)
I2C_ERROR_COOLDOWN_SEC = 1.0
MIN_EVENT_INTERVAL = 5.0      # Minimum seconds between events to avoid spam

CONFIG_PATH = "/app/bodycam2/camera/conf/config.json"

exit_event = threading.Event()

# =================== UTILITY/MQTT (MATCHES IMU) ===================
def get_shell_output(command):
    try:
        output = subprocess.check_output(command, shell=True, stderr=subprocess.STDOUT, universal_newlines=True)
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
    # NOTE: topic ends with /button, not /fall
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
                    print("[MQTT] Waiting for broker connection...")
            except Exception as e:
                print(f"[MQTT] Connect error: {e}. Retrying in 5 sec.")
                time.sleep(5)

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

def read_ads1115_ch3(bus):
    config = (CONFIG_OS_SINGLE |
              MUX_CH3 |
              CONFIG_PGA_4_096V |
              CONFIG_MODE_SINGLE |
              CONFIG_DR_128SPS |
              CONFIG_COMP_QUE_DISABLE)
    config_bytes = config.to_bytes(2, 'big')
    bus.write_i2c_block_data(ADS1115_ADDR, REG_CONFIG, list(config_bytes))
    time.sleep(0.008)  # Conversion delay
    data = bus.read_i2c_block_data(ADS1115_ADDR, REG_CONVERSION, 2)
    raw_adc = (data[0] << 8) | data[1]
    if raw_adc > 0x7FFF:
        raw_adc -= 0x10000
    voltage = raw_adc * LSB_SIZE
    return voltage

# =================== BUTTON DETECTOR WITH MOVING AVERAGE + HYSTERESIS ===================
class ButtonMonitor:
    def __init__(self, bus, mqtt_pub, mqtt_settings):
        self.bus = bus
        self.mqtt_pub = mqtt_pub
        self.mqtt_settings = mqtt_settings
        self.last_press_time = 0
        self.press_start_time = None
        self.moving_window = []
        self.state = 'RELEASED'

    def log(self, msg, important=False):
        print(f"[{time.strftime('%Y-%m-%d %H:%M:%S')}] {msg}")

    def run(self):
        while not exit_event.is_set():
            try:
                voltage = read_ads1115_ch3(self.bus)
                # Update moving average window
                self.moving_window.append(voltage)
                if len(self.moving_window) > MOVING_AVG_WINDOW:
                    self.moving_window.pop(0)
                avg_voltage = sum(self.moving_window) / len(self.moving_window)
                now = time.time()

                # --- Hysteresis-based state machine ---
                if self.state == 'RELEASED':
                    if avg_voltage < PRESS_THRESHOLD_V:
                        self.state = 'PRESSED'
                        self.press_start_time = now
                        self.log(f"Button pressed (avg {avg_voltage:.3f} V)")
                elif self.state == 'PRESSED':
                    if avg_voltage > RELEASE_THRESHOLD_V:
                        self.state = 'RELEASED'
                        self.press_start_time = None
                        self.log(f"Button released (avg {avg_voltage:.3f} V)")
                    else:
                        # Still pressed, check if held long enough and not sent recently
                        held_time = now - self.press_start_time if self.press_start_time else 0
                        if held_time >= BUTTON_HOLD_TIME_SEC and (now - self.last_press_time) > MIN_EVENT_INTERVAL:
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
                            # Only send ONCE per press (until released)
                # (Optional: log average voltage in debug)
                # self.log(f"avg_voltage={avg_voltage:.3f} V, raw={voltage:.3f} V")

                time.sleep(POLL_INTERVAL_SEC)
            except Exception as e:
                self.log(f"Error in main loop: {e}", important=True)
                traceback.print_exc()
                time.sleep(I2C_ERROR_COOLDOWN_SEC)

# =================== MAIN ===================
def main():
    # Signals
    signal.signal(signal.SIGTERM, handle_exit_signal)
    signal.signal(signal.SIGINT, handle_exit_signal)
    if hasattr(signal, "SIGHUP"):
        signal.signal(signal.SIGHUP, handle_exit_signal)

    cfg = load_config()
    mqtt_settings = build_mqtt_settings(cfg)
    mqtt_pub = MQTTPublisher(mqtt_settings)

    try:
        with SMBus(I2C_BUS) as bus:
            mqtt_pub.connect()
            monitor = ButtonMonitor(bus, mqtt_pub, mqtt_settings)
            monitor.run()
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
