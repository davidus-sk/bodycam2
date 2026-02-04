<?php

include_once 'bootstrap.php';

// start sessions
session_start();

// assets
define('ASSETS_VERSION', (isset($_GET['dev']) ? date('YmdHis', time()) : date('YmdHi', @filemtime('assets'))));

// views
define('VIEW', !empty($_GET['r']) ? $_GET['r'] : 'video');
define('REQUEST_URI', 'index.php?r=' . VIEW);

// app config
$appConfig = readConfig(true, [
    'app' => ['assetsVersion' => ASSETS_VERSION],
    'mqtt' => ['clientId' => getDeviceId()],
    'map' => ['yardtracker_api_token' => '***'],
]);
?>
<!doctype html>
<html class="no-js" lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Bodycam</title>
<meta name="description" content="">
<meta name="color-scheme" content="light">
<meta name="viewport" content="initial-scale=1.0, minimum-scale=1.0, maximum-scale=1.0, user-scalable=no, width=device-width, height=device-height">
<link href="./assets/css/style.css?v=<?= ASSETS_VERSION; ?>" rel="stylesheet">
<link href="./assets/fonts/remixicon.css?v=<?= ASSETS_VERSION; ?>" rel="stylesheet">
<link rel="icon" href="./assets/img/favicon.ico" sizes="any">
<link rel="apple-touch-icon" href="icon.png">
<link rel="manifest" href="./manifest.json">
<script src="./assets/js/vendor.js?v=<?= ASSETS_VERSION; ?>" type="text/javascript"></script>
<script type="text/javascript">
let app = undefined;
let appConfig = {};
const assetsVersion = '<?= ASSETS_VERSION; ?>';
</script>
<script type="importmap">
{
    "imports": {
        "AppModule": "./assets/js/app.js?v=<?= ASSETS_VERSION; ?>",
        "MapModule": "./assets/js/map.js?v=<?= ASSETS_VERSION; ?>",
        "SettingsModule": "./assets/js/settings.js?v=<?= ASSETS_VERSION; ?>",
        "VideoModule": "./assets/js/video.js?v=<?= ASSETS_VERSION; ?>",
        "DebugModule": "./assets/js/debug.js?v=<?= ASSETS_VERSION; ?>"
    }
}
</script>
<script type="module">
import {App} from "AppModule";

// app config
appConfig = <?= $appConfig; ?>;
app = new App(appConfig);
</script>
</head>
<body>

    <div id="wrapper">

        <?= render('common/sidebar'); ?>

        <div id="content" class="h-screen">

            <?= render(VIEW); ?>

        </div>
    </div>


</body>
</html>
