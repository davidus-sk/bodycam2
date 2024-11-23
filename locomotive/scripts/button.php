#!/usr/bin/php
<?php

// run only once
$lockFile = fopen('/tmp/locomotive_button.pid', 'c');
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
$clientId = 'locomotive-' . trim(`/usr/bin/cat /proc/cpuinfo | /usr/bin/grep "Serial" | /usr/bin/xargs | /usr/bin/cut -d ' ' -f 3`);
$username = 'marek';
$password = 'Mqtt12345';
$clean_session = false;
$mqtt_version = MqttClient::MQTT_3_1;

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

$mqtt->subscribe('camera/+/button', function ($topic, $message) {
    printf("Received message on topic [%s]: %s\n", $topic, $message);
}, 0);

$mqtt->loop(true);
