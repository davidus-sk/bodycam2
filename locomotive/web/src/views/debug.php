<?php
$deviceId = $_COOKIE['device_id'] ?? null;
if (!$deviceId) {
    $deviceId = randomDeviceId();
    setcookie('device_id', $deviceId, time() + 3 * 24 * 3600);
}
?>
<div id="debug" class="container">
    
    <div class="mt-3">
        <strong>Device:</strong>
        <select id="sel-cameras" class="form-control">         
            <option value="">My Device</option>   
            <option value="device-100000003a0a2f6e" selected>PI - Marek</option>
            <option value="device-00000000b203ade4">AL</option>            
        </select>

    </div>
    <div class="d-grid gap-3 d-md-block mt-5">
        <button type="button" class="btn btn-lg btn-secondary" data-mqtt="1" data-status="1" disabled>/status</button>
        <button type="button" class="btn btn-lg btn-secondary ms-md-2" data-mqtt="1" data-status="auto" disabled>/status (AUTO)</button>
    </div>

    <hr class="my-4" />

    <div class="d-grid gap-3 d-md-block">
        <button id="btn-start-stream" type="button" class="btn btn-lg btn-secondary" data-mqtt="1" disabled>Stream - Start</button>
        <button id="btn-stop-stream" type="button" class="btn btn-lg btn-danger" style="display: none;" data-mqtt="1" disabled>Stream - Stop</button>

        <button id="btn-resume-stream" type="button" class="btn btn-lg btn-secondary ms-md-2" data-mqtt="1" style="display: none;" disabled>Stream - Resume</button>
        <button id="btn-pause-stream" type="button" class="btn btn-lg btn-secondary ms-md-2" style="display: none;" data-mqtt="1" style="display: none;" disabled>Stream - Pause</button>
    </div>

    <video id="local-video" class="mt-3" style="display: none; width:100%; height: 250px; max-width: 340px;" playsinline autoplay muted></video>

    <hr class="my-4" />

    <!-- BUTTONS -->
    <div class="d-grid gap-3 d-md-block">
        <button type="button" class="btn btn-lg btn-secondary" data-mqtt="1" 
        data-button-status="emergency" disabled>/button/ESTOP</button>
        <button type="button" class="btn btn-lg btn-secondary ms-md-2" data-mqtt="1" 
        data-button-status="fall" disabled>/button/fall</button>
    </div>

    <hr class="my-4" />

    <div class="d-grid gap-3 d-md-block">
        <button type="button" class="btn btn-lg btn-secondary" data-mqtt="1" data-gps="1" disabled>GPS</button>
        <button type="button" class="btn btn-lg btn-secondary ms-md-2" data-mqtt="1" data-gps="auto" disabled>GPS (AUTO)</button>

        <button id="btn-add-loco" type="button" class="btn btn-lg btn-secondary mt-3 mt-md-0 ms-md-2" data-mqtt="1" disabled>GPS LOCOMOTIVE</button>

    </div>

    <hr class="my-4" />

    <div class="d-grid gap-3 d-md-block">
        <button id="btn-cam-restart" type="button" class="btn btn-lg btn-secondary" data-mqtt="1"   disabled>Camera restart</button>
    </div>


</div>
<script type="module">
import {Debug} from "./assets/js/debug.js?v=<?= ASSETS_VERSION ?>";

const config = <?= Config::read(true, [
    'deviceId' => $deviceId,
]); ?>;
$(function() { 
    const deb = new Debug(config, app);
});
</script>

