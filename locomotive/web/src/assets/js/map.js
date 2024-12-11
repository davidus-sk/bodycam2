import { worker, isObjectEmpty, getTimestamp } from './functions.js';
import { EventDispatcher } from './EventDispatcher.js';
import { MqttClient } from './mqtt/client.js';
import { PiCamera } from './rtc/picamera.js';
import { Modal } from './modal.js';

// https://codepen.io/peeke/pen/BjxXZa
// https://codepen.io/danest/pen/nYdOoE
// https://www.kirupa.com/animations/creating_pulsing_circle_animation.htm
// https://codepen.io/Raphael/pen/DmvmdX

export class MapView {
    config = {};
    mqttClient = null;

    DEFAULT_GPS_POSITION = [30.672026, -92.260802];
    DEFAULT_ZOOM = 16;
    MARKER_TIMEOUT = 1120;

    constructor(options, app) {
        this.app = app;

        // merge options
        this.options = Object.assign({}, options);

        console.log('!: options', this.options);

        // local variables
        this.templates = {};
        this.running = false;
        this.modalVideo = undefined;
        this.camera = undefined;
        this.modal = undefined;
        this.activeIcon = undefined;

        // dom  elements
        this.$element = $('#map');
        this.$btnReset = $('#btn-reset');

        // events dispatcher
        EventDispatcher.attach(this);

        // debug
        if (this.debugMode === true && typeof console != 'undefined') {
            this.debug = console.log.bind(console);
        } else {
            this.debug = function (message) {};
        }

        // templates
        this.templates['camera'] = Handlebars.compile($('#entry-template').html());

        // map
        this.initMap().then(() => {
            // events
            this.attachEvents();

            // mqtt
            this.initMqtt();

            // init workers
            this.initWorkers();
        });

        // update markers
        this.on('map_objects_refresh', data => {
            console.log('e: map_objects_refresh', data);
        });
    }

    initMqtt() {
        // mqtt client
        this.mqttClient = this.app?.getMqttClient();
        if (this.mqttClient) {
            console.log('!: mqtt initialized');

            // topics
            const camGpsRegex = new RegExp(`^device\/device-[0-9a-fA-F]{16}\/gps$`);

            // connect callback
            this.mqttClient.on('connect', () => {
                this.debug('e: mqtt connect');

                // subscribe to topics
                this.mqttClient.subscribe('device/+/gps');
            });

            // message callback
            this.mqttClient.on('message', (topic, msg) => {
                let payload = msg?.toString() ?? null;

                this.debug('e: message', topic, payload.substring(0, 50) + '...');

                // camera gps
                if (topic.match(camGpsRegex)) {
                    this.newMapObject(JSON.parse(payload));
                }
            });
        }
    }

    async initMap() {
        this.mapObjects = {};
        this.mapFitBounds = true;

        // markers super group - all marker groups are in this group
        this._markers = {};
        //
        this._markersGroup = {};
        // markers references
        this._markersRef = {};
        // references to all layers
        this._layers = {};
        // references to all icons
        this._icons = {};
        //
        this._layersControls = {};

        // Map
        // -----------------------------------------------------------
        this.map = L.map('map', {
            zoomControl: false,
        });

        this.map.setView(this.DEFAULT_GPS_POSITION, this.DEFAULT_ZOOM);

        // Icons
        // -----------------------------------------------------------
        this._icons['locomotive'] = L.divIcon({
            className: 'map-icon',
            iconUrl: 'assets/img/map_icon_locomotive.png',
            iconSize: [48, 48],
            iconAnchor: [24, 24],
            popupAnchor: [0, -75],
            shadowUrl: 'assets/img/map_icon_locomotive.png',
            shadowSize: [2, 2],
            shadowAnchor: [0, 0],
        });

        this._icons['camera'] = L.divIcon({
            className: 'map-icon',
            iconUrl: 'assets/img/map_icon_person.png',
            iconSize: [48, 48],
        });

        this._icons['camera_panic'] = L.divIcon({
            className: 'map-icon map-icon-panic',
            iconUrl: 'assets/img/map_icon_person.png',
            iconSize: [48, 48],
            html: '<div class="pulsating-circle"></div>',
        });

        // this._icons['camera'] = L.icon.pulse({
        //     iconSize: [48, 48],
        //     fillColor: 'transparent',
        //     color: 'red',
        // });

        // this._icons['red'] = L.icon.pulse({
        //     color: 'red',
        //     fillColor: 'red',
        //     animate: true,
        // });

        // Layers
        // -----------------------------------------------------------
        this._layers = {
            street: L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
                maxZoom: 20,
            }),
            street2: L.tileLayer('http://{s}.google.com/vt/lyrs=m&x={x}&y={y}&z={z}', {
                maxZoom: 20,
                subdomains: ['mt0', 'mt1', 'mt2', 'mt3'],
            }),
            satelite: L.tileLayer('http://{s}.google.com/vt/lyrs=s&x={x}&y={y}&z={z}', {
                maxZoom: 20,
                subdomains: ['mt0', 'mt1', 'mt2', 'mt3'],
            }),
        };

        // Layers controls
        // -----------------------------------------------------------
        this._layersControls = {
            Street: this._layers.street,
            Satelite: this._layers.satelite,
        };

        // Overlays
        // feature group - all markers on the map are stored in this group
        this._markers = new L.FeatureGroup();
        this._markers.addTo(this.map);

        this._markersGroup['locomotive'] = new L.FeatureGroup().addTo(this._markers);
        this._markersGroup['camera'] = new L.FeatureGroup().addTo(this._markers);

        this.mapOverlays = {
            Locomotive: this._markersGroup['locomotive'],
            Persons: this._markersGroup['camera'],
        };

        // default layer
        this._layers['street'].addTo(this.map);

        // layer controls
        var layerControl = L.control.layers(this._layersControls, this.mapOverlays).addTo(this.map);
    }

    initWorkers() {
        worker('map_markers', 5000, () => {
            let objects = [...Object.values(this.mapObjects)];
            let now = getTimestamp();

            for (const obj of objects) {
                const objectType = obj.type ?? 'camera';
                const delta = now - obj.ts;

                // remove old map object
                if (delta > this.MARKER_TIMEOUT) {
                    console.log('remove marker...');
                    this._markersRef[obj.camera_id].removeFrom(this._markersGroup[objectType]);
                    this._markersRef[obj.camera_id].removeFrom(this.map);
                }
            }
        });
    }

    attachEvents() {
        // map events
        if (this.map) {
            this.map.on('dragstart', e => {
                console.log('e: map - dragstart', e);

                this.mapFitBounds = false;
                this.filterBadge(this.$btnReset, true);
            });
        }

        this.$btnReset.on('click', e => {
            e.preventDefault();
            if (this.map) {
                this.fitBounds();

                this.filterBadge(this.$btnReset, false);
            }
        });

        // map marker click
        this.on('map_marker_click', (marker, data) => {
            console.log('e: map_marker_click', marker, data);

            //$( "#draggable" ).draggable();
            this.activeIcon = marker;
            $(marker._icon).addClass('active');

            this.modal = new Modal({
                parent: '#content',
                width: 400,
                height: 360,
                x: 'RIGHT',
                y: 'TOP',
                offsetX: 20,
                offsetY: 20,
                title: data.camera_id,
                body: this.templates['camera'](),
                onHide: () => {
                    this.debug('e: modal hide');
                    this.modalVideo = null;
                    this.camera = null;

                    $(this.activeIcon._icon).removeClass('active');
                    this.activeIcon = undefined;

                    this.fitBounds();
                },
            }).show();

            this.fitBounds([-420, 0]);

            // $appModal.draggable({
            //     helper: 'modal-win-header',
            //     containment: $appModal.parent(),
            // });

            interact('#' + this.modal.getId())
                .draggable({
                    inertia: false,
                    modifiers: [
                        interact.modifiers.restrictRect({
                            restriction: '#content',
                        }),
                    ],
                    listeners: {
                        move(event) {
                            var target = event.target,
                                // keep the dragged position in the data-x/data-y attributes
                                x = (parseFloat(target.getAttribute('data-x')) || 0) + event.dx,
                                y = (parseFloat(target.getAttribute('data-y')) || 0) + event.dy;

                            // translate the element
                            target.style.transform = 'translate(' + x + 'px, ' + y + 'px)';

                            // update the posiion attributes
                            target.setAttribute('data-x', x);
                            target.setAttribute('data-y', y);
                        },
                    },
                })
                .resizable({
                    inertia: false,
                    edges: { left: true, right: true, bottom: true, top: false },
                    modifiers: [
                        interact.modifiers.restrictEdges({
                            outer: '#content',
                        }),
                        interact.modifiers.restrictSize({
                            min: { width: 400, height: 400 },
                        }),
                    ],
                    listeners: {
                        move(event) {
                            var target = event.target,
                                x = parseFloat(target.getAttribute('data-x')) || 0,
                                y = parseFloat(target.getAttribute('data-y')) || 0;

                            // update the element's style
                            target.style.width = event.rect.width + 'px';
                            target.style.height = event.rect.height + 'px';

                            // translate when resizing from top or left edges
                            x += event.deltaRect.left;
                            y += event.deltaRect.top;

                            target.style.transform = 'translate(' + x + 'px,' + y + 'px)';

                            target.setAttribute('data-x', x);
                            target.setAttribute('data-y', y);
                        },
                    },
                });

            // init pi camera
            this.initPiCamera(data.camera_id, true);
        });
    }

    filterBadge($element, status) {
        if (status === true) {
            $element.find('.filter-active').removeClass('d-none');
            //$element.removeClass("btn-dark").addClass("btn-danger");
        } else {
            $element.find('.filter-active').addClass('d-none');
            //$element.removeClass("btn-danger").addClass("btn-dark");
        }
    }

    fitBounds(padding) {
        const bounds = this._markers.getBounds();
        if (padding === undefined) {
            padding = [0, 0];
        }

        if (!isObjectEmpty(bounds)) {
            this.map.fitBounds(bounds, {
                maxZoom: 19,
                paddingTopLeft: padding,
            });
        } else {
            this.map.flyTo(this.DEFAULT_GPS_POSITION, this.map.getZoom());
        }
    }

    // refresh map objects
    newMapObject(data) {
        var self = this;
        var fitBounds = true;

        if (data && typeof data === 'object') {
            const cameraId = data.camera_id;
            const objectType = data.type ?? 'camera';
            let icon = objectType;

            if (data.panic && data.panic === 1) {
                icon = icon + '_panic';
            }

            // new map object
            if (this.mapObjects[cameraId] === undefined) {
                // map
                var marker = new L.Marker(data.gps, {
                    camera: data,
                    icon: this._icons[icon],
                }).on('click', function () {
                    self.emit('map_marker_click', this, data);
                });

                // markers - feature group (markers are added to separate groups)
                // add marker to the desired group
                marker.addTo(this._markersGroup[objectType]);

                // marker reference
                this._markersRef[cameraId] = marker;

                console.log('f: newMapObject() - new object', data, marker);
                marker.getElement().classList.add('css-icon');

                // update position
            } else {
                console.log('f: newMapObject() - update gps', data);
                this._markersRef[cameraId].setIcon(this._icons[icon]);
                this._markersRef[cameraId].setLatLng(data.gps);
            }

            if (this.mapFitBounds === true) {
                this.fitBounds();
            }

            // store object reference
            this.mapObjects[cameraId] = data;
        }

        this.emit('map_objects_refresh', data);
    }

    initPiCamera(cameraId, connect) {
        // pi camera
        this.camera = new PiCamera(cameraId, this.options.camera, null, this.mqttClient);

        // attach video reference to the camera
        this.camera.attach(document.getElementById('map-video'));

        // connect
        if (connect === true) {
            this.camera.connect();
        }
    }
}

export default { MapView };
