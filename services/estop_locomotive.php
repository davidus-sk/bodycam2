[Unit]
Description=E-STOP MQTT Monitoring Service (locomotive receiver)
After=multi-user.target
Wants=multi-user.target

[Service]
Type=simple
ExecStart=/app/bodycam2/locomotive/scripts/estop_receiver.php
Restart=always
RestartSec=1
User=root
WorkingDirectory=/app/bodycam2/locomotive/scripts
StandardOutput=syslog
StandardError=syslog
SyslogIdentifier=estop-locomotive-service

[Install]
WantedBy=multi-user.target
