<?php 
include_once '../bootstrap.php';

$cams = [[
    'name' => 'Front camera',
    'source' => 'https://muazkhan.com:9001/demos/Video-Broadcasting.html?roomid=4ajat0h2tbx',
], [
    'name' => 'Left camera',
    'source' => 'https://webrtc.github.io/test-pages/src/peer2peer-video/output.mp4',
], [
    'name' => 'Left camera',
    'source' => 'https://sample-videos.com/video321/mp4/720/big_buck_bunny_720p_30mb.mp4',
], [
    'name' => 'Left camera',
    'source' => 'https://sample-videos.com/video321/mp4/720/big_buck_bunny_720p_30mb.mp4',
]];

echo jsonResponse($cams);
