import smbus2
import time
import math
import argparse
from datetime import datetime
import sys
import traceback

# --------- CONFIGURATION ---------
I2C_BUS = 1
MPU6050_ADDR = 0x68
PWR_MGMT_1 = 0x6B
ACCEL_XOUT_H = 0x3B
GYRO_XOUT_H = 0x43

ACCEL_SCALE = 16384.0  # ±2g range
GYRO_SCALE = 131.0     # ±250°/s range

# Fall detection thresholds
FREE_FALL_THRESHOLD_G = 0.5
IMPACT_THRESHOLD_G = 2.0
IMPACT_THRESHOLD_GYRO = 250

# Inactivity detection (gyro only, due to gravity affecting accel)
INACTIVITY_GYRO_THRESHOLD = 20     # °/s, small rotations threshold
INACTIVITY_PERIOD_SEC = 2.0
INACTIVITY_ALLOWED_MOVEMENT_FRAC = 0.2
IMPACT_STABILIZATION_DELAY = 0.2   # Seconds after impact to ignore transient vibration

MIN_VALID_ACCEL_SUM = 0.05
I2C_ERROR_COOLDOWN_SEC = 1.0
FREE_FALL_IMPACT_WINDOW = 1.0
MIN_EVENT_INTERVAL = 5.0

# --------- UTILITY FUNCTIONS ---------

def read_word(bus, addr, reg):
    high = bus.read_byte_data(addr, reg)
    low = bus.read_byte_data(addr, reg + 1)
    value = (high << 8) + low
    return value if value < 0x8000 else value - 65536

def get_mpu6050(bus):
    ax = read_word(bus, MPU6050_ADDR, ACCEL_XOUT_H) / ACCEL_SCALE
    ay = read_word(bus, MPU6050_ADDR, ACCEL_XOUT_H + 2) / ACCEL_SCALE
    az = read_word(bus, MPU6050_ADDR, ACCEL_XOUT_H + 4) / ACCEL_SCALE
    gx = read_word(bus, MPU6050_ADDR, GYRO_XOUT_H) / GYRO_SCALE
    gy = read_word(bus, MPU6050_ADDR, GYRO_XOUT_H + 2) / GYRO_SCALE
    gz = read_word(bus, MPU6050_ADDR, GYRO_XOUT_H + 4) / GYRO_SCALE
    return ax, ay, az, gx, gy, gz

def magnitude(x, y, z):
    return math.sqrt(x * x + y * y + z * z)

def timestamp():
    return datetime.now().strftime("%Y-%m-%d %H:%M:%S")

# --------- FALL DETECTION CLASS ---------

class FallDetector:
    def __init__(self, bus, sample_rate_hz=100, verbose=False):
        self.bus = bus
        self.sample_rate_hz = sample_rate_hz
        self.verbose = verbose
        self.reset_state()
        print(f"[{timestamp()}] Fall detection initialized.")

    def reset_state(self):
        self.state = "IDLE"
        self.free_fall_time = None
        self.impact_time = None
        self.inactivity_start_time = None
        self.last_event_time = 0
        self.inactivity_buffer = []

    def log(self, message, important=False):
        if self.verbose or important:
            print(f"[{timestamp()}] {message}")

    def run(self):
        interval = 1.0 / self.sample_rate_hz
        while True:
            try:
                ax, ay, az, gx, gy, gz = get_mpu6050(self.bus)
                a_mag = magnitude(ax, ay, az)
                g_mag = magnitude(gx, gy, gz)

                if abs(ax) + abs(ay) + abs(az) < MIN_VALID_ACCEL_SUM:
                    self.log("Ignoring invalid accel reading (near zero).", important=True)
                    time.sleep(interval)
                    continue

                current_time = time.time()

                if self.verbose:
                    self.log(f"|a|={a_mag:.2f}g |gyro|={g_mag:.1f}°/s State={self.state}")

                if self.state == "IDLE":
                    if a_mag < FREE_FALL_THRESHOLD_G and (current_time - self.last_event_time) > MIN_EVENT_INTERVAL:
                        self.state = "FREE_FALL"
                        self.free_fall_time = current_time
                        self.log(f"Free fall detected |a|={a_mag:.2f}g", important=True)

                elif self.state == "FREE_FALL":
                    if (current_time - self.free_fall_time) > FREE_FALL_IMPACT_WINDOW:
                        self.log("Free fall expired without impact.", important=True)
                        self.reset_state()
                    elif a_mag > IMPACT_THRESHOLD_G or g_mag > IMPACT_THRESHOLD_GYRO:
                        self.state = "POST_IMPACT"
                        self.impact_time = current_time
                        self.log(f"Impact detected |a|={a_mag:.2f}g |gyro|={g_mag:.1f}°/s", important=True)
                        self.log(f"Stabilizing for {IMPACT_STABILIZATION_DELAY:.2f}s...", important=True)
                        time.sleep(IMPACT_STABILIZATION_DELAY)
                        self.inactivity_start_time = time.time()
                        self.inactivity_buffer.clear()

                elif self.state == "POST_IMPACT":
                    rotation_detected = g_mag > INACTIVITY_GYRO_THRESHOLD
                    self.inactivity_buffer.append(rotation_detected)

                    inactivity_elapsed = current_time - self.inactivity_start_time
                    if inactivity_elapsed >= INACTIVITY_PERIOD_SEC:
                        movement_ratio = sum(self.inactivity_buffer) / len(self.inactivity_buffer)
                        if movement_ratio <= INACTIVITY_ALLOWED_MOVEMENT_FRAC:
                            self.log("FALL CONFIRMED!", important=True)
                        else:
                            self.log(f"False alarm due to post-impact rotation ({movement_ratio*100:.1f}%)", important=True)
                        self.last_event_time = current_time
                        self.reset_state()

            except Exception as e:
                self.log(f"Sensor error: {e}. Resetting...", important=True)
                traceback.print_exc()
                self.reset_state()
                time.sleep(I2C_ERROR_COOLDOWN_SEC)

            time.sleep(interval)

# --------- MAIN ENTRY POINT ---------

def main():
    parser = argparse.ArgumentParser(description="MPU6050 Fall Detection")
    parser.add_argument('--verbose', action='store_true', help='Verbose mode (sensor values)')
    parser.add_argument('--rate', type=int, default=100, help='Sample rate (Hz)')
    args = parser.parse_args()

    try:
        with smbus2.SMBus(I2C_BUS) as bus:
            bus.write_byte_data(MPU6050_ADDR, PWR_MGMT_1, 0)
            detector = FallDetector(bus, args.rate, args.verbose)
            detector.run()
    except KeyboardInterrupt:
        print("\nExiting gracefully.")
    except Exception as e:
        print(f"Critical error: {e}")
        traceback.print_exc()
        sys.exit(1)

if __name__ == "__main__":
    main()

