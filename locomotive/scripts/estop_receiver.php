#!/usr/bin/php
<?php

// Monitor ESTOP BUTTON topic, if message was received, trigger relay.
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

// pull relay low first
$command = dirname(__FILE__) . '/setup_relay.py';
`$command`;

// MQTT settings
$clientId = trim(`{$config['client_id']}`);
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
syslog(LOG_INFO, "Connecting to server {$config['server']}:{$config['port']} as {$clientId}.");
$mqtt = new MqttClient($config['server'], $config['port'], $clientId . '-' . mt_rand(10, 99), $mqtt_version);
$mqtt->connect($connection_settings, $clean_session);
syslog(LOG_INFO, "Connection " . ($mqtt->isConnected() ? "established" : "failed") . ".");

$mqtt->subscribe('device/+/button', function ($topic, $message) {
    syslog(LOG_INFO, "Received ESTOP message: {$message}.");

    $data = json_decode($message, true);

    var_dump(time() - $data['ts']);

    if ($data && (time() - $data['ts'] < 5)) {
        syslog(LOG_INFO, "Activated relay.");
        $command = dirname(__FILE__) . '/relay.py';
        `$command`;
    }//if
}, 0);

$mqtt->loop(true);
