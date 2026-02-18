#!/usr/bin/python3

import subprocess
import json
import time
import requests
import sys
import signal
from gpiozero import LED

# --- Configuration ---
DESTINATION_URL = "https://your-api-endpoint.com/report"
BATTERY_FILE = "/dev/shm/battery.dat"
JSON_FILE = "/dev/shm/status.json"
INTERVAL = 30  # Seconds

cell_led = LED(23)

def signal_handler(sig, frame):
    cell_led.off()
    sys.exit(0)

def get_modem_list():
    """Returns a list of modem indices found on the system."""
    try:
        result = subprocess.check_output(["mmcli", "-L", "-J"], stderr=subprocess.STDOUT)
        data = json.loads(result)
        # Extract indices from the 'modem-list' array
        return [m.split('/')[-1] for m in data.get("modem-list", [])]
    except Exception as e:
        print(f"Error listing modems: {e}")
        return []

def get_modem_details(index):
    """Fetches and parses specific details for a given modem index."""
    try:
        result = subprocess.check_output(["mmcli", "-m", index, "-J"], stderr=subprocess.STDOUT)
        data = json.loads(result)
        modem = data.get("modem", {})

        # Extracting the specific fields you requested
        details = {
            "index": index,
            "status": modem.get("generic", {}).get("state"),
            "imei": modem.get("3gpp", {}).get("imei"),
            "signal_quality": int(modem.get("generic", {}).get("signal-quality", {}).get("value")),
            "operator_name": modem.get("3gpp", {}).get("operator-name"),
            "signal_level": 0,
        }

        if details["signal_quality"] > 0:
            result = subprocess.check_output(["mmcli", "-m", index, "--signal-setup=15"], stderr=subprocess.STDOUT)
            result = subprocess.check_output(["mmcli", "-m", index, "--signal-get", "-J"], stderr=subprocess.STDOUT)
            data = json.loads(result)
            modem = data.get("modem", {})

            if modem:
                rssi = modem.get("signal", {}).get("lte", {}).get("rssi")

                if rssi:
                    details["signal_level"] = round(2 * (float(rssi) + 100), 0)

        return details
    except Exception as e:
        print(f"Error getting details for modem {index}: {e}")
        return None

def get_battery_level():
    """Get battery level from file written by the ADC"""
    try:
        with open(BATTERY_FILE, 'r') as file:
            content = file.read().strip()

            if content:
                return int(content)
            else:
                print(f"Error: File {BATTERY_FILE} is empty.")
                return 0

    except FileNotFoundError:
        print(f"Error: The file {BATTERY_FILE} was not found.")
        return 0
    except ValueError:
        print(f"Error: The file {BATTERY_FILE} contains non-integer data.")
        return 0

def write_to_file(data):
    """Write obtained data to file"""
    try:
        with open(JSON_FILE, 'w', encoding='utf-8') as f:
            json.dump(data, f, indent=4)
    except:
        print(f"Error: Unable to write JSON data to file {JSON_FILE}")

def main():
    signal.signal(signal.SIGINT, signal_handler)
    signal.signal(signal.SIGTERM, signal_handler)

    status = "new"

    print(f"Starting modem monitor. Posting to {DESTINATION_URL} every {INTERVAL}s...")

    while True:
        modem_indices = get_modem_list()

        if not modem_indices:
            print("No modems detected.")

        for index in modem_indices:
            print(f"Procesing modem with index {index}")

            payload = get_modem_details(index)
            payload["battery_level"] = get_battery_level()

            write_to_file(payload)

            print(f"Sending data to server: {payload}")

            if payload:
                # blink led
                if payload['status'] != status and payload['status'] == "connected":
                    cell_led.blink(on_time=1, off_time=2, background=True)

                if payload['status'] != status and payload['status'] == "registered":
                    cell_led.blink(on_time=1, off_time=4, background=True)

                if payload['status'] != status and payload['status'] != "registered" and payload['status'] != "connected":
                    cell_led.off()

                status = payload['status']

#                try:
#                    response = requests.post(DESTINATION_URL, json=payload, timeout=10)
#                    print(f"Sent data for Modem {index}: Status {response.status_code}")
#                except requests.exceptions.RequestException as e:
#                    print(f"Failed to post data: {e}")

        time.sleep(INTERVAL)

if __name__ == "__main__":
    main()
