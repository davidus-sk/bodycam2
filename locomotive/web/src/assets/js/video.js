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

            for (const cameraId in cameras) {
                const val = cameras[cameraId];

                if (val) {
                    val.terminate();
                }
            }
        };

        // debug
        if (this.debugMode === true && typeof console != 'undefined') {
            this.debug = console.log.bind(console);
        } else {
            this.debug = function (message) {};
        }

        this.colorReceived = 'background-color:#540101;color:#dbe2ff;font-weight:500';

        // regex map
        const cameraIdPattern = 'device-[0-9a-fA-F]{16}';
        this.topicRegex['device_status'] = new RegExp(`^device\/${cameraIdPattern}\/status$`);
        this.topicRegex['device_gps'] = new RegExp(`^device\/${cameraIdPattern}\/gps$`);

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
        // mqtt
        this.mqttClient = this.app?.getMqttClient();
        if (this.mqttClient) {
            this.mqttClient.on('connect', () => this.mqttConnected());
            this.mqttClient.on('disconnect', () => this.mqttDisconnected());
        }
    }

    mqttConnected() {
        this.mqttClientId = this.mqttClient.clientId;

        // received camera status
        this.mqttClient.subscribe('device/+/status');

        this.debug('[mqtt_service] subscribe: device/+/status');

        // got the message
        this.mqttClient.on('message', (topic, message) => {
            let payload = message?.toString() ?? null;
            //this.debug('e: message', topic, payload.substring(0, 50) + '...');
            payload = JSON.parse(payload);

            if (payload) {
                // camera status
                if (topic.match(this.topicRegex['device_status'])) {
                    this.receivedCameraStatus(payload);
                }
            }
        });

        this.mqttClient.on('publish', (topic, message) => {
            //console.log('!: mqtt publish: -->', topic, message);
        });
    }

    mqttDisconnected() {
        console.log('e: mqtt disconnected');

        this.mqttClientId = undefined;
    }

    attach(videoElement, uuid) {
        this.videoRefs[uuid] = videoElement;
    }

    receivedCameraStatus(payload) {
        const cameraId = payload.device_id;

        this.debug('[mqtt_service] message: %cdevice/+/status', this.colorReceived, payload);

        // camera is already in reference list, check time
        if (this.isCameraInGrid(cameraId)) {
            this.debug('[video] camera already in the grid');
            //this.getCameraData(cameraId)?.picamera?.restart();
            //return;
            //const cameraStatus = this.getCameraStatus();

            if (!this.isCameraConnected(cameraId)) {
                this.debug('[video] camera is not connected - reconnect');
                //this.getCameraData(cameraId)?.picamera?.connect();
            } else {
                this.debug('[video] camera connected - all ok');
            }

            //const now = Math.round(new Date() / 1000);
            //if (now - this.cameras[cameraId].ts )
        } else {
            this.debug('[video] new camera');

            // save reference
            //this.cameras[cameraId] = payload;
            this.updateCameraData(cameraId, payload);

            this.updateGrid(payload);
            this.initPiCamera(cameraId, true);
            //this.demoMp4(cameraId, true);
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
        const cameraId = camera.device_id ?? null;

        let className = 'grid-1x1';

        switch (cameraCount) {
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

        // set grid class
        // this.$element
        //     .removeClass(function (index, className) {
        //         return (className.match(/\bgrid-[\d]x[\d]\b/g) || []).join(' ');
        //     })
        //     .addClass(className);
        this.$element.attr('class', className);

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

    demoMp4(cameraId, autoplay) {
        const mp4 = {
            'device-0000000000000001': 'http://localhost/static/video2.mp4',
            'device-100000003a0a2f6e': 'http://localhost/static/video3.mp4',
            'device-00000000b203ade4': 'http://localhost/static/video1.mp4',
            'device-0000000000000002': 'http://localhost/static/video4.mp4',
        };

        const elementId = '#video_' + cameraId;
        const $video = $(elementId);
        const video = $video.get(0);

        video.pause();
        $video.attr('loop', 1).html('<source src="' + mp4[cameraId] + '" />');
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
