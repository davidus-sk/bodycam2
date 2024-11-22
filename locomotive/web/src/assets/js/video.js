import { EventDispatcher } from "./EventDispatcher.js";
import { PiCamera } from "./rtc/picamera.js";

export class Video {
    config = {};
    videoRefs = {};
    vidConns = {};

    constructor(cfg) {
        // events dispatcher
        EventDispatcher.attach(this);

        // merge config
        this.config = Object.assign(this.config, cfg);

        this.$element = $("#video-grid");
        this.videoSources = [];

        this.getVideoSources();
        //this.initStream();
    }

    attach(videoElement, uuid) {
        this.videoRefs[uuid] = videoElement;
    }

    getVideoSources() {
        //const self = this;

        // fetch the video sources
        $.get("ajax/video_sources.php")
            .done((data) => {
                const videoCount = data.length;
                let cols = 1,
                    rows = 1;

                switch (videoCount) {
                    case 2:
                        cols = 2;
                        rows = 1;
                        break;
                    case 3:
                    case 4:
                        cols = 2;
                        rows = 2;

                        break;
                    case 5:
                    case 6:
                        cols = 2;
                        rows = 3;
                        break;
                    case 7:
                    case 8:
                    case 9:
                        cols = 3;
                        rows = 3;
                        break;
                }

                // set grid class
                this.$element.addClass("grid" + cols + "x" + rows);

                // init streams
                $.each(data, (index, video) => {
                    // dom id
                    video.dom = "video_" + video.uuid;

                    // append html to the video matrix
                    this.$element.append(`
                        <div class="video-wrapper">
                            <video id="${video.dom}" playsinline autoplay muted></video>
                        </div>
                    `);

                    // dom reference
                    this.videoRefs[video.uuid] = document.getElementById(
                        video.dom
                    );

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
                this.emit("videos_added");
            })
            .fail(function (jqXHR, textStatus, errorThrown) {
                console.log(textStatus);
            });
    }

    initStream() {
        $.each(this.videoSources, (index, video) => {
            video.$dom.get(0).autoplay = true;
            video.$dom.get(0).play();
        });
    }
}

export default { Video };
