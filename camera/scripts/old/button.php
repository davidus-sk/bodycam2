#!/usr/bin/php
<?php

// Monitor creation of ESTOP file by the button reading service.
// If the ESTOP file was created send MQTT message to the locomotive
//
// Future improvement: Send MQTT right away from the button reading service


// load libraries
require(dirname(__FILE__) . '/../../../vendor/autoload.php');
require(dirname(__FILE__) . '/../../common/functions.php');

use PhpMqtt\Client\MqttClient;
use PhpMqtt\Client\ConnectionSettings;

// run once
run_once('/tmp/camera_button.pid', $fh);

// load settings
$config = read_config();

// log
openlog("camera_button", LOG_PID | LOG_PERROR, LOG_LOCAL0);

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
  ->setLastWillMessage('Emergency button service disconnected.')
  ->setUseTls(true)
  ->setLastWillQualityOfService(0);

while (true) {
    if (file_exists($stop_file)) {
        // debug
        syslog(LOG_INFO, "ESTOP file ({$stop_file}) detected.");

        // connect to the server
        $mqtt = new MqttClient($config['server'], $config['port'], $clientId . '-' . mt_rand(10, 99), $mqtt_version);
        $mqtt->connect($connection_settings, $clean_session);

        // construct payload
        $payload = [
            'device_id' => $clientId,
            'device_type' => 'camera',
            'ts' => time(),
            'status' => 'emergency'
        ];

        // publish and disconnect
        $mqtt->publish("device/{$clientId}/button", json_encode($payload), 0, false);

        // debug
        syslog(LOG_INFO, "ESTOP message sent to server.");

        $mqtt->disconnect();

        unlink($stop_file);
        clearstatcache();

        // debug
        syslog(LOG_INFO, "ESTOP file ({$stop_file}) deleted.");
    }//if

    // rest
    usleep(50000);
}//while
