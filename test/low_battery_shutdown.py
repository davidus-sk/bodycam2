import os
import time
import subprocess

# Configuration
BATTERY_FILE = "/dev/shm/battery.dat"
THRESHOLD = 10
CHECK_INTERVAL = 60  # seconds

def monitor_battery():
    print(f"Monitoring {BATTERY_FILE} for threshold {THRESHOLD}%...")
    
    while True:
        try:
            if os.path.exists(BATTERY_FILE):
                with open(BATTERY_FILE, 'r') as f:
                    content = f.read().strip()
                    
                    if content:
                        battery_level = int(content)
                        
                        if battery_level <= THRESHOLD:
                            print(f"Battery low ({battery_level}%). Shutting down...")
                            # Executes the shutdown command immediately
                            subprocess.run(["sudo", "shutdown", "-h", "now"])
                            break
            else:
                print(f"Warning: {BATTERY_FILE} not found. Retrying...")
                
        except ValueError:
            print("Error: File content is not a valid integer.")
        except Exception as e:
            print(f"An unexpected error occurred: {e}")
            
        time.sleep(CHECK_INTERVAL)

if __name__ == "__main__":
    monitor_battery()
