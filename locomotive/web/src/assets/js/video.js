import { getTimestamp, worker, wait } from './functions.js';
import { EventDispatcher } from './EventDispatcher.js';
import { ConsoleColors } from './utils.js';
import { PiCamera } from './rtc/picamera.js';

export class Video {
    options = {};

    VIDEO_TIMEOUT = 30;
    TEXT_OVERLAY_TIMEOUT = 5;

    mqtt = undefined;
    _devices = {};
    topicRegex = {};
    orientation = 'landscape';

    constructor(options, app) {
        this.options = this.initializeOptions(options);

        // local variables
        this._overlayRefs = {};

        // events dispatcher
        EventDispatcher.attach(this);

        // debug
        if (
            (!this.options.hasOwnProperty('app') ||
                !this.options.app.hasOwnProperty('debug') ||
                this.options.app.debug !== false) &&
            (!this.options.hasOwnProperty('video') ||
                !this.options.video.hasOwnProperty('debug') ||
                this.options.video.debug !== false) &&
            typeof console != 'undefined'
        ) {
            this.debug = console.log.bind(console);
        } else {
            this.debug = function (message) {};
        }

        this.debug('[video] options', this.options);

        // dom elements
        this.$content = $('#content');
        this.$grid = $('#video-grid');

        // regex map
        const deviceIdPattern = 'device-[0-9a-fA-F]{16}';
        this.topicRegex['device_status'] = new RegExp(`^device\/${deviceIdPattern}\/status$`);
        this.topicRegex['device_gps'] = new RegExp(`^device\/${deviceIdPattern}\/gps$`);
        this.topicRegex['device_distance'] = new RegExp(`^device\/${deviceIdPattern}\/distance$`);
        this.topicRegex['device_osd'] = new RegExp(`^device\/${deviceIdPattern}\/osd$`);

        // attach events
        window.onbeforeunload = () => {
            this.debug('[video] window reload');

            for (const deviceId in this._devices) {
                const val = this._devices[deviceId];

                if (val && val.picamera) {
                    val.picamera.terminate();
                }
            }
        };

        // resize
        window.addEventListener('resize', event => this.handleResize(event), true);
        window.dispatchEvent(new Event('resize'));

        // mqtt
        this.initMqtt(app?.getMqttClient());

        // init workers
        this.initWorkers();
    }

    initializeOptions(userOptions) {
        const defaultOptions = {
            debug: false,
        };

        return { ...defaultOptions, ...userOptions };
    }

    handleResize(event) {
        // this.$content.append(screen.height + ' - ');
        // this.$content.append(window.innerHeight + ' - ');
        // this.$content.append(screen.availHeight);
        this.$content.height(window.innerHeight);
        this.orientation = window.innerWidth > window.innerHeight ? 'landscape' : 'portrait';
        this.$grid.removeClass('grid-landscape grid-portrait').addClass('grid-' + this.orientation);
    }

    initMqtt(mqttClient) {
        if (mqttClient && typeof mqttClient === 'object') {
            this.mqtt = mqttClient;
            this.mqtt.on('connect', () => this.mqttConnected());
            this.mqtt.on('disconnect', () => this.mqttDisconnected());
        }
    }

    mqttConnected() {
        if (this.mqtt) {
            this.mqttId = this.mqtt.getClientId();

            this.debug('[video][mqtt] connected');

            // received camera status
            this.debug('[video][mqtt] subscribe: device/# - client id: %s', this.mqttId);
            this.mqtt.subscribe('device/#');

            // got the message
            this.mqtt.on('message', (topic, message) => {
                let payload;
                try {
                    payload = JSON.parse(message?.toString());
                } catch (e) {
                    this.debug(
                        '[video] %s | %cerror -> topic: %s - message parsing error: %s',
                        this.mqttId,
                        topic,
                        ConsoleColors.error,
                        e
                    );
                }

                if (payload) {
                    // camera status
                    if (topic.match(this.topicRegex['device_status'])) {
                        this.handleDeviceStatusMessage(payload);
                    }
                    // distance
                    if (topic.match(this.topicRegex['device_distance'])) {
                        this.handleDeviceDistanceMessage(payload);
                    }
                    // network
                    if (topic.match(this.topicRegex['device_osd'])) {
                        this.handleDeviceOsdMessage(payload);
                    }
                }
            });
        }
    }

    mqttDisconnected() {
        this.debug('[video][mqtt] mqtt disconnected');
    }

    handleDeviceStatusMessage(payload) {
        const deviceId = payload.device_id ?? null;

        this.debug(
            '[video][mqtt] %s | %cmqtt message:',
            deviceId || '???',
            ConsoleColors.purple,
            'device/+/status',
            payload
        );

        if (!deviceId || !deviceId.length) {
            return;
        }

        // camera is already in reference list, check time
        if (this.isDeviceInGrid(deviceId)) {
            //this.debug('[video] camera already in the grid');

            // update timestamp
            this._devices[deviceId].ts = payload.ts;
            this._devices[deviceId].status = payload.status;
            this._devices[deviceId].ai = payload.ai === true;

            const cam = this.getDeviceData(deviceId)?.picamera;

            // device connected
            if (this.isDeviceConnected(deviceId)) {
                if (cam) {
                    cam.setOptions(this._devices[deviceId]);
                    //cam.aiStatus(this._devices[deviceId].ai);
                }

                // device disconnected
            } else {
                // reconnect picamera
                if (cam) {
                    this.debug(
                        '[video] %s | %ccamera not connected - reconnecting',
                        deviceId,
                        ConsoleColors.error,
                        '| camera status: ' + this.getDeviceStatus(deviceId)
                    );

                    cam.reconnect();
                }
            }
        } else {
            this.debug(
                '[video] %s | %c!!! new device connected',
                deviceId || '???',
                ConsoleColors.turquoise
            );

            let device = payload;

            // dom id
            device.dom_id = 'device_' + deviceId;
            device.video_id = 'video_' + deviceId;

            // append html to the video matrix
            this.$grid.append(
                `<div id="${device.dom_id}" class="video-wrapper" data-device-id="${deviceId}">` +
                    `<video id="${device.video_id}" autoplay playsinline muted></video>` +
                    '<div class="osd">' +
                    `<span id="${device.dom_id}_hw" class="hw-status"></span>` +
                    '</div>' +
                    '</div>'
            );

            // video element reference
            device.video_ref = document.getElementById(device.video_id);

            // test
            // $(device.video_ref).on('contextmenu', e => {
            //     this.removeDeviceFromGrid(deviceId);
            // });

            // update reference
            this._devices[deviceId] = device;

            // update grid
            this.updateGrid();

            // init pi camera
            this.initPiCamera(deviceId, true, {
                enableAi: device.ai,
            });

            //this.demoMp4(deviceId, true);
        }
    }

    getDeviceData(deviceId) {
        return this._devices[deviceId] || null;
    }

    isDeviceInGrid(deviceId) {
        return this._devices[deviceId] !== undefined;
    }

    isDeviceConnected(deviceId) {
        return (
            this._devices[deviceId] !== undefined &&
            this._devices[deviceId].picamera &&
            this._devices[deviceId].picamera?.isConnected()
        );
    }

    getDeviceStatus(deviceId) {
        return this._devices[deviceId] !== undefined && this._devices[deviceId].picamera
            ? this._devices[deviceId].picamera.getStatus()
            : 'unknown';
    }

    initPiCamera(deviceId, connect, options) {
        var device = this.getDeviceData(deviceId);
        if (device) {
            // override camera options
            const camOptions = { ...this.options.camera, ...options };

            // pi camera
            device.picamera = new PiCamera(deviceId, camOptions, null, this.mqtt);

            // attach video reference to the camera
            device.picamera.attach(device.video_ref);

            // connect
            if (connect === true) {
                device.picamera.connect();
            }

            // update reference
            //this._devices[deviceId] = device;
        }
    }

    updateGrid() {
        const deviceCount = Object.values(this._devices).length;
        let className = 'grid-' + this.orientation + ' grid-' + deviceCount;
        this.$grid.attr('class', className);
    }

    removeDeviceFromGrid(deviceId) {
        if (deviceId.length) {
            if (this._devices[deviceId] !== undefined) {
                this.debug(
                    '[video] %s | removing device from the grid (no /status message received more than %ss)',
                    deviceId || '???',
                    this.VIDEO_TIMEOUT
                );

                // picamera
                if (this._devices[deviceId].picamera) {
                    this.debug('[video] %s | calling picamera.terminate()', deviceId || '???');
                    this._devices[deviceId].picamera.terminate();
                }

                // overlays
                this.hideOverlayText(deviceId);

                // dom
                $('#' + this._devices[deviceId].video_id).remove();
                $('#' + this._devices[deviceId].dom_id).remove();

                this._devices[deviceId] = null;
                delete this._devices[deviceId];
            }
        }

        this.updateGrid();
    }

    initWorkers() {
        worker('video_grid', 5000, () => {
            let now = getTimestamp();
            for (const deviceId in this._devices) {
                const device = this._devices[deviceId];
                if (device && device.ts) {
                    const delta = now - device.ts;

                    // remove old map object
                    if (delta > this.VIDEO_TIMEOUT) {
                        this.removeDeviceFromGrid(device.device_id);
                    }
                }
            }

            for (const deviceId in this._overlayRefs) {
                const ref = this._overlayRefs[deviceId];
                if (ref && ref.time) {
                    if (now - ref.time > this.TEXT_OVERLAY_TIMEOUT) {
                        this.hideOverlayText(deviceId);
                    }
                }
            }
        });
    }

    demoMp4(deviceId, autoplay) {
        const mp4 = {
            'device-0000000000000001': 'http://localhost/static/video2.mp4',
            'device-100000003a0a2f6e': 'http://localhost/static/video3.mp4',
            'device-00000000b203ade4': 'http://localhost/static/video1.mp4',
            'device-0000000000000002': 'http://localhost/static/video4.mp4',
        };

        const elementId = '#video_' + deviceId;
        const $video = $(elementId);
        const video = $video.get(0);

        video.pause();
        $video.attr('loop', 1).html('<source src="' + mp4[deviceId] + '" />');
        video.load();
        video
            .play()
            .then(() => {})
            .catch(error => {
                console.log(error);
            });
    }

    showOverlayText(deviceId, text, options) {
        if (!deviceId) {
            return;
        }

        if (!options || typeof options !== 'object') {
            options = {};
        }

        let opt = {
            ...{
                x: 'center',
                y: 'top',
                padding: 15,
                fontSize: undefined,
                color: undefined,
                bgColor: undefined,
            },
            ...options,
        };

        if (this._overlayRefs[deviceId] === undefined) {
            // new overlay
            let $videoWrapper = $('#device_' + deviceId);
            if ($videoWrapper.length) {
                //  new div
                let $div = $(
                    '<div class="overlay-text"><div class="text">' + text + '</div></div>'
                );

                let css = { fontSize: opt.fontSize };

                if (opt.x === 'left') {
                    css.left = opt.padding;
                } else if (opt.x === 'right') {
                    css.right = opt.padding;
                    css.textAlign = 'right';
                } else if (opt.x === 'center') {
                    css.textAlign = 'center';
                    css.width = '100%';
                } else {
                    css.left = parseInt(opt.x);
                }

                if (opt.y === 'top') {
                    css.top = opt.padding;
                } else if (opt.y === 'bottom') {
                    css.bottom = opt.padding;
                } else if (opt.y === 'center') {
                    css.top = '50%';
                } else {
                    css.top = parseInt(opt.y);
                }

                if (opt.color) {
                    css.color = color;
                }

                if (opt.bgColor) {
                    css.bgColor = bgColor;
                }

                if (opt.fontSize) {
                    css.fontSize = fontSize;
                }

                $div.appendTo($videoWrapper);
                $div.css(css).show();

                this._overlayRefs[deviceId] = {
                    time: getTimestamp(),
                    element: $div,
                };
            }
        } else {
            // update reference
            this._overlayRefs[deviceId].time = getTimestamp();
            this._overlayRefs[deviceId].element.find('.text').html(text);
        }
    }

    hideOverlayText(deviceId) {
        if (deviceId && this._overlayRefs[deviceId]) {
            if (this._overlayRefs[deviceId].element) {
                this._overlayRefs[deviceId].element.remove();
            }

            delete this._overlayRefs[deviceId];
        }
    }

    handleDeviceDistanceMessage(payload) {
        const deviceId = payload.device_id ?? null;

        this.debug('[video][mqtt] %s | message:', deviceId || '???', 'device/+/distance', payload);

        if (!deviceId || !deviceId.length) {
            return;
        }

        if (payload.strongest_distance && payload.strongest_distance.distance_mm) {
            // convert to feats
            let ft = payload.strongest_distance.distance_mm * 0.00328084;
            // round
            ft = Math.round(ft * 100) / 100;
            // show
            this.showOverlayText(deviceId, ft + ' ft');
        }
    }

    handleDeviceOsdMessage(payload) {
        const deviceId = payload.device_id ?? null;

        this.debug('[video][mqtt] %s | message:', deviceId || '???', 'device/+/osd', payload);

        if (!deviceId || !deviceId.length || !this.isDeviceInGrid(deviceId)) {
            return;
        }

        const domId = `device_${deviceId}_hw`,
            $elm = $('#' + domId);

        // show
        if (payload.status !== 'undefined') {
            let html = '';

            // Battery
            if (typeof payload.status.battery !== 'undefined') {
                let bat, batClass;
                if (payload.status.battery >= 85) {
                    bat = '<i class="ri-battery-fill"></i>';
                    batClass = 'high';
                } else if (payload.status.signal >= 35) {
                    bat = '<i class="ri-battery-low-line"></i>';
                    batClass = 'medium';
                } else {
                    bat = '<i class="ri-battery-line"></i>';
                    batClass = 'low';
                }

                html += `<span class="text battery ${batClass} ms-1">${bat} ${payload.status.battery}%</span>`;
            }

            // Network Signal
            if (typeof payload.status.signal !== 'undefined') {
                let sig;
                if (payload.status.signal >= 75) {
                    sig = 'high';
                } else if (payload.status.signal >= 50) {
                    sig = 'medium';
                } else if (payload.status.signal >= 0) {
                    sig = 'low';
                } else {
                    sig = 'offline';
                }

                html +=
                    `<span class="text signal ${sig}">` +
                    `<i class="ri-base-station-line"></i> ${payload.status.signal}` +
                    '</span>';
            }

            $elm.html(html).show();
        } else {
            $elm.hide();
        }
    }
}

export default { Video };
