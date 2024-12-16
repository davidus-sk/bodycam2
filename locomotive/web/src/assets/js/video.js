import { getTimestamp, worker } from './functions.js';
import { EventDispatcher } from './EventDispatcher.js';
import { PiCamera } from './rtc/picamera.js';

export class Video {
    options = {};

    _devices = {};
    debugMode = true;

    VIDEO_TIMEOUT = 120;

    mqttClient = null;
    topicRegex = {};

    constructor(options, app) {
        this.options = this.initializeOptions(options);
        this.app = app;

        // events dispatcher
        EventDispatcher.attach(this);

        // attach events
        window.onbeforeunload = function () {
            console.log('e: window reload');

            for (const deviceId in this._devices) {
                const val = this._devices[deviceId];

                if (val && val.picamera) {
                    val.picamera.terminate();
                }
            }
        };

        // debug
        if (this.debugMode === true && typeof console != 'undefined') {
            this.debug = console.log.bind(console);
        } else {
            this.debug = function (message) {};
        }

        // dom elements
        this.$grid = $('#video-grid');

        // local variables
        this.colorReceived = 'background-color:#540101;color:#dbe2ff;font-weight:500';

        // regex map
        const deviceIdPattern = 'device-[0-9a-fA-F]{16}';
        this.topicRegex['device_status'] = new RegExp(`^device\/${deviceIdPattern}\/status$`);
        this.topicRegex['device_gps'] = new RegExp(`^device\/${deviceIdPattern}\/gps$`);

        // mqtt
        this.initMqtt();

        // init workers
        this.initWorkers();
    }

    initializeOptions(userOptions) {
        const defaultOptions = {
            debug: false,
        };

        return { ...defaultOptions, ...userOptions };
    }

    initMqtt() {
        // mqtt
        this.mqttClient = this.app?.getMqttClient();
        if (this.mqttClient) {
            this.mqttClient.on('connect', () => this.mqttConnected());
            this.mqttClient.on('disconnect', () => this.mqttDisconnected());
        }
    }

    mqttConnected() {
        this.mqttClientId = this.mqttClient.getClientId();

        this.debug('[video] mqtt connected');

        // received camera status
        this.debug('[video] subscribe: device/+/status');
        this.mqttClient.subscribe('device/+/status');

        // got the message
        this.mqttClient.on('message', (topic, message) => {
            let payload = message?.toString() ?? null;
            //this.debug('e: message', topic, payload.substring(0, 50) + '...');
            payload = JSON.parse(payload);

            if (payload) {
                // camera status
                if (topic.match(this.topicRegex['device_status'])) {
                    this.receivedDeviceStatus(payload);
                }
            }
        });
    }

    mqttDisconnected() {
        this.debug('[video] mqtt disconnected');
    }

    receivedDeviceStatus(payload) {
        const deviceId = payload.device_id ?? null;

        this.debug('[video] mqtt message: %cdevice/+/status', this.colorReceived, payload);

        if (deviceId && deviceId.length) {
            // camera is already in reference list, check time
            if (this.isDeviceInGrid(deviceId)) {
                //this.debug('[video] camera already in the grid');

                // update timestamp
                this._devices[deviceId].ts = payload.ts;
                this._devices[deviceId].status = payload.status;

                // device disconnected
                if (!this.isDeviceConnected(deviceId)) {
                    this.debug('[video] camera already in the grid - not connected - reconnect');
                    //this.getDeviceData(deviceId)?.picamera?.reconnect();

                    // device connected
                } else {
                }
            } else {
                this.debug('[video] new device');

                let device = payload;

                // dom id
                device.dom_id = 'device_' + deviceId;
                device.video_id = 'video_' + deviceId;

                // append html to the video matrix
                this.$grid.append(`<div id="${device.dom_id}" class="video-wrapper">
                        <video id="${device.video_id}" autoplay playsinline muted></video>
                    </div>`);

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
                this.initPiCamera(deviceId, true);
                //this.demoMp4(deviceId, true);
            }
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

    initPiCamera(deviceId, connect) {
        var camera = this.getDeviceData(deviceId);

        if (camera) {
            // pi camera
            camera.picamera = new PiCamera(deviceId, this.options.camera, null, this.mqttClient);

            // attach video reference to the camera
            camera.picamera.attach(camera.video_ref);

            // connect
            if (connect === true) {
                camera.picamera.connect();
            }

            // update reference
            this._devices[deviceId] = camera;
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
                        this.debug('[video] removing device from the grid ... delta = ' + delta);

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
}

export default { Video };
