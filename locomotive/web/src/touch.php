<?php

$dir = realpath(__DIR__ . '/assets');

$oldDatetime = filemtime($dir);

touch($dir);
clearstatcache();

$newDatetime = filemtime($dir);

echo '<div style="font-family: monospace;">';
echo 'old filemtime: ' . date('Y-m-d H:i:s', $oldDatetime) . '<br>';
echo 'new filemtime: ' . date('Y-m-d H:i:s', $newDatetime) . '<br>';
echo 'ok';
echo '</div>';
