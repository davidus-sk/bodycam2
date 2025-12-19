<?php

namespace App;

use Symfony\Component\Cache\Adapter\FilesystemAdapter;
use Symfony\Contracts\Cache\ItemInterface;

final class Cache
{
    private FilesystemAdapter $cache;

    /**
     * Class constructor
     *
     * @param integer $defaultLifetime
     * @param string $namespace
     * @param string|null $directory
     */
    public function __construct(
        int $defaultLifetime = 60,
        string $namespace = 'app',
        ?string $directory = null
    ) {

        if (!$directory) {
            $directory = realpath(__DIR__ . '/../runtime') . DIRECTORY_SEPARATOR . 'cache';
        }

        $this->cache = new FilesystemAdapter(
            $namespace,
            $defaultLifetime,
            $directory
        );
    }

    /**
     * Returns cached value or <b>FALSE</b> if not found.
     */
    public function get(string $key): mixed
    {
        $item = $this->cache->getItem($key);

        return $item->isHit() ? $item->get() : false;
    }

    /**
     * Returns cached value or computes and stores it.
     */
    public function getOrSet(string $key, callable $callback, ?int $ttl = null): mixed
    {
        return $this->cache->get($key, function (ItemInterface $item) use ($callback, $ttl) {
            if ($ttl !== null) {
                $item->expiresAfter($ttl);
            }

            return $callback();
        });
    }

    /**
     * Stores a value.
     */
    public function set(string $key, mixed $value, ?int $ttl = null): bool
    {
        $item = $this->cache->getItem($key);
        $item->set($value);

        if ($ttl !== null) {
            $item->expiresAfter($ttl);
        }

        return $this->cache->save($item);
    }

    /**
     * Checks if the key exists.
     */
    public function has(string $key): bool
    {
        return $this->cache->hasItem($key);
    }

    /**
     * Deletes a single key.
     */
    public function delete(string $key): bool
    {
        return $this->cache->deleteItem($key);
    }

    /**
     * Clears the namespace.
     */
    public function clear(): bool
    {
        return $this->cache->clear();
    }
}
