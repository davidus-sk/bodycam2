#!/usr/bin/php
<?php

// load libraries
require(dirname(__FILE__) . '/../../../vendor/autoload.php');
require(dirname(__FILE__) . '/../../common/functions.php');

use \PhpMqtt\Client\MqttClient;
use \PhpMqtt\Client\ConnectionSettings;

// run once
run_once('/tmp/camera_status.pid', $fh);

// load settings
$config = read_config();

// log
openlog("camera_status", LOG_PID | LOG_PERROR, LOG_LOCAL0);

// MQTT settings
$clientId = 'device-' . trim(`{$config['client_id']}`);
$clean_session = true;
$mqtt_version = MqttClient::MQTT_3_1;
$status = empty($argv[1]) ? 'bootup' : 'alive';

// MQTT connection string
$connection_settings = (new ConnectionSettings)
  ->setUsername($config['username'])
  ->setPassword($config['password'])
  ->setKeepAliveInterval(60)
  ->setConnectTimeout(3)
  ->setLastWillTopic("device/{$clientId}/last-will")
  ->setLastWillMessage('Camera status service disconnected.')
  ->setUseTls(true)
  ->setLastWillQualityOfService(0);

while (TRUE) {
	// connect to the server
	$mqtt = new MqttClient($config['server'], $config['port'], $clientId . '-' . mt_rand(10, 99), $mqtt_version);
	$mqtt->connect($connection_settings, $clean_session);

	if (!$mqtt->isConnected()) {
		syslog(LOG_ERR, "MQTT not connected. Exiting...");
		exit(-1);
	}//if

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

	syslog(LOG_INFO, "Camera status '{$status}' message sent.");

	// send this only once
	if ($status == 'bootup') {
		exit(0);
	}//if

	// rest
	sleep(15);
}//while
