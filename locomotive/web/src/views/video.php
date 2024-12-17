
<div id="video-grid" class="grid-1x1"></div>

<script type="module">
import {Video} from "./assets/js/video.js?v=<?= ASSETS_VERSION ?>";

const config = <?= Config::read(true); ?>;

$(function() {

    const v = new Video(config, app);

});
</script>
