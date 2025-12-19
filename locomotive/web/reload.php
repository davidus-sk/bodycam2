<?php

$dir = realpath(__FILE__ . '/assets');
if ($dir && file_exists($dir)) {
    touch($dir);
    clearstatcache(true);
}

header('Location: index.php');
