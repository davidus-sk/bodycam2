<?php

namespace App\Base;

use App\Helpers\ArrayHelper;
use Symfony\Component\Yaml\Exception\ParseException;
use Symfony\Component\Yaml\Yaml;

class Config
{
    private static $initialized;

    private static $defaultConfig;
    private static $userConfig;
    private static $userConfigPath;
    private static $mergedConfig;


    /**
     * Get configuration
     * @param bool $jsonEncode
     * @param array|null $overrideOptions
     * @return string|array
     */
    public static function all(bool $jsonEncode = false, ?array $overrideOptions = null): string|array
    {
        $config = self::getMergedConfig();

        // override
        if ($overrideOptions !== null) {
            $config = array_replace_recursive($config, $overrideOptions);
        }

        if ($jsonEncode) {
            return json_encode($config);
        } else {
            return $config;
        }
    }

    /**
     * Get the raw value for a key
     * If the key does not exist, an optional default value can be returned instead.
     * @param string $key Which config item to look up
     * @param mixed $defaultFallback Fallback default value to use when configuration
     * object has neither a value nor a default.
     * @return mixed Config value
     */
    public static function get(?string $key = null, $default = null)
    {
        $config = self::getMergedConfig();

        if ($key === null) {
            return $config;
        }

        if (isset($config[$key])) {
            return $config[$key];
        }

        // dot notation syntax
        if (strpos($key, '.') !== false) {
            foreach (explode('.', $key) as $segment) {
                if (!is_array($config) || !array_key_exists($segment, $config)) {
                    return $default;
                }

                $config = $config[$segment];
            }
        }


        return $config;
    }

    /**
     * Sets a configuration value.
     * @param string $key The configuration key.
     * @param mixed $value The value to set for the given key.
     * @param bool $merge Merge values
     * @return void
     */
    public static function set(string $key, $value, bool $merge = true): void
    {
        if (is_null($key)) {
            self::$mergedConfig = $value;
            return;
        }

        $config = self::getMergedConfig();

        // dot notation syntax
        if (strpos($key, '.') !== false) {
            $array = & $config;
            $parts = explode('.', trim($key));

            while (count($parts) > 1) {
                $part = array_shift($parts);

                if (!isset($array[$part]) or !is_array($array[$part])) {
                    $array[$part] = [];
                }

                $array = & $array[$part];
            }

            if ($merge === true) {
                $part = array_shift($parts);
                foreach ($value as $k => $val) {
                    $array[$part][$k] = $val;
                }
            } else {
                $array[array_shift($parts)] = $value;
            }
        } else {
            if ($merge === true) {
                if (is_array($value)) {
                    foreach ($value as $k => $val) {
                        $config[$key][$k] = $val;
                    }
                } else {
                    $config[$key] = $value;
                }
            } else {
                $config[$key] = $value;
            }
        }

        var_dump('----------------------');
        print_r($config['mqtt']);

        self::$mergedConfig = $config;
    }

    public static function unset($key)
    {
        if (is_null($key)) {
            return;
        }

        $config = self::getMergedConfig();

        // dot notation syntax
        if (strpos($key, '.') !== false) {
            $array = & $config;
            $parts = explode('.', trim($key));

            while (count($parts) > 1) {
                $part = array_shift($parts);

                $array = & $array[$part];
            }

            $k = array_shift($parts);
            unset($array[$k]);
        } else {
            if (isset($config[$key])) {
                unset($config[$key]);
            }
        }

        self::$mergedConfig = $config;
    }

    public static function getMergedConfig()
    {
        if (self::$initialized === null) {
            self::$initialized = true;
            self::readConfigs();
        }

        return self::$mergedConfig;
    }

    /**
     * Read configs
     *
     * @param string|null $defaultConfigFile
     * @param string|null $userConfigFile
     * @return array
     */
    private static function readConfigs(?string $defaultConfigFile = null, ?string $userConfigFile = null): array
    {

        if (!$defaultConfigFile) {
            $defaultConfigFile = realpath(__DIR__ . '/../../config/config.default.yaml');
        }

        if (!$userConfigFile) {
            self::$userConfigPath = realpath(__DIR__ . '/../../config/config.yaml');
        } else {
            self::$userConfigPath = $userConfigFile;
        }

        // default config
        self::$defaultConfig = Yaml::parseFile($defaultConfigFile);

        // custom config
        if (file_exists(self::$userConfigPath)) {
            $userConfig = Yaml::parseFile(self::$userConfigPath);
            self::$userConfig = ArrayHelper::merge(self::$defaultConfig, $userConfig);
        }

        self::$mergedConfig = ArrayHelper::merge(self::$defaultConfig, self::$userConfig);

        return self::$mergedConfig;
    }

    public static function save(): bool
    {
        return self::writeFile(self::getMergedConfig(), self::$userConfigPath);
    }

    private static function writeFile(array $data, string $path): bool
    {
        // dump array to its YAML representation
        $yaml = Yaml::dump($data, 4);

        // open file pointer, init flock options
        $fp = fopen($path, 'w');
        $retries = 0;
        $max_retries = 100;

        if (!$fp) {
            return false;
        }

        // loop until get lock, or reach max retries
        do {
            if ($retries > 0) {
                usleep(rand(1, 5000));
            }
            $retries += 1;
        } while (!flock($fp, LOCK_EX) && $retries <= $max_retries);

        // couldn't get the lock
        if ($retries == $max_retries) {
            return false;
        }

        // got lock, write data
        fwrite($fp, $yaml);

        // release lock
        flock($fp, LOCK_UN);
        fclose($fp);

        return true;
    }


}
