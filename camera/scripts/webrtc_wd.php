#!/usr/bin/php
<?php

// run only once
$lockFile = fopen('/tmp/camera_webrtc_wd.pid', 'c');
$gotLock = flock($lockFile, LOCK_EX | LOCK_NB, $wouldBlock);
if ($lockFile === false || (!$gotLock && !$wouldBlock)) {
        throw new Exception("Can't obtain lock.");
} else if (!$gotLock && $wouldBlock) {
        exit();
}//if

ftruncate($lockFile, 0);
fwrite($lockFile, getmypid() . "\n");

// load up config file
$conf_file = '/app/bodycam2/camera/conf/config.json';

if (!file_exists($conf_file)) {
	echo date('r') . "> Config file does not exist.\n";
	exit;
}//if

$json = file_get_contents($conf_file);
$data = json_decode($json, TRUE);

if (empty($data)) {
	echo date('r') . "> Config file is empty.\n";
	exit;
}//if

// keep checking
while (TRUE) {
	// find running instances
	$pid = trim(`/usr/bin/pgrep -f "[p]i_webrtc"`);

	// if not running, start new instance
	if (empty($pid)) {
		$clientId = 'device-' . trim(`{$data['client_id']}`);

		echo date('r') . "> Starting pi_webrtc for {$clientId}.\n";

		`/app/bodycam2/camera/stream/pi_webrtc --use_libcamera --fps={$data['fps']} --width={$data['width']} --height={$data['height']} --hw_accel --no_audio --mqtt_host={$data['server']} --mqtt_port={$data['port']} --mqtt_username={$data['username']} --mqtt_password={$data['password']} --uid={$clientId}  >> /tmp/pi_webrtc.log 2>&1 &`;
	}//if

	// sleep
	sleep(1);
}//while
