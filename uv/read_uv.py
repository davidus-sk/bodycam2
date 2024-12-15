import smbus
import time
import RPi.GPIO as GPIO
import logging
import json
from datetime import datetime

# GPIO configuration
UV_SHDN_PIN = 25  # GPIO25 (BCM numbering for UV_SHDNn)

# Constants
ADC_RESOLUTION = 4095
ADC_VREF = 3.3  # Reference voltage of the ADC
RF = 40e6  # Total feedback resistor value in ohms (40 MΩ from R64 + R65)
RESPONSIVITY = 0.11  # Photodiode responsivity in A/W

# Logging configuration
LOG_FILE = "/tmp/uv.log"
JSON_FILE = "/tmp/uv.json"
logging.basicConfig(
    filename=LOG_FILE,
    level=logging.INFO,
    format="%(asctime)s %(levelname)s: %(message)s",
)

# Initialize GPIO
GPIO.setmode(GPIO.BCM)  # Use BCM numbering
GPIO.setup(UV_SHDN_PIN, GPIO.OUT)  # Set UV_SHDNn pin as output

# Function to enable the UV sensor
def enable_uv_sensor():
    logging.info("Enabling UV sensor.")
    GPIO.output(UV_SHDN_PIN, GPIO.HIGH)  # Set UV_SHDNn to HIGH (sensor enabled)
    time.sleep(0.1)  # Allow time for the sensor to stabilize

# Function to disable the UV sensor (optional)
def disable_uv_sensor():
    logging.info("Disabling UV sensor.")
    GPIO.output(UV_SHDN_PIN, GPIO.LOW)  # Set UV_SHDNn to LOW (sensor disabled)

# I2C configuration
bus = smbus.SMBus(1)

# Function to read from the ADC
def read_adc():
    try:
        logging.info("Configuring ADC for automatic conversion mode.")
        # ADC121C021 address, 0x50(80)
        # Select configuration register, 0x02(02)
        # 0x20(32): Automatic conversion mode enabled
        bus.write_byte_data(0x50, 0x02, 0x20)
        time.sleep(0.5)

        # ADC121C021 address, 0x50(80)
        # Read data back from 0x00(00), 2 bytes
        # raw_adc MSB, raw_adc LSB
        logging.info("Reading ADC data.")
        data = bus.read_i2c_block_data(0x50, 0x00, 2)

        # Convert the data to 12 bits
        raw_adc = (data[0] & 0x0F) * 256 + data[1]
        logging.info(f"ADC raw value: {raw_adc}")
        return raw_adc
    except Exception as e:
        logging.error(f"Error reading ADC: {e}")
        raise

# Function to calculate UV intensity
def calculate_uv_intensity(adc_value):
    try:
        # Calculate the output voltage
        v_out = (adc_value / ADC_RESOLUTION) * ADC_VREF
        logging.info(f"Output voltage (Vout): {v_out:.6f} V")

        # Calculate the photocurrent
        photocurrent = v_out / RF
        logging.info(f"Photocurrent: {photocurrent:.9f} A")

        # Calculate the UV intensity
        uv_intensity = photocurrent / RESPONSIVITY  # In watts
        uv_intensity_nw = uv_intensity * 1e9  # Convert to nanowatts (nW)
        logging.info(f"UV intensity: {uv_intensity_nw:.2f} nW/cm^2")
        return v_out, photocurrent, uv_intensity_nw
    except Exception as e:
        logging.error(f"Error calculating UV intensity: {e}")
        raise

# Function to save data to JSON
def save_to_json(adc_value, v_out, photocurrent, uv_intensity):
    try:
        current_time = datetime.now()
        iso_timestamp = current_time.isoformat()
        epoch_timestamp = int(current_time.timestamp())
        # Convert photocurrent to full decimal representation
        photocurrent_full = f"{photocurrent:.9f}".rstrip('0').rstrip('.')  # Remove trailing zeros and decimal point if unnecessary
        json_data = {
            "sensor_type": "uv",
            "adc_raw_reading": adc_value,
            "output_voltage": {
                "value": round(v_out, 6),  # Rounded to 6 decimal places
                "units": "V"
            },
            "photocurrent": {
                "value": photocurrent_full,
                "units": "A"
            },
            "uv_intensity": {
                "value": round(uv_intensity, 2),  # Rounded to 2 decimal places
                "units": "nW/cm^2"
            },
            "timestamp_iso": iso_timestamp,
            "timestamp_epoch": epoch_timestamp,
        }
        with open(JSON_FILE, "w") as json_file:
            json.dump(json_data, json_file, indent=4)
        logging.info(f"Data saved to JSON file: {JSON_FILE}")
    except Exception as e:
        logging.error(f"Error saving data to JSON: {e}")
        raise

# Main function
def main():
    try:
        logging.info("Starting UV sensor measurement.")
        enable_uv_sensor()  # Enable the UV sensor

        adc_value = read_adc()  # Read value from the ADC
        v_out, photocurrent, uv_intensity = calculate_uv_intensity(adc_value)

        print(f"Digital Value of Analog Input: {adc_value}")
        print(f"UV Intensity: {uv_intensity:.2f} nW/cm^2")

        save_to_json(adc_value, v_out, photocurrent, uv_intensity)  # Save results to JSON
    except Exception as e:
        logging.error(f"An error occurred: {e}")
        print(f"An error occurred: {e}")
    finally:
        disable_uv_sensor()  # Disable the UV sensor (optional)
        GPIO.cleanup()  # Clean up GPIO settings
        logging.info("UV sensor measurement completed.")

if __name__ == "__main__":
    main()
