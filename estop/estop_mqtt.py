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
    MQTT publish to  device/{base_id}/button
    Payload: {"device_id": "...", "device_type": "camera", "ts": ..., "status": "emergency"}

Usage:
    python3 estop_mqtt.py              # normal (MQTT required)
    python3 estop_mqtt.py --skip-mqtt  # local testing without broker
"""

import argparse
import json
import os
import random
import signal
import subprocess
import sys
import threading
import time
import traceback

import gpiod
import paho.mqtt.client as mqtt

# ---------------------------------------------------------------------------
#  Configuration
# ---------------------------------------------------------------------------
ESTOP_GPIO_PINS = [8, 11]            # GPIO 8 and 11
GPIO_CHIP = "/dev/gpiochip0"
LED_GPIO_PIN = 22                    # Optional visual feedback LED

# Debounce: after detecting a falling edge, confirm the pin is still LOW for
# this many milliseconds.  100 ms is short enough for genuine emergency use
# but filters electrical noise on top of the hardware RC filter.
DEBOUNCE_CONFIRM_SEC = 0.100

# Minimum seconds between published e-stop events.
# Prevents MQTT flood if a worker mashes the button repeatedly, while still
# allowing a re-trigger quickly if the first message was lost (QoS 1 helps,
# but belt-and-suspenders).
MIN_EVENT_INTERVAL_SEC = 3.0

# Heartbeat: log a line every N seconds so you can confirm the process lives.
HEARTBEAT_INTERVAL_SEC = 60.0

CONFIG_PATH = "/app/bodycam2/camera/conf/config.json"

# MQTT QoS 1 -- broker ACKs receipt.  Paho auto-retries on failure.
MQTT_QOS = 1

# ---------------------------------------------------------------------------
#  Globals
# ---------------------------------------------------------------------------
exit_event = threading.Event()


# ---------------------------------------------------------------------------
#  Utility / Config
# ---------------------------------------------------------------------------
def ts():
    return time.strftime("%Y-%m-%d %H:%M:%S")


def get_shell_output(command):
    try:
        output = subprocess.check_output(
            command, shell=True, stderr=subprocess.STDOUT, universal_newlines=True
        )
        return output.strip()
    except Exception as e:
        print(f"[{ts()}] [CONFIG] ERROR: shell command failed: '{command}' -> {e}")
        return None


def load_config(path=CONFIG_PATH):
    try:
        with open(path, "r") as f:
            cfg = json.load(f)
    except FileNotFoundError:
        print(f"[{ts()}] [CONFIG] ERROR: Config file not found at {path}. Exiting.")
        sys.exit(100)
    except json.JSONDecodeError as e:
        print(f"[{ts()}] [CONFIG] ERROR: Invalid JSON in {path}: {e}")
        sys.exit(101)
    except Exception as e:
        print(f"[{ts()}] [CONFIG] ERROR: Failed to read config: {e}")
        sys.exit(102)
    return cfg


def build_mqtt_settings(cfg):
    for k in ("server", "port_s", "username", "client_id"):
        if k not in cfg:
            print(f"[{ts()}] [CONFIG] ERROR: Missing key '{k}' in config file.")
            sys.exit(103)

    mqtt_broker = cfg.get("server")
    try:
        mqtt_port = int(cfg.get("port_s"))
    except Exception:
        print(f"[{ts()}] [CONFIG] ERROR: Invalid port_s value in config, must be int.")
        sys.exit(104)

    mqtt_username = cfg.get("username")
    mqtt_password = cfg.get("password", "")
    mqtt_keepalive = int(cfg.get("keepalive", 20))
    mqtt_ws_path = cfg.get("path", "/mqtt")
    mqtt_use_ws = True
    mqtt_protocol = mqtt.MQTTv5

    base_id = get_shell_output(cfg.get("client_id"))
    if not base_id:
        print(f"[{ts()}] [CONFIG] ERROR: Could not determine base client_id, exiting.")
        sys.exit(105)

    rand_num = random.randint(10, 99)
    mqtt_client_id = f"{base_id}-{rand_num}"
    mqtt_topic = f"device/{base_id}/button"

    print(f"[{ts()}] [MQTT] TOPIC: {mqtt_topic}")
    print(f"[{ts()}] [MQTT] CLIENT_ID: {mqtt_client_id}")

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
        base_id=base_id,
    )


# ---------------------------------------------------------------------------
#  MQTT Publisher (matches IMU/UV pattern)
# ---------------------------------------------------------------------------
class MQTTPublisher:
    def __init__(self, mqtt_settings):
        self.connected = False
        self._closed = False
        self.settings = mqtt_settings
        self.client = mqtt.Client(
            mqtt.CallbackAPIVersion.VERSION2,
            client_id=self.settings["client_id"],
            protocol=self.settings["protocol"],
            transport="websockets" if self.settings["use_ws"] else "tcp",
        )
        if self.settings["username"]:
            self.client.username_pw_set(
                self.settings["username"], self.settings["password"]
            )
        self._setup_callbacks()

    def _setup_callbacks(self):
        def on_connect(client, userdata, flags, reason_code, properties):
            rc = reason_code.value if hasattr(reason_code, "value") else reason_code
            if rc == 0:
                print(f"[{ts()}] [MQTT] Connected successfully.")
                self.connected = True
            else:
                print(f"[{ts()}] [MQTT] Connect failed, reason: {reason_code}")
                self.connected = False

        def on_disconnect(client, userdata, flags, reason_code, properties):
            print(f"[{ts()}] [MQTT] Disconnected, reason: {reason_code}")
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
                    keepalive=self.settings["keepalive"],
                )
                self.client.loop_start()
                for _ in range(100):
                    if self.connected or exit_event.is_set():
                        break
                    time.sleep(0.1)
                if not self.connected and not exit_event.is_set():
                    print(f"[{ts()}] [MQTT] Waiting for broker connection...")
            except Exception as e:
                print(f"[{ts()}] [MQTT] Connect error: {e}. Retrying in 5 sec.")
                if exit_event.wait(5.0):
                    return

    def publish(self, payload):
        if not self.connected and not exit_event.is_set():
            self.connect()
        try:
            if isinstance(payload, dict):
                payload = json.dumps(payload)
            result = self.client.publish(
                self.settings["topic"], payload, qos=MQTT_QOS
            )
            if result.rc != mqtt.MQTT_ERR_SUCCESS:
                print(f"[{ts()}] [MQTT] Publish failed, rc: {result.rc}")
            else:
                print(f"[{ts()}] [MQTT] Published (QoS {MQTT_QOS}): {payload}")
        except Exception as e:
            print(f"[{ts()}] [MQTT] Publish exception: {e}")

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


# ---------------------------------------------------------------------------
#  Signal handling
# ---------------------------------------------------------------------------
def handle_exit_signal(signum, frame):
    print(f"[{ts()}] [Main] Received signal {signum}, shutting down.")
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

    # --- MQTT setup ---
    mqtt_pub = None
    mqtt_settings = None
    if skip_mqtt:
        print(f"[{ts()}] [MQTT] Skipped (--skip-mqtt)")
        # Still need base_id for payload; try to load config, fall back gracefully
        try:
            cfg = load_config()
            base_id_cmd = cfg.get("client_id", "")
            base_id = get_shell_output(base_id_cmd) if base_id_cmd else "unknown"
        except SystemExit:
            base_id = "unknown"
        mqtt_settings = {"base_id": base_id or "unknown"}
    else:
        cfg = load_config()
        mqtt_settings = build_mqtt_settings(cfg)
        mqtt_pub = MQTTPublisher(mqtt_settings)
        mqtt_pub.connect()

    # --- GPIO setup (gpiod v2) ---
    print(f"[{ts()}] [GPIO] Opening {GPIO_CHIP}, pins {ESTOP_GPIO_PINS}")

    led_request = None
    try:
        config = {
            pin: gpiod.LineSettings(
                direction=gpiod.line.Direction.INPUT,
                bias=gpiod.line.Bias.PULL_UP,
                edge_detection=gpiod.line.Edge.FALLING,  # physical HIGH->LOW = button press
            )
            for pin in ESTOP_GPIO_PINS
        }
        request = gpiod.request_lines(
            GPIO_CHIP,
            consumer="estop-monitor",
            config=config,
        )
    except Exception as e:
        print(f"[{ts()}] [GPIO] ERROR: Failed to request GPIO lines: {e}")
        traceback.print_exc()
        if mqtt_pub:
            mqtt_pub.close()
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
            print(f"[{ts()}] [GPIO] LED feedback enabled on GPIO{LED_GPIO_PIN}")
        except Exception as e:
            print(f"[{ts()}] [GPIO] WARNING: Could not setup LED on GPIO{LED_GPIO_PIN}: {e}")
            led_request = None

    print(f"[{ts()}] [GPIO] Interrupt ready on pins {ESTOP_GPIO_PINS} (pull-up, falling edge = press)")
    print(f"[{ts()}] [E-STOP] Monitor started")
    print(f"[{ts()}] [E-STOP] Debounce confirm: {DEBOUNCE_CONFIRM_SEC * 1000:.0f} ms")
    print(f"[{ts()}] [E-STOP] Min event interval: {MIN_EVENT_INTERVAL_SEC:.1f} s")
    print(f"[{ts()}] [E-STOP] MQTT QoS: {MQTT_QOS}")

    # Show initial pin state so we can verify wiring
    for pin in ESTOP_GPIO_PINS:
        raw_val = request.get_value(pin)
        pressed = read_pin_pressed(request, pin)
        print(f"[{ts()}] [GPIO] GPIO{pin} initial: raw={raw_val} pressed={pressed}")

    if debug:
        print(f"[{ts()}] [DEBUG] Debug mode ON - printing pin state every 0.5s")

    last_event_time = 0.0
    last_heartbeat = time.time()
    event_count = 0

    try:
        while not exit_event.is_set():
            # Wait for edge event; shorter timeout in debug mode for frequent state prints
            wait_timeout = 0.5 if debug else 1.0
            if not request.wait_edge_events(wait_timeout):
                # Timeout, no events
                now = time.time()

                # Debug: print raw pin state every cycle
                if debug:
                    states = []
                    for pin in ESTOP_GPIO_PINS:
                        raw_val = request.get_value(pin)
                        pressed = read_pin_pressed(request, pin)
                        states.append(f"GPIO{pin}: raw={raw_val} pressed={pressed}")
                    print(f"[{ts()}] [DEBUG] {' | '.join(states)}")

                # Heartbeat
                if (now - last_heartbeat) >= HEARTBEAT_INTERVAL_SEC:
                    pin_states = []
                    for pin in ESTOP_GPIO_PINS:
                        pressed = read_pin_pressed(request, pin)
                        pin_states.append(f"GPIO{pin}={'PRESSED' if pressed else 'idle'}")
                    mqtt_status = "connected" if (mqtt_pub and mqtt_pub.connected) else ("skipped" if skip_mqtt else "disconnected")
                    print(
                        f"[{ts()}] [Heartbeat] alive | events_fired={event_count} | "
                        f"{' '.join(pin_states)} | mqtt={mqtt_status}"
                    )
                    last_heartbeat = now
                continue

            events = request.read_edge_events()

            now = time.time()

            # --- Heartbeat (also on event wake) ---
            if (now - last_heartbeat) >= HEARTBEAT_INTERVAL_SEC:
                pin_states = []
                for pin in ESTOP_GPIO_PINS:
                    pressed = read_pin_pressed(request, pin)
                    pin_states.append(f"GPIO{pin}={'PRESSED' if pressed else 'idle'}")
                mqtt_status = "connected" if (mqtt_pub and mqtt_pub.connected) else ("skipped" if skip_mqtt else "disconnected")
                print(
                    f"[{ts()}] [Heartbeat] alive | events_fired={event_count} | "
                    f"{' '.join(pin_states)} | mqtt={mqtt_status}"
                )
                last_heartbeat = now

            # Process edge events
            for event in events:
                pin = event.line_offset

                if debug:
                    print(f"[{ts()}] [DEBUG] Edge event on GPIO{pin}, confirming press...")

                # Confirm the press is real (software debounce on top of hardware RC)
                if not confirm_press(request, pin):
                    if debug:
                        print(f"[{ts()}] [DEBUG] GPIO{pin} debounce rejected (bounce or glitch)")
                    continue

                now = time.time()

                # Cooldown check
                elapsed = now - last_event_time
                if elapsed < MIN_EVENT_INTERVAL_SEC:
                    remaining = MIN_EVENT_INTERVAL_SEC - elapsed
                    print(
                        f"[{ts()}] [E-STOP] GPIO{pin} pressed but cooldown active "
                        f"({remaining:.1f}s remaining), suppressed"
                    )
                    continue

                # --- Fire e-stop ---
                event_count += 1
                payload = {
                    "device_id": mqtt_settings["base_id"],
                    "device_type": "camera",
                    "ts": int(now),
                    "status": "emergency",
                }

                print(
                    f"[{ts()}] [E-STOP] >>> EMERGENCY TRIGGERED via GPIO{pin} "
                    f"(event #{event_count})"
                )

                # LED feedback: turn ON for 1 second in a background thread
                if led_request:
                    def _led_flash():
                        try:
                            led_request.set_value(LED_GPIO_PIN, gpiod.line.Value.ACTIVE)
                            time.sleep(1.0)
                            led_request.set_value(LED_GPIO_PIN, gpiod.line.Value.INACTIVE)
                        except Exception:
                            pass
                    threading.Thread(target=_led_flash, daemon=True).start()

                if mqtt_pub and not skip_mqtt:
                    try:
                        mqtt_pub.publish(payload)
                    except Exception as e:
                        print(f"[{ts()}] [E-STOP] MQTT publish error: {e}")
                        traceback.print_exc()
                else:
                    print(f"[{ts()}] [E-STOP] Event (MQTT skipped): {json.dumps(payload)}")

                last_event_time = now

    except Exception as e:
        print(f"[{ts()}] [E-STOP] Fatal error in main loop: {e}")
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
        if mqtt_pub:
            mqtt_pub.close()
        print(f"[{ts()}] [Main] Exiting cleanly. Total events fired: {event_count}")


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
        help="Flash GPIO22 LED on e-stop event (testing only)",
    )
    parser.add_argument(
        "--debug",
        action="store_true",
        help="Print raw pin state every 0.5s for wiring verification",
    )
    args = parser.parse_args()
    run(skip_mqtt=args.skip_mqtt, led_feedback=args.led_feedback, debug=args.debug)


if __name__ == "__main__":
    main()
