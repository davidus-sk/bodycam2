#!/usr/bin/php
<?php

// Monitor BUTTON topic, if message was received, trigger relay.
// Messages come from body worn units and trigger relay on the loco unit.

// load libraries
require(dirname(__FILE__) . '/../../vendor/autoload.php');
require(dirname(__FILE__) . '/../../common/functions.php');

use PhpMqtt\Client\MqttClient;
use PhpMqtt\Client\ConnectionSettings;

// run once
run_once('/tmp/locomotive_button.pid', $fh);

// load settings
$config = read_config();

// log
openlog("locomotive_button", LOG_PID | LOG_PERROR, LOG_LOCAL0);

// MQTT settings
$clientId = 'device-' . trim(`{$config['client_id']}`);
$clean_session = true;
$mqtt_version = MqttClient::MQTT_3_1;
$stop_file = '/tmp/ESTOP';

// MQTT connection string
$connection_settings = (new ConnectionSettings())
    ->setUsername($config['username'])
    ->setPassword($config['password'])
    ->setKeepAliveInterval(60)
    ->setConnectTimeout(3)
    ->setLastWillTopic("device/{$clientId}/last-will")
    ->setLastWillMessage('client disconnect')
    ->setUseTls(true)
    ->setLastWillQualityOfService(0);

// connect to the server
$mqtt = new MqttClient($config['server'], $config['port'], $clientId . '-' . mt_rand(10, 99), $mqtt_version);
$mqtt->connect($connectionSettings, $clean_session);

$mqtt->subscribe('device/+/button', function ($topic, $message) {
    syslog(LOG_INFO, "Received message on topic [{$topic}]: {$message}.");

    $command = dirname(__FILE__) . '/relay.py';
    `$command`;
}, 0);

$mqtt->loop(true);
