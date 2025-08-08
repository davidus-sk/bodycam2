<?php

function run_once($lock_file, &$fh)
{
    $fh = fopen($lock_file, 'c');
    $got_lock = flock($fh, LOCK_EX | LOCK_NB, $would_block);

    if ($fh === false || (!$got_lock && !$would_block)) {
        throw new Exception("Can't obtain lock.");
    } elseif (!$got_lock && $would_block) {
        echo date('r') . "> Already running. Exiting...\n";
        exit();
    }//if

    ftruncate($fh, 0);
    fwrite($fh, getmypid() . "\n");
}

function read_config()
{
    // load up config file
    $conf_file = '/app/bodycam2/camera/conf/config.json';

    // check if config exists
    if (!file_exists($conf_file)) {
        echo date('r') . "> Config file does not exist.\n";
        exit;
    }//if

    // read contents
    $json = file_get_contents($conf_file);
    $data = json_decode($json, true);

    if (empty($data)) {
        echo date('r') . "> Config file is empty.\n";
        exit;
    }//if

    return $data;
}//func
