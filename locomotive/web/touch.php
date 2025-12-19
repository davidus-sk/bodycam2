<?php

$cli = php_sapi_name() == 'cli';
$dir = realpath(dirname(__FILE__) . '/assets');

if (!$dir) {
    if ($cli) {
        echo "\nnew filemtime: assets dir not exists";
    } else {
        echo '<div style="font-family: monospace;">';
        echo "new filemtime: assets dir not exists";
        echo '</div>';
    }

    die();
}

$oldDatetime = filemtime($dir);

touch($dir);
clearstatcache();

$newDatetime = filemtime($dir);

if ($cli) {
    echo "\nold filemtime: " . date('Y-m-d H:i:s', $oldDatetime);
    echo "\nnew filemtime: " . date('Y-m-d H:i:s', $newDatetime);
    echo "\n";

} else {
    echo '<div style="font-family: monospace;">';
    echo "old filemtime: " . date('Y-m-d H:i:s', $oldDatetime) . '<br>';
    echo "new filemtime: " . date('Y-m-d H:i:s', $newDatetime) . '<br>';
    echo "ok";
    echo '</div>';
}
