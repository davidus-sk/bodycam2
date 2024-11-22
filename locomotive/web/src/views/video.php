
<div id="video-grid" 
    class="d-flex2 h-full overflow-hidden flex2-wrap flex-row justify-content-center align-items-center">
</div>

<script type="module">
import {Video} from "<?= js('video.js'); ?>";

const config = <?= Config::read(true); ?>;
const v = new Video(config);


$(function() {
    v.on("videos_added", () => {
        console.log('----------------------');
        console.log('e: videos_added');

    });
});
</script>
