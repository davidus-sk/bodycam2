<div class="w-full h-screen overflow-hidden relative">
    <div id="map" class="w-full h-full z-5"></div>

    <button id="btn-reset" class="absolute z-10 btn btn-sm btn-dark" style="top: 15px; left: 15px;">
        Reset
        <span class="filter-active d-none position-absolute top-0 start-100 translate-middle p-2 bg-danger border border-light rounded-circle">
            <span class="visually-hidden">New alerts</span>
        </span>
    </button>
</div>

<link href="./assets/vendor/leaflet/leaflet.css" rel="stylesheet">
<script src="./assets/vendor/leaflet/leaflet.js"></script>
<script type="module">
import {MapView} from "<?= js('map.js'); ?>";

$(function() {
    const mapView = new MapView();
    
});
</script>
