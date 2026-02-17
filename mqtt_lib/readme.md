# Bodycam2 MQTT Module

Shared MQTT client library for all bodycam2 services. Eliminates duplicated
broker logic across scripts and provides a single, production-grade client
with automatic reconnection for 4G field use.

Supports publishing, subscribing, and mixed pub/sub on the same connection.

  Location:  /app/bodycam2/mqtt_lib/
  Log file:  /tmp/mqtt.log
  Config:    /app/bodycam2/conf/config.json


## Quick Start

    import sys
    sys.path.insert(0, "/app/bodycam2")

    import threading
    from mqtt_lib import MQTTClient, load_config

    exit_event = threading.Event()
    config = load_config()


## Long-Running Publisher (IMU, E-STOP, status alive mode)

    client = MQTTClient(config, exit_event)
    client.connect()

    # Publish as many times as needed -- connection stays alive
    client.publish(f"device/{client.device_id}/fall", {"fall": True}, qos=1)

    # When shutting down
    client.close()


## One-Shot Publisher (bootup notification, cron job)

    client = MQTTClient(config, exit_event)
    client.publish_once(f"device/{client.device_id}/status", {"status": "bootup"}, qos=1)
    # client closes itself after delivery


## Subscriber (camera restart listener)

    def on_message(topic, payload):
        print(f"Got message on {topic}")

    client = MQTTClient(config, exit_event)
    client.subscribe(f"device/{client.device_id}/restart", on_message, qos=1)
    client.connect()
    client.loop_forever()   # blocks until exit_event is set
    client.close()

Subscriptions registered before connect() are established as soon as
the connection comes up.  On reconnect (4G dropout), all subscriptions
are automatically re-established.


## load_config(path=None)

Reads the shared config JSON and returns a normalised dict with these keys:

    server      str   MQTT broker hostname
    port        int   Broker port (accepts "port" or legacy "port_s")
    username    str   Broker username
    password    str   Broker password
    keepalive   int   Keepalive interval in seconds
    ws_path     str   WebSocket path (default "/mqtt")
    device_id   str   Resolved device identifier

All other keys in the config file (stun_url, fps, width, height, etc.)
are passed through so individual scripts can access them.

Calls sys.exit(100-105) on config errors so systemd sees the failure.


## MQTTClient(config, exit_event, lwt_topic=None, lwt_payload=None)

Constructor arguments:

    config       dict              Output of load_config()
    exit_event   threading.Event   Script's shutdown signal
    lwt_topic    str, optional     Last Will and Testament topic
    lwt_payload  dict/str, opt.    LWT message body

Methods:

    connect(timeout=10.0)
        Connect to broker and start background loop. Blocks until
        connected or exit_event is set.

    publish(topic, payload, qos=1)
        Publish a message. Auto-reconnects if disconnected.
        Returns True/False. Default QoS is 1 (at-least-once).

    publish_once(topic, payload, qos=1, timeout=10.0)
        Connect, publish one message, disconnect. For one-shot scripts.
        Client closes itself after delivery.

    subscribe(topic, callback, qos=1)
        Register a subscription with a callback function.  Can be called
        before or after connect().  Callback signature:
            callback(topic: str, payload: bytes)
        Subscriptions are re-established automatically on reconnect.

    loop_forever(health_interval=60.0)
        Block until exit_event is set.  For subscriber-only scripts.
        Logs a periodic health message for monitoring.

    close()
        Clean shutdown. Safe to call multiple times.

Properties:

    device_id   str    Resolved device identifier
    connected   bool   Current connection state


## Config File Format

The module reads from /app/bodycam2/conf/config.json:

    {
        "server": "your-broker.hivemq.cloud",
        "port": "8884",
        "keepalive": 20,
        "path": "/mqtt",
        "username": "bodycam",
        "password": "secret",
        "client_id": "/usr/bin/cat /etc/machine-id",
        "width": 1280,
        "height": 960
    }

Notes:
  - "port" and "port_s" are both accepted (normalised internally).
  - "client_id" can be a literal string or a shell command (detected by
    the presence of "/"). The command runs once at config load time.
  - All non-MQTT keys are passed through for scripts that need them.


## 4G / Network Resilience

The client uses paho-mqtt's background loop (loop_start) with
exponential-backoff reconnection (1s up to 120s). When 4G drops:

  1. Broker stops receiving keepalive pings.
  2. Paho detects the dead connection and fires on_disconnect.
  3. Background loop begins automatic reconnect attempts with backoff.
  4. When 4G returns, paho reconnects and publishing resumes.
  5. All subscriptions are automatically re-established on reconnect.

No manual intervention or restart required. Designed for 8+ hour shifts.


## Adding a New Script

  1. Import the module:

        sys.path.insert(0, "/app/bodycam2")
        from mqtt_lib import MQTTClient, load_config

  2. Create your exit event and load config:

        exit_event = threading.Event()
        config = load_config()

  3. Create a client (with optional LWT):

        client = MQTTClient(config, exit_event)
        client.connect()

  4. Publish using your script's topic:

        topic = f"device/{client.device_id}/your-event"
        client.publish(topic, {"key": "value"}, qos=1)

  5. Or subscribe to a topic:

        def handle(topic, payload):
            print(f"Got: {payload}")

        client.subscribe(f"device/{client.device_id}/commands", handle, qos=1)
        client.loop_forever()

  6. Close on shutdown:

        client.close()


## File Layout

    /app/bodycam2/
        conf/
            config.json              shared config (one file, all scripts)
        mqtt_lib/
            __init__.py              re-exports MQTTClient, load_config
            client.py                all MQTT logic lives here
            README.md                this file
        camera/
            scripts/
                status.py
                camera_restart.py
                imu_fall_detect.py
                estop_mqtt.py
