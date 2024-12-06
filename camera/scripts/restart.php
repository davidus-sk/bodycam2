#!/usr/bin/php
<?php

// run only once
$lockFile = fopen('/tmp/camera_restart.pid', 'c');
$gotLock = flock($lockFile, LOCK_EX | LOCK_NB, $wouldBlock);
if ($lockFile === false || (!$gotLock && !$wouldBlock)) {
        throw new Exception("Can't obtain lock.");
} else if (!$gotLock && $wouldBlock) {
        exit();
}//if

ftruncate($lockFile, 0);
fwrite($lockFile, getmypid() . "\n");

// load libraries
require(dirname(__FILE__) . '/../../../vendor/autoload.php');

use \PhpMqtt\Client\MqttClient;
use \PhpMqtt\Client\ConnectionSettings;

// log
openlog("camera_restart", LOG_PID | LOG_PERROR, LOG_LOCAL0);

// MQTT settings
$server   = '951badeefd764316aa971d7958e80e0c.s1.eu.hivemq.cloud';
$port     = 8883;
$clientId = 'device-' . trim(`/usr/bin/cat /proc/cpuinfo | /usr/bin/grep "Serial" | /usr/bin/xargs | /usr/bin/cut -d ' ' -f 3`);
$username = 'marek';
$password = 'Mqtt12345';
$clean_session = false;
$mqtt_version = MqttClient::MQTT_3_1;

// log
syslog(LOG_INFO, "Starting camera restart service for {$clientId}.");

// MQTT connection string
$connectionSettings = (new ConnectionSettings)
  ->setUsername($username)
  ->setPassword($password)
  ->setKeepAliveInterval(60)
  ->setConnectTimeout(3)
  ->setLastWillTopic("device/{$clientId}/last-will")
  ->setLastWillMessage('Camera restart service disconnected.')
  ->setUseTls(true)
  ->setLastWillQualityOfService(0);

// connect to the server
$mqtt = new MqttClient($server, $port, $clientId . '-' . mt_rand(10, 99), $mqtt_version);
$mqtt->connect($connectionSettings, $clean_session);

// log
if ($mqtt->isConnected()) {
	syslog(LOG_INFO, "Connected to MQTT server at {$server}.");
}//if

$mqtt->subscribe("device/{$clientId}/restart", function ($topic, $message) {
	// log
	syslog(LOG_INFO, "Restarting camera streamer.");

	`/usr/bin/pkill -9 -f "pi_webrtc"`;

	// no need to start here, WD will restart dead streamer
}, 0);

$mqtt->loop(true);
