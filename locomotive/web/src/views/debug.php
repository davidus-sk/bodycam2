<script>
let deb;
</script>

<div class="p-5">
    <div class="mb-5">
        <strong>Live cameras:</strong>
        <select id="sel-cameras" class="form-control">            
            <option value="camera-0000000000000001">Marek</option>
            <option value="camera-00000000b203ade4">AL</option>
        </select>

    </div>
    <div class="mb-5">
        <button id="btn-cam-status" type="button" class="btn btn-lg btn-secondary" onclick="deb.cameraStatus()" disabled>Camera status</button>

        <button id="btn-panic" type="button" class="btn btn-lg btn-secondary ms-3" onclick="deb.panic()" disabled>Panic button</button>
    </div>
    <div class="mb-3">
        <button id="btn-start-stream" type="button" class="btn btn-lg btn-secondary" disabled>Start Stream</button>
        
        <button id="btn-stop-stream" type="button" class="btn btn-lg btn-secondary ms-3" disabled>Stop Stream</button>
    </div>
</div>

<video id="local-video" style="display: none;" playsinline autoplay muted></video>

<script type="module">
import {Debug} from "./assets/js/debug.js?t=<?=time();?>";

const config = <?= Config::read(true); ?>;

$(function() { 

    deb = new Debug(config, app);

});
</script>
