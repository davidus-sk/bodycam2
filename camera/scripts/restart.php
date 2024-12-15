#!/usr/bin/php
<?php

// load libraries
require(dirname(__FILE__) . '/../../../vendor/autoload.php');
require(dirname(__FILE__) . '/../../common/functions.php');

use \PhpMqtt\Client\MqttClient;
use \PhpMqtt\Client\ConnectionSettings;

// run once
run_once('/tmp/camera_restart.pid', $fh);

// load settings
$config = read_config();

// log
openlog("camera_restart", LOG_PID | LOG_PERROR, LOG_LOCAL0);

// MQTT settings
$clientId = 'device-' . trim(`{$config['client_id']}`);
$clean_session = true;
$mqtt_version = MqttClient::MQTT_3_1;

// log
syslog(LOG_INFO, "Starting camera restart service for {$clientId}.");

// MQTT connection string
$connection_settings = (new ConnectionSettings)
  ->setUsername($config['username'])
  ->setPassword($config['password'])
  ->setKeepAliveInterval(60)
  ->setConnectTimeout(3)
  ->setLastWillTopic("device/{$clientId}/last-will")
  ->setLastWillMessage('Camera restart service disconnected.')
  ->setUseTls(true)
  ->setLastWillQualityOfService(0);

// connect to the server
$mqtt = new MqttClient($config['server'], $config['port'], $clientId . '-' . mt_rand(10, 99), $mqtt_version);
$mqtt->connect($connection_settings, $clean_session);

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
