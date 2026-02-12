#!/usr/bin/env python3
"""
UV / Ambient Light Monitor for Bodycam
LTR-390UV-01 on I2C bus 0 @ 0x53

Reads UVI and Lux every 60 seconds, writes to /dev/shm/uv.dat
Format: lux,uvi  (e.g. 1523.4,6.2)

Logs to /tmp/uv.log
"""

import smbus2
import time
import logging
import signal
import sys
import statistics

# -----------------------------------------------------------------------------
# Configuration
# -----------------------------------------------------------------------------
I2C_BUS = 0
I2C_ADDR = 0x53

OUTPUT_FILE = "/dev/shm/uv.dat"
LOG_FILE = "/tmp/uv.log"
POLL_INTERVAL = 60      # seconds
NUM_SAMPLES = 3         # samples to median

WFAC = 1.0              # Window factor. 1.0 = no window / clear sky

# LTR-390UV register addresses
REG_MAIN_CTRL       = 0x00
REG_MEAS_RATE       = 0x04
REG_GAIN            = 0x05
REG_PART_ID         = 0x06
REG_MAIN_STATUS     = 0x07
REG_ALS_DATA_0      = 0x0D
REG_ALS_DATA_1      = 0x0E
REG_ALS_DATA_2      = 0x0F
REG_UVS_DATA_0      = 0x10
REG_UVS_DATA_1      = 0x11
REG_UVS_DATA_2      = 0x12

# MAIN_CTRL values
CTRL_STANDBY         = 0x00
CTRL_ALS_ACTIVE      = 0x02   # ALS mode + enable
CTRL_UVS_ACTIVE      = 0x0A   # UVS mode + enable

# Gain settings (register 0x05)
GAIN_1               = 0x00
GAIN_3               = 0x01
GAIN_6               = 0x02
GAIN_9               = 0x03
GAIN_18              = 0x04

# Resolution / measurement rate (register 0x04)
RES_20BIT_400MS      = 0x00
RES_18BIT_100MS      = 0x22

# UVS config: gain 18x, 20-bit/400ms -> sensitivity = 2300 counts/UVI
UVS_GAIN             = GAIN_18
UVS_CONV_TIME        = 0.45   # 400ms + margin
UV_SENSITIVITY       = 2300.0

# ALS config: gain 3x, 18-bit/100ms
ALS_GAIN             = GAIN_3
ALS_CONV_TIME        = 0.15   # 100ms + margin
ALS_GAIN_FACTOR      = 3.0
ALS_INT_FACTOR       = 1.0    # 18-bit/100ms -> INT=1

# Meas rate register values
UVS_MEAS_RATE_REG    = 0x04   # 20-bit resolution, 500ms rate
ALS_MEAS_RATE_REG    = 0x22   # 18-bit resolution, 100ms rate

EXPECTED_PART_ID     = 0xB2

# -----------------------------------------------------------------------------
# Logging
# -----------------------------------------------------------------------------
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    handlers=[
        logging.FileHandler(LOG_FILE),
        logging.StreamHandler()
    ]
)
log = logging.getLogger("uv_monitor")

# -----------------------------------------------------------------------------
# Globals
# -----------------------------------------------------------------------------
running = True


def signal_handler(sig, frame):
    global running
    log.info("Received signal %d, shutting down", sig)
    running = False


signal.signal(signal.SIGTERM, signal_handler)
signal.signal(signal.SIGINT, signal_handler)


# -----------------------------------------------------------------------------
# I2C helpers
# -----------------------------------------------------------------------------
def write_reg(bus, reg, val):
    bus.write_byte_data(I2C_ADDR, reg, val)


def read_reg(bus, reg):
    return bus.read_byte_data(I2C_ADDR, reg)


def read_20bit_data(bus, reg_low):
    """Read 3 consecutive registers and assemble 20-bit value."""
    d0 = bus.read_byte_data(I2C_ADDR, reg_low)
    d1 = bus.read_byte_data(I2C_ADDR, reg_low + 1)
    d2 = bus.read_byte_data(I2C_ADDR, reg_low + 2)
    return ((d2 & 0x0F) << 16) | (d1 << 8) | d0


# -----------------------------------------------------------------------------
# Sensor init / verify
# -----------------------------------------------------------------------------
def init_sensor(bus):
    """Verify part ID and put sensor in standby."""
    part_id = read_reg(bus, REG_PART_ID)
    if part_id != EXPECTED_PART_ID:
        log.warning("Unexpected PART_ID: 0x%02X (expected 0x%02X)", part_id, EXPECTED_PART_ID)

    # Clear power-on status by reading MAIN_STATUS
    status = read_reg(bus, REG_MAIN_STATUS)
    log.info("Initial status: 0x%02X", status)

    # Ensure standby
    write_reg(bus, REG_MAIN_CTRL, CTRL_STANDBY)

    log.info("LTR-390UV initialized (PART_ID=0x%02X)", part_id)


# -----------------------------------------------------------------------------
# Single measurement
# -----------------------------------------------------------------------------
def read_uvs(bus):
    """Take a single UVS measurement and return raw count."""
    # Configure for UVS
    write_reg(bus, REG_GAIN, UVS_GAIN)
    write_reg(bus, REG_MEAS_RATE, UVS_MEAS_RATE_REG)

    # Activate UVS mode
    write_reg(bus, REG_MAIN_CTRL, CTRL_UVS_ACTIVE)

    # Wait for conversion
    time.sleep(UVS_CONV_TIME)

    # Poll for data ready (bit 3 of MAIN_STATUS)
    for _ in range(10):
        status = read_reg(bus, REG_MAIN_STATUS)
        if status & 0x08:
            break
        time.sleep(0.05)

    data = read_20bit_data(bus, REG_UVS_DATA_0)

    # Back to standby
    write_reg(bus, REG_MAIN_CTRL, CTRL_STANDBY)

    return data


def read_als(bus):
    """Take a single ALS measurement and return raw count."""
    # Configure for ALS
    write_reg(bus, REG_GAIN, ALS_GAIN)
    write_reg(bus, REG_MEAS_RATE, ALS_MEAS_RATE_REG)

    # Activate ALS mode
    write_reg(bus, REG_MAIN_CTRL, CTRL_ALS_ACTIVE)

    # Wait for conversion
    time.sleep(ALS_CONV_TIME)

    # Poll for data ready
    for _ in range(10):
        status = read_reg(bus, REG_MAIN_STATUS)
        if status & 0x08:
            break
        time.sleep(0.05)

    data = read_20bit_data(bus, REG_ALS_DATA_0)

    # Back to standby
    write_reg(bus, REG_MAIN_CTRL, CTRL_STANDBY)

    return data


# -----------------------------------------------------------------------------
# Conversion formulas
# -----------------------------------------------------------------------------
def counts_to_uvi(raw_count):
    """Convert UVS raw count to UV Index."""
    uvi = (raw_count / UV_SENSITIVITY) * WFAC
    return round(uvi, 1)


def counts_to_lux(raw_count):
    """Convert ALS raw count to Lux."""
    lux = (0.6 * raw_count) / (ALS_GAIN_FACTOR * ALS_INT_FACTOR) * WFAC
    return round(lux, 1)


# -----------------------------------------------------------------------------
# Main loop
# -----------------------------------------------------------------------------
def main():
    log.info("UV monitor starting (bus=%d, addr=0x%02X)", I2C_BUS, I2C_ADDR)
    log.info("UVS: gain=18x, 20-bit/400ms | ALS: gain=3x, 18-bit/100ms")
    log.info("Sampling %d readings per cycle, interval=%ds", NUM_SAMPLES, POLL_INTERVAL)

    bus = None
    try:
        bus = smbus2.SMBus(I2C_BUS)
        init_sensor(bus)
    except Exception as e:
        log.error("Failed to initialize sensor: %s", e)
        sys.exit(1)

    while running:
        cycle_start = time.monotonic()
        try:
            # Collect UVS samples
            uvs_samples = []
            for i in range(NUM_SAMPLES):
                raw = read_uvs(bus)
                uvs_samples.append(raw)

            # Collect ALS samples
            als_samples = []
            for i in range(NUM_SAMPLES):
                raw = read_als(bus)
                als_samples.append(raw)

            # Median
            uvs_median = statistics.median(uvs_samples)
            als_median = statistics.median(als_samples)

            # Convert
            uvi = counts_to_uvi(uvs_median)
            lux = counts_to_lux(als_median)

            # Clamp UVI floor
            if uvi < 0:
                uvi = 0.0

            # Write output
            output = f"{lux},{uvi}"
            with open(OUTPUT_FILE, "w") as f:
                f.write(output)

            log.info("lux=%.1f uvi=%.1f (uvs_raw=%s als_raw=%s)",
                     lux, uvi, uvs_samples, als_samples)

        except Exception as e:
            log.error("Read cycle failed: %s", e)

        # Sleep remainder of interval, checking for shutdown every second
        elapsed = time.monotonic() - cycle_start
        sleep_time = max(0, POLL_INTERVAL - elapsed)
        end_time = time.monotonic() + sleep_time
        while running and time.monotonic() < end_time:
            time.sleep(1)

    # Cleanup
    if bus:
        try:
            write_reg(bus, REG_MAIN_CTRL, CTRL_STANDBY)
        except Exception:
            pass
        bus.close()

    log.info("UV monitor stopped")


if __name__ == "__main__":
    main()
