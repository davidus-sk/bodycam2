<script>
let deb;
</script>

<div class="p-5">
    <div>
        <button id="btn-cam-status" type="button" class="btn btn-sm btn-secondary" onclick="deb.cameraStatus()" disabled>Camera status</button>
        <button id="btn-panic" type="button" class="btn btn-sm btn-secondary ms-2" onclick="deb.panic()" disabled>Panic button</button>
    </div>
</div>
<script type="module">
import {Debug} from "./assets/js/debug.js";

const config = <?= Config::read(true); ?>;

$(function() {

   deb = new Debug(config, app);

});
</script>
