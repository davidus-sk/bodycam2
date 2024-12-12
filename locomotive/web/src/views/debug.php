<script>
let deb;
</script>

<div id="debug">
    <div class="p-5">
        <div class="mb-5">
            <strong>Live cameras:</strong>
            <select id="sel-cameras" class="form-control">            
                <option value="device-100000003a0a2f6e">Marek PI</option>
                <option value="device-0000000000000001" selected>Marek PC</option>                
                <option value="device-00000000b203ade4">AL</option>
                <option value="device-0000000000000002">Fake</option>
            </select>

        </div>
        <div class="mb-3">
            <button id="btn-cam-status" type="button" class="btn btn-lg btn-secondary mt-3" data-btn-mqtt="1" disabled>Camera status</button>

            <button id="btn-panic" type="button" class="btn btn-lg btn-secondary mt-3 ms-3" data-btn-mqtt="1" disabled>Panic button</button>

            <button id="btn-cam-restart" type="button" class="btn btn-lg btn-secondary mt-3 ms-3" data-btn-mqtt="1" disabled>Camera restart</button>
        </div>
        <div class="mb-3">
            <button id="btn-start-stream" type="button" class="btn btn-lg btn-secondary mt-3" data-btn-mqtt="1" disabled>Start Stream</button>
            
            <button id="btn-stop-stream" type="button" class="btn btn-lg btn-secondary mt-3 ms-3" data-btn-mqtt="1" disabled>Stop Stream</button>
        </div>
        <div class="mb-0">
            <button id="btn-add-loco" type="button" class="btn btn-lg btn-secondary mt-3" data-btn-mqtt="1" disabled>Add Loco</button>
            <button id="btn-gps-fake" type="button" class="btn btn-lg btn-secondary mt-3 ms-3" data-btn-mqtt="1" disabled>Fake GPS</button>
            <button id="btn-gps-fake-panic" type="button" class="btn btn-lg btn-secondary mt-3 ms-3" data-btn-mqtt="1" disabled>Fake GPS Panic</button>
            <button id="btn-gps-auto" type="button" class="btn btn-lg btn-secondary mt-3 ms-3" data-btn-mqtt="1" disabled>Fake GPS Start</button>
        </div>

        <video id="local-video" class="mt-3" style="display: none;width:250px;height: 250px;" playsinline autoplay muted></video>
    </div>


</div>

<script type="module">
import {Debug} from "./assets/js/debug.js?t=<?=time();?>";

const config = <?= Config::read(true); ?>;

$(function() { 

    deb = new Debug(config, app);

});
</script>
