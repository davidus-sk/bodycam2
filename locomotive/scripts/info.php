#!/usr/bin/php
<?php

$data = ['wwan0' => [], 'tun0' => []];

$wwan0 = `/usr/sbin/ip a show dev wwan0`;
if (preg_match("/inet ([0-9\.]+)/", $wwan0, $m)) {
	$data['wwan0']['ip'] = $m[1];
}//if

$tun0 = `/usr/sbin/ip a show dev tun0`;
if (preg_match("/inet ([0-9\.]+)/", $tun0, $m)) {
	$data['tun0']['ip'] = $m[1];
}

$modem = `/usr/bin/mmcli -m 0 -J`;

if ($json = json_decode($modem, TRUE)) {
	$data['wwan0']['status'] = $json['modem']['generic']['state'];
	$data['wwan0']['signal'] = $json['modem']['generic']['signal-quality']['value'];
	$data['wwan0']['failed'] = $json['modem']['generic']['state-failed-reason'];
	$data['wwan0']['network'] = $json['modem']['3gpp']['operator-name'];
}

// write out
file_put_contents('/dev/shm/info.json', json_encode($data));
