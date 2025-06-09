<?php

include_once 'bootstrap.php';
include_once 'class/Config.php';

// assets
$assetsTime = filemtime('assets');
define('ASSETS_VERSION', ($assetsTime ? date('YmdHis', $assetsTime) : date('YmdH')));

// views
define('VIEW', !empty($_GET['r']) ? $_GET['r'] : 'video');

// mqtt
$MQTT_CLIENT_ID = (VIEW === 'debug' && $_SERVER['HTTP_HOST'] === 'localhost')
    ? 'mqttjs_debug' : MQTT_CLIENT_ID;

// content
$content = render(VIEW, ['cssLastModified' => ASSETS_VERSION]);
?>
<!doctype html>
<html class="no-js" lang="">

<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Bodycam</title>
<meta name="description" content="">
<meta name="color-scheme" content="light">
<meta name="viewport" content="initial-scale=1.0, minimum-scale=1.0, maximum-scale=1.0, user-scalable=no, width=device-width, height=device-height">
<link href="./assets/css/style.css?v=<?= ASSETS_VERSION; ?>" rel="stylesheet">
<link href="https://cdn.jsdelivr.net/npm/remixicon@4.5.0/fonts/remixicon.min.css" rel="stylesheet">
<link rel="icon" href="./assets/img/favicon.ico" sizes="any">
<link rel="apple-touch-icon" href="icon.png">
<link rel="manifest" href="./manifest.json">
<script src="./assets/js/vendor.js?v=<?= ASSETS_VERSION; ?>" type="text/javascript"></script>
<script type="text/javascript">
let app = undefined;
let appConfig = {};
</script>
<script type="module">
import {App} from "./assets/js/app.js";

// app config
appConfig = <?= readConfig(true, [
    'mqtt' => ['clientId' => $MQTT_CLIENT_ID],
]);
?>;

app = new App(appConfig);
</script>
</head>
<body>

    <div id="wrapper">
        <div id="sidebar-toggle"><span></span></div>
        <aside id="sidebar" aria-label="Sidebar">            
            <div class="h-full overflow-y-auto">                            
                <ul class="sidebar-menu">
                    <li>
                        <a href="<?= url('/'); ?>" class="sidebar-menu-item<?=(VIEW === 'video' ? ' active' : ''); ?>">
                            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor"><path d="M22 12.999V20C22 20.5523 21.5523 21 21 21H13V12.999H22ZM11 12.999V21H3C2.44772 21 2 20.5523 2 20V12.999H11ZM11 3V10.999H2V4C2 3.44772 2.44772 3 3 3H11ZM21 3C21.5523 3 22 3.44772 22 4V10.999H13V3H21Z"></path></svg>
                            <span class="label">Video</span>
                        </a>
                    </li>
                    <li>
                        <a href="<?= url('map'); ?>" class="sidebar-menu-item<?=(VIEW === 'map' ? ' active' : ''); ?>">
                            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor"><path d="M16.9497 11.9497C18.7347 10.1648 19.3542 7.65558 18.8081 5.36796L21.303 4.2987C21.5569 4.18992 21.8508 4.30749 21.9596 4.56131C21.9862 4.62355 22 4.69056 22 4.75827V19L15 22L9 19L2.69696 21.7013C2.44314 21.8101 2.14921 21.6925 2.04043 21.4387C2.01375 21.3765 2 21.3094 2 21.2417V7L5.12892 5.65904C4.70023 7.86632 5.34067 10.2402 7.05025 11.9497L12 16.8995L16.9497 11.9497ZM15.5355 10.5355L12 14.0711L8.46447 10.5355C6.51184 8.58291 6.51184 5.41709 8.46447 3.46447C10.4171 1.51184 13.5829 1.51184 15.5355 3.46447C17.4882 5.41709 17.4882 8.58291 15.5355 10.5355Z"></path></svg>
                            <span class="label">Map</span>
                        </a>
                    </li>
                    <li>
                        <a href="<?= url('settings'); ?>" class="sidebar-menu-item<?=(VIEW === 'settings' ? ' active' : ''); ?>">
                            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor"><path d="M3.33946 17.0002C2.90721 16.2515 2.58277 15.4702 2.36133 14.6741C3.3338 14.1779 3.99972 13.1668 3.99972 12.0002C3.99972 10.8345 3.3348 9.824 2.36353 9.32741C2.81025 7.71651 3.65857 6.21627 4.86474 4.99001C5.7807 5.58416 6.98935 5.65534 7.99972 5.072C9.01009 4.48866 9.55277 3.40635 9.4962 2.31604C11.1613 1.8846 12.8847 1.90004 14.5031 2.31862C14.4475 3.40806 14.9901 4.48912 15.9997 5.072C17.0101 5.65532 18.2187 5.58416 19.1346 4.99007C19.7133 5.57986 20.2277 6.25151 20.66 7.00021C21.0922 7.7489 21.4167 8.53025 21.6381 9.32628C20.6656 9.82247 19.9997 10.8336 19.9997 12.0002C19.9997 13.166 20.6646 14.1764 21.6359 14.673C21.1892 16.2839 20.3409 17.7841 19.1347 19.0104C18.2187 18.4163 17.0101 18.3451 15.9997 18.9284C14.9893 19.5117 14.4467 20.5941 14.5032 21.6844C12.8382 22.1158 11.1148 22.1004 9.49633 21.6818C9.55191 20.5923 9.00929 19.5113 7.99972 18.9284C6.98938 18.3451 5.78079 18.4162 4.86484 19.0103C4.28617 18.4205 3.77172 17.7489 3.33946 17.0002ZM8.99972 17.1964C10.0911 17.8265 10.8749 18.8227 11.2503 19.9659C11.7486 20.0133 12.2502 20.014 12.7486 19.9675C13.1238 18.8237 13.9078 17.8268 14.9997 17.1964C16.0916 16.5659 17.347 16.3855 18.5252 16.6324C18.8146 16.224 19.0648 15.7892 19.2729 15.334C18.4706 14.4373 17.9997 13.2604 17.9997 12.0002C17.9997 10.74 18.4706 9.5632 19.2729 8.6665C19.1688 8.4405 19.0538 8.21822 18.9279 8.00021C18.802 7.78219 18.667 7.57148 18.5233 7.36842C17.3457 7.61476 16.0911 7.43414 14.9997 6.80405C13.9083 6.17395 13.1246 5.17768 12.7491 4.03455C12.2509 3.98714 11.7492 3.98646 11.2509 4.03292C10.8756 5.17671 10.0916 6.17364 8.99972 6.80405C7.9078 7.43447 6.65245 7.61494 5.47428 7.36803C5.18485 7.77641 4.93463 8.21117 4.72656 8.66637C5.52881 9.56311 5.99972 10.74 5.99972 12.0002C5.99972 13.2604 5.52883 14.4372 4.72656 15.3339C4.83067 15.5599 4.94564 15.7822 5.07152 16.0002C5.19739 16.2182 5.3324 16.4289 5.47612 16.632C6.65377 16.3857 7.90838 16.5663 8.99972 17.1964ZM11.9997 15.0002C10.3429 15.0002 8.99972 13.6571 8.99972 12.0002C8.99972 10.3434 10.3429 9.00021 11.9997 9.00021C13.6566 9.00021 14.9997 10.3434 14.9997 12.0002C14.9997 13.6571 13.6566 15.0002 11.9997 15.0002ZM11.9997 13.0002C12.552 13.0002 12.9997 12.5525 12.9997 12.0002C12.9997 11.4479 12.552 11.0002 11.9997 11.0002C11.4474 11.0002 10.9997 11.4479 10.9997 12.0002C10.9997 12.5525 11.4474 13.0002 11.9997 13.0002Z"></path></svg>
                            <span class="label">Settings</span>
                        </a>
                    </li>
                </ul>

                <span class="separator"></span>

                <div id="mqtt-status" class="mt-4">OFFLINE</div>
                <div id="mqtt-status-count" class="mt-2">0</div>

            </div>
        </aside>
        <div id="content" class="h-screen">
            
            <?php echo $content; ?>

        </div>
    </div>
    

</body>
</html>
