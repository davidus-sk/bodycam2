[Unit]
Description=Network information checker (locomotive receiver)
After=multi-user.target
Wants=multi-user.target

[Service]
Type=simple
ExecStart=/app/bodycam2/locomotive/scripts/info.php
Restart=always
RestartSec=1
User=root
WorkingDirectory=/app/bodycam2/locomotive/scripts
StandardOutput=syslog
StandardError=syslog
SyslogIdentifier=estop-locomotive-service

[Install]
WantedBy=multi-user.target
