export function init() {}

export function cleanStream() {
    // it returns the actual transform function
    return function transform(frame, controller) {
        // for now, let's queue the current video frame
        controller.enqueue(frame);
    };
}

const randomColor = () => `hsl(${~~(360 * Math.random())}, 100%, 40%)`;

// function that creates a processed track
// it receives a track and a transform function
export function createProcessedTrack({ track, transform }) {
    // create MediaStreamTrackProcessor and MediaStreamTrackGenerator objects
    const processor = new MediaStreamTrackProcessor({ track: track });
    const generator = new MediaStreamTrackGenerator({ kind: 'video' });

    // create the transformer object passing the transform function
    const transformer = new TransformStream({ transform });

    // connecting all together
    processor.readable.pipeThrough(transformer).pipeTo(generator.writable);

    // returning the resulting track
    return generator;
}

// a customizable transform function factory for adding text
// let's add some default values
export function addText(text, options) {
    if (!options || typeof options !== 'object') {
        options = {};
    }

    let opt = {
        ...{
            x: 'right',
            y: 'bottom',
            padding: 20,
            color: 'white',
            fontSize: '14px',
            fontWeight: 'bold',
            fontFamily: 'Arial',
            bgColor: undefined,
            bgPadding: 10,
        },
        ...options,
    };

    // an ofscreencanvas for drawing video frame and text
    const canvas = new OffscreenCanvas(1, 1);
    const ctx = canvas.getContext('2d');

    // the transform function
    return function transform(frame, controller) {
        // set canvas size same as the video frame
        const width = frame.displayWidth;
        const height = frame.displayHeight;
        canvas.width = width;
        canvas.height = height;

        if (!text.length) {
            text = new Date().toLocaleString();
        }

        ctx.clearRect(0, 0, width, height);

        // set font style
        ctx.font = opt.fontWeight + ' ' + opt.fontSize + ' ' + opt.fontFamily;

        // some values for text size and x position in the canvas
        const textSize = ctx.measureText(text);
        let fontHeight = textSize.actualBoundingBoxAscent + textSize.actualBoundingBoxDescent;

        let x, y;

        if (opt.x === 'left') {
            x = opt.padding;
            ctx.textAlign = 'start';
        } else if (opt.x === 'right') {
            x = width - textSize.width - opt.padding;
            ctx.textAlign = 'end';
        } else if (x === 'center') {
            x = width / 2;
            ctx.textAlign = 'center';
        } else {
            x = parseInt(opt.x);
        }

        if (opt.y === 'top') {
            y = opt.padding;
            ctx.textBaseline = 'top';
        } else if (opt.y === 'bottom') {
            y = height - opt.padding;
            ctx.textBaseline = 'bottom';
        } else if (opt.y === 'center') {
            y = height / 2 - fontHeight / 2;
            ctx.textBaseline = 'middle';
        } else {
            y = parseInt(opt.y);
        }

        // determine position of the text based on the params
        const bgHWidth = textSize.width + opt.bgPadding;
        const bgHeight = fontHeight + opt.bgPadding;

        ctx.drawImage(frame, 0, 0, width, height);

        if (opt.bgColor) {
            ctx.fillStyle = opt.bgColor;
            ctx.fillRect(x, y, bgHWidth, bgHeight);
        }

        ctx.fillStyle = opt.color;
        ctx.fillText(text, x, y);

        // create a new frame based on the content of the canvas
        const newFrame = new VideoFrame(canvas, { timestamp: frame.timestamp });

        // close the current frame
        frame.close();

        // enqueue the new one
        controller.enqueue(newFrame);
    };
}

// a customizable transform function factory for adding text
// let's add some default values
export function detectPersons({ stream }) {
    // an offscreencanvas for drawing video frame and text
    const canvas = new OffscreenCanvas(1, 1);
    const ctx = canvas.getContext('2d');

    // Start detecting poses in the webcam video
    let predictions = [];
    let poses = [];

    let net;
    let model;
    let detector;

    const modelLoaded = function (m) {
        model = m;
    };

    // #ffffff - White
    // #800000 - Maroon
    // #469990 - Malachite
    // #e6194b - Crimson
    // #42d4f4 - Picton Blue
    // #fabed4 - Cupid
    // #aaffc3 - Mint Green
    // #9a6324 - Kumera
    // #000075 - Navy Blue
    // #f58231 - Jaffa
    // #4363d8 - Royal Blue
    // #ffd8b1 - Caramel
    // #dcbeff - Mauve
    // #808000 - Olive
    // #ffe119 - Candlelight
    // #911eb4 - Seance
    // #bfef45 - Inchworm
    // #f032e6 - Razzle Dazzle Rose
    // #3cb44b - Chateau Green
    // #a9a9a9 - Silver Chalice
    const COLOR_PALETTE = [
        '#ffffff',
        '#800000',
        '#469990',
        '#e6194b',
        '#42d4f4',
        '#fabed4',
        '#aaffc3',
        '#9a6324',
        '#000075',
        '#f58231',
        '#4363d8',
        '#ffd8b1',
        '#dcbeff',
        '#808000',
        '#ffe119',
        '#911eb4',
        '#bfef45',
        '#f032e6',
        '#3cb44b',
        '#a9a9a9',
    ];

    const predictWebcam = async () => {
        // model.classify(stream).then(predictions => {
        //     console.log('Predictions: ');
        //     console.log(predictions);
        // });

        // await model.detect(stream).then(data => {
        //     //console.log('Predictions: ', predictions);
        //     predictions = data;
        // });

        if (net) {
            net.estimateMultiplePoses(stream).then(data => {
                poses = data;
                //poses = poses.filter(item => item.score > 0.5);
            });
        }
    };

    /**
     * Draw the skeleton of a body on the video.
     * @param keypoints A list of keypoints.
     */
    const drawSkeleton = function (ctx, keypoints, poseId) {
        // Each poseId is mapped to a color in the color palette.
        const color = COLOR_PALETTE[poseId % 20];

        ctx.fillStyle = color;
        ctx.strokeStyle = color;
        ctx.lineWidth = 2;

        //const mod = poseDetection.SupportedModels.PoseNet;
        const mod = posedetection.SupportedModels.MoveNet;
        //const mod = posedetection.SupportedModels.BlazePose;

        net.util.getAdjacentPairs(mod).forEach(([i, j]) => {
            const kp1 = keypoints[i];
            const kp2 = keypoints[j];

            // If score is null, just show the keypoint.
            const score1 = kp1.score != null ? kp1.score : 1;
            const score2 = kp2.score != null ? kp2.score : 1;
            const scoreThreshold = 0.3;

            if (score1 >= scoreThreshold && score2 >= scoreThreshold) {
                ctx.beginPath();
                ctx.moveTo(kp1.x, kp1.y);
                ctx.lineTo(kp2.x, kp2.y);
                ctx.stroke();
            }
        });
    };

    // Load the model.
    //cocoSsd.load({ base: 'lite_mobilenet_v2' }).then(modelLoaded);
    //mobilenet.load().then(modelLoaded);

    posenet.load().then(function (data) {
        net = data;
    });

    // the transform function
    return async function transform(frame, controller) {
        // set canvas size same as the video frame
        const width = frame.displayWidth;
        const height = frame.displayHeight;
        canvas.width = width;
        canvas.height = height;

        // let's draw!
        //ctx.clearRect(0, 0, width, height);
        ctx.drawImage(frame, 0, 0, width, height);

        if (model || net) {
            predictWebcam();

            if (poses) {
                for (const pose of poses) {
                    drawResult(ctx, pose);
                }
            }

            if (predictions.length) {
                // Draw the skeleton connections
                for (let i = 0; i < predictions.length; i++) {
                    let prediction = predictions[i];
                    if (prediction.score > 0.5) {
                        let x = prediction.bbox[0];
                        let y = prediction.bbox[1];
                        let width = prediction.bbox[2];
                        let height = prediction.bbox[3];

                        // draws a rect with top-left corner of (x, y)

                        ctx.lineWidth = 2;
                        ctx.strokeStyle = 'rgb(255, 0, 0)';
                        ctx.strokeRect(x, y, width, height);

                        ctx.fillStyle = 'black';
                        ctx.fillRect(x, y - 10, 100, 20);
                        ctx.fillStyle = 'rgb(255, 255, 255)';
                        ctx.fillText(prediction.class, x, y);

                        ctx.fillStyle = 'black';
                        ctx.fillRect(x, y - 10 + 20, 100, 20);
                        ctx.fillStyle = 'rgb(255, 255, 255)';
                        ctx.fillText(prediction.score.toFixed(2), x, y + 20);
                        // ctx.stroke(255, 0, 0);
                        // ctx.lineWidth = 2;
                        // ctx.beginPath();
                        // ctx.moveTo(prediction.bbox, pointA.y);
                        // ctx.lineTo(pointB.x, pointB.y);
                        // ctx.stroke();
                    }
                }

                // Draw the skeleton connections
                // for (let i = 0; i < predictions.length; i++) {
                //     let pose = poses[i];
                //     for (let j = 0; j < predictions.length; j++) {
                //         let pointAIndex = connections[j][0];
                //         let pointBIndex = connections[j][1];
                //         let pointA = pose.keypoints[pointAIndex];
                //         let pointB = pose.keypoints[pointBIndex];
                //         // Only draw a line if both points are confident enough
                //         if (pointA.confidence > 0.1 && pointB.confidence > 0.1) {
                //             ctx.stroke(255, 0, 0);
                //             ctx.lineWidth = 2;
                //             ctx.beginPath();
                //             ctx.moveTo(pointA.x, pointA.y);
                //             ctx.lineTo(pointB.x, pointB.y);
                //             ctx.stroke();
                //         }
                //     }
                // }
                // Draw all the tracked landmark points
                // for (let i = 0; i < poses.length; i++) {
                //     let pose = poses[i];
                //     for (let j = 0; j < pose.keypoints.length; j++) {
                //         let keypoint = pose.keypoints[j];
                //         // Only draw a circle if the keypoint's confidence is bigger than 0.1
                //         if (keypoint.confidence > 0.1) {
                //             fill(0, 255, 0);
                //             noStroke();
                //             circle(keypoint.x, keypoint.y, 10);
                //         }
                //     }
                // }
            }
        }

        // create a new frame based on the content of the canvas
        const newFrame = new VideoFrame(canvas, { timestamp: frame.timestamp });

        // close the current frame
        frame.close();

        // enqueue the new one
        controller.enqueue(newFrame);
    };
}

// a customizable transform function factory for adding text
// let's add some default values
export function detectPersonsSkeleton({ stream }) {
    // an offscreencanvas for drawing video frame and text
    const canvas = new OffscreenCanvas(1, 1);
    const ctx = canvas.getContext('2d');

    // #ffffff - White
    // #800000 - Maroon
    // #469990 - Malachite
    // #e6194b - Crimson
    // #42d4f4 - Picton Blue
    // #fabed4 - Cupid
    // #aaffc3 - Mint Green
    // #9a6324 - Kumera
    // #000075 - Navy Blue
    // #f58231 - Jaffa
    // #4363d8 - Royal Blue
    // #ffd8b1 - Caramel
    // #dcbeff - Mauve
    // #808000 - Olive
    // #ffe119 - Candlelight
    // #911eb4 - Seance
    // #bfef45 - Inchworm
    // #f032e6 - Razzle Dazzle Rose
    // #3cb44b - Chateau Green
    // #a9a9a9 - Silver Chalice
    const COLOR_PALETTE = [
        '#ffffff',
        '#800000',
        '#469990',
        '#e6194b',
        '#42d4f4',
        '#fabed4',
        '#aaffc3',
        '#9a6324',
        '#000075',
        '#f58231',
        '#4363d8',
        '#ffd8b1',
        '#dcbeff',
        '#808000',
        '#ffe119',
        '#911eb4',
        '#bfef45',
        '#f032e6',
        '#3cb44b',
        '#a9a9a9',
    ];

    let net;
    let detector;
    let poses = [];
    const model = poseDetection.SupportedModels.MoveNet;
    const scoreThreshold = 0.2;
    const enableTracking = true;
    const runtime = 'mediapipe';

    const createDetector = async function () {
        let modelConfig = {};

        switch (model) {
            case poseDetection.SupportedModels.PoseNet:
                modelConfig = {
                    architecture: 'MobileNetV1',
                    outputStride: 16,
                    multiplier: 0.75,
                    inputResolution: 257,
                };

                break;

            case poseDetection.SupportedModels.BlazePose:
                modelConfig = {
                    runtime,
                    modelType: 'light',
                    solutionPath: `https://cdn.jsdelivr.net/npm/@mediapipe/pose@${mpPose.VERSION}`,
                };

                break;

            case poseDetection.SupportedModels.MoveNet:
                modelConfig.enableSmoothing = true;
                modelConfig.modelType = poseDetection.movenet.modelType.MULTIPOSE_LIGHTNING;
                modelConfig.minPoseScore = scoreThreshold;
                // modelConfig.enableTracking = enableTracking;
                // modelConfig.trackerType = 'boundingBox';
                // modelConfig.multiPoseMaxDimension = 256;

                break;
        }

        poseDetection.createDetector(model, modelConfig).then(d => {
            //console.log('[picamera][ai] detector loaded', d);
            detector = d;
        });
    };

    const drawKeypoints = async function (keypoints) {
        ctx.fillStyle = 'Green';
        ctx.strokeStyle = 'White';
        ctx.lineWidth = 2;

        for (let i = 0; i < keypoints.length; i++) {
            drawKeypoint(keypoints[i]);
        }
    };

    const drawKeypoint = function (keypoint) {
        const radius = 4;
        let circle;

        if (keypoint.score >= scoreThreshold) {
            circle = new Path2D();
            circle.arc(keypoint.x, keypoint.y, radius, 0, 2 * Math.PI);
            ctx.fill(circle);
            ctx.stroke(circle);
        }
    };

    const drawSkeleton = async function (keypoints, poseId) {
        const color = enableTracking && poseId != null ? COLOR_PALETTE[poseId % 20] : 'White';

        ctx.fillStyle = color;
        ctx.strokeStyle = color;
        ctx.lineWidth = 2;

        poseDetection.util.getAdjacentPairs(model).forEach(([i, j]) => {
            const kp1 = keypoints[i];
            const kp2 = keypoints[j];
            if (kp1.score >= scoreThreshold && kp2.score >= scoreThreshold) {
                ctx.beginPath();
                ctx.moveTo(kp1.x, kp1.y);
                ctx.lineTo(kp2.x, kp2.y);
                ctx.stroke();
            }
        });
    };

    posenet.load().then(function (data) {
        //console.log('[picamera][ai] model loaded', data);
        net = data;

        createDetector();
    });

    // the transform function
    return async function transform(frame, controller) {
        // set canvas size same as the video frame
        const width = frame.displayWidth;
        const height = frame.displayHeight;

        // set canvas dimensions
        canvas.width = width;
        canvas.height = height;

        // Because the image from camera is mirrored, need to flip horizontally.
        //ctx.translate(canvas.width, 0);
        //ctx.scale(-1, 1);

        //ctx.clearRect(0, 0, width, height);
        ctx.drawImage(frame, 0, 0, width, height);
        console.log(width, height);

        if (width && height) {
            if (detector) {
                detector
                    .estimatePoses(stream, {
                        flipHorizontal: false,
                        maxPoses: 2,
                        //decodingMethod: "single-person",
                    })
                    .then(data => {
                        poses = data;
                    });
            }

            if (poses && poses.length > 0) {
                for (const pose of poses) {
                    if (pose.keypoints != null) {
                        drawKeypoints(pose.keypoints);
                        drawSkeleton(pose.keypoints, pose.id);
                    }
                }
            }
        }

        // create a new frame based on the content of the canvas
        const newFrame = new VideoFrame(canvas, { timestamp: frame.timestamp });

        // close the current frame
        frame.close();

        // enqueue the new one
        controller.enqueue(newFrame);
    };
}

export function detectPersonsBoundingBox(stream) {
    const canvas = new OffscreenCanvas(1, 1);
    const ctx = canvas.getContext('2d');

    let net;
    let predictions;

    // Load the model
    cocoSsd.load().then(function (data) {
        net = data;
    });

    // the transform function
    return async function transform(frame, controller) {
        // set canvas size same as the video frame
        const width = frame.displayWidth;
        const height = frame.displayHeight;
        canvas.width = width;
        canvas.height = height;

        // let's draw!
        ctx.drawImage(frame, 0, 0, width, height);

        if (net) {
            net.detect(canvas).then(data => {
                predictions = data;
            });

            if (predictions && predictions.length) {
                for (let i = 0; i < predictions.length; i++) {
                    let prediction = predictions[i];
                    if (prediction.score > 0.5 && prediction.class === 'person') {
                        const color = 'hsl(100, 100%, 50%)';
                        const text = `${prediction.class} ${prediction.score.toFixed(2)}`;
                        let [x, y, w, h] = prediction.bbox;

                        ctx.beginPath();
                        ctx.font = '12px Arial';
                        ctx.strokeStyle = color;
                        ctx.lineWidth = 2;
                        ctx.strokeRect(x, y, w, h);

                        ctx.fillStyle = color;
                        const textSize = ctx.measureText(text).width;

                        ctx.rect(x + 1, y - 20, textSize + 12, 20);
                        ctx.fill();
                        ctx.fillStyle = 'white';
                        ctx.fillText(text, x + 5, y - 5);
                        ctx.closePath();
                    }
                }
            }
        }

        // create a new frame based on the content of the canvas
        const newFrame = new VideoFrame(canvas, { timestamp: frame.timestamp });

        // close the current frame
        frame.close();

        // enqueue the new one
        controller.enqueue(newFrame);
    };
}
