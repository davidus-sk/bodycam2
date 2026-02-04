<?php
$networkInfo = file_exists('/dev/shm/info.json') ? file_get_contents('/dev/shm/info.json') : '{"wwan0":{"ip":"10.117.105.55","status":"connected","signal":"84","failed":"--","network":"AT&T"},"tun0":{"ip":"10.220.0.34"}}';
$networkInfo = $networkInfo ? json_decode($networkInfo, true) : [];
?>

<div class="container">

    <div class="row mb-4">
        <div class="col-sm-6">
            <button 
                id="btn-air" 
                type="button" 
                class="btn btn-lg btn-cool btn-h-100 w-100 mt-3 mt-md-0" 
                data-bs-toggle="modal" 
                data-bs-target="#blow-air" 
                disabled 
            >
                BLOW AIR
            </button>
        </div>
        
        <div class="col-sm-6">
            <button
                id="btn-reload-ui" 
                type="button"
                class="btn btn-lg btn-cool btn-h-100 w-100 mt-3 mt-md-0" 
                data-bs-toggle="modal" 
                data-bs-target="#reload-ui" 
            >
                RELOAD UI
            </button>
        </div>
    </div>

    <div class="row">    
        <div class="col-sm-6">
            <button
                id="btn-restart-camera"
                type="button"
                class="btn btn-lg btn-cool btn-h-100 w-100 mt-3 mt-md-0"
                data2-bs-toggle="modal"
                data2-bs-target="#restart" 
                disabled 
            >
                RESTART CAMERA
            </button>
        </div>
        
        <div class="col-sm-6">
            <button
                id="btn-restart"
                type="button"
                class="btn btn-lg btn-cool btn-h-100 w-100 mt-3 mt-md-0"
                data-bs-toggle="modal"
                data-bs-target="#restart" 
                disabled 
            >
                RESTART SYSTEM
            </button>
        </div>
    </div>

    <?php if ($networkInfo) { ?>

    <div class="mt-5 d-flex">
        <div class="card card-dark" style="width: 420px;">
            <div class="card-body">
                <div class="mb-3">WWAN0:</div>

                <?php if (isset($networkInfo['wwan0'])) { ?>                
                <pre class="mb-0"><?= json_encode($networkInfo['wwan0'], JSON_PRETTY_PRINT); ?></pre>
                <?php } ?>
            </div>
        </div>
        <div class="card card-dark ms-3" style="width: 420px;">
            <div class="card-body">         
                <div class="mb-3">TUN0:</div>

                <?php if (isset($networkInfo['tun0'])) { ?>                
                <pre class="mb-0"><?= json_encode($networkInfo['tun0'], JSON_PRETTY_PRINT); ?></pre>
                <?php } ?>
            </div>
        </div>
    </div>

    <?php } ?>
</div>

<!-- Modal - reload ui -->
<div
    id="reload-ui"
    class="modal fade absolute"
    data-bs-theme="dark"
    data-bs-backdrop="static" 
    data-bs-keyboard="false" 
    tabindex="-1"
    aria-hidden="true"
>
    <div class="modal-dialog modal-dialog-centered">
        <div class="modal-content">
            <div class="modal-header">
                <h1 class="modal-title fs-5">Reloading UI</h1>
            </div>
            <div class="modal-body">
                <div id="blow-air-content">
                    Please wait...
                </div>                
            </div>
        </div>
    </div>
</div>

<!-- Modal - blow air -->
<div
    id="blow-air"
    class="modal fade absolute"
    data-bs-theme="dark"
    data-bs-backdrop="static" 
    data-bs-keyboard="false" 
    tabindex="-1"
    aria-hidden="true"
>
    <div class="modal-dialog modal-dialog-centered">
        <div class="modal-content">
            <div class="modal-header">
                <h1 class="modal-title fs-5">Blow air?</h1>
            </div>
            <div class="modal-body">
                <div id="blow-air-content">
                    Are you sure you want to .... It takes about 60 seconds.
                </div>
                <div id="blow-air-progress" style="display: none;">
                    <div class="mb-2">
                        Please wait ...
                        <span id="blow-air-time">60</span>
                        s
                    </div>
                    <div class="progress" role="progressbar">
                        <div class="progress-bar bg-success" style="width: 100%;"></div>
                    </div>
                </div>
            </div>
            <div class="modal-footer justify-content-between">
                <button id="btn-blow-air-cancel" type="button" class="btn btn-lg btn-secondary" style="width: 170px" data-bs-dismiss="modal">
                    Cancel
                </button>
                <button
                    id="btn-blow-air-confirm"
                    type="button"
                    class="btn btn-lg btn-warning"
                    style="width: 170px"
                    data-confirmed="0"
                >
                    Blow air
                </button>
            </div>
        </div>
    </div>
</div>

<!-- Modal - restart -->
<div
    id="restart"
    class="modal fade absolute"
    data-bs-theme="dark"
    data-bs-backdrop="static" 
    data-bs-keyboard="false" 
    tabindex="-1"
    aria-hidden="true"
>
    <div class="modal-dialog modal-dialog-centered">
        <div class="modal-content">
            <div class="modal-header">
                <h1 class="modal-title fs-5">Restart system?</h1>
            </div>
            <div class="modal-body">
                <div id="restart-content">
                    Are you sure you want to restart the system? It takes about 60 seconds.
                </div>
                <div id="restart-progress" style="display: none;">
                    <div class="mb-2">
                        Please wait ...
                        <span id="restart-time">60</span>
                        s
                    </div>
                    <div class="progress" role="progressbar">
                        <div class="progress-bar bg-success" style="width: 100%;"></div>
                    </div>
                </div>
            </div>
            <div class="modal-footer justify-content-between">
                <button id="btn-restart-cancel" type="button" class="btn btn-lg btn-secondary" style="width: 170px" data-bs-dismiss="modal">
                    Cancel
                </button>
                <button
                    id="btn-restart-confirm"
                    type="button"
                    class="btn btn-lg btn-warning"
                    style="width: 170px"
                    data-confirmed="0"
                >
                    Confirm restart
                </button>
            </div>
        </div>
    </div>
</div>


<script type="module">
import {Settings} from "SettingsModule";

const config = <?= readConfig(true); ?>;

$(function() {

    const settings = new Settings(config, app);

});
</script>
