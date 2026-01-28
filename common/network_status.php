#!/usr/bin/php
<?php

// load libraries
require(dirname(__FILE__) . '/../vendor/autoload.php');
require(dirname(__FILE__) . '/../common/functions.php');

use PhpMqtt\Client\MqttClient;
use PhpMqtt\Client\ConnectionSettings;

// run once
run_once('/tmp/network_status.pid', $fh);

// load settings
$config = read_config();

// log
openlog("network_status", LOG_PID | LOG_PERROR, LOG_LOCAL0);

// MQTT settings
$clientId = trim(`{$config['client_id']}`);
$clean_session = true;
$mqtt_version = MqttClient::MQTT_3_1;
$type = empty($argv[1]) ? 'camera' : 'locomotive';

// MQTT connection string
$connection_settings = (new ConnectionSettings())
    ->setUsername($config['username'])
    ->setPassword($config['password'])
    ->setKeepAliveInterval(60)
    ->setConnectTimeout(3)
    ->setLastWillTopic("device/{$clientId}/last-will")
    ->setLastWillMessage('Camera status service disconnected.')
    ->setUseTls(true)
    ->setLastWillQualityOfService(0);

// get modems - /org/freedesktop/ModemManager1/Modem/0
$modem_id = false;
$modem_string = `/usr/bin/mmcli -L`;
if (preg_match("@/Modem/([0-9]+)@", $modem_string, $m)) {
    $modem_id = (int)$m[1];

    syslog(LOG_INFO, "Modem ID {$modem_id} found.");

    // start signal collection
    `/usr/bin/mmcli -m {$modem_id} --signal-setup=15`;
}

if ($modem_id === false) {
    syslog(LOG_ERR, "No modem found. Exiting...");
    exit(-1);
}//if

while (true) {

    // get signal status - rssi: -58.00 dBm
    $signal_level = 0;
    $signal_status = `/usr/bin/mmcli -m {$modem_id} --signal-get`;
    if (preg_match("/rssi:\s+([0-9\.\-]+)/", $signal_status, $m)) {
        $rssi = (float)$m[1];
        $signal_level = round(2 * ($rssi + 100), 0);
    }

    try {

        // connect to the server
        $mqtt = new MqttClient($config['server'], $config['port'], $clientId . '-' . mt_rand(10, 99), $mqtt_version);
        $mqtt->connect($connection_settings, $clean_session);

        if (!$mqtt->isConnected()) {
            syslog(LOG_ERR, "MQTT not connected. Exiting...");
            exit(-1);
        }//if

        $battery_level = 0;
        if (file_exists('/tmp/battery.dat')) {
            $voltage = (float)file_get_contents('/tmp/battery.dat');
            $battery_level = round(($voltage * 100) / 3.7);
            $battery_level = $battery_level > 100 ? 100 : $battery_level;
        }//if

        // construct payload
        $payload = [
            'device_id' => $clientId,
            'device_type' => 'camera',
            'ts' => time(),
            'status' => ['signal' => $signal_level, "battery" => $battery_level]
        ];

        // publish and disconnect
        $mqtt->publish("device/{$clientId}/osd", json_encode($payload), 0, false);
        $mqtt->disconnect();

        syslog(LOG_INFO, "Network status '{$signal_level}%' message sent.");

    } catch (Exception $e) {
        syslog(LOG_ERR, "Error: '{$e->getMessage()}'");
    }

    // rest
    sleep(15);
}//while
