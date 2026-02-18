#!/app/bodycam2/venv/bin/python3

"""
OSD Telemetry Publisher for Bodycam
====================================
Periodically reads signal and battery levels from /dev/shm/status.json
and publishes them to MQTT for OSD overlay or dashboard display.

MQTT topic : device/{device_id}/osd
Log file   : /tmp/osd.log

Usage:
    python3 osd.py
"""

import json
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
STATUS_FILE = "/dev/shm/status.json"
PUBLISH_INTERVAL_SEC = 10
LOG_FILE = "/tmp/osd.log"

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
log = logging.getLogger("osd")

# ---------------------------------------------------------------------------
#  Shutdown signal
# ---------------------------------------------------------------------------
exit_event = threading.Event()


def _handle_signal(signum, _frame):
    log.info("Signal %d received, shutting down.", signum)
    exit_event.set()


# ---------------------------------------------------------------------------
#  Status reading
# ---------------------------------------------------------------------------
def read_status():
    """Read signal_level and battery_level from the shared status file.

    Returns a dict with both values, or None if the file is missing,
    unreadable, or contains bad JSON.
    """
    try:
        with open(STATUS_FILE, "r") as fh:
            data = json.load(fh)
    except FileNotFoundError:
        log.warning("Status file not found: %s (skipping)", STATUS_FILE)
        return None
    except json.JSONDecodeError as exc:
        log.warning("Bad JSON in %s: %s (skipping)", STATUS_FILE, exc)
        return None
    except Exception as exc:
        log.warning("Cannot read %s: %s (skipping)", STATUS_FILE, exc)
        return None

    signal_level = data.get("signal_level")
    battery_level = data.get("battery_level")

    if signal_level is None or battery_level is None:
        log.warning("Missing signal_level or battery_level in %s (skipping)", STATUS_FILE)
        return None

    return {"signal": signal_level, "battery": battery_level}


# ---------------------------------------------------------------------------
#  Main
# ---------------------------------------------------------------------------
def main():
    # Signal handlers
    signal.signal(signal.SIGTERM, _handle_signal)
    signal.signal(signal.SIGINT, _handle_signal)
    if hasattr(signal, "SIGHUP"):
        signal.signal(signal.SIGHUP, _handle_signal)

    config = load_config()
    device_id = config["device_id"]
    topic = f"device/{device_id}/osd"

    client = MQTTClient(config, exit_event)

    try:
        client.connect()

        if not client.connected and not exit_event.is_set():
            log.error("Could not establish initial MQTT connection")
            sys.exit(1)

        log.info("OSD publisher started: interval=%ds, topic=%s", PUBLISH_INTERVAL_SEC, topic)

        while not exit_event.is_set():
            status = read_status()

            if status is not None:
                payload = {
                    "device_id": device_id,
                    "device_type": "camera",
                    "ts": int(time.time()),
                    "status": status,
                }
                client.publish(topic, payload, qos=0)

            if exit_event.wait(timeout=PUBLISH_INTERVAL_SEC):
                break

    except KeyboardInterrupt:
        log.info("Interrupted.")
    finally:
        client.close()
        log.info("OSD publisher shutdown complete.")


if __name__ == "__main__":
    main()
