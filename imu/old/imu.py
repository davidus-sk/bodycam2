import smbus2
import RPi.GPIO as GPIO
import time
import math

# I2C address of the ICM-42670-P
ADDRESS = 0x68  # Update this if your device uses a different address

# ICM-42670-P Register Addresses (Based on your corrections)
DEVICE_CONFIG = 0x01  # Device reset and SPI mode configuration
INT_CONFIG = 0x06     # Interrupt configuration
TEMP_DATA1 = 0x09     # High byte of temperature data
TEMP_DATA0 = 0x0A     # Low byte of temperature data
ACCEL_DATA_X1 = 0x0B  # High byte of X-axis accelerometer data
ACCEL_DATA_X0 = 0x0C  # Low byte of X-axis accelerometer data
ACCEL_DATA_Y1 = 0x0D  # High byte of Y-axis accelerometer data
ACCEL_DATA_Y0 = 0x0E  # Low byte of Y-axis accelerometer data
ACCEL_DATA_Z1 = 0x0F  # High byte of Z-axis accelerometer data
ACCEL_DATA_Z0 = 0x10  # Low byte of Z-axis accelerometer data
GYRO_DATA_X1 = 0x11   # High byte of X-axis gyroscope data
GYRO_DATA_X0 = 0x12   # Low byte of X-axis gyroscope data
GYRO_DATA_Y1 = 0x13   # High byte of Y-axis gyroscope data
GYRO_DATA_Y0 = 0x14   # Low byte of Y-axis gyroscope data
GYRO_DATA_Z1 = 0x15   # High byte of Z-axis gyroscope data
GYRO_DATA_Z0 = 0x16   # Low byte of Z-axis gyroscope data
PWR_MGMT0 = 0x1F      # Power management
GYRO_CONFIG0 = 0x20   # Gyroscope configuration
ACCEL_CONFIG0 = 0x21  # Accelerometer configuration
WHO_AM_I = 0x75       # Device ID

# Accelerometer sensitivity (LSB/g) based on FS_SEL setting in ACCEL_CONFIG0
ACCEL_SENSITIVITY = 16384.0  # For FS_SEL = 0 (±2g)

# Fall detection threshold in g's
FALL_THRESHOLD_G = 2.5  # Adjust based on testing and requirements

# GPIO pin for FSYNC (GPIO43 on Raspberry Pi CM3)
FSYNC_PIN = 43

def initialize_gpio():
    """Initialize GPIO and set FSYNC pin LOW."""
    GPIO.setmode(GPIO.BCM)
    GPIO.setup(FSYNC_PIN, GPIO.OUT)
    GPIO.output(FSYNC_PIN, GPIO.LOW)
    print(f"FSYNC pin (GPIO {FSYNC_PIN}) set to LOW.")

def check_who_am_i(bus):
    """Check the WHO_AM_I register to verify sensor identity."""
    try:
        who_am_i = bus.read_byte_data(ADDRESS, WHO_AM_I)
        print(f"WHO_AM_I register: 0x{who_am_i:02X}")
        # The expected WHO_AM_I value for ICM-42670-P is 0x67 (confirm with datasheet)
        if who_am_i == 0x67:
            print("Sensor identified correctly.")
        else:
            print("Unexpected WHO_AM_I value. Sensor may not be connected properly.")
    except Exception as e:
        print(f"Error reading WHO_AM_I register: {e}")

def initialize_sensor(bus):
    """Initialize the ICM-42670-P sensor."""
    try:
        # Reset the device
        bus.write_byte_data(ADDRESS, DEVICE_CONFIG, 0x01)  # Set DEVICE_CONFIG to reset device
        time.sleep(0.1)

        # Set power management to turn on accelerometer and gyroscope
        # PWR_MGMT0: bits[3:2]: GYRO_MODE, bits[1:0]: ACCEL_MODE
        # Set GYRO_MODE and ACCEL_MODE to 0b11 (Low Noise Mode)
        bus.write_byte_data(ADDRESS, PWR_MGMT0, 0x0F)  # 0x0F = 00001111
        time.sleep(0.1)

        # Configure gyroscope
        # GYRO_CONFIG0: bits[6:5]: GYRO_UI_FS_SEL, bits[3:0]: GYRO_ODR
        # For FS_SEL = 0 (±2000 dps), ODR = 1 kHz (0x05)
        bus.write_byte_data(ADDRESS, GYRO_CONFIG0, 0x05)
        time.sleep(0.1)

        # Configure accelerometer
        # ACCEL_CONFIG0: bits[6:5]: ACCEL_UI_FS_SEL, bits[3:0]: ACCEL_ODR
        # For FS_SEL = 0 (±2g), ODR = 1 kHz (0x05)
        bus.write_byte_data(ADDRESS, ACCEL_CONFIG0, 0x05)
        time.sleep(0.1)

        print("Sensor initialized.")
    except Exception as e:
        print(f"Error initializing sensor: {e}")

def read_accelerometer(bus):
    """Read accelerometer data and return x, y, z values."""
    try:
        # Read 6 bytes starting from ACCEL_DATA_X1
        data = bus.read_i2c_block_data(ADDRESS, ACCEL_DATA_X1, 6)
        # Combine high and low bytes
        acc_x = (data[0] << 8) | data[1]
        acc_y = (data[2] << 8) | data[3]
        acc_z = (data[4] << 8) | data[5]
        # Convert to signed value
        if acc_x >= 0x8000:
            acc_x -= 0x10000
        if acc_y >= 0x8000:
            acc_y -= 0x10000
        if acc_z >= 0x8000:
            acc_z -= 0x10000
        return acc_x, acc_y, acc_z
    except Exception as e:
        print(f"I2C read error: {e}")
        return None, None, None

def get_acceleration_g(acc_x, acc_y, acc_z):
    """Convert raw accelerometer data to g's."""
    ax = acc_x / ACCEL_SENSITIVITY
    ay = acc_y / ACCEL_SENSITIVITY
    az = acc_z / ACCEL_SENSITIVITY
    return ax, ay, az

def get_acceleration_magnitude_g(ax, ay, az):
    """Calculate the magnitude of acceleration in g's."""
    return math.sqrt(ax**2 + ay**2 + az**2)

def main():
    bus = smbus2.SMBus(1)  # Use I2C bus 1
    initialize_gpio()
    check_who_am_i(bus)
    initialize_sensor(bus)
    print("Starting fall detection...")
    while True:
        try:
            acc_x, acc_y, acc_z = read_accelerometer(bus)
            if None in (acc_x, acc_y, acc_z):
                # Skip this reading due to error
                continue
            # Print raw accelerometer values
            print(f"Raw Accelerometer Readings - X: {acc_x}, Y: {acc_y}, Z: {acc_z}")
            ax, ay, az = get_acceleration_g(acc_x, acc_y, acc_z)
            # Print acceleration in g's
            print(f"Acceleration in g's - X: {ax:.2f}, Y: {ay:.2f}, Z: {az:.2f}")
            acc_magnitude = get_acceleration_magnitude_g(ax, ay, az)
            print(f"Total Acceleration Magnitude: {acc_magnitude:.2f} g")
            if acc_magnitude > FALL_THRESHOLD_G:
                print("Fall detected!")
            time.sleep(0.1)  # Sampling rate of 10 Hz
        except Exception as e:
            print(f"Error in main loop: {e}")
            time.sleep(0.1)
            continue

if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        GPIO.cleanup()
        print("Program terminated by user.")
