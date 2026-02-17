#!/app/bodycam2/venv/bin/python3

import sys
import subprocess
sys.path.insert(0, "/app/bodycam2")
from mqtt_lib import load_config

config = load_config()


subprocess.check_call([
    "/app/bodycam2/camera/stream/pi-webrtc_1.2.2",
    "--camera=libcamera:0",
    f"--fps={config['fps']}",
    f"--width={config['width']}",
    f"--height={config['height']}",
    "--hw-accel",
    "--no-audio",
    "--use-mqtt",
    f"--mqtt-host={config['server']}",
    f"--mqtt-port=8883",
    f"--mqtt-username={config['username']}",
    f"--mqtt-password={config['password']}",
    f"--uid={config['device_id']}",
    f"--stun-url={config['stun_url']}",
    f"--turn-url={config['turn_url']}",
    f"--turn-username={config['turn_username']}",
    f"--turn-password={config['turn_password']}"]);
