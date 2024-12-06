import { generateClientId } from './functions.js';
import { EventDispatcher } from './EventDispatcher.js';
import { MqttClient } from './mqtt/client.js';
import { PiCamera } from './rtc/picamera.js';

export class Video {
    options = {};

    cameras = {};
    cameraRefs = {};
    videoRefs = {};
    vidConns = {};
    debugMode = true;

    mqttClient = null;
    topicRegex = {};

    constructor(options, app) {
        this.options = this.initializeOptions(options);
        this.app = app;

        // events dispatcher
        EventDispatcher.attach(this);

        this.$element = $('#video-grid');
        this.videoSources = [];

        // attach events
        window.onbeforeunload = function () {
            console.log('e: window reload');
        };

        // debug
        if (this.debugMode === true && typeof console != 'undefined') {
            this.debug = console.log.bind(console);
        } else {
            this.debug = function (message) {};
        }

        this.colorReceived = 'background-color:#540101;color:#dbe2ff;font-weight:500';

        // regex map
        const uuidRegex = 'camera-[0-9a-fA-F]{16}';
        this.topicRegex['camera_status'] = new RegExp(`camera/${uuidRegex}/status`);
        this.topicRegex['camera_gps'] = new RegExp(`camera/${uuidRegex}/gps`);

        // mqtt
        this.initMqtt();
    }

    initializeOptions(userOptions) {
        const defaultOptions = {
            debug: false,
        };

        return { ...defaultOptions, ...userOptions };
    }

    initMqtt() {
        // client id (required by picamera)
        //const mqttClientId = generateClientId(23);
        //this.options.mqtt.clientId = mqttClientId;

        // init mqtt client
        // this.mqttClient = new MqttClient({
        //     ...this.options.mqtt,
        //     ...{
        //         debug: this.options.debug,
        //     },
        // });

        // mqtt
        this.mqttClient = this.app?.getMqttClient();
        if (this.mqttClient) {
            this.mqttClient.on('connect', () => this.mqttConnected());
            this.mqttClient.on('disconnect', () => this.mqttDisconnected());
        }
    }

    mqttConnected() {
        this.debug('e: mqtt connected');

        // received camera status
        this.mqttClient.subscribe('camera/+/status');

        // got the message
        this.mqttClient.on('message', (topic, message) => {
            const payload = message?.toString() ?? null;

            if (topic && payload) {
                this.handleMessage(topic, payload);
            }
        });
    }

    mqttDisconnected() {
        console.log('e: mqtt disconnected');
    }

    attach(videoElement, uuid) {
        this.videoRefs[uuid] = videoElement;
    }

    handleMessage(topic, message) {
        this.debug('e: message', topic, message);

        // camera status
        if (topic.match(this.topicRegex['camera_status'])) {
            this.receivedCameraStatus(message);
        }
    }

    receivedCameraStatus(message) {
        const payload = JSON.parse(message);
        const cameraId = payload.camera_id;

        this.debug('m: <-- %ccamera/status:', this.colorReceived, payload);

        // camera is already in reference list, check time
        if (this.isCameraInGrid(cameraId)) {
            this.debug('! camera already in grid');
            //this.getCameraData(cameraId)?.picamera?.restart();
            //return;
            //const cameraStatus = this.getCameraStatus();

            if (!this.isCameraConnected(cameraId)) {
                this.debug('! camera is not connected - reconnect');
                //this.getCameraData(cameraId)?.picamera?.connect();
            } else {
                this.debug('! camera connected - all ok');
            }

            //const now = Math.round(new Date() / 1000);
            //if (now - this.cameras[cameraId].ts )
        } else {
            this.debug('! new camera');

            // save reference
            //this.cameras[cameraId] = payload;
            this.updateCameraData(cameraId, payload);

            this.updateGrid(payload);
            this.initPiCamera(cameraId, true);
        }
    }

    getCameraData(cameraId) {
        return this.cameras[cameraId] || null;
    }

    updateCameraData(cameraId, data) {
        this.cameras[cameraId] = data;
    }

    isCameraInGrid(cameraId) {
        return this.getCameraData(cameraId) !== null;
    }

    isCameraConnected(cameraId) {
        return this.getCameraData(cameraId)?.picamera?.isConnected();
    }

    getCameraStatus(cameraId) {
        return this.getCameraData(cameraId)?.picamera?.getStatus() || 'unknown';
    }

    initPiCamera(cameraId, connect) {
        let camera = this.getCameraData(cameraId);

        if (camera) {
            // pi camera
            camera.picamera = new PiCamera(cameraId, this.options.camera, null, this.mqttClient);

            // attach video reference to the camera
            camera.picamera.attach(camera.video_ref);

            // connect
            if (connect === true) {
                camera.picamera.connect();
            }

            // update reference
            this.updateCameraData(cameraId, camera);
        }
    }

    updateGrid(camera) {
        const cameras = Object.values(this.cameras);
        const cameraCount = cameras.length;
        const cameraId = camera.camera_id ?? null;

        this.debug('cameraCount', cameraCount);

        let className = 'grid-1x1';

        switch (cameraCount) {
            case 1:
                className = 'grid-1x1';
                break;
            case 2:
                className = 'grid-2x1';
                break;
            case 3:
            case 4:
                className = 'grid-2x2';
                break;
            case 5:
            case 6:
                className = 'grid-2x3';
                break;
            case 7:
            case 8:
            case 9:
                className = 'grid-3x3';
                break;
        }

        // set grid class
        this.$element
            .removeClass(function (index, className) {
                return (className.match(/\bgrid-[\d]x[\d]\b/g) || []).join(' ');
            })
            .addClass(className);

        // dom id
        camera.dom_id = 'camera_' + cameraId;
        camera.video_id = 'video_' + cameraId;

        // append html to the video matrix
        this.$element.append(`
            <div id="${camera.dom_id}" class="video-wrapper">
                <video id="${camera.video_id}" autoplay playsinline muted></video>
            </div>
        `);

        // video element reference
        camera.video_ref = document.getElementById(camera.video_id);

        // update reference
        this.cameras[cameraId] = camera;
    }
}

export default { Video };
