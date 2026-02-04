import { getTimestamp, worker, wait } from './functions.js';
import { EventDispatcher } from './EventDispatcher.js';
import { ConsoleColors } from './utils.js';
import { PiCamera } from './rtc/picamera.js';

export class Video {
    options = {};

    VIDEO_TIMEOUT = 30;

    mqtt = undefined;
    topicRegex = {};
    orientation = 'landscape';

    constructor(options, app) {
        this.options = this.initializeOptions(options);

        // local variables
        this._devices = new Map();

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

        // dom elements
        this.$content = $('#content');
        this.$grid = $('#video-grid');

        // regex map
        const deviceIdPattern = '[0-9a-zA-Z\-\_]+';
        this.topicRegex['device_status'] = new RegExp(`^device\/${deviceIdPattern}\/status$`);
        this.topicRegex['device_gps'] = new RegExp(`^device\/${deviceIdPattern}\/gps$`);
        this.topicRegex['device_distance'] = new RegExp(`^device\/${deviceIdPattern}\/distance$`);
        this.topicRegex['device_osd'] = new RegExp(`^device\/${deviceIdPattern}\/osd$`);

        // attach events
        window.onbeforeunload = () => {
            this.debug('[video] window reload');

            for (const [_, device] of this._devices) {
                if (device && device.picamera) {
                    device.picamera.terminate();
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
            // received camera status
            this.debug('[video] %s | mqtt subscribe: device/#', this.mqtt.clientId);
            this.mqtt.subscribe('device/#');

            // got the message
            this.mqtt.on('message', (topic, message) => {
                let payload;
                try {
                    payload = JSON.parse(message?.toString());
                } catch (e) {
                    this.debug(
                        '[video] %s | %cerror -> topic: %s - message parsing error: %s',
                        this.mqtt.clientId,
                        ConsoleColors.error,
                        topic,
                        e
                    );
                }

                if (payload) {
                    // camera status
                    if (this.topicRegex['device_status'].test(topic)) {
                        this.handleDeviceStatusMessage(topic, payload);
                    }
                    // distance
                    if (this.topicRegex['device_distance'].test(topic)) {
                        this.handleDeviceDistanceMessage(topic, payload);
                    }
                    // network
                    if (this.topicRegex['device_osd'].test(topic)) {
                        this.handleDeviceOsdMessage(topic, payload);
                    }
                }
            });
        }
    }

    mqttDisconnected() {
        this.debug('[video] %s | mqtt disconnected', this.mqtt?.clientId);
    }

    handleDeviceStatusMessage(topic, payload) {
        const deviceId = payload.device_id ?? null;

        if (!deviceId || !deviceId.length) {
            this.debug(
                '[video] %cstatus - ' + topic,
                ConsoleColors.error,
                'unknown deviceId - ignoring'
            );
            return;
        }

        this.debug('[video] %s | status - %s', deviceId, topic);

        // get device data (only if is already in the video grid)
        const device = this.getDeviceData(deviceId);

        // camera is in the grid
        if (device) {
            //this.debug('[video] %s | the camera is already in the grid', deviceId);

            // update device data
            device.ts = payload.ts;
            device.status = payload.status;
            device.ai = payload.ai === true;

            const cam = device?.picamera;
            const isConnected = this.isDeviceConnected(deviceId);
            const status = this.getCameraStatus(deviceId);

            // this.debug(
            //     '[video] %s |  ^ - connected: %s (status: %s)',
            //     deviceId,
            //     isConnected ? 'yes' : 'no',
            //     status
            // );

            // device connected
            if (isConnected) {
                if (cam) {
                    cam.setOptions(device);
                    //cam.aiStatus(this._devices[deviceId].ai);
                }

                // device disconnected
            } else {
                // reconnect picamera only if not already connecting
                if (cam && ['connecting'].indexOf(status) === -1) {
                    this.debug('[video] %s | %creconnecting', deviceId, ConsoleColors.yellow);
                    this.showOverlayText(deviceId, 'status_text', 'Connecting');
                    cam.reconnect();
                }
            }
        } else {
            this.debug('[video] %s | %cnew device connected', deviceId, ConsoleColors.turquoise);

            let device = payload;

            // additional info
            device.dom_id = 'device_' + deviceId;
            device.video_id = 'video_' + deviceId;
            device.overlays = new Map();

            // store reference
            this._devices.set(deviceId, device);

            // append html to the video matrix
            // prettier-ignore
            this.$grid.append(
                `<div id="${device.dom_id}" class="video-wrapper" data-device-id="${deviceId}">`
                    + `<video id="${device.video_id}" autoplay playsinline muted></video>`
                    + '<div class="osd">'
                        + `<span id="${device.dom_id}_hw" class="hw-status"></span>`
                    + '</div>'
                    + '<div class="overlay-wrapper"></div>'
                + '</div>'
            );

            // video element reference
            device.video_ref = document.getElementById(device.video_id);

            // update grid
            this.updateGrid();

            // test
            // $(device.video_ref).on('contextmenu', e => {
            //     this.removeDeviceFromGrid(deviceId);
            // });

            // demo video
            if (
                [
                    '000000000000100',
                    '000000000000101',
                    '000000000000102',
                    '000000000000100',
                ].indexOf(deviceId) !== -1
            ) {
                this.demoMp4(deviceId, true);
            } else {
                // init pi camera
                this.initPiCamera(deviceId, true, {
                    ai: device.ai,
                });

                this.showOverlayText(deviceId, 'status_text', 'Connecting');
            }

            // events
            $('#' + device.dom_id)
                .hammer()
                .bind('doubletap', (evt, touch) => {
                    const $elm = $(evt.target);
                    const _deviceId = $elm.attr('data-device-id') || false;

                    if (_deviceId) {
                        $elm.toggleClass('fullscreen');
                        // const _device = this.getDeviceData(_deviceId);

                        // if (_device && _device.picamera) {
                        //     _device.picamera.setEnabledStatus(false);
                        // }
                    }
                });
        }
    }

    getDeviceData(deviceId) {
        return this._devices.get(deviceId);
    }

    isDeviceInGrid(deviceId) {
        return this._devices.has(deviceId) && this._devices.get(deviceId) !== undefined;
    }

    isDeviceConnected(deviceId) {
        const d = this.getDeviceData(deviceId);
        return d && d.picamera ? d.picamera.isConnected() : false;
    }

    getCameraStatus(deviceId) {
        const device = this._devices.get(deviceId);
        return device && device.picamera ? device.picamera.getStatus() : 'unknown';
    }

    initPiCamera(deviceId, connect, options) {
        const device = this.getDeviceData(deviceId);
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

            // events
            device.picamera.onConnectionState = state => {
                //this.debug('[video] %s | onConnectionState: %s', deviceId, state);

                switch (state) {
                    case 'connecting':
                        this.showOverlayText(deviceId, 'status_text', 'Connecting');
                        break;
                    case 'closed':
                    case 'connected':
                        this.hideOverlayText(deviceId, 'status_text');
                        break;
                }
            };
        }
    }

    updateGrid() {
        let className = 'grid-' + this.orientation + ' grid-' + this._devices.size;
        this.$grid.attr('class', className);
    }

    removeDeviceFromGrid(deviceId) {
        const device = this.getDeviceData(deviceId);

        if (device) {
            // overlays
            this.hideOverlayText(deviceId);

            // picamera
            if (device.picamera) {
                device.picamera.terminate();
            }

            // dom
            $('#' + device.video_id).remove();
            $('#' + device.dom_id).remove();

            // delete reference
            this._devices.delete(deviceId);
        }

        this.updateGrid();
    }

    initWorkers() {
        worker('video_grid', 5000, () => {
            let now = getTimestamp();
            for (const [deviceId, device] of this._devices) {
                if (device) {
                    if (device.ts) {
                        const delta = now - device.ts;

                        // remove old map object
                        if (delta > this.VIDEO_TIMEOUT) {
                            this.debug(
                                '[video] %s | removing device from the grid (no /status message received more than %ss)',
                                deviceId || '???',
                                this.VIDEO_TIMEOUT
                            );

                            this.removeDeviceFromGrid(device.device_id);
                        }
                    }

                    // overlays
                    if (device.overlays.size) {
                        for (const [id, o] of device.overlays) {
                            if (typeof o.timeout !== 'number' || o.timeout === 0) continue;

                            if (now - o._time > o.timeout) {
                                this.hideOverlayText(o.deviceId, o.overlayId);
                            }
                        }
                    }
                }
            }
        });
    }

    demoMp4(deviceId, autoplay) {
        const mp4 = {
            '000000000000100': 'http://localhost/static/video1.mp4',
            '000000000000101': 'http://localhost/static/video2.mp4',
            '000000000000102': 'http://localhost/static/video3.mp4',
            '000000000000103': 'http://localhost/static/video4.mp4',
        };

        this.showOverlayText(deviceId, 'status_text', 'Connecting');

        setTimeout(() => {
            this.hideOverlayText(deviceId, 'status_text');

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
        }, 1000);
    }

    showOverlayText(deviceId, overlayId, text, options) {
        const device = this._devices.get(deviceId);

        if (!device || !overlayId || overlayId === '') {
            return;
        }

        if (!options || typeof options !== 'object') {
            options = {};
        }

        const defaults = {
            deviceId: deviceId,
            overlayId: overlayId,
            element: undefined,
            x: 'center',
            y: 'center',
            padding: 15,
            class: undefined,
            fontSize: undefined,
            color: undefined,
            bgColor: undefined,
            text: undefined,
            timeout: false,
        };

        // reference id
        const ref = deviceId + '_' + overlayId;

        // data
        const overlay = device.overlays.get(ref);

        // overlay wrapper
        const $wrapper = $('#device_' + deviceId + ' .overlay-wrapper');

        // css class
        let cssClass = null;
        if (options.class) {
            cssClass = options.class;
            delete options.class;
        }

        let opt;
        if (overlay === undefined) {
            // new overlay
            opt = { ...defaults, ...options };

            // reference
            opt.element = $('<div class="overlay-text ' + cssClass + '">' + text + '</div>');

            // update dom
            opt.element.appendTo($wrapper);
            $wrapper.css('display', 'block');
        } else {
            // update
            opt = { ...overlay, ...options };
        }

        let css = {};

        if (opt.color) {
            css.color = opt.color;
        }

        if (opt.bgColor) {
            css.backgroundColor = opt.bgColor;
        }

        if (opt.fontSize) {
            css.fontSize = opt.fontSize;
        }

        // props
        opt.text = text;
        opt._time = getTimestamp();

        // store reference
        device.overlays.set(ref, opt);

        // text
        const $text = opt.element;
        $text.html(opt.text).css({ width: 'auto' });

        if (opt.x === 'left') {
            css.left = opt.padding;
        } else if (opt.x === 'right') {
            css.right = opt.padding;
        } else if (opt.x === 'center') {
            let w = Math.round($text.outerWidth()) + 4;
            css.width = w;
            css.left = '50%';
            css.marginLeft = '-' + w / 2 + 'px';
        } else {
            css.marginLeft = parseInt(opt.x);
        }

        if (opt.y === 'top') {
            css.top = opt.padding;
        } else if (opt.y === 'bottom') {
            css.bottom = opt.padding;
        } else if (opt.y === 'center') {
            const h = $text.innerHeight();
            css.top = '50%';
            css.marginTop = '-' + h / 2 + 'px';
        } else {
            css.top = parseInt(opt.y);
        }

        // apply styles + show
        $text.css(css);
    }

    hideOverlayText(deviceId, overlayId) {
        const device = this._devices.get(deviceId);

        if (!device) {
            return;
        }

        if (overlayId === undefined) {
            // remove all device overlays
            for (const [ref, o] of device.overlays) {
                if (ref.startsWith(deviceId + '_')) {
                    if (o.element) {
                        o.element.remove();
                    }

                    device.overlays.delete(ref);
                }
            }
        } else {
            // remove single overlay
            let ref = deviceId + '_' + overlayId;
            const o = device.overlays.get(ref);

            if (o && o.element) {
                o.element.remove();
            }

            device.overlays.delete(ref);
        }
    }

    handleDeviceDistanceMessage(topic, payload) {
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
            this.showOverlayText(deviceId, 'distance', ft + ' ft', {
                timeout: 5,
                class: 'text-distance',
                x: 'center',
                y: 'top',
            });
        }
    }

    handleDeviceOsdMessage(topic, payload) {
        const deviceId = payload.device_id ?? null;

        this.debug('[video][mqtt] %s | message:', deviceId || '???', 'device/+/osd', payload);

        if (!deviceId || !deviceId.length || !this.isDeviceInGrid(deviceId)) {
            return;
        }

        const domId = `device_${deviceId}_hw`,
            $elm = $('#' + domId);

        // show
        if (typeof payload.status !== 'undefined') {
            let html = '';

            // Battery
            if (typeof payload.status.battery !== 'undefined') {
                let bat, batClass;
                if (payload.status.battery >= 85) {
                    bat = '<i class="ri-battery-fill"></i>';
                    batClass = 'high';
                } else if (payload.status.battery >= 35) {
                    bat = '<i class="ri-battery-low-line"></i>';
                    batClass = 'medium';
                } else {
                    bat = '<i class="ri-battery-line"></i>';
                    batClass = 'low';
                }

                html += `<span class="text battery ${batClass}">${bat} ${payload.status.battery}%</span>`;
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
