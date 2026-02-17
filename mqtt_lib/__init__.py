"""
Bodycam2 shared MQTT client library.

Usage:
    from mqtt_lib import load_config, MQTTClient
"""

from mqtt_lib.client import MQTTClient, load_config

__all__ = ["MQTTClient", "load_config"]
