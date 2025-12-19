<?php

namespace App;

use App\HttpClient;

class YardtrackerClient
{
    private string|null $apiKey;
    private string $baseUrl = 'https://yardtracker.biz/api';
    private HttpClient $client;

    public function __construct(int $timeout = 5, array $defaultHeaders = [])
    {
        $this->apiKey = Config::get('map.yardtracker_api_token');
        $this->client = new HttpClient([
            'Accept: application/json',
            'Authorization: ' . $this->apiKey,
        ]);
    }

    /**
     * Get site list
     * @return array
     */
    public function getSiteList(): array
    {
        $data = $this->client->get($this->baseUrl . '/sitelist');

        return $data ? json_decode($data, true) : [];
    }

    /**
     * Get site equipment
     * @return array
     */
    public function getSiteEquipment(int $locationId): array
    {
        $data = $this->client->get($this->baseUrl . '/equipment', [
            'locationid' => $locationId
        ]);

        return $data ? json_decode($data, true) : [];
    }
}
