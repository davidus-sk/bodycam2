<?php

namespace App\Base;

use Symfony\Component\Cache\Adapter\FilesystemAdapter;

class Cache
{
    /**
     * @var bool
     */
    public $enabled = true;

    /**
     * @var FilesystemAdapter
     */
    private $cachePool;

    /**
     * Sub-namespace
     * @var string
     */
    private $subNamespace;

    /**
     * Class constructor
     * @param string $namespace
     * @param int $defaultLifetime
     * @param string|null $directory
     */
    public function __construct(string $namespace = 'cache', int $defaultLifetime = 500, ?string $directory = null)
    {
        if ($directory === null) {
            $directory = APP_DIR . '/runtime';
        }

        $this->cachePool = new FilesystemAdapter($namespace, $defaultLifetime, $directory);
        $this->enabled = !isset($_REQUEST['nocache']);
    }

    public function withSubNamespace(string $namespace): static
    {
        $clone = clone $this;
        $clone->subNamespace = $namespace;

        return $clone;
    }

    /**
     * Get cached item
     * @param string $key
     * @return mixed
     */
    public function get(string $key): mixed
    {
        if (!$this->enabled) {
            return false;
        }

        // retrieve the cache item
        if ($this->subNamespace) {
            $item = $this->cachePool->withSubNamespace($this->subNamespace)->getItem($key);
        } else {
            $item = $this->cachePool->getItem($key);
        }

        if ($item->isHit()) {
            return $item->get();
        }

        // default
        return false;
    }

    public function set(string $key, mixed $data, int|\DateInterval|null $expiresAfter = 300): bool
    {
        if (!$this->enabled) {
            return false;
        }

        if (is_callable($data)) {
            $data = call_user_func($data);
        }

        // retrieve the cache item
        if ($this->subNamespace) {
            $item = $this->cachePool->withSubNamespace($this->subNamespace)->getItem($key);
        } else {
            $item = $this->cachePool->getItem($key);
        }


        $item->set($data);
        $item->expiresAfter($expiresAfter);

        return $this->cachePool->save($item);
    }

    public function getOrSet(string $key, mixed $data, int|\DateInterval|null $expiresAfter = 300): mixed
    {
        if (!$this->enabled) {
            if (is_callable($data)) {
                $data = call_user_func($data);
            }

            return $data;
        }

        // retrieve the cache item
        if ($this->subNamespace) {
            $item = $this->cachePool->withSubNamespace($this->subNamespace)->getItem($key);
        } else {
            $item = $this->cachePool->getItem($key);
        }

        if (!$item->isHit()) {
            // item does not exist in the cache

            if (is_callable($data)) {
                $data = call_user_func($data);
            }

            $item->set($data);
            $item->expiresAfter($expiresAfter);

            if ($this->subNamespace) {
                $this->cachePool->withSubNamespace($this->subNamespace)->save($item);
            } else {
                $this->cachePool->save($item);
            }
        }

        // retrieve the value stored by the item
        return $item->get();
    }

    /**
     * Deletes the cache item
     *
     * @param string|array $key
     * @return bool
     */
    public function delete(string|array $key): bool
    {
        if (!$this->enabled) {
            return false;
        }

        if (is_array($key)) {
            if ($this->subNamespace) {
                $deleted = $this->cachePool->withSubNamespace($this->subNamespace)->deleteItems($key);
            } else {
                $deleted = $this->cachePool->deleteItems($key);
            }
        } else {
            if ($this->subNamespace) {
                $deleted = $this->cachePool->withSubNamespace($this->subNamespace)->deleteItem($key);
            } else {
                $deleted = $this->cachePool->deleteItem($key);
            }
        }

        return $deleted;
    }

}
