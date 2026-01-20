<?php

namespace App;

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
     * @return void
     */
    public static function set(string $key, $value): void
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

            $array[array_shift($parts)] = $value;
        } else {
            $config[$key] = $value;
        }

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
            $defaultConfigFile = __DIR__ . '/../config/config.default.ini';
        }

        if (!$userConfigFile) {
            self::$userConfigPath = __DIR__ . '/../config/config.ini';
        } else {
            self::$userConfigPath = $userConfigFile;
        }

        self::$defaultConfig = self::parseIniFileWithSections($defaultConfigFile);
        self::$userConfig = self::parseIniFileWithSections(self::$userConfigPath);

        self::$mergedConfig = self::mergeIniArrays(self::$defaultConfig, self::$userConfig);

        return self::$mergedConfig;
    }

    public static function save(): bool
    {
        return self::writeIniFile(self::getMergedConfig(), self::$userConfigPath);
    }

    private static function writeIniFile(array $assocArr, string $path, bool $hasSections = true): bool
    {
        // process array
        $data = [];

        foreach ($assocArr as $key => $val) {
            if (is_array($val)) {
                $data[] = "[$key]";

                foreach ($val as $skey => $sval) {

                    if (is_array($sval)) {
                        foreach ($sval as $_skey => $_sval) {
                            if (is_numeric($_skey)) {
                                $data[] = $skey.'[] = '.(is_numeric($_sval) ? $_sval : (ctype_upper($_sval) ? $_sval : '"'.$_sval.'"'));
                            } else {
                                $data[] = $skey.'['.$_skey.'] = '.(is_numeric($_sval) ? $_sval : (ctype_upper($_sval) ? $_sval : '"'.$_sval.'"'));
                            }
                        }
                    } else {

                        if ($sval !== false) {
                            $data[] = $skey.' = '.(is_numeric($sval) ? $sval : (ctype_upper($sval) ? $sval : '"'.$sval.'"'));
                        } else {
                            $data[] = $skey.' = ""';
                        }
                    }
                }
            } else {
                if ($val !== false) {
                    $data[] = $key.' = '.(is_numeric($val) ? $val : (ctype_upper($val) ? $val : '"'.$val.'"'));
                } else {
                    $data[] = $key.' = ""';
                }
            }

            // empty line
            $data[] = null;
        }

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
        fwrite($fp, implode(PHP_EOL, $data).PHP_EOL);

        // release lock
        flock($fp, LOCK_UN);
        fclose($fp);

        return true;
    }

    private static function parseIniFileWithSections($filename)
    {
        return parse_ini_file($filename, true, INI_SCANNER_TYPED);
    }

    private static function mergeIniArrays($defaultArray, $userArray)
    {
        $merged = [];

        foreach ($userArray as $key => $value) {
            if (isset($userArray[$key])) {
                $merged[$key] = $userArray[$key];
            } elseif (isset($defaultArray[$key])) {
                $merged[$key] = $defaultArray[$key];
            }
        }

        foreach ($defaultArray as $key => $value) {
            if (!isset($merged[$key])) {
                $merged[$key] = $defaultArray[$key];
            }
        }

        return $merged;
    }
}
