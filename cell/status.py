#!/usr/bin/python3

import subprocess
import json
import time
import requests
from gpiozero import LED

# --- Configuration ---
DESTINATION_URL = "https://your-api-endpoint.com/report"
BATTERY_FILE = "/dev/shm/battery.dat"
INTERVAL = 30  # Seconds

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
            subprocess.check_output(["mmcli", "-m", index, "--signal-setup=15"], stderr=subprocess.STDOUT)
            rssi = subprocess.check_output(["mmcli", "-m", index, "--signal-get"], stderr=subprocess.STDOUT)

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
                print(f"Error: File {file_path} is empty.")
                return None

    except FileNotFoundError:
        print(f"Error: The file {file_path} was not found.")
        return None
    except ValueError:
        print(f"Error: The file {file_path} contains non-integer data.")
        return None

def main():
    status = "new"
    cell_led = LED(23)

    print(f"Starting modem monitor. Posting to {DESTINATION_URL} every {INTERVAL}s...")

    while True:
        modem_indices = get_modem_list()

        if not modem_indices:
            print("No modems detected.")

        for index in modem_indices:
            payload = get_modem_details(index)
            payload["battery_level"] = get_battery_level()

            print(f"Sending data to server: {payload}")

            if payload:
                # blink led
                if payload['status'] != status and payload['status'] == "connected":
                    cell_led.blink()
                    status = payload['status']

                if payload['status'] != status and payload['status'] != "connected":
                    cell_led.off()
                    status = payload['status']

                try:
                    response = requests.post(DESTINATION_URL, json=payload, timeout=10)
                    print(f"Sent data for Modem {index}: Status {response.status_code}")
                except requests.exceptions.RequestException as e:
                    print(f"Failed to post data: {e}")

        time.sleep(INTERVAL)

if __name__ == "__main__":
    main()
