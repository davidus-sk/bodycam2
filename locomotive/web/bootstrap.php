<?php

define('ROOT_DIR', realpath(__DIR__ . '/../..'));
define('APP_DIR', __DIR__);

// Includes
// ------------------------------------------------
include_once ROOT_DIR . '/vendor/autoload.php';
include_once APP_DIR . '/functions.php';

// MQTT
// ------------------------------------------------
$mqttClientId = $_COOKIE['mqtt_client_id'] ?? null;
if (!$mqttClientId) {
    $mqttClientId = uniqid('mqttjs_');
    setcookie('mqtt_client_id', $mqttClientId, time() + 3 * 24 * 3600, '/');
}

define('MQTT_CLIENT_ID', $mqttClientId);
