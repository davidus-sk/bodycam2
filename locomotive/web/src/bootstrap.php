<?php

// Includes
// ------------------------------------------------
#include_once __DIR__ . '/vendor/autoload.php';
include_once __DIR__ . '/functions.php';

define('APP_DIR', __DIR__);

// MQTT
// ------------------------------------------------
$mqttClientId = $_COOKIE['mqtt_client_id'] ?? null;
if (!$mqttClientId) {
    $mqttClientId = uniqid('mqttjs_');
    setcookie('mqtt_client_id', $mqttClientId, time() + 3 * 24 * 3600, '/');
}

define('MQTT_CLIENT_ID', $mqttClientId);
