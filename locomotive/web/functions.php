<?php

use App\Base\View;
use App\Base\Config;

$_db = null;
function db()
{
    global $_db;
    if ($_db === null) {
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
 * @param bool $changeBaseView
 * @return string
 */
function url(string $to, array $params = [], bool $changeBaseView = false): string
{
    if ($changeBaseView === true && $to) {
        $url = str_replace('.php', '', $to) . '.php';
    } else {
        if (!$to || $to == '/') {
            $url = 'index.php';
        } else {
            $url = 'index.php' . '?r=' . trim($to, ' /');
        }
    }

    if ($params) {
        $sep = strpos($url, '?') !== false ? '&' : '?';
        $url .=  $sep . http_build_query($params);
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
 * @param bool|string|null $layout
 * @return string rendered view content.
 * @throws RuntimeException if the view file does not exist or is not a file.
 * @throws Throwable If an error occurred during rendering.
 */
function render(
    string $view,
    array $params = [],
    bool|string|null $layout = null,
    array $layoutParams = [],
): string {
    return View::render($view, $params, $layout, $layoutParams);
}

/**
 * Set layout
 * @param string|boolean $layout
 * @return void
 */
function layout(string|bool $layout): void
{
    View::layout($layout);
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

function _t(string $message, array $params = []): string
{
    // Replace placeholders in the translation with the provided values.
    if ($params) {
        foreach ($params as $placeholder => $value) {
            $message = str_replace(":$placeholder", $value, $message);
        }
    }

    return $message;
}

function isAdmin(): bool
{
    return isset($_SESSION['auth_role']) && $_SESSION['auth_role'] === 'admin';
}

/**
 * Returns boolean representation of integer value
 * @param int $value
 * @return bool
 */
function booleanValue($value)
{
    return $value === 1 || (bool) $value === true || $value === '1';
}

/**
 * Returns array with Yes/No values
 * @return array
 */
function yesNoArray()
{
    return [1 => _t('Yes'), 0 => _t('No')];
}


/**
 * Returns value Yes/No
 * @return string
 */
function yesNoValue($value)
{
    return ((int) $value === 1) ? _t('Yes') : _t('No');
}

/**
 * Returns array with Enabled/Disabled values
 * @return array
 */
function enabledDisabledArray()
{
    return [0 => _t('Disabled'), 1 => _t('Enabled')];
}


/**
 * Returns value Enabled/Disabled
 * @return string
 */
function enabledDisabledNoValue($value)
{
    return ((int) $value === 1) ? _t('Enabled') : _t('Disabled');
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


function get_post(mixed $key = null): array
{
    if ($key !== null) {
        return $_POST[$key] ?? [];
    } else {
        return $_POST;
    }
}

function isPost(): bool
{
    return isset($_SERVER['REQUEST_METHOD']) && $_SERVER['REQUEST_METHOD'] === 'POST';
}

function showMessages(): ?string
{
    $output = null;

    if (!empty($_SESSION['_messages_'])) {
        $output = '';
        $output .= '<div class="messages ' . $_SESSION['_messages_']['t'] . '">';

        foreach ($_SESSION['_messages_']['m'] as $m) {
            $output .= '<div class="message">' . $m . ' <i class="message-close fa-solid fa-xmark"></i></div>';
        }

        $output .= '</div>';
        unset($_SESSION['_messages_']);
    }

    return $output;
}

function set_messages(string $type, string|array $messages): void
{
    if (!is_array($messages)) {
        $messages = [$messages];
    }

    if ($messages) {
        $data = ['t' => $type, 'm' => []];

        foreach ($messages as $e) {
            $data['m'][] = $e;
        }

        $_SESSION['_messages_'] = $data;
    }
}

function success_messages(string|array $messages): void
{
    set_messages('success', $messages);
}

function warning_message(string|array $messages): void
{
    set_messages('warning', $messages);
}

function error_message(string|array $messages): void
{
    set_messages('error', $messages);
}

function readConfig(bool $returnJson = false, array $overrideOptions = [])
{
    return Config::all($returnJson, $overrideOptions);
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
 * Get device id
 * @return string
 */
function getDeviceId(): string
{
    $clientId = $_COOKIE['device_id'] ?? null;
    if (!$clientId) {
        $clientId = randomDeviceId();
        setcookie('device_id', $clientId, time() + (30 * 24 * 3600));
    }

    return $clientId;
}

/**
 * Random device id (16 characters)
 * format: 100000003a0a2f6e
 * @return string
 */
function randomDeviceId(): string
{
    $clientId = '';
    $chars = '0123456789abcdef';
    $maxChars = 16;

    for ($i = 0; $i < $maxChars; $i++) {
        $index = random_int(0, strlen($chars) - 1);
        $clientId .= $chars[$index];
    }

    return $clientId;
}
