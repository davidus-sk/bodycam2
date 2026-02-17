#!/usr/bin/env python3
"""
Shared MQTT client for bodycam2 services.

Provides a single, production-grade MQTT client that all bodycam scripts
share.  Handles config loading, device-ID resolution, TLS/WebSocket setup,
automatic reconnection (critical for 4G), and clean shutdown.

Supports both publishing and subscribing on the same connection.

Location : /app/bodycam2/mqtt_lib/client.py
Log file : /tmp/mqtt.log

Publishing (long-running services like IMU fall-detect, E-STOP):
    client = MQTTClient(config, exit_event)
    client.connect()
    client.publish("device/<id>/fall", payload)
    ...
    client.close()

Publishing one-shot (cron / bootup):
    client = MQTTClient(config, exit_event)
    client.publish_once("device/<id>/status", payload)

Subscribing (listeners like camera restart):
    client = MQTTClient(config, exit_event)
    client.subscribe("device/<id>/restart", callback_fn, qos=1)
    client.connect()
    client.loop_forever()
    client.close()
"""

import json
import logging
import os
import random
import subprocess
import sys
import threading
import time

import paho.mqtt.client as mqtt

# ---------------------------------------------------------------------------
#  Logging -- dedicated MQTT log so broker chatter doesn't pollute service logs
# ---------------------------------------------------------------------------
LOG_FILE = "/tmp/mqtt.log"

log = logging.getLogger("bodycam.mqtt")
log.setLevel(logging.INFO)

_file_handler = logging.FileHandler(LOG_FILE)
_file_handler.setFormatter(
    logging.Formatter("%(asctime)s [%(levelname)s] %(name)s: %(message)s")
)
log.addHandler(_file_handler)
log.addHandler(logging.StreamHandler())

# Prevent duplicate log entries if caller also configures root logger
log.propagate = False

# ---------------------------------------------------------------------------
#  Constants
# ---------------------------------------------------------------------------
DEFAULT_CONFIG_PATH = "/app/bodycam2/conf/config.json"

RECONNECT_MIN_DELAY_SEC = 1
RECONNECT_MAX_DELAY_SEC = 120

_CONNECT_POLL_INTERVAL = 0.1       # seconds between connection checks
_DEFAULT_CONNECT_TIMEOUT = 10.0    # seconds to wait for initial connect
_DEFAULT_RETRY_WAIT = 5.0          # seconds between full connect retries


# ---------------------------------------------------------------------------
#  Config loading
# ---------------------------------------------------------------------------
def _resolve_device_id(raw_value):
    """Resolve device_id from config.

    If the value contains a path separator (``/``), treat it as a shell
    command (e.g. ``/usr/bin/cat /etc/machine-id``).  Otherwise treat it
    as a literal device-id string.

    Returns the resolved id or *None* on failure.
    """
    if not raw_value:
        return None

    if "/" in raw_value:
        try:
            result = subprocess.check_output(
                raw_value,
                shell=True,
                stderr=subprocess.STDOUT,
                universal_newlines=True,
            ).strip()
            return result if result else None
        except Exception as e:
            log.error("device_id command failed ('%s'): %s", raw_value, e)
            return None

    return raw_value


def load_config(path=None):
    """Load and normalise the shared bodycam MQTT config.

    Parameters
    ----------
    path : str, optional
        Override config file location (defaults to DEFAULT_CONFIG_PATH).

    Returns
    -------
    dict
        Normalised config with keys: ``server``, ``port``, ``username``,
        ``password``, ``keepalive``, ``ws_path``, ``device_id``, plus any
        extra keys present in the JSON (e.g. ``width``, ``height``).

    Raises
    ------
    SystemExit
        On missing file, bad JSON, missing required keys, or unresolvable
        device id.  Exit codes 100-105 mirror the legacy scripts so systemd
        can distinguish config failures from runtime failures.
    """
    config_path = path or DEFAULT_CONFIG_PATH

    # --- Read file ---
    try:
        with open(config_path, "r") as fh:
            raw = json.load(fh)
    except FileNotFoundError:
        log.error("Config not found: %s", config_path)
        sys.exit(100)
    except json.JSONDecodeError as exc:
        log.error("Invalid JSON in %s: %s", config_path, exc)
        sys.exit(101)
    except Exception as exc:
        log.error("Cannot read %s: %s", config_path, exc)
        sys.exit(102)

    # --- Required keys ---
    for key in ("server", "username", "client_id"):
        if key not in raw:
            log.error("Missing required key '%s' in %s", key, config_path)
            sys.exit(103)

    # --- Port: accept 'port' or legacy 'port_s' ---
    port_raw = raw.get("port", raw.get("port_s"))
    if port_raw is None:
        log.error("Missing 'port' or 'port_s' in %s", config_path)
        sys.exit(103)
    try:
        port = int(port_raw)
    except (ValueError, TypeError):
        log.error("Invalid port value '%s' in %s", port_raw, config_path)
        sys.exit(104)

    # --- Device ID ---
    device_id = _resolve_device_id(raw["client_id"])
    if not device_id:
        log.error("Could not resolve device_id from '%s'", raw["client_id"])
        sys.exit(105)

    # --- Build normalised config ---
    config = {
        "server":    raw["server"],
        "port":      port,
        "username":  raw["username"],
        "password":  raw.get("password", ""),
        "keepalive": int(raw.get("keepalive", 20)),
        "ws_path":   raw.get("path", "/mqtt"),
        "device_id": device_id,
    }

    # Pass through all remaining keys that individual scripts may need
    # (e.g. stun_url, turn_url, fps, width, height)
    _mqtt_keys = {"server", "port", "port_s", "username", "password",
                  "keepalive", "path", "client_id"}
    for key, value in raw.items():
        if key not in _mqtt_keys and key not in config:
            config[key] = value

    log.info(
        "Config loaded: server=%s port=%d device=%s keepalive=%ds",
        config["server"], config["port"], config["device_id"],
        config["keepalive"],
    )
    return config


# ---------------------------------------------------------------------------
#  MQTT Client
# ---------------------------------------------------------------------------
class MQTTClient:
    """Production MQTT client with publish, subscribe, and auto-reconnect.

    Designed for bodycam services running 8+ hour shifts over 4G.
    Handles network drops, broker restarts, and SIM7600 hiccups
    via paho's built-in reconnect loop with exponential back-off.

    Subscriptions are automatically re-established after reconnect,
    so listeners survive 4G dropouts without intervention.

    Parameters
    ----------
    config : dict
        Output of :func:`load_config`.
    exit_event : threading.Event
        Shared shutdown signal from the owning script.  The client
        checks this to bail out of blocking waits during shutdown.
    lwt_topic : str, optional
        Last Will and Testament topic.
    lwt_payload : dict or str, optional
        LWT message body (dict will be JSON-serialised).
    """

    def __init__(self, config, exit_event, lwt_topic=None, lwt_payload=None):
        self._config = config
        self._exit = exit_event or threading.Event()
        self._connected = False
        self._closed = False
        self._loop_started = False
        self._lock = threading.Lock()

        # Track subscriptions for auto-resubscribe on reconnect
        # List of (topic, qos, callback) tuples
        self._subscriptions = []

        # Unique client-id per process to avoid broker-side collisions
        # when multiple services run on the same device.
        suffix = random.randint(10, 99)
        client_id = f"{config['device_id']}-{suffix}"

        self._client = mqtt.Client(
            mqtt.CallbackAPIVersion.VERSION2,
            client_id=client_id,
            protocol=mqtt.MQTTv5,
            transport="websockets",
        )

        # --- Auth ---
        if config["username"]:
            self._client.username_pw_set(config["username"], config["password"])

        # --- TLS (HiveMQ Cloud requires it) ---
        self._client.tls_set()

        # --- WebSocket path ---
        self._client.ws_set_options(path=config["ws_path"])

        # --- Automatic reconnect back-off ---
        self._client.reconnect_delay_set(
            RECONNECT_MIN_DELAY_SEC, RECONNECT_MAX_DELAY_SEC
        )

        # --- LWT (optional) ---
        if lwt_topic and lwt_payload is not None:
            payload_str = (
                json.dumps(lwt_payload) if isinstance(lwt_payload, dict)
                else str(lwt_payload)
            )
            self._client.will_set(lwt_topic, payload=payload_str, qos=1, retain=False)
            log.info("LWT configured: topic=%s", lwt_topic)

        # --- Callbacks ---
        self._setup_callbacks()

        log.info(
            "Client created: client_id=%s broker=%s:%d",
            client_id, config["server"], config["port"],
        )

    # ------------------------------------------------------------------
    #  Callbacks
    # ------------------------------------------------------------------
    def _setup_callbacks(self):
        def on_connect(_client, _userdata, _flags, reason_code, _properties):
            rc = reason_code.value if hasattr(reason_code, "value") else reason_code
            if rc == 0:
                log.info("Connected to %s:%d", self._config["server"], self._config["port"])
                self._connected = True
                # Re-subscribe after reconnect (4G dropout recovery)
                self._restore_subscriptions()
            else:
                log.error("Connect failed: reason=%s", reason_code)
                self._connected = False

        def on_disconnect(_client, _userdata, _flags, reason_code, _properties):
            self._connected = False
            rc = reason_code.value if hasattr(reason_code, "value") else reason_code
            if rc == 0:
                log.info("Disconnected cleanly")
            else:
                log.warning(
                    "Unexpected disconnect: reason=%s (auto-reconnect active)",
                    reason_code,
                )

        def on_message(_client, _userdata, message):
            log.info("Message received: topic=%s", message.topic)
            # Route to registered callbacks
            for sub_topic, _qos, callback in self._subscriptions:
                if mqtt.topic_matches_sub(sub_topic, message.topic):
                    try:
                        callback(message.topic, message.payload)
                    except Exception as exc:
                        log.error(
                            "Callback error for topic %s: %s", message.topic, exc
                        )

        self._client.on_connect = on_connect
        self._client.on_disconnect = on_disconnect
        self._client.on_message = on_message

    def _restore_subscriptions(self):
        """Re-subscribe to all registered topics after a reconnect."""
        for sub_topic, qos, _callback in self._subscriptions:
            try:
                result, mid = self._client.subscribe(sub_topic, qos=qos)
                if result == mqtt.MQTT_ERR_SUCCESS:
                    log.info("Subscribed to %s (qos=%d, mid=%d)", sub_topic, qos, mid)
                else:
                    log.error("Subscribe failed for %s: rc=%s", sub_topic, result)
            except Exception as exc:
                log.error("Subscribe error for %s: %s", sub_topic, exc)

    # ------------------------------------------------------------------
    #  Connection
    # ------------------------------------------------------------------
    def connect(self, timeout=_DEFAULT_CONNECT_TIMEOUT):
        """Connect to the broker and start the background network loop.

        Blocks until connected, *exit_event* is set, or the cumulative
        timeout is exceeded.  After the first successful connection,
        paho's ``loop_start()`` thread handles keepalive and automatic
        reconnection -- callers do **not** need to call ``connect()``
        again after a 4G drop.

        Parameters
        ----------
        timeout : float
            Seconds to wait for the initial connection per attempt.
        """
        if self._closed:
            raise RuntimeError("Cannot connect: client has been closed")

        while not self._connected and not self._exit.is_set():
            try:
                self._client.connect(
                    self._config["server"],
                    self._config["port"],
                    keepalive=self._config["keepalive"],
                )

                if not self._loop_started:
                    self._client.loop_start()
                    self._loop_started = True

                # Wait for the on_connect callback
                deadline = time.time() + timeout
                while not self._connected and not self._exit.is_set():
                    if time.time() > deadline:
                        log.warning(
                            "Connect attempt timed out (%.0fs), retrying...", timeout
                        )
                        break
                    time.sleep(_CONNECT_POLL_INTERVAL)

            except Exception as exc:
                log.error("Connect error: %s. Retrying in %.0fs.", exc, _DEFAULT_RETRY_WAIT)
                if self._exit.wait(_DEFAULT_RETRY_WAIT):
                    return  # shutdown requested

        if self._connected:
            log.info("MQTT ready")

    # ------------------------------------------------------------------
    #  Subscribing
    # ------------------------------------------------------------------
    def subscribe(self, topic, callback, qos=1):
        """Register a subscription.

        The callback is invoked whenever a message arrives on the given
        topic.  Subscriptions are tracked internally and automatically
        re-established after a reconnect (4G dropout recovery).

        Can be called before or after ``connect()``.  If called before,
        the subscription is established as soon as the connection comes
        up.  If called after, it takes effect immediately.

        Parameters
        ----------
        topic : str
            MQTT topic or topic filter (wildcards supported).
        callback : callable
            Function with signature ``callback(topic: str, payload: bytes)``.
            The payload is raw bytes -- decode/parse as needed.
        qos : int
            Quality of Service (0, 1, or 2).  Default is 1.
        """
        self._subscriptions.append((topic, qos, callback))
        log.info("Subscription registered: %s (qos=%d)", topic, qos)

        # If already connected, subscribe immediately
        if self._connected:
            try:
                result, mid = self._client.subscribe(topic, qos=qos)
                if result == mqtt.MQTT_ERR_SUCCESS:
                    log.info("Subscribed to %s (qos=%d, mid=%d)", topic, qos, mid)
                else:
                    log.error("Subscribe failed for %s: rc=%s", topic, result)
            except Exception as exc:
                log.error("Subscribe error for %s: %s", topic, exc)

    # ------------------------------------------------------------------
    #  Blocking loop for subscriber scripts
    # ------------------------------------------------------------------
    def loop_forever(self, health_interval=60.0):
        """Block until exit_event is set.  For subscriber-only scripts.

        Logs a periodic health message so you can verify the service
        is still alive via journalctl or the log file.

        Parameters
        ----------
        health_interval : float
            Seconds between health log messages.
        """
        log.info("Entering loop_forever (health log every %.0fs)", health_interval)
        last_health = time.time()

        while not self._exit.is_set():
            self._exit.wait(timeout=1.0)

            now = time.time()
            if (now - last_health) >= health_interval:
                sub_count = len(self._subscriptions)
                status = "connected" if self._connected else "disconnected"
                log.info(
                    "Health | mqtt=%s | subscriptions=%d", status, sub_count
                )
                last_health = now

        log.info("loop_forever exiting (exit_event set)")

    # ------------------------------------------------------------------
    #  Publishing
    # ------------------------------------------------------------------
    def publish(self, topic, payload, qos=1):
        """Publish a message to the broker.

        If the connection is down, attempts a reconnect before giving up.
        This method is thread-safe.

        Parameters
        ----------
        topic : str
            Full MQTT topic (e.g. ``device/<id>/fall``).
        payload : dict or str
            Message body; dicts are JSON-serialised automatically.
        qos : int
            Quality of Service (0 = fire-and-forget, 1 = at-least-once).
            Default is 1 for safety-critical delivery.

        Returns
        -------
        bool
            True if paho accepted the publish, False otherwise.
            Note: QoS 1 delivery confirmation is handled by the paho
            background loop asynchronously.
        """
        if self._closed:
            log.error("Cannot publish: client closed (topic=%s)", topic)
            return False

        # Reconnect if needed (non-blocking if exit is set)
        if not self._connected and not self._exit.is_set():
            log.warning("Not connected -- reconnecting before publish...")
            self.connect()

        if not self._connected:
            log.error("Still disconnected, dropping message on %s", topic)
            return False

        try:
            data = json.dumps(payload) if isinstance(payload, dict) else payload

            with self._lock:
                result = self._client.publish(topic, data, qos=qos)

            if result.rc == mqtt.MQTT_ERR_SUCCESS:
                log.info("Published %s (qos=%d): %s", topic, qos, data)
                return True

            log.error("Publish failed on %s: rc=%s", topic, result.rc)
            return False

        except Exception as exc:
            log.error("Publish exception on %s: %s", topic, exc)
            return False

    def publish_once(self, topic, payload, qos=1, timeout=_DEFAULT_CONNECT_TIMEOUT):
        """Connect, publish one message, disconnect.

        Convenience method for one-shot scripts (cron, bootup notifications).
        The client is closed automatically after delivery.

        Parameters
        ----------
        topic : str
            Full MQTT topic.
        payload : dict or str
            Message body.
        qos : int
            Quality of Service.
        timeout : float
            Max seconds to wait for connection and delivery.

        Returns
        -------
        bool
            True if the message was delivered, False otherwise.
        """
        try:
            self.connect(timeout=timeout)

            if not self._connected:
                log.error("publish_once: could not connect within %.0fs", timeout)
                return False

            data = json.dumps(payload) if isinstance(payload, dict) else payload

            with self._lock:
                result = self._client.publish(topic, data, qos=qos)

            if result.rc != mqtt.MQTT_ERR_SUCCESS:
                log.error("publish_once: publish failed rc=%s", result.rc)
                return False

            # Wait for broker acknowledgement when qos > 0
            if qos > 0:
                result.wait_for_publish(timeout=timeout)

            log.info("publish_once delivered %s: %s", topic, data)
            return True

        except ValueError:
            # wait_for_publish raises ValueError if qos==0
            log.info("publish_once delivered %s (qos=0): %s", topic, payload)
            return True

        except Exception as exc:
            log.error("publish_once error: %s", exc)
            return False

        finally:
            self.close()

    # ------------------------------------------------------------------
    #  Shutdown
    # ------------------------------------------------------------------
    def close(self):
        """Cleanly shut down the MQTT connection.  Safe to call multiple times."""
        if self._closed:
            return
        self._closed = True

        if self._loop_started:
            try:
                self._client.loop_stop()
            except Exception:
                pass

        try:
            self._client.disconnect()
        except Exception:
            pass

        self._connected = False
        log.info("Client closed")

    # ------------------------------------------------------------------
    #  Properties
    # ------------------------------------------------------------------
    @property
    def device_id(self):
        """Device identifier resolved from config at init time."""
        return self._config["device_id"]

    @property
    def connected(self):
        """Whether the MQTT client is currently connected."""
        return self._connected
