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
while (true) {
    // find running instances
    $pid = trim(`/usr/bin/pgrep -f "[p]i_webrtc"`);

    // if not running, start new instance
    if (empty($pid)) {
        $clientId = trim(`{$config['client_id']}`);

        // launch
        syslog(LOG_INFO, "Starting pi_webrtc for {$clientId}.");
        `/app/bodycam2/camera/stream/pi_webrtc --camera=libcamera:0 --fps={$config['fps']} --width={$config['width']} --height={$config['height']} --hw-accel --no-audio --use-mqtt --mqtt-host={$config['server']} --mqtt-port={$config['port']} --mqtt-username={$config['username']} --mqtt-password={$config['password']} --uid={$clientId} --stun-url=stun:34.200.4.20:3478 --turn-url=turn:34.200.4.20:3478 --turn-username=marek --turn-password=337caaf1d2 >> /tmp/pi_webrtc.log 2>&1 &`;

        // reset kill counter
        $k = 0;
    }
    // it could run but be a zombie
    else {
        $status = trim(`/usr/bin/cat /proc/{$pid}/status | /usr/bin/grep "State:"`);

        if (preg_match("/State:\s+Z/", $status)) {
            // try to kill zombie process
            syslog(LOG_INFO, "Zombie process {$pid}. Killing process {$pid}...");
            `/usr/bin/kill -9 $pid`;

            $k++;

            if ($k > 5) {
                // no dice, we have to reboot
                syslog(LOG_INFO, "Unable to kill zombie process. Rebooting...");
                `/usr/sbin/reboot`;
            }//if
        }//if

        // check of network errors
        $status = trim(`/usr/bin/tail -n 2 /tmp/pi_webrtc.log`);

        if (preg_match("/Network/", $status)) {
            syslog(LOG_INFO, "Network issue detected. Killing process {$pid}...");
            `/usr/bin/kill -9 $pid`;
        }//if
    }//if

    // sleep
    sleep(1);
}//while
