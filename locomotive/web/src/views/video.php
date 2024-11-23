
<div id="video-grid" 
    class="h-full overflow-hidden flex-row justify-content-center align-items-center grid-1x1">
</div>

<script type="module">
import {Video} from "<?= js('video.js'); ?>";

const config = <?= Config::read(true); ?>;
const v = new Video(config);

</script>
