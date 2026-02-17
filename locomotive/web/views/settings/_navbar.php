<?php

use App\Base\View;

// selected tab
$tab = $_GET['tab'] ?? 'index';

// menu items
$items = [
    [
        'label' => 'System',
        'url' => url('settings'),
        'tab' => 'index',
    ],
    [
        'label' => 'MQTT',
        'url' => url('settings', ['tab' => 'mqtt']),
        'tab' => 'mqtt',
        'visible' => isAdmin(),
    ],
    [
        'label' => 'Camera',
        'url' => url('settings', ['tab' => 'camera']),
        'tab' => 'camera',
        'visible' => isAdmin(),
    ],
];
?>
<div id="forms" class="container mb-5">
    <nav id="nav-top" class="nav nav-pills">
    <?php
    foreach ($items as $item):

        $visible = !isset($item['visible']) || $item['visible'] !== false;
        $isActive = $tab === $item['tab'];
        $cssClass = $isActive ? ' active' : '';

        if (!$visible) {
            continue;
        }

        echo '<a class="nav-link'. $cssClass .'" aria-current="page" href="'. $item['url'] .'">'. $item['label'] .'</a>';
    endforeach;
?>
    </nav>
</div>
