<?php

namespace App;

class HttpClient
{
    private int $timeout = 5;
    private array $defaultHeaders;

    public function __construct(array $defaultHeaders = [])
    {
        $this->defaultHeaders = $defaultHeaders;
    }

    /**
     * GET request
     *
     * @param string $url
     * @param array $query
     * @param array $headers
     * @return string|false
     */
    public function get(string $url, array $query = [], array $headers = []): string|false
    {
        if (!empty($query)) {
            $url .= '?' . http_build_query($query);
        }

        return $this->request('GET', $url, null, $headers);
    }

    /**
     * Post request
     *
     * @param string $url
     * @param array $data
     * @param array $headers
     * @return string|false
     */
    public function post(string $url, array|string $data = [], array $headers = []): string|false
    {
        return $this->request('POST', $url, $data, $headers);
    }

    private function request(
        string $method,
        string $url,
        array|string|null $data,
        array $headers
    ): string|false {
        $ch = curl_init();

        $finalHeaders = array_merge($this->defaultHeaders, $headers);

        curl_setopt_array($ch, [
            CURLOPT_URL => $url,
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_CUSTOMREQUEST => $method,
            CURLOPT_TIMEOUT => $this->timeout,
            CURLOPT_CONNECTTIMEOUT => 2,
            CURLOPT_HTTPHEADER => $finalHeaders,
            CURLOPT_ENCODING => '',
            CURLOPT_HTTP_VERSION => CURL_HTTP_VERSION_2_0,
        ]);

        if ($method === 'POST') {
            curl_setopt($ch, CURLOPT_POSTFIELDS, $data);
        }

        $response = curl_exec($ch);

        if ($response === false) {
            $error = curl_error($ch);
            curl_close($ch);
            return false;
        }

        curl_close($ch);
        return $response;
    }
}
