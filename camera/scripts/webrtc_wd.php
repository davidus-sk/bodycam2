#!/usr/bin/php
<?php

// load libraries
require(dirname(__FILE__) . '/../../common/functions.php');

// run once
run_once('/tmp/camera_webrtc_wd.pid', $fh);

// load settings
$config = read_config();

// log
openlog("camera_webrtc_wd", LOG_PID | LOG_PERROR, LOG_LOCAL0);

// globals
$k = 0;

// keep checking
while (TRUE) {
	// find running instances
	$pid = trim(`/usr/bin/pgrep -f "[p]i_webrtc"`);

	// if not running, start new instance
	if (empty($pid)) {
		$clientId = 'device-' . trim(`{$data['client_id']}`);

		// launch
		syslog(LOG_INFO, "Starting pi_webrtc for {$clientId}.");
		`/app/bodycam2/camera/stream/pi_webrtc --use_libcamera --fps={$data['fps']} --width={$data['width']} --height={$data['height']} --hw_accel --no_audio --mqtt_host={$data['server']} --mqtt_port={$data['port']} --mqtt_username={$data['username']} --mqtt_password={$data['password']} --uid={$clientId}  >> /tmp/pi_webrtc.log 2>&1 &`;

		// reset kill counter
		$k = 0;
	}
	// it could run but be a zombie
	else {
		$status = trim(`/usr/bin/cat /proc/{$pid}/status | /usr/bin/grep "State:"`);

		if (preg_match("/State:\s+Z/", $status)) {
			// try to kill zombie process
			syslog(LOG_INFO, "Zombie process {$pid}. Killing it...");
			`/usr/bin/kill -9 $pid`;

			$k++;

			if ($k > 5) {
				// no dice, we have to reboot
				syslog(LOG_INFO, "Unable to kill zombie process. Rebooting...");
				`/usr/bin/reboot`;
			}//if
		}//if
	}//if

	// sleep
	sleep(1);
}//while
