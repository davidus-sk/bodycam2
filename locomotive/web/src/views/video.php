<div id="video-grid" class="grid-1x1"></div>
<script type="module">
import {Video} from "./assets/js/video.js?v=<?= ASSETS_VERSION ?>";

$(function() {
    const v = new Video(appConfig, app);
});
</script>
