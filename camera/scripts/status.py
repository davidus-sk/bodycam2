#!/app/bodycam2/venv/bin/python3
"""
Bodycam status reporter.

Publishes periodic heartbeat messages to the MQTT broker so the backend
knows this device is alive and reachable.

Modes
-----
bootup : Publish a single "bootup" status message and exit.
alive  : Maintain a persistent MQTT connection and publish "alive"
         every HEARTBEAT_INTERVAL_SEC.  Designed to run for 8+ hour
         shifts over 4G with automatic reconnection on network drops.

Usage
-----
    status.py alive     # long-running heartbeat (systemd service)
    status.py bootup    # one-shot notification (systemd oneshot / cron)
    status.py           # defaults to "bootup"

MQTT topic : device/{device_id}/status
Log file   : /tmp/status.log
"""

import logging
import signal
import sys
import threading
import time

# ---------------------------------------------------------------------------
#  Path setup -- allow import of shared mqtt_lib module from /app/bodycam2/
# ---------------------------------------------------------------------------
sys.path.insert(0, "/app/bodycam2")

from mqtt_lib import MQTTClient, load_config

# ---------------------------------------------------------------------------
#  Configuration
# ---------------------------------------------------------------------------
HEARTBEAT_INTERVAL_SEC = 35
LOG_FILE = "/tmp/status.log"

# ---------------------------------------------------------------------------
#  Logging
# ---------------------------------------------------------------------------
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
    handlers=[
        logging.FileHandler(LOG_FILE),
        logging.StreamHandler(),
    ],
)
log = logging.getLogger("status")

# ---------------------------------------------------------------------------
#  Shutdown signal
# ---------------------------------------------------------------------------
exit_event = threading.Event()


def _handle_signal(signum, _frame):
    log.info("Signal %d received, shutting down.", signum)
    exit_event.set()


# ---------------------------------------------------------------------------
#  Payload
# ---------------------------------------------------------------------------
def build_payload(device_id, status, config):
    """Construct the status MQTT payload."""
    payload = {
        "device_id":   device_id,
        "device_type":  "camera",
        "ts":           int(time.time()),
        "status":       status,
    }

    # Include resolution if available in config
    width = config.get("width")
    height = config.get("height")
    if width and height:
        payload["resolution"] = f"{width}x{height}"

    return payload


# ---------------------------------------------------------------------------
#  Run modes
# ---------------------------------------------------------------------------
def run_bootup(config):
    """Send a single 'bootup' message and exit."""
    device_id = config["device_id"]
    topic = f"device/{device_id}/status"
    payload = build_payload(device_id, "bootup", config)

    # LWT: announce "offline" if the device vanishes unexpectedly
    lwt_topic = f"device/{device_id}/last-will"
    lwt_payload = {"device_id": device_id, "status": "offline"}

    client = MQTTClient(config, exit_event, lwt_topic=lwt_topic, lwt_payload=lwt_payload)
    ok = client.publish_once(topic, payload, qos=1)

    if ok:
        log.info("Bootup status sent for %s", device_id)
    else:
        log.error("Failed to send bootup status for %s", device_id)
        sys.exit(1)


def run_alive(config):
    """Maintain a persistent connection and heartbeat every 35 seconds."""
    device_id = config["device_id"]
    topic = f"device/{device_id}/status"

    # LWT: announce "offline" if broker loses contact
    lwt_topic = f"device/{device_id}/last-will"
    lwt_payload = {"device_id": device_id, "status": "offline"}

    client = MQTTClient(config, exit_event, lwt_topic=lwt_topic, lwt_payload=lwt_payload)

    try:
        client.connect()

        if not client.connected and not exit_event.is_set():
            log.error("Could not establish initial MQTT connection")
            sys.exit(1)

        log.info("Heartbeat loop started: interval=%ds, topic=%s",
                 HEARTBEAT_INTERVAL_SEC, topic)

        while not exit_event.is_set():
            payload = build_payload(device_id, "alive", config)
            client.publish(topic, payload, qos=0)

            # Sleep in small increments so we can react to exit_event promptly
            if exit_event.wait(timeout=HEARTBEAT_INTERVAL_SEC):
                break

    except KeyboardInterrupt:
        log.info("Interrupted.")
    finally:
        client.close()
        log.info("Status reporter shutdown complete.")


# ---------------------------------------------------------------------------
#  Main
# ---------------------------------------------------------------------------
def main():
    # Signal handlers
    signal.signal(signal.SIGTERM, _handle_signal)
    signal.signal(signal.SIGINT, _handle_signal)
    if hasattr(signal, "SIGHUP"):
        signal.signal(signal.SIGHUP, _handle_signal)

    # Determine mode from CLI
    status = "bootup"
    if len(sys.argv) > 1 and sys.argv[1] in ("alive", "bootup"):
        status = sys.argv[1]

    log.info("Status reporter starting: mode=%s", status)

    config = load_config()

    if status == "bootup":
        run_bootup(config)
    else:
        run_alive(config)


if __name__ == "__main__":
    main()
