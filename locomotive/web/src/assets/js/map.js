import { getTimestamp, worker, isObjectEmpty } from './functions.js';
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
    MARKER_TIMEOUT = 120;

    constructor(options, app) {
        this.options = this.initializeOptions(options);
        this.app = app;

        // events dispatcher
        EventDispatcher.attach(this);

        // local variables
        this._templates = {};
        this._piCameraRefs = {};
        this._modalRefs = {};
        this._activeMarker = undefined;

        // dom  elements
        this.$element = $('#map');
        this.$btnReset = $('#btn-reset');

        // debug
        if (this.options.debug === true && typeof console != 'undefined') {
            this.debug = console.log.bind(console);
        } else {
            this.debug = function (message) {};
        }

        this.debug('[map] options', this.options);

        // templates
        this._templates['camera'] = Handlebars.compile($('#entry-template').html());

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
        // this.on('map_objects_refresh', data => {
        //     console.log('[map] event - map_objects_refresh', data);
        // });
    }

    initializeOptions(userOptions) {
        const defaultOptions = {
            debug: false,
        };

        return { ...defaultOptions, ...userOptions };
    }

    initMqtt() {
        // mqtt client
        this.mqttClient = this.app?.getMqttClient();
        if (this.mqttClient) {
            console.log('[map] mqtt initialized');

            // topics
            const gpsRegex = new RegExp(`^device\/device-[0-9a-fA-F]{16}\/gps$`);
            const panicButtonRegex = new RegExp(`^device\/device-[0-9a-fA-F]{16}\/button$`);

            // connect callback
            this.mqttClient.on('connect', () => {
                this.debug('[map] mqtt connected');

                // subscribe to topics
                this.mqttClient.subscribe('device/#');
            });

            // message callback
            this.mqttClient.on('message', (topic, msg) => {
                const payload = msg ? JSON.parse(msg.toString()) : null;
                const deviceId = payload ? payload.device_id : null;

                this.debug('[map] mqtt message: ' + topic, msg.toString().substring(0, 50) + '...');

                // camera gps
                if (topic.match(gpsRegex)) {
                    this.newMapObject(payload);
                }

                // panic button
                if (topic.match(panicButtonRegex)) {
                    this.panicButton(deviceId);
                }
            });
        }
    }

    async initMap() {
        this._mapObjects = {};
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
            className: 'map-icon map-icon-locomotive',
            html: '<div class="inner"></div>',
            iconSize: [48, 48],
        });

        this._icons['camera'] = L.divIcon({
            className: 'map-icon map-icon-camera',
            html: '<div class="inner"></div>',
            iconSize: [48, 48],
        });

        this._icons['camera_panic'] = L.divIcon({
            className: 'map-icon map-icon-camera panic',
            html: '<div class="inner"></div>',
            iconSize: [48, 48],
        });

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
            let objects = [...Object.values(this._mapObjects)];
            let now = getTimestamp();

            for (const obj of objects) {
                const delta = now - obj.ts;

                // remove old map object
                if (delta > this.MARKER_TIMEOUT) {
                    this.debug('[map] removing map object...');

                    this.destroyPiCamera(obj.device_id);
                    //this.removeMapObject(obj.device_id);
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
                this.$btnReset.show();
            });
        }

        this.$btnReset.on('click', e => {
            e.preventDefault();
            if (this.map) {
                this.fitBounds();

                this.filterBadge(this.$btnReset, false);
                this.$btnReset.hide();
            }
        });

        // map marker click
        // https://stackoverflow.com/questions/49277253/leaflet-contextmenu-how-to-pass-a-marker-reference-when-executing-a-callback-f
        this.on('map_marker_click', (marker, data) => {
            console.log('e: map_marker_click', marker, data);

            let deviceId = data.device_id;

            //$( "#draggable" ).draggable();
            this._activeMarker = marker;
            $(marker._icon).addClass('active');

            // new modal window
            if (this._modalRefs[deviceId] === undefined) {
                const modalBody = this._templates['camera']({
                    deviceId: deviceId,
                });

                // model win count
                const winCount = Object.keys(this._modalRefs).length;

                this._modalRefs[deviceId] = new Modal({
                    parent: '#content',
                    width: 400,
                    height: 360,
                    x: 'RIGHT',
                    y: 'TOP',
                    offsetX: 20,
                    offsetY: 20 + winCount * 70,
                    body: modalBody,
                    active: true,
                    onInit: m => {
                        for (var key in this._modalRefs) {
                            if (this._modalRefs.hasOwnProperty(key)) {
                                this._modalRefs[key].setActiveStatus(false);
                            }
                        }
                    },
                    onShow: () => {
                        this.fitBounds([-420, 0]);
                        this.initPiCamera(deviceId, true);
                    },
                    onHide: data => {
                        this.debug('[map] event - modal hide', data);

                        if (this._activeMarker) {
                            $(this._activeMarker._icon).removeClass('active');
                            //this._activeMarker = undefined;
                        }

                        this.fitBounds();
                    },
                }).show();

                interact('#' + this._modalRefs[deviceId].getId())
                    .on('tap', event => {
                        event.stopPropagation();
                        for (var key in this._modalRefs) {
                            if (this._modalRefs.hasOwnProperty(key)) {
                                this._modalRefs[key].setActiveStatus(false);
                            }
                        }

                        this._modalRefs[deviceId].setActiveStatus(true);
                    })
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
            } else {
                this._modalRefs[deviceId].show();
            }

            // $appModal.draggable({
            //     helper: 'modal-win-header',
            //     containment: $appModal.parent(),
            // });
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

        if (data && typeof data === 'object') {
            const deviceId = data.device_id;
            const objectType = data.type ?? 'camera';
            let icon = objectType;

            // new map object
            if (this._mapObjects[deviceId] === undefined) {
                // map
                var marker = new L.Marker(data.gps, {
                    camera: data,
                    icon: this._icons[icon],
                }).on('click', function () {
                    self.emit('map_marker_click', this, data);
                });

                marker.on('contextmenu', function (e) {
                    self.destroyPiCamera(e.target.options.camera.device_id);
                    //self.removeMapObject(e.target.options.camera.device_id);
                });

                // markers - feature group (markers are added to separate groups)
                // add marker to the desired group
                marker.addTo(this._markersGroup[objectType]);

                // marker reference
                this._markersRef[deviceId] = marker;

                this.debug('[map] new map object', data, marker);
                marker.getElement().classList.add('css-icon');

                // update position
            } else {
                this.debug('[map] map object update - gps', data);
                this._markersRef[deviceId].setLatLng(data.gps);
            }

            if (this.mapFitBounds === true) {
                this.fitBounds();
            }

            // store object reference
            this._mapObjects[deviceId] = data;
        }

        this.emit('map_objects_refresh', data);
    }

    removeMapObject(deviceId) {
        if (deviceId && deviceId.length) {
            this.debug('[map] removing map object - device id: ' + deviceId);

            for (const group in this._markersGroup) {
                this._markersRef[deviceId].removeFrom(this._markersGroup[group]);
            }

            this._markersRef[deviceId].removeFrom(this.map);

            delete this._markersRef[deviceId];
            delete this._mapObjects[deviceId];
        }
    }

    initPiCamera(deviceId, connect) {
        if (deviceId && deviceId.length) {
            if (this._piCameraRefs[deviceId] === undefined) {
                this.debug('[map] initializing picamera...');

                // initialize new PiCamera object
                this._piCameraRefs[deviceId] = new PiCamera(
                    deviceId,
                    this.options.camera,
                    null,
                    this.mqttClient
                );

                // attach video reference to the camera
                console.log('video-' + deviceId);
                console.log(document.getElementById('video-' + deviceId));
                this._piCameraRefs[deviceId].attach(document.getElementById('video-' + deviceId));
            }

            // connect
            if (connect === true) {
                this._piCameraRefs[deviceId].connect();
            }
        }
    }

    destroyPiCamera(deviceId) {
        if (deviceId && deviceId.length) {
            // camera
            if (this._piCameraRefs[deviceId] !== undefined) {
                this._piCameraRefs[deviceId].terminate();
                delete this._piCameraRefs[deviceId];
            }

            // modal win
            if (this._modalRefs[deviceId] !== undefined) {
                this._modalRefs[deviceId].destroy();
                delete this._modalRefs[deviceId];
            }
        }
    }

    panicButton(deviceId) {
        this.debug('[map] panic button', deviceId);
        if (deviceId && deviceId.length) {
            if (this._markersRef[deviceId] !== undefined) {
                this._markersRef[deviceId].setIcon(this._icons['camera_panic']);
            }
        }
    }
}

export default { MapView };
