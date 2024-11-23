#!/usr/bin/php
<?php

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
$status = empty($argv[1]) ? 'bootup' : 'alive';

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

// connect to the server
$mqtt = new MqttClient($server, $port, $clientId, $mqtt_version);
$mqtt->connect($connectionSettings, $clean_session);

// construct payload
$payload = [
	'camera_id' => $clientId,
	'ts' => time(),
	'status' => $status
];

// publish and disconnect
$mqtt->publish("camera/{$clientId}/status", json_encode($payload), 0, false);
$mqtt->disconnect();
