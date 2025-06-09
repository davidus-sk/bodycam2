<?php

$_db = null;
function db()
{
    global $_db;
    if ($_db === null) {

        include_once APP_DIR . '/class/Config.php';

        try {
            $dsn = sprintf('mysql:host=%s;dbname=%s;charset=utf8mb4', Config::get('database.host'), Config::get('database.name'));
            $_db = new PDO($dsn, Config::get('database.username'), Config::get('database.password'));
            $_db->setAttribute(PDO::ATTR_DEFAULT_FETCH_MODE, PDO::FETCH_ASSOC);
        } catch (PDOException $e) {
            echo "DB Connection failed: " . $e->getMessage();
            die();
        }
    }

    return $_db;
}

/**
 * Generate URL
 * @param string $to
 * @param array $params
 * @param bool $window
 * @return string
 */
function url($to, array $params = [], $window = false): string
{
    $url = $window === true ? 'window.php' : 'index.php';
    if (!$to || $to == '/') {
        $url = 'index.php';
    } else {
        $url .= '?r=' . trim($to, ' /');
    }

    if ($params) {
        $url .= '&' . http_build_query($params);
    }

    return $url;
}

/**
 * Redirect
 * @param string $to
 * @param array $params
 * @param bool $permanent
 * @return void
 */
function redirect($to, array $params = [], $permanent = false)
{
    $url = url($to, $params);
    header("Location: {$url}", true, $permanent ? 301 : 302);
    die();
}

/**
 * Renders a view
 * @param string $view view name.
 * @param array $params view variables (`name => value`).
 * @return string rendered view content.
 * @throws RuntimeException if the view file does not exist or is not a file.
 * @throws Throwable If an error occurred during rendering.
 * @psalm-suppress RedundantCondition, NoValue
 */
function render(string $view, array $params = []): string
{
    $__viewPath = __DIR__ . '/views/' . trim($view, '\/') . '.php';
    if (!file_exists($__viewPath) || !is_file($__viewPath)) {
        throw new RuntimeException(sprintf('View file "%s" does not exist or is not a file.', $__viewPath));
    }

    if ($params) {
        extract($params);
    }

    ob_start();
    include $__viewPath;
    $content = ob_get_clean();

    return $content;
}

/**
 * Json response
 * @param mixed $data
 * @param int $responseCode
 * @return void
 */
function jsonResponse($data, $responseCode = 200)
{
    header('Content-Type: application/json; charset=utf-8');

    if (is_numeric($responseCode) && $responseCode !== 200) {
        http_response_code($responseCode);
    }

    echo json_encode($data, JSON_PRETTY_PRINT | JSON_NUMERIC_CHECK);
    die();
}

/**
 * Prints a string to STDOUT.
 * @param string $string the string to print
 * @return void
 */
function stdout($string): void
{
    echo $string;
}

function readConfig(bool $returnJson = false, array $overrideOptions = [])
{
    return Config::getAll($returnJson, $overrideOptions);
}

/**
 * Get array value
 * @param array $arr
 * @param string $value
 * @return mixed
 */
function arrayGetValue(array $arr, $value)
{
    return $arr[$value] ?? null;
}

/**
 * Merges two or more arrays into one recursively.
 * @param array $a array to be merged to
 * @param array $b array to be merged from. You can specify additional
 * arrays via third argument, fourth argument etc.
 * @return array the merged array (the original arrays are not changed.)
 */
function arrayMerge($a, $b)
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
                $res[$k] = !count($v) ? [] : arrayMerge($res[$k], $v);
            } else {
                $res[$k] = $v;
            }
        }
    }

    return $res;
}

/**
 * Indexes and/or groups the array according to a specified key.
 * The input should be either multidimensional array or an array of objects.
 * @param array $array the array that needs to be indexed or grouped
 * @param string $key the column name
 * @return array the indexed array
 */
function arrayIndex($array, $key, $groups = []): array
{
    $result = [];
    $groups = (array) $groups;

    foreach ($array as $element) {
        $lastArray = &$result;

        foreach ($groups as $group) {
            $value = $element[$group] ?? null;
            if (!array_key_exists($value, $lastArray)) {
                $lastArray[$value] = [];
            }
            $lastArray = &$lastArray[$value];
        }

        if ($key === null) {
            if (!empty($groups)) {
                $lastArray[] = $element;
            }
        } else {
            $value = $element[$key] ?? null;
            if ($value !== null) {
                $lastArray[$value] = $element;
            }
        }
        unset($lastArray);
    }

    return $result;
}

/**
 * Converts seconds to hours minutes and seconds
 * @param int $seconds
 * @param bool $roundSeconds
 * @return string
 */
function secondsToWords($seconds, $roundSeconds = false)
{
    if (intval($seconds) <= 0) {
        return '0s';
    }

    $h = floor($seconds / 3600);
    $m = floor(($seconds - ($h * 3600)) / 60);
    $s = $seconds - ($h * 3600) - ($m * 60);

    if ($roundSeconds === true) {
        $s = round($s);
    }

    if ($seconds >= 3600) {
        return $h . 'h ' . $m . 'm ' . $s . 's';
    } elseif ($seconds >= 60) {
        return $m . 'm ' . $s . 's';
    } else {
        return $s . 's';
    }
}

/**
 * Render JS file
 * @param string $filename
 * @return string
 */
function js(string $filename, bool $htmlTag = false): string
{
    if ($htmlTag === true) {
        return '<script src="./assets/js/'. $filename .'" type="text/javascript"></script>';
    } else {
        return './assets/js/' . $filename;
    }
}

/**
 * Random device id (16 characters)
 * @param bool $localDevice
 * @return string
 */
function randomDeviceId(bool $localDevice = false): string
{
    $clientId = '';
    $chars = '0123456789abcdefABCDEF';
    $maxChars = 16;

    // format 100000003a0a2f6e

    // local devices (client id starts with zeros)
    if ($localDevice === true) {
        $clientId = '00000000';
        $maxChars = 8;
    }

    for ($i = 0; $i < $maxChars; $i++) {
        $index = random_int(0, strlen($chars) - 1);
        $clientId .= $chars[$index];
    }

    return 'device-' . $clientId;
}
