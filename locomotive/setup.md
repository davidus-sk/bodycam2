# Modem connectivity

1. Check modem status with `mmcli -m 0`
2. Add managed connection `nmcli c add type gsm ifname cdc-wdm0 con-name Cellular apn fast.t-mobile.com`
3. Check if it works `ping -I wwan0 www.google.com`
