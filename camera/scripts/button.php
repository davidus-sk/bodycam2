#!/usr/bin/php
<?php

// run only once
$lockFile = fopen('/tmp/camera_button.pid', 'c');
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
$clientId = 'camera-' . trim(`/usr/bin/cat /proc/cpuinfo | /usr/bin/grep "Serial" | /usr/bin/xargs | /usr/bin/cut -d ' ' -f 3`);
$username = 'marek';
$password = 'Mqtt12345';
$clean_session = false;
$mqtt_version = MqttClient::MQTT_3_1;
$stop_file = '/tmp/ESTOP';

// MQTT connection string
$connectionSettings = (new ConnectionSettings)
  ->setUsername($username)
  ->setPassword($password)
  ->setKeepAliveInterval(60)
  ->setConnectTimeout(3)
  ->setLastWillTopic("camera/{$clientId}/last-will")
  ->setLastWillMessage('client disconnect')
  ->setUseTls(true)
  ->setLastWillQualityOfService(0);

while (TRUE) {
	if (file_exists($stop_file)) {
		// debug
		echo date('r') . "> ESTOP ({$stop_file}) detected.\n";

		// connect to the server
		$mqtt = new MqttClient($server, $port, $clientId, $mqtt_version);
		$mqtt->connect($connectionSettings, $clean_session);

		// construct payload
		$payload = [
			'camera_id' => $clientId,
			'ts' => time(),
			'status' => 'emergency'
		];

		// publish and disconnect
		$mqtt->publish("camera/{$clientId}/button", json_encode($payload), 0, false);

		// debug
		echo date('r') . "> Message sent to server.\n";

		$mqtt->disconnect();

		unlink($stop_file);
		clearstatcache();

		// debug
		echo date('r') . "> ESTOP ({$stop_file}) deleted.\n";
	}//if

	// rest
	usleep(50000);
}//while
