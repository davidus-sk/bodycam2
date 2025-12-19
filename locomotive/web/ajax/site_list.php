<?php

include '../bootstrap.php';

use App\YardtrackerClient;
use App\Cache;

try {

    // cache
    $cache = new Cache();
    $cacheKey = 'site_list';
    $data = $cache->get($cacheKey);

    if ($data === false) {
        $client = new YardtrackerClient();
        $data = $client->getSiteList();
        $cache->set($cacheKey, $data, 60);
    }

    jsonResponse($data);
} catch (Exception $e) {
    jsonResponse([
        'error' => $e->getMessage()
    ], $e->getCode());
}
