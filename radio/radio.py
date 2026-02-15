import serial
import time
import RPi.GPIO as GPIO
import time

class ZetaPlusPi:
    def __init__(self, port='/dev/serial0', baudrate=19200):
        # Configuration for Raspberry Pi GPIO UART
        # ZETAPLUS requires 19200, 8, N, 1 [cite: 309]
        self.ser = serial.Serial(
            port=port,
            baudrate=baudrate,
            bytesize=serial.EIGHTBITS,
            parity=serial.PARITY_NONE,
            stopbits=serial.STOPBITS_ONE,
            timeout=1
        )

    def validate_connection(self):
        """
        Sends the 'ATV' command (65, 84, 86) to retrieve firmware version[cite: 320].
        This confirms the UART link is active and the module is powered.
        """
        # Clear buffers to ensure a clean read
        self.ser.reset_input_buffer()

        # Command: ATV (ASCII for Version Check) [cite: 320]
        self.ser.write(b'ATV')

        # The module responds with #V followed by the version [cite: 318]
        time.sleep(0.1) 
        response = self.ser.read_until(b'\r')

        if response:
            decoded = response.decode('ascii', errors='ignore').strip()
            print(f"Connection Verified. Firmware Version: {decoded} [cite: 318]")
            return True
        return False

    def send_packet(self, channel, message):
        """
        Transmits data using the 'ATS' command: ATS <Channel> <Length> <Data>[cite: 140].
        """
        if isinstance(message, str):
            message = message.encode('ascii')

        length = len(message)
        # Construct packet: 'ATS' (65, 84, 83) + Channel + Length + Data [cite: 140, 141]
        header = bytearray([65, 84, 83, channel, length])
        full_packet = header + message

        self.ser.write(full_packet)
        print(f"Transmitted {length} bytes on channel {channel} [cite: 140]")

    def listen_for_data(self, duration=10):
        """
        Polls the RX pin. Data received by the ZETAPLUS is automatically
        sent to the Pi's RX (GPIO15)[cite: 89, 316].
        """
        print(f"Listening for {duration} seconds...")
        end_time = time.time() + duration
        while time.time() < end_time:
            if self.ser.in_waiting > 0:
                # Received data typically starts with #R followed by RSSI/Length [cite: 238, 286]
                raw_data = self.ser.read(self.ser.in_waiting)
                print(f"Received Raw: {raw_data}")
            time.sleep(0.1)

    def close(self):
        self.ser.close()

if __name__ == "__main__":
    GPIO.setmode(GPIO.BCM)

    # Enable Radion
    GPIO.setup(4, GPIO.OUT)
    GPIO.output(4, GPIO.LOW)

    # Setup status LED
    GPIO.setup(25, GPIO.OUT)

    # Wait for radio to come on
    time.sleep(1)

    # GPIO14 (TX) and GPIO15 (RX) are mapped to /dev/serial0
    radio = ZetaPlusPi(port='/dev/serial0')

    try:
        if radio.validate_connection():
            # Turn on status LED
            GPIO.output(25, GPIO.HIGH)

            # Example: Send "PI_DATA" on Channel 0 [cite: 140]
            radio.send_packet(channel=0, message="E-STOP")

            # Start listening for incoming RF packets [cite: 316]
            radio.listen_for_data(duration=15)
        else:
            print("Failed to connect")
    except KeyboardInterrupt:
        print("\nStopping...")
    finally:
        radio.close()
        GPIO.cleanup()
