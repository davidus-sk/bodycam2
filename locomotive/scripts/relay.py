#!/usr/bin/python3

from gpiozero import LED
from time import sleep

led = LED(4)

led.on()
sleep(0.25)
led.off()
