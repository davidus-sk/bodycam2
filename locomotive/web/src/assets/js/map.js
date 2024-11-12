import { worker } from "./functions.js";
import { EventDispatcher } from "./EventDispatcher.js";

export class MapView {
    constructor() {
        // constants
        this.DEFAULT_GPS_POSITION = [41.396879107772705, -91.07739278163716];
        this.DEFAULT_ZOOM = 5;

        this.$element = $("#map");
        this.running = false;

        this.markers = {};
        this.markersLayer = {};
        this.mapFitBounds = true;

        this.$btnReset = $("#btn-reset");

        // events dispatcher
        EventDispatcher.attach(this);

        // map
        this.initMap();

        // events
        this.attachEvents();

        // timers
        this.initTimers();

        // update markers
        this.on("map_objects_refresh", (data) => {
            console.log(this._listeners);
            console.log("e: map_objects_refresh", data);
        });
    }

    initMap() {
        // leaflet map reference
        this.map = L.map("map", {
            zoomControl: false,
        });

        // markers - feature group
        this.markersLayer = new L.FeatureGroup().addTo(this.map);

        var layers = {
            streets: L.tileLayer(
                "https://tile.openstreetmap.org/{z}/{x}/{y}.png",
                {
                    maxZoom: 20,
                    attribution:
                        '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
                }
            ),
            streets2: L.tileLayer(
                "http://{s}.google.com/vt/lyrs=m&x={x}&y={y}&z={z}",
                {
                    maxZoom: 20,
                    subdomains: ["mt0", "mt1", "mt2", "mt3"],
                }
            ),
            satelite: L.tileLayer(
                "http://{s}.google.com/vt/lyrs=s&x={x}&y={y}&z={z}",
                {
                    maxZoom: 20,
                    subdomains: ["mt0", "mt1", "mt2", "mt3"],
                }
            ),
        };

        layers["streets"].addTo(this.map);

        this.map.setView(this.DEFAULT_GPS_POSITION, this.DEFAULT_ZOOM);
    }

    initTimers() {
        this.refreshMapObjects();
        return;

        worker("worker_test", 5000, () => {
            this.refreshMapObjects();
        });
    }

    attachEvents() {
        // map events
        if (this.map) {
            this.map.on("dragstart", (e) => {
                console.log("e: map - dragstart", e);

                this.mapFitBounds = false;
                this.filterBadge(this.$btnReset, true);
            });
        }

        this.$btnReset.on("click", (e) => {
            e.preventDefault();
            if (this.map) {
                this.map.fitBounds(this.markersLayer.getBounds(), {
                    paddingTopLeft: [0, 0],
                });

                this.filterBadge(this.$btnReset, false);
            }
        });
    }

    filterBadge($element, status) {
        if (status === true) {
            $element.find(".filter-active").removeClass("d-none");
            //$element.removeClass("btn-dark").addClass("btn-danger");
        } else {
            $element.find(".filter-active").addClass("d-none");
            //$element.removeClass("btn-danger").addClass("btn-dark");
        }
    }

    // refresh map objects
    refreshMapObjects() {
        var self = this;
        var fitBounds = true;
        return $.get("ajax/map_objects.php").done((data) => {
            if (data && typeof data === "object") {
                for (var group in data) {
                    var objects = data[group];
                    objects.forEach((obj) => {
                        let objId = obj.id;

                        console.log(obj);
                        // new marker
                        if (
                            self.markers[objId] !== undefined &&
                            self.markers[objId] !== null
                        ) {
                            self.markers[objId].setLatLng([obj.lat, obj.lng]);

                            // update position
                        } else {
                            // map
                            var marker = new L.Marker([obj.lat, obj.lng], {
                                obj: obj,
                            }).on("click", function () {
                                self.emit("map_marker_click");
                            });

                            marker.addTo(self.markersLayer);
                            self.markers[objId] = marker;
                        }
                    });
                } //for

                if (self.mapFitBounds === true) {
                    self.map.fitBounds(self.markersLayer.getBounds(), {
                        paddingTopLeft: [0, 0],
                    });
                }
            }

            this.emit("map_objects_refresh", data);
        });
    }
}

export default { MapView };
