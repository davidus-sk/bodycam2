<?php

class Config
{
    /**
     * @var boolean
     */
    private static $initialized = false;

    /**
     * @var array
     */
    private static $data;


    /**
     * Read configuration
     * @param bool $returnJson
     * @return array
     */
    public static function read(bool $returnJson = false): array|string
    {

        // init
        if (self::$initialized !== true) {
            self::$initialized = true;

            $configPath = __DIR__ . '/../config/config.ini';
            $defaultConfigPath = __DIR__ . '/../config/config.default.ini';

            $cfg = self::readFile($configPath);
            $cfgDefault = self::readFile($defaultConfigPath);

            self::$data = self::merge($cfgDefault, $cfg);
        }

        return $returnJson === true ?
            json_encode(self::$data, JSON_NUMERIC_CHECK)
            : self::$data;
    }

    /**
     * Read single configuration file
     * @param mixed $filePath
     * @throws \Exception
     * @return array
     */
    private static function readFile($filePath): array
    {
        $cfg = [];

        if (!file_exists($filePath)) {
            throw new Exception('Configuration file "'. $filePath .'" does not exist.');
        }

        $cfg = parse_ini_file($filePath, true, INI_SCANNER_TYPED);
        if (!is_array($cfg)) {
            throw new Exception('Failed to read configuration file "'. $filePath .'".');
        }

        return $cfg;
    }

    /**
     * Get the raw value for a key
     * If the key does not exist, an optional default value can be returned instead.
     * @param string $key Which config item to look up
     * @param mixed $defaultFallback Fallback default value to use when configuration object has neither a value nor a default.
     * @return mixed Config value
     */
    public static function get($key, $default = null)
    {
        self::read();
        return self::$data[$key] ?? $default;
    }

    /**
     * Set a value for a key. If the key does not yet exist it will be created.
     * @param array $config
     * @return void
     */
    public static function set($key, $value)
    {
        self::read();
        self::$data[$key] = $value;
    }

    /**
     * Determine if a non-default config value exists.
     * @param string $key
     * @return bool
     */
    public static function has($key)
    {
        self::read();
        return isset(self::$data[$key]);
    }

    /**
     * Export data as raw data
     * @return array
     */
    public static function export()
    {
        self::read();
        return self::$data;
    }

    /**
     * Write an ini configuration file
     * @param array  $array
     * @return bool
     */
    public static function write(array $array): bool
    {
        $configPath = __DIR__ . '/../config/config.ini';

        // process array
        $data = [];
        foreach ($array as $key => $val) {
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
                        $data[] = $skey.' = '.(is_numeric($sval) ? $sval : (ctype_upper($sval) ? $sval : '"'.$sval.'"'));
                    }
                }
            } else {
                $data[] = $key.' = '.(is_numeric($val) ? $val : (ctype_upper($val) ? $val : '"'.$val.'"'));
            }
            // empty line
            $data[] = null;
        }

        // open file pointer, init flock options
        $fp = fopen($configPath, 'w');
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

    /**
     * Merges two or more arrays into one recursively.
     * @param array $a array to be merged to
     * @param array $b array to be merged from. You can specify additional
     * arrays via third argument, fourth argument etc.
     * @return array the merged array (the original arrays are not changed.)
     */
    public static function merge($a, $b)
    {
        $args = func_get_args();
        $res = array_shift($args);

        while (!empty($args)) {
            foreach (array_shift($args) as $k => $v) {
                if (is_int($k)) {
                    if (array_key_exists($k, $res)) {
                        $res[] = $v;
                    } else {
                        $res[$k] = $v;
                    }
                } elseif (is_array($v) && isset($res[$k]) && is_array($res[$k])) {
                    $res[$k] = !count($v) ? [] : self::merge($res[$k], $v);
                } else {
                    $res[$k] = $v;
                }
            }
        }

        return $res;
    }

}
