import { generateClientId } from "./functions.js";
import { EventDispatcher } from "./EventDispatcher.js";
import { MqttClient } from "./mqtt/client.js";
import { PiCamera } from "./rtc/picamera.js";

export class Video {
    config = {};

    cameras = {};
    cameraRefs = {};
    videoRefs = {};
    vidConns = {};
    debugMode = true;

    mqttClient = null;
    topicRegex = {};

    constructor(config) {
        // events dispatcher
        EventDispatcher.attach(this);

        // merge config
        this.config = Object.assign(this.config, config);

        this.$element = $("#video-grid");
        this.videoSources = [];

        // attach events
        window.onbeforeunload = function () {
            if (this.mqttClient) {
                this.mqttClient.disconnect();
                this.mqttClient = null;
            }
        };

        // debug
        if (this.debugMode === true && typeof console != "undefined") {
            this.debug = console.log.bind(console);
        } else {
            this.debug = function (message) {};
        }

        this.colorReceived =
            "background-color:#540101;color:#dbe2ff;font-weight:500";

        // regex map
        const uuidRegex = "camera-[0-9a-fA-F]{16}";
        this.topicRegex["camera_status"] = new RegExp(
            `camera/${uuidRegex}/status`
        );
        this.topicRegex["camera_gps"] = new RegExp(`camera/${uuidRegex}/gps`);

        // mqtt
        this.initMqtt();
    }

    initMqtt() {
        // client id (required by picamera)
        const mqttClientId = generateClientId(23);
        //this.config.mqtt.clientId = mqttClientId;

        // init mqtt client
        this.mqttClient = new MqttClient(this.config.mqtt);

        // mqtt connected
        this.mqttClient.onConnect = async (conn) => {
            this.debug("e: mqtt connected");

            // received camera status
            conn.subscribe("camera/+/status");

            // got the message
            conn.on("message", (topic, msg) => {
                const payload = msg.toString();

                this.handleMessage(topic, payload);
            });
        };

        // mqtt disconnected
        this.mqttClient.onDisconnect = () => {
            this.debug("e: mqtt disconnected");
        };

        // mqtt connect
        this.mqttClient.connect();
    }

    attach(videoElement, uuid) {
        this.videoRefs[uuid] = videoElement;
    }

    handleMessage(topic, message) {
        this.debug("e: message", topic, message);

        // camera status
        if (topic.match(this.topicRegex["camera_status"])) {
            this.receivedCameraStatus(message);
        }
    }

    receivedCameraStatus(message) {
        const payload = JSON.parse(message);

        this.debug("m: <-- %ccamera/status:", this.colorReceived, payload);

        // store live cam data
        let updateGrid = true;
        // camera is already in reference list, check time
        if (this.isCameraInGrid(payload.camera_id)) {
            this.debug("camera already in grid");

            updateGrid = false;
            //const now = Math.round(new Date() / 1000);
            //if (now - this.cameras[payload.camera_id].ts )
        }

        if (updateGrid) {
            this.cameras[payload.camera_id] = payload;
            this.updateGrid(this.cameras[payload.camera_id]);
        }
    }

    isCameraInGrid(camera_id) {
        return this.cameras[camera_id] !== undefined;
    }

    updateGrid(camera) {
        const cameras = Object.values(this.cameras);
        const cameraCount = cameras.length;
        const cameraId = camera.camera_id ?? null;

        this.debug("cameraCount", cameraCount);

        let className = "grid-1x1";

        switch (cameraCount) {
            case 1:
                className = "grid-1x1";
                break;
            case 2:
                className = "grid-2x1";
                break;
            case 3:
            case 4:
                className = "grid-2x2";
                break;
            case 5:
            case 6:
                className = "grid-2x3";
                break;
            case 7:
            case 8:
            case 9:
                className = "grid-3x3";
                break;
        }

        // set grid class
        this.$element
            .removeClass(function (index, className) {
                return (className.match(/\bgrid-[\d]x[\d]\b/g) || []).join(" ");
            })
            .addClass(className);

        // dom id
        camera.dom_id = "camera_" + cameraId;
        camera.video_id = "video_" + cameraId;

        // append html to the video matrix
        this.$element.append(`
            <div id="${camera.dom_id}" class="video-wrapper">
                <video id="${camera.video_id}" autoplay playsinline muted></video>
            </div>
        `);

        // video element reference
        camera.video_ref = document.getElementById(camera.video_id);

        // pi camera
        camera.picamera = new PiCamera(
            cameraId,
            this.config.camera,
            this.config.mqtt,
            this.mqttClient
        );

        // attach video reference to the camera
        camera.picamera.attach(camera.video_ref);

        // connect
        camera.picamera.connect();

        // update reference
        this.cameras[cameraId] = camera;

        return;
        // init streams
        $.each(data, (index, video) => {
            // dom id
            video.dom = "video_" + video.uuid;

            // dom reference
            this.videoRefs[video.uuid] = document.getElementById(video.dom);

            // store information about the video source
            this.videoSources.push(video);

            // append stream uuid to the config
            this.config.camera.deviceUuid = video.uuid;

            // pi camera
            this.vidConns[index] = new PiCamera(
                this.config.camera,
                this.config.mqtt
            );

            // attach video reference to the camera
            this.vidConns[index].attach(this.videoRefs[video.uuid]);

            // connect to the stream
            this.vidConns[index].connect();
            // if (conn) {
            //     conn.terminate()
            // }
        });

        // emit event
        //this.emit("videos_added");
    }
}

export default { Video };
