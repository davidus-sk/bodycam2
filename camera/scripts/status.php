#!/usr/bin/php
<?php

// run only once
$lockFile = fopen('/tmp/camera_status.pid', 'c');
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

// MQTT settings
$server   = '951badeefd764316aa971d7958e80e0c.s1.eu.hivemq.cloud';
$port     = 8883;
$clientId = 'device-' . trim(`/usr/bin/cat /proc/cpuinfo | /usr/bin/grep "Serial" | /usr/bin/xargs | /usr/bin/cut -d ' ' -f 3`);
$username = 'marek';
$password = 'Mqtt12345';
$clean_session = false;
$mqtt_version = MqttClient::MQTT_3_1;
$status = empty($argv[1]) ? 'bootup' : 'alive';

// MQTT connection string
$connectionSettings = (new ConnectionSettings)
  ->setUsername($username)
  ->setPassword($password)
  ->setKeepAliveInterval(60)
  ->setConnectTimeout(3)
  ->setLastWillTopic("device/{$clientId}/last-will")
  ->setLastWillMessage('Camera status service disconnected.')
  ->setUseTls(true)
  ->setLastWillQualityOfService(0);

while (TRUE) {
	// connect to the server
	$mqtt = new MqttClient($server, $port, $clientId . '-' . mt_rand(10, 99), $mqtt_version);
	$mqtt->connect($connectionSettings, $clean_session);

	// construct payload
	$payload = [
		'device_id' => $clientId,
		'device_type' => 'camera',
		'ts' => time(),
		'status' => $status
	];

	// publish and disconnect
	$mqtt->publish("device/{$clientId}/status", json_encode($payload), 0, false);
	$mqtt->disconnect();

	sleep(30);
}//while
