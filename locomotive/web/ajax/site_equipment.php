<?php

include '../bootstrap.php';

use App\YardtrackerClient;
use App\Cache;

try {

    $locationId = isset($_GET['location_id']) ? (int) $_GET['location_id'] : 0;

    if (!$locationId) {
        throw new InvalidArgumentException('Unknown Location ID.', 400);
    }

    // cache
    $cache = new Cache();
    $cacheKey = 'site_equipment';
    $data = $cache->get($cacheKey);

    if ($data === false) {
        $client = new YardtrackerClient();

        $data = $client->getSiteEquipment($locationId);
        $cache->set($cacheKey, $data, 60);
    }

    jsonResponse($data);
} catch (Exception $e) {
    jsonResponse([
        'error' => $e->getMessage()
    ], $e->getCode());
}
