<div id="video-grid" class="grid-landscape grid-1"></div>

<style>
#content { overflow: hidden; }
</style>
<script src="./assets/js/vendor/tf.min.js"></script>
<script src="./assets/js/vendor/coco-ssd.js"></script>
<!-- <script src="https://cdn.jsdelivr.net/npm/@tensorflow-models/posenet"></script>
<script src="https://cdn.jsdelivr.net/npm/@tensorflow-models/pose-detection"></script>
<script src="https://cdn.jsdelivr.net/npm/@tensorflow-models/body-segmentation"></script>
<script src="https://cdn.jsdelivr.net/npm/@tensorflow-models/body-pix"></script>
<script src="https://cdn.jsdelivr.net/npm/@tensorflow-models/mobilenet"></script> -->
<!-- Optional: Include below scripts if you want to use MediaPipe runtime. -->
<!-- <script src="https://cdn.jsdelivr.net/npm/@mediapipe/selfie_segmentation"></script> -->

<script type="module">
import {Video} from "VideoModule";

$(function() {
    const v = new Video(appConfig, app);
});
</script>
