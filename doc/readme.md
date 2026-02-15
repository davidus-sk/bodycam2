# System Architecture

## /cell/status.py
 - purpose: report data via mqtt to receiver
 - service: yes
 - managed by: `/services/cell_status.service`
 - interval: 60s
 - provides: cell signal level, operator name, cell connection status, battery level

## /battery/battery_monitor.py
 - purpose: monitor LiPo battery voltage via ADC and report percentage
 - service: yes
 - managed by: `/services/battery-monitor.service`
 - interval: 60s
 - provides: battery level (0-100) to `/dev/shm/battery.dat`
 - log: `/tmp/battery_monitor.log`

## /uv/uv_monitor.py
 - purpose: monitor UV index and ambient light via LTR-390UV-01 sensor
 - service: yes
 - managed by: `/services/uv-monitor.service`
 - interval: 60s
 - provides: lux and UVI to `/dev/shm/uv.dat` (format: lux,uvi)
 - log: `/tmp/uv.log`

## /estop/estop_mqtt.py
 - purpose: safety-critical emergency stop via redundant tactile switches
 - service: yes
 - managed by: `/services/estop.service`
 - interval: interrupt-driven (GPIO 8, GPIO 11 falling edge)
 - provides: emergency stop event via MQTT to device/{id}/button
 - log: `/tmp/estop.log`

## /imu/imu_fall_detect.py
 - purpose: 3-phase fall detection via ICM-42605 IMU
 - service: yes
 - managed by: `/services/imu.service`
 - interval: interrupt-driven (GPIO 16, 100 Hz DATA_READY)
 - provides: fall detection event via MQTT to device/{id}/fall
 - log: `/tmp/imu.log`

