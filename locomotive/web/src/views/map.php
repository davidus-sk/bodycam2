
<div class="w-full h-screen overflow-hidden relative">
    <div id="map" class="w-full h-full z-5"></div>

    <button id="btn-reset" class="absolute z-10 btn btn-sm btn-dark" style="top: 15px; left: 15px;">
        Reset
        <span class="filter-active d-none position-absolute top-0 start-100 translate-middle p-2 bg-danger border border-light rounded-circle">
            <span class="visually-hidden">New alerts</span>
        </span>
    </button>
</div>

<!-- TEMPLATES -->
<script id="entry-template" type="text/x-handlebars-template">
    <div class="map-video-wrapper">
        <div class="video-header">
            <button type="button" class="close" data-modal-close="1"></button>
        </div>
        <div class="video-wrapper">
            <video id="map-video" autoplay playsinline muted></video>
        </div>
    </div>
</script>


<link href="./assets/vendor/jquery-ui-1.14.1.custom/jquery-ui.min.css" rel="stylesheet">
<link href="./assets/vendor/leaflet/plugins/L.Icon.Pulse.css" rel="stylesheet">
<link href="./assets/vendor/leaflet/leaflet.css" rel="stylesheet">

<script src="https://cdn.jsdelivr.net/npm/interactjs/dist/interact.min.js"></script>
<script src="./assets/vendor/handlebars.min-v4.7.8.js"></script>
<script src="./assets/vendor/leaflet/leaflet.js"></script>
<script src="./assets/vendor/leaflet/plugins/L.Icon.Pulse.js"></script>
<script src="./assets/vendor/jquery-ui-1.14.1.custom/jquery-ui.min.js"></script>

<script type="module">
import {MapView} from "<?= js('map.js'); ?>";

const config = <?= Config::read(true); ?>;

$(function() {
    const mapView = new MapView(config, app);
    
});
</script>
