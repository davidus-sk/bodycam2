import { getTimestamp, worker, wait } from './functions.js';
import { EventDispatcher } from './EventDispatcher.js';
import { ConsoleColors } from './utils.js';
import { PiCamera } from './rtc/picamera.js';

export class Video {
    options = {};

    VIDEO_TIMEOUT = 120;

    mqtt = undefined;
    _devices = {};
    topicRegex = {};

    constructor(options, app) {
        this.options = this.initializeOptions(options);

        // events dispatcher
        EventDispatcher.attach(this);

        // attach events
        window.onbeforeunload = () => {
            console.log('[video] window reload');

            for (const deviceId in this._devices) {
                const val = this._devices[deviceId];

                if (val && val.picamera) {
                    val.picamera.terminate();
                }
            }
        };

        // debug
        if (
            (this.options.debug === true ||
                this.options.video.debug === true ||
                this.options.app.debug === true) &&
            typeof console != 'undefined'
        ) {
            this.debug = console.log.bind(console);
        } else {
            this.debug = function (message) {};
        }

        console.log(this.options);

        // dom elements
        this.$grid = $('#video-grid');

        // regex map
        const deviceIdPattern = 'device-[0-9a-fA-F]{16}';
        this.topicRegex['device_status'] = new RegExp(`^device\/${deviceIdPattern}\/status$`);
        this.topicRegex['device_gps'] = new RegExp(`^device\/${deviceIdPattern}\/gps$`);
        this.topicRegex['device_distance'] = new RegExp(`^device\/${deviceIdPattern}\/distance$`);

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
            this.debug('[video][mqtt] subscribe: device/#');
            this.mqtt.subscribe('device/#');

            // got the message
            this.mqtt.on('message', (topic, message) => {
                let payload = JSON.parse(message?.toString());
                if (payload) {
                    // camera status
                    if (topic.match(this.topicRegex['device_status'])) {
                        this.handleDeviceStatusMessage(payload);
                    }
                    // distance
                    if (topic.match(this.topicRegex['device_distance'])) {
                        this.handleDeviceDistanceMessage(payload);
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
            '[video][mqtt] %cmqtt message:',
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

            // device connected
            if (this.isDeviceConnected(deviceId)) {
                this.getDeviceData(deviceId)?.picamera?.setOptions(this._devices[deviceId]);

                // device disconnected
            } else {
                this.debug('[video] camera not connected - reconnect');

                // reconnect picamera
                this.getDeviceData(deviceId)?.picamera?.reconnect();
            }
        } else {
            this.debug('[video] %c!!! new device', ConsoleColors.red, deviceId);

            let device = payload;

            // dom id
            device.dom_id = 'device_' + deviceId;
            device.video_id = 'video_' + deviceId;

            // append html to the video matrix
            this.$grid.append(
                `<div id="${device.dom_id}" class="video-wrapper"><video id="${device.video_id}" autoplay playsinline muted></video></div>`
            );

            // video element reference
            device.video_ref = document.getElementById(device.video_id);

            // test
            // $(device.video_ref).on('contextmenu', e => {
            //     this.removeDevice(deviceId);
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
        let className = 'grid-1x1';

        switch (deviceCount) {
            case 1:
                className = 'grid-1x1';
                break;
            case 2:
                className = 'grid-2x1';
                break;
            case 3:
                className = 'grid-2x2 grid-2x2-1';
                break;
            case 4:
                className = 'grid-2x2';
                break;
            case 5:
                className = 'grid-2x3 grid-2x3-1';
                break;
            case 6:
                className = 'grid-2x3';
                break;
            case 7:
            case 8:
            case 9:
                className = 'grid-3x3';
                break;
        }

        this.$grid.attr('class', className);
    }

    removeDevice(deviceId) {
        if (this._devices[deviceId] !== undefined) {
            // picamera
            if (this._devices[deviceId].picamera) {
                this._devices[deviceId].picamera.terminate();
            }

            // dom
            $('#' + this._devices[deviceId].video_id).remove();
            $('#' + this._devices[deviceId].dom_id).remove();

            this._devices[deviceId] = null;
            delete this._devices[deviceId];
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
                        this.debug(
                            '[video] removing device from the grid - deviceId: ' +
                                deviceId +
                                ', delta: ' +
                                delta
                        );

                        this.removeDevice(device.device_id);
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
                fontSize: 16,
                color: '#ffc20c',
                bgColor: undefined,
            },
            ...options,
        };

        let $videoWrapper = $('#device_' + deviceId);
        if ($videoWrapper.length) {
            if (!$videoWrapper.find('.overlay-text').length) {
                // overlay not found

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

                $div.appendTo($videoWrapper);
                $div.css(css).show();
            } else {
                // update div
                $videoWrapper.find('.overlay-text .text').html(text);
            }
        }
    }

    hideOverlayText(deviceId) {
        $('#device_' + deviceId)
            .find('.overlay-text')
            .remove();
    }

    handleDeviceDistanceMessage(payload) {
        const deviceId = payload.device_id ?? null;

        this.debug(
            '[video][mqtt] %cmqtt message:',
            ConsoleColors.purple,
            'device/+/distance',
            payload
        );

        if (!deviceId || !deviceId.length) {
            return;
        }

        if (payload.peaks && Array.isArray(payload.peaks)) {
            const maxStrength = payload.peaks.reduce(
                (max, item) => (item.strength > (max?.strength ?? -Infinity) ? item : max),
                null
            );

            if (maxStrength) {
                // convert to feats
                let ft = maxStrength.distance_mm * 0.00328084;
                // round
                ft = Math.round(ft * 100) / 100;
                // show
                this.showOverlayText(deviceId, ft + ' ft');

                setTimeout(() => {
                    this.hideOverlayText(deviceId);
                }, 2000);
            }
        }
        //}
    }
}

export default { Video };
