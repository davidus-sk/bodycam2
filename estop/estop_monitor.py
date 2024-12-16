from gpiozero import Button
import os
import time
import logging
from datetime import datetime

# Configuration
ESTOP_PIN = 27  # BCM pin number for the e-stop button
ESTOP_FILE = "/tmp/ESTOP"
LOG_FILE = "/tmp/e-stop.log"

# Setup logging
logging.basicConfig(
    filename=LOG_FILE,
    level=logging.INFO,
    format="%(asctime)s %(levelname)s %(message)s",
)

def log_button_press():
    """Logs the button press event with a timestamp."""
    timestamp = datetime.now().astimezone().isoformat()
    logging.info(f"Button pressed at {timestamp}")
    print(f"Button pressed at {timestamp}")

def write_estop_file():
    """Creates the ESTOP file if it doesn't already exist."""
    if not os.path.exists(ESTOP_FILE):
        with open(ESTOP_FILE, "w") as f:
            f.write("E-STOP Triggered\n")
        print(f"{ESTOP_FILE} created.")
    else:
        print(f"{ESTOP_FILE} already exists.")

def button_pressed():
    """Callback function for button press."""
    log_button_press()
    write_estop_file()

def main():
    """Main function to monitor the e-stop button."""
    try:
        # Initialize the Button with pull-up resistor
        estop_button = Button(ESTOP_PIN, pull_up=True, bounce_time=0.2)

        # Assign the callback function to when the button is pressed
        estop_button.when_pressed = button_pressed

        print("Monitoring e-stop button...")
        logging.info("E-stop monitoring started.")

        # Keep the script running indefinitely
        while True:
            time.sleep(1)  # Yield CPU to other processes
    except KeyboardInterrupt:
        print("Exiting program.")
    except Exception as e:
        logging.error(f"Error occurred: {e}")
        print(f"Error occurred: {e}")
    finally:
        logging.info("E-stop monitoring stopped.")

if __name__ == "__main__":
    main()
