from gpiozero import LED
from time import sleep
import time

leds = [None] * 4
leds[0] = LED(22)
leds[1] = LED(23)
leds[2] = LED(24)
leds[3] = LED(25)

try:
    while True:
        for led in leds:
            print(f"PIN {led.pin} is {led.value}")
            ns_s = time.time_ns()

            if str(led.pin) == "GPIO24":
                led.blink(on_time=2, off_time=1, n=1, background=False)
            else:
                led.blink(n=1, background=False)

            ns_e = time.time_ns()

            print("Time diff: {}s".format((ns_e-ns_s)/1000000000))

        sleep(1)


except KeyboardInterrupt:
    print("Exiting program.")
finally:
    for led in leds:
        led.close()
