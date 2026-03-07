import { getTimestamp, worker, isObjectEmpty } from './functions.js';
import { EventDispatcher } from './EventDispatcher.js';
import { ConsoleColors } from './utils.js';
import { AppWorker } from './common/AppWorker.js';
import { PiCamera } from './rtc/picamera.js';
import { Modal } from './modal.js';

// https://codepen.io/peeke/pen/BjxXZa
// https://codepen.io/danest/pen/nYdOoE
// https://www.kirupa.com/animations/creating_pulsing_circle_animation.htm
// https://codepen.io/Raphael/pen/DmvmdX

export class MapView {
    config = {};

    DEFAULT_GPS_POSITION = [30.672026, -92.260802];
    DEFAULT_ZOOM = 16;
    MARKER_TIMEOUT = 60;

    mqtt = null;

    constructor(options, app) {
        this.options = this.initializeOptions(options);

        // events dispatcher
        EventDispatcher.attach(this);

        // local variables
        this._templates = {};
        this._piCameraRefs = {};
        this._modalRefs = {};
        this._activeMarker = undefined;
        this._gps = {};

        // sites
        this._locationId = 0;
        this._site = {};

        // dom elements
        this.$element = $('#map');
        this.$btnReset = $('#btn-reset');

        // icon
        this._sharedIcon = L.DivIcon.extend({
            options: {
                className: 'map-icon def-equipment',
                html: '<div class="inner"></div>',
                iconSize: [38, 38],
                // shadowSize:   [50, 64],
                // iconAnchor:   [22, 94],
                // shadowAnchor: [4, 62],
                // popupAnchor:  [-3, -76]
            },
        });

        // debug
        if (
            (!this.options.hasOwnProperty('app') ||
                !this.options.app.hasOwnProperty('debug') ||
                this.options.app.debug !== false) &&
            (!this.options.hasOwnProperty('map') ||
                !this.options.map.hasOwnProperty('debug') ||
                this.options.map.debug !== false) &&
            typeof console != 'undefined'
        ) {
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
            this.initMqtt(app?.getMqttClient());

            // init workers
            this.initWorkers();

            // get my gps
            this.getCurrentPosition();

            // get sites list
            this.fetchSites();
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

    initMqtt(mqttClient) {
        if (mqttClient && typeof mqttClient === 'object') {
            this.mqtt = mqttClient;

            this.debug('[map] mqtt initialized');

            // topics
            const gpsRegex = new RegExp('^device/[0-9a-zA-Z\-\_]+/gps$');
            const buttonRegex = new RegExp('^device/[0-9a-zA-Z\-\_]+/button$');

            // connect callback
            this.mqtt.on('connect', () => {
                this.debug('[map] mqtt connected');

                // subscribe to topics
                this.mqtt.subscribe('device/+/gps');
                this.mqtt.subscribe('device/+/button');
            });

            // message callback
            this.mqtt.on('message', (topic, msg) => {
                let payload;

                try {
                    payload = msg ? JSON.parse(msg.toString()) : null;
                    this.debug(
                        '[map] mqtt message: ' + topic,
                        msg.toString().substring(0, 50) + '...'
                    );

                    if (topic) {
                        // received GPS data
                        if (topic.match(gpsRegex)) {
                            this.deviceGpsHandler(payload);
                        }

                        // received panic button event
                        if (topic.match(buttonRegex)) {
                            this.deviceButton(payload);
                        }
                    }
                } catch (e) {
                    this.debug(
                        '[video] %s | topic: %s - %cmessage parsing error: %s',
                        this.mqtt.clientId,
                        topic,
                        ConsoleColors.error,
                        e
                    );
                }
            });
        }
    }

    async initMap() {
        this._mapObjects = {};
        this.mapFitBounds = true;

        // markers super group - all marker groups are in this group
        this._markers = {};
        // marker groups
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

        // Layers
        // -----------------------------------------------------------
        this.createLayers();

        // Layers controls
        // -----------------------------------------------------------
        this._layersControls = {
            Street: this._layers.street,
            Satellite: this._layers.satellite,
        };

        // Overlays
        // feature group - all markers on the map are stored in this group
        this._markers = new L.FeatureGroup();
        this._markers.addTo(this.map);

        // layers - each group is a layer (user can show or hide the group)
        this._markersGroup['default'] = new L.FeatureGroup().addTo(this._markers);
        this._markersGroup['locomotive'] = new L.FeatureGroup().addTo(this._markers);
        this._markersGroup['camera'] = new L.FeatureGroup().addTo(this._markers);
        this._markersGroup['equipment'] = new L.FeatureGroup().addTo(this._markers);

        // overlay picker
        this.mapOverlays = {
            Locomotive: this._markersGroup['locomotive'],
            Persons: this._markersGroup['camera'],
            Equipment: this._markersGroup['equipment'],
        };

        // default layer
        this._layers['street'].addTo(this.map);

        // layer controls
        const layerControl = L.control
            .layers(this._layersControls, this.mapOverlays)
            .addTo(this.map);
    }

    initWorkers() {
        // map markers
        const mapObjects = new AppWorker('map_markers', 5000);

        // tick
        mapObjects.onTick = () => {
            let now = getTimestamp();

            // map objects
            const keys = Object.keys(this._mapObjects);
            if (keys.length) {
                for (const deviceId of keys) {
                    const device = this._mapObjects[deviceId];
                    const delta = now - device.ts;

                    // remove old map object
                    if (delta > this.MARKER_TIMEOUT) {
                        this.removeMapObject(device.device_id);
                    }
                }
            }
        };
    }

    attachEvents() {
        // map events
        if (this.map) {
            this.map.on('dragstart', e => {
                this.debug('[map] event - dragstart', e);

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
            this.debug('[map] event - map_marker_click', marker, data);

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
                        for (const key in this._modalRefs) {
                            if (this._modalRefs.hasOwnProperty(key)) {
                                this._modalRefs[key].setActiveStatus(false);
                            }
                        }
                    },
                    onShow: () => {
                        //this.fitBounds([-420, 0]);
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
                        for (const key in this._modalRefs) {
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
                                const target = event.target;
                                const x = (parseFloat(target.getAttribute('data-x')) || 0) + event.dx;
                                const y = (parseFloat(target.getAttribute('data-y')) || 0) + event.dy;

                                // translate the element
                                target.style.transform = 'translate(' + x + 'px, ' + y + 'px)';

                                // update the position attributes
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
                                const target = event.target;
                                let x = parseFloat(target.getAttribute('data-x')) || 0;
                                let y = parseFloat(target.getAttribute('data-y')) || 0;

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
        });
    }

    getMapIcon(objectType) {
        switch (objectType) {
            case 'locomotive':
                return new this._sharedIcon({ className: 'map-icon locomotive' });
            case 'camera_fall':
                return new this._sharedIcon({ className: 'map-icon map-icon-pulse fall' });
            case 'camera_emergency':
                return new this._sharedIcon({ className: 'map-icon map-icon-pulse emergency' });
            case 'camera':
                return new this._sharedIcon({ className: 'map-icon camera' });
            case 'equipment':
            default:
                return new this._sharedIcon({ className: 'map-icon equipment' });
        }

        //     color: 'red',
        //     fillColor: 'red',
        //     animate: true,
        // });
    }

    createLayers() {
        this._layers = {
            street: L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
                maxZoom: 20,
            }),
            street2: L.tileLayer('http://{s}.google.com/vt/lyrs=m&x={x}&y={y}&z={z}', {
                maxZoom: 20,
                subdomains: ['mt0', 'mt1', 'mt2', 'mt3'],
            }),
            satellite: L.tileLayer('http://{s}.google.com/vt/lyrs=s&x={x}&y={y}&z={z}', {
                maxZoom: 20,
                subdomains: ['mt0', 'mt1', 'mt2', 'mt3'],
            }),
        };
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
                maxNativeZoom: 18,
                paddingTopLeft: padding,
            });
        } else {
            this.map.flyTo(this.DEFAULT_GPS_POSITION, this.map.getZoom());
        }
    }

    // refresh map objects
    deviceGpsHandler(data) {
        if (data && typeof data === 'object') {
            const deviceId = data.device_id;
            const objectType = data.type ?? 'equipment';
            const now = getTimestamp();

            this.addMapObject(deviceId, {
                layer: 'camera',
                type: objectType,
                ts: now,
                gps: data.gps,
            });
        }

        this.emit('map_objects_refresh', data);
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
                    this.mqtt
                );

                // attach video reference to the camera
                this._piCameraRefs[deviceId].attach(document.getElementById('video-' + deviceId));
            }

            // connect
            if (connect === true) {
                this._piCameraRefs[deviceId].connect();
            }
        }
    }

    addMapObject(deviceId, obj) {
        this.debug('[map] new object added - deviceId: %s', deviceId, obj);

        // new map object (add it to the map)
        if (this._mapObjects[deviceId] === undefined) {
            // object layer
            const layer = obj.layer ?? 'equipment';

            // object type
            const type = obj.type ?? 'equipment';

            // initialize new marker
            const marker = new L.Marker(obj.gps, {
                camera: obj,
                icon: this.getMapIcon(type),
            }).on('click', () => {
                this.emit('map_marker_click', marker, obj);
            });

            marker.on('contextmenu', e => {
                this.removeMapObject(e.target.options.camera.device_id);
            });

            // markers - feature group (markers are added to separate groups)
            // add marker to the desired group
            // default group - default_equipment
            if (this._markersGroup.hasOwnProperty(layer)) {
                marker.addTo(this._markersGroup[layer]);
            } else {
                marker.addTo(this._markersGroup['equipment']);
            }

            // store the marker reference
            this._markersRef[deviceId] = marker;

            marker.getElement().classList.add('css-icon');

            if (this.mapFitBounds === true) {
                this.fitBounds();
            }
        } else {
            // update position
            this.debug('[map] map object update - gps', obj);

            if (
                typeof this._markersRef[deviceId] === 'object' &&
                this._markersRef[deviceId]['_leaflet_id'] !== undefined
            ) {
                // update the gps coordinates
                this._markersRef[deviceId].setLatLng(obj.gps);
            }
        }

        // store the object reference
        this._mapObjects[deviceId] = obj;
    }

    removeMapObject(deviceId) {
        if (deviceId && deviceId.length) {
            this.debug('[map] removing map object ...', deviceId);

            // camera
            if (this._piCameraRefs[deviceId] !== undefined) {
                this._piCameraRefs[deviceId].terminate();
                delete this._piCameraRefs[deviceId];
            }

            // modal win
            if (this._modalRefs[deviceId] !== undefined) {
                interact('#' + this._modalRefs[deviceId].getId()).unset();
                this._modalRefs[deviceId].destroy();
                delete this._modalRefs[deviceId];
            }

            // marker
            if (this._markersRef[deviceId] !== undefined) {
                const layer = this._mapObjects[deviceId]?.layer;
                if (layer && this._markersGroup[layer]) {
                    this._markersRef[deviceId].removeFrom(this._markersGroup[layer]);
                } else {
                    this._markersRef[deviceId].removeFrom(this.map);
                }
                delete this._markersRef[deviceId];
            }

            // map object reference
            if (this._mapObjects[deviceId] !== undefined) {
                delete this._mapObjects[deviceId];
            }
        }
    }

    deviceButton(data) {
        this.debug('[map] device button pressed', data);
        if (data && data.device_id && data.device_id.length) {
            const deviceId = data.device_id;
            const status = data.status || '';

            if (this._markersRef[deviceId] !== undefined) {
                const icon = this.getMapIcon(status);

                this._markersRef[deviceId].setIcon(icon);
            }
        }
    }

    getCurrentPosition() {
        if (!('geolocation' in navigator)) return;
        this.debug('[map][gps] getting the current position...');

        navigator.geolocation.getCurrentPosition(
            position => {
                this.gps = {
                    lat: position.coords.latitude,
                    lng: position.coords.longitude,
                };

                this.debug('[map][gps] successfully retrieved', this.gps);
            },
            () => {
                this.debug('[map][gps] Unable to retrieve current location');
            },
            {
                enableHighAccuracy: true,
                maximumAge: 15000,
                timeout: 10000,
            }
        );
    }

    fetchSites() {
        // we need to hide api token - call local php script
        $.get('ajax/site_list.php').done(data => {
            // find the closest site

            this._locationId = 1;
            this.getSiteEquipment();
        });
    }

    getSiteEquipment() {
        if (!this._locationId) return;

        $.get('ajax/site_equipment.php', { location_id: this._locationId }).done(data => {
            if (data && typeof data === 'object') {
                const now = getTimestamp();

                for (const code in data) {
                    if (data.hasOwnProperty(code)) {
                        const loc = data[code];

                        // test data
                        // if (i === 0) {
                        //     const randomItem = arr => arr[Math.floor(Math.random() * arr.length)];
                        //     const types = ['camera', 'equipment', 'locomotive'];
                        //     loc.lat = 30.672026;
                        //     loc.lon = -92.260702;
                        //     loc.type = randomItem(types);
                        // }

                        if (loc && loc.hasOwnProperty('lat')) {
                            if (loc['lat'] && loc['lon']) {
                                // we have GPS
                                this.addMapObject(code, {
                                    layer: 'equipment',
                                    type: loc.type ?? 'equipment',
                                    ts: now,
                                    gps: { lat: loc.lat, lng: loc.lon },
                                });
                            }
                        }

                    }
                }
            }
        });
    }
}

export default { MapView };
