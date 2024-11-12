import { EventDispatcher } from "./EventDispatcher.js";

export class Video {
    constructor() {
        // events dispatcher
        EventDispatcher.attach(this);

        this.$element = $("#video-grid");
        this.videoSources = [];

        this.getVideoSources();
        //this.initStream();
    }

    getVideoSources() {
        //const self = this;

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

                // apply grid
                this.$element.addClass("grid" + cols + "x" + rows);

                $.each(data, (index, video) => {
                    // dom id
                    video.dom = "video_" + index;

                    // dom reference
                    video.$dom = $(video.dom);

                    // store information about the video source
                    this.videoSources.push(video);

                    // append html to the video matrix
                    this.$element.append(`
                        <div class="video-wrapper d2-flex flex2-column justif2-content-center">
                            <video id="${video.dom}" 
                                controls="" 
                                poster=""
                                autoplay2 
                                muted2 
                                preload="auto">
                                <source src="${video.source}" type="video/mp4">
                            </video>
                        </div>
                    `);

                    //if ((index + 1) % rows === 0) {
                    //    this.$element.append('<div class="w-100"></div>');
                    //}
                });

                this.emit("videos_added");
            })
            .fail(function (jqXHR, textStatus, errorThrown) {
                console.log(textStatus);
            });
    }

    initStream() {
        $.each(this.videoSources, (index, video) => {
            console.log(video);
            video.$dom.get(0).autoplay = true;
            video.$dom.get(0).play();
        });
    }
}

export default { Video };
