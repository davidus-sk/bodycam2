#!/bin/bash
ping -c 5 8.8.8.8
if [ "$?" != "0" ]; then
  if [ -f "/dev/shm/online.flag" ]; then
    echo "Lost connection. Rebooting..."
    /usr/sbin/reboot
  fi
else
  echo "Connection is up."
  /usr/bin/touch /dev/shm/online.flag
fi
