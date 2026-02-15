import subprocess
import json
import time
import requests

# --- Configuration ---
DESTINATION_URL = "https://your-api-endpoint.com/report"
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
            "signal_quality": modem.get("generic", {}).get("signal-quality", {}).get("value"),
            "operator_name": modem.get("3gpp", {}).get("operator-name"),
        }
        return details
    except Exception as e:
        print(f"Error getting details for modem {index}: {e}")
        return None

def main():
    print(f"Starting modem monitor. Posting to {DESTINATION_URL} every {INTERVAL}s...")
    
    while True:
        modem_indices = get_modem_list()
        
        if not modem_indices:
            print("No modems detected.")
        
        for index in modem_indices:
            payload = get_modem_details(index)
            print(f"Sending data to server: {payload}")

            if payload:
                try:
                    response = requests.post(DESTINATION_URL, json=payload, timeout=10)
                    print(f"Sent data for Modem {index}: Status {response.status_code}")
                except requests.exceptions.RequestException as e:
                    print(f"Failed to post data: {e}")

        time.sleep(INTERVAL)

if __name__ == "__main__":
    main()
