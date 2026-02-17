#!/usr/bin/env python3
"""
Restart Listener for Bodycam
====================================
Subscribes to an MQTT topic and restarts the camera streamer service
when a restart command is received.

MQTT topic : device/{device_id}/restart
Log file   : /tmp/camera_restart.log

Usage:
    python3 restart.py
"""

import logging
import signal
import subprocess
import sys
import threading

# ---------------------------------------------------------------------------
#  Path setup -- allow import of shared mqtt_lib module from /app/bodycam2/
# ---------------------------------------------------------------------------
sys.path.insert(0, "/app/bodycam2")

from mqtt_lib import MQTTClient, load_config

# ---------------------------------------------------------------------------
#  Configuration
# ---------------------------------------------------------------------------
STREAMER_SERVICE = "webrtc_streamer"
LOG_FILE = "/tmp/camera_restart.log"

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
log = logging.getLogger("camera_restart")

# ---------------------------------------------------------------------------
#  Shutdown signal
# ---------------------------------------------------------------------------
exit_event = threading.Event()


def _handle_signal(signum, _frame):
    log.info("Signal %d received, shutting down.", signum)
    exit_event.set()


# ---------------------------------------------------------------------------
#  Restart logic
# ---------------------------------------------------------------------------
def restart_streamer():
    """Restart the camera streamer via systemctl.

    Returns True if the command executed, False on timeout or error.
    """
    try:
        result = subprocess.run(
            ["/usr/bin/systemctl", "restart", STREAMER_SERVICE],
            capture_output=True,
            text=True,
            timeout=10,
        )
        if result.returncode == 0:
            log.info("Restarted %s service", STREAMER_SERVICE)
        else:
            log.error(
                "systemctl restart %s exited with code %d: %s",
                STREAMER_SERVICE, result.returncode, result.stderr.strip(),
            )
        return True

    except subprocess.TimeoutExpired:
        log.error("systemctl restart %s timed out after 10s", STREAMER_SERVICE)
        return False

    except Exception as exc:
        log.error("Failed to restart %s: %s", STREAMER_SERVICE, exc)
        return False


def on_restart_message(topic, payload):
    """Callback invoked when a message arrives on the restart topic."""
    log.info("Restart command received on %s", topic)
    restart_streamer()


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
    topic = f"device/{device_id}/restart"

    # LWT so the backend knows if this listener goes down
    lwt_topic = f"device/{device_id}/last-will"
    lwt_payload = {"device_id": device_id, "status": "restart-listener-offline"}

    client = MQTTClient(config, exit_event, lwt_topic=lwt_topic, lwt_payload=lwt_payload)

    # Register subscription before connecting -- will be established
    # as soon as the connection comes up, and re-established on reconnect
    client.subscribe(topic, on_restart_message, qos=1)

    try:
        client.connect()

        if not client.connected and not exit_event.is_set():
            log.error("Could not establish initial MQTT connection")
            sys.exit(1)

        log.info("Listening for restart commands on %s", topic)

        # Block until shutdown signal
        client.loop_forever()

    except KeyboardInterrupt:
        log.info("Interrupted.")
    finally:
        client.close()
        log.info("Camera restart listener shutdown complete.")


if __name__ == "__main__":
    main()
