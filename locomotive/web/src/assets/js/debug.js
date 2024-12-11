import { getTimestamp } from './functions.js';

export class Debug {
    constructor() {
        // dom elements
        this.$debug = $('#debug');
        this.$selDevices = $('#sel-cameras');
        this.$localVideo = $('#local-video');

        const $btnDeviceStatus = $('#btn-cam-status');
        const $btnPanic = $('#btn-panic');

        // regex map
        const deviceIdPattern = 'device-[0-9a-fA-F]{16}';

        this.topicRegex = {};
        this.topicRegex['camera_status'] = new RegExp(`^device\/${deviceIdPattern}\/status$`);
        this.topicRegex['camera_gps'] = new RegExp(`^device\/${deviceIdPattern}\/gps$`);

        this.topicRegex['web_rtc_sdp_offer'] = new RegExp(
            `^${deviceIdPattern}\/sdp\/[^\/]+\/offer$`
        );
        this.topicRegex['web_rtc_ice_offer'] = new RegExp(
            `^${deviceIdPattern}\/ice\/[^\/]+\/offer$`
        );

        // mqtt
        this.mqttClient = app?.getMqttClient();
        if (this.mqttClient) {
            this.mqttClient.on('connect', () => this.mqttConnected());
            this.mqttClient.on('disconnect', () => this.mqttDisconnect());
        }

        // buttons
        $btnDeviceStatus.on('click', () => this.sendDeviceStatus());
        $btnPanic.on('click', () => this.panicButton());

        //
        this.stream();
        this.cameraRestart();
        this.gps();
    }

    mqttConnected() {
        console.log('e: mqtt connected');

        // client id
        this.mqttClientId = this.mqttClient.getClientId();

        this.mqttClient.on('publish', (topic, message) => {
            console.log('!: mqtt publish: -->', topic, message);
        });

        this.mqttClient.on('subscribe', topic => {
            console.log('!: mqtt subscribe: ' + topic);
        });

        $('[data-btn-mqtt=1]').attr('disabled', false);
    }

    mqttDisconnect() {
        console.log('e: mqtt disconnected');

        $('[data-btn-mqtt=1]').attr('disabled', 'disabled');
    }

    getSelectedDeviceId() {
        return this.$selDevices.find(':selected').val();
    }

    checkMqttConnection() {
        if (!this.mqttClient || !this.mqttClient.isConnected()) {
            console.log('! mqtt is not connected');
            return false;
        }

        return true;
    }

    constructTopic(topic, subLevels) {
        let t = `${this.deviceId}/${topic}/${this.mqttClientId}`;
        if (typeof subLevels === 'string') {
            t += subLevels;
        }

        t = t.replace('/{1,}/', '/');

        return t;
    }

    sendDeviceStatus() {
        if (this.mqttClient && this.mqttClient.isConnected()) {
            console.log('f: cameraStatus()');

            const deviceId = this.getSelectedDeviceId();
            const topic = `device/${deviceId}/status`;

            this.mqttClient.publish(
                topic,
                JSON.stringify({
                    ts: getTimestamp(),
                    client_id: this.mqttClientId,
                    camera_id: deviceId,
                    status: 'alive',
                })
            );
        }
    }

    panicButton() {
        if (this.mqttClient && this.mqttClient.isConnected()) {
            console.log('f: cameraStatus()');

            const deviceId = this.getSelectedDeviceId();
            const topic = `device/${deviceId}/button`;

            this.mqttClient.publish(
                topic,
                JSON.stringify({
                    ts: getTimestamp(),
                    client_id: this.mqttClientId,
                    camera_id: deviceId,
                })
            );

            console.log('f: mqtt publish -> ' + topic);
        }
    }

    cameraRestart() {
        let $btnDeviceRestart = $('#btn-cam-restart');

        // start stream
        $btnDeviceRestart.on('click', e => {
            e.preventDefault();

            console.log('!: camera restart');

            // mqtt connection
            if (!this.checkMqttConnection()) {
                return;
            }

            const deviceId = this.getSelectedDeviceId();
            const topic = `device/${deviceId}/restart`;

            console.log('!: camera restart', topic);

            this.mqttClient.publish(
                topic,
                JSON.stringify({
                    ts: getTimestamp(),
                    client_id: this.mqttClientId,
                    camera_id: deviceId,
                })
            );
        });
    }

    stream() {
        let pc = undefined;
        let localStream;
        let localVideo = this.$localVideo.get(0);
        let localOffer;
        let deviceId;
        let cacheIceList = [];
        let remoteDescriptionSet = false;

        let $btnStartStream = $('#btn-start-stream');
        let $btnStopStream = $('#btn-stop-stream');

        // attach events
        window.onbeforeunload = function () {
            console.log('e: window reload');
            stopLocalStream();
        };

        const stopLocalStream = () => {
            console.log('f: stopLocalStream()', localStream);

            if (localStream) {
                localStream.getTracks().forEach(track => track.stop());
                localStream = null;
            }

            if (pc) {
                pc.close();
                pc = undefined;
            }
        };

        const handleICECandidateEvent = e => {
            console.log('e: handleICECandidateEvent !!!!!!!!!!!!!!!!!!!!!!');
            if (e.candidate) {
                console.log('---> Sending local ICE candidate back to other peer');
                const topic = `${deviceId}/ice/${this.mqttClientId}`;
                this.mqttClient.publish(topic, JSON.stringify(e.candidate));
            }
        };

        // An event handler which is called when the remote end of the connection
        // removes its stream. We consider this the same as hanging up the call.
        // It could just as well be treated as a "mute".
        //
        // Note that currently, the spec is hazy on exactly when this and other
        // "connection failure" scenarios should occur, so sometimes they simply
        // don't happen.

        function handleRemoveStreamEvent(event) {
            console.log('*** Stream removed');
            closeVideoCall();
        }

        // Called by the WebRTC layer to let us know when it's time to
        // begin (or restart) ICE negotiation. Starts by creating a WebRTC
        // offer, then sets it as the description of our local media
        // (which configures our local media stream), then sends the
        // description to the callee as an offer. This is a proposed media
        // format, codec, resolution, etc.

        const handleNegotiationNeededEvent = () => {
            console.log('*** Negotiation needed');
        };

        // Accept an offer to video chat. We configure our local settings,
        // create our RTCPeerConnection, get and attach our local camera
        // stream, then create and send an answer to the caller.
        const handleRemoteSdpMessage = message => {
            const sdp = JSON.parse(message);
            console.log('<--- Got remote offer');

            console.log('**** Initializing webrtc connection');

            pc = new RTCPeerConnection({ iceCandidatePoolSize: 5 });
            pc.addTransceiver('video', { direction: 'sendonly' });
            pc.addTransceiver('audio', { direction: 'sendonly' });

            pc.onicecandidate = handleICECandidateEvent;
            pc.onremovestream = handleRemoveStreamEvent;
            pc.oniceconnectionstatechange = handleICEConnectionStateChangeEvent;
            pc.onicegatheringstatechange = handleICEGatheringStateChangeEvent;
            pc.onsignalingstatechange = handleSignalingStateChangeEvent;
            pc.onnegotiationneeded = handleNegotiationNeededEvent;
            pc.ontrack = handleTrackEvent;

            /*
            console.log('---> Creating offer');
            
            pc.createOffer()
                .then(offer => {
                    console.log('---> Creating new description object to send to remote peer');
                    pc.setLocalDescription(offer, () => {
                        console.log('---> Sending offer to remote peer');

                        const topic = `${deviceId}/sdp/${this.mqttClientId}`;
                        console.log('!: mqtt publish: ', topic);
                        this.mqttClient.publish(topic, JSON.stringify(offer));
                    });
                })
                .catch(reportError);
            */

            var desc = new RTCSessionDescription(sdp);

            pc.setRemoteDescription(desc)
                .then(() => {
                    console.log('Setting up the local media stream...');
                    console.log('-- Local video stream obtained');
                    console.log('-- Adding tracks to the RTCPeerConnection');
                    remoteDescriptionSet = true;
                })
                .then(() => {
                    console.log('------> Creating answer');
                    // Now that we've successfully set the remote description, we need to
                    // start our stream up locally then create an SDP answer. This SDP
                    // data describes the local end of our call, including the codec
                    // information, options agreed upon, and so forth.
                    return pc.createAnswer();
                })
                .then(answer => {
                    console.log('------> Setting local description after creating answer');
                    // We now have our answer, so establish that as the local description.
                    // This actually configures our end of the call to match the settings
                    // specified in the SDP.
                    return pc.setLocalDescription(answer);
                })
                .then(() => {
                    // We've configured our end of the call now. Time to send our
                    // answer back to the caller so they know that we want to talk
                    // and how to talk to us.

                    console.log('------> Sending answer packet back to other peer', pc);

                    const topic = `${deviceId}/sdp/${this.mqttClientId}`;
                    this.mqttClient.publish(topic, JSON.stringify(pc.localDescription));

                    localVideo.srcObject = localStream;
                    localStream.getTracks().forEach(track => pc.addTrack(track, localStream));
                })
                .catch(handleGetUserMediaError);
        };

        // A new ICE candidate has been received from the other peer. Call
        // RTCPeerConnection.addIceCandidate() to send it along to the
        // local ICE framework.
        const handleRemoteIceCandidate = message => {
            let ice = JSON.parse(message);

            if (ice && ice.candidate) {
                console.log('---> Got remote ice candidate');

                if (remoteDescriptionSet === true) {
                    console.log('     Adding remote ICE candidate');
                    pc.addIceCandidate(new RTCIceCandidate(ice));

                    while (cacheIceList.length > 0) {
                        ice = cacheIceList.shift();
                        console.log('     Adding cached remote ICE candidate');
                        pc.addIceCandidate(new RTCIceCandidate(ice));
                    }
                } else {
                    cacheIceList.push(ice);
                }
            }
        };

        // Handle the |icegatheringstatechange| event. This lets us know what the
        // ICE engine is currently working on: "new" means no networking has happened
        // yet, "gathering" means the ICE engine is currently gathering candidates,
        // and "complete" means gathering is complete. Note that the engine can
        // alternate between "gathering" and "complete" repeatedly as needs and
        // circumstances change.
        //
        // We don't need to do anything when this happens, but we log it to the
        // console so you can see what's going on when playing with the sample.

        function handleICEGatheringStateChangeEvent(event) {
            console.log('*** ICE gathering state changed to: ' + pc.iceGatheringState);

            if (pc.iceGatheringState === 'complete') {
            }
        }

        // Called by the WebRTC layer when events occur on the media tracks
        // on our WebRTC call. This includes when streams are added to and
        // removed from the call.
        //
        // track events include the following fields:
        //
        // RTCRtpReceiver       receiver
        // MediaStreamTrack     track
        // MediaStream[]        streams
        // RTCRtpTransceiver    transceiver

        function handleTrackEvent(event) {
            //console.log('*** Track event', event);
        }

        // Handle |iceconnectionstatechange| events. This will detect
        // when the ICE connection is closed, failed, or disconnected.
        //
        // This is called when the state of the ICE agent changes.

        function handleICEConnectionStateChangeEvent(event) {
            console.log('*** ICE connection state changed to ' + pc.iceConnectionState);

            switch (pc.iceConnectionState) {
                case 'closed':
                case 'failed':
                case 'disconnected':
                    closeVideoCall();
                    break;
            }
        }

        // Set up a |signalingstatechange| event handler. This will detect when
        // the signaling connection is closed.
        //
        // NOTE: This will actually move to the new RTCPeerConnectionState enum
        // returned in the property RTCPeerConnection.connectionState when
        // browsers catch up with the latest version of the specification!

        function handleSignalingStateChangeEvent(event) {
            console.log('*** WebRTC signaling state changed to: ' + pc.signalingState);
            switch (pc.signalingState) {
                case 'closed':
                    closeVideoCall();
                    break;
            }
        }

        // Close the RTCPeerConnection and reset variables so that the user can
        // make or receive another call if they wish. This is called both
        // when the user hangs up, the other user hangs up, or if a connection
        // failure is detected.

        function closeVideoCall() {
            return;
        }

        // Handle errors which occur when trying to access the local media
        // hardware; that is, exceptions thrown by getUserMedia(). The two most
        // likely scenarios are that the user has no camera and/or microphone
        // or that they declined to share their equipment when prompted. If
        // they simply opted not to share their media, that's not really an
        // error, so we won't present a message in that situation.

        function handleGetUserMediaError(e) {
            console.log(e);
            switch (e.name) {
                case 'NotFoundError':
                    console.log(
                        'Unable to open your call because no camera and/or microphone' +
                            'were found.'
                    );
                    break;
                case 'SecurityError':
                case 'PermissionDeniedError':
                    // Do nothing; this is the same as the user canceling the call.
                    break;
                default:
                    console.log('Error opening your camera and/or microphone: ' + e.message);
                    break;
            }

            // Make sure we shut down our end of the RTCPeerConnection so we're
            // ready to try again.

            closeVideoCall();
        }

        // start stream
        $btnStartStream.on('click', e => {
            e.preventDefault();

            // mqtt connection
            if (!this.checkMqttConnection()) {
                return;
            }

            deviceId = this.getSelectedDeviceId();
            cacheIceList = [];

            navigator.mediaDevices
                .getUserMedia({
                    audio: false,
                    video: true,
                })
                .then(stream => {
                    console.log('!: camera initialized');
                    localStream = stream;
                });

            this.mqttClient.subscribe(`${deviceId}/#`);
            this.mqttClient.on('message', (topic, message) => {
                const msg = message ? message.toString() : null;

                if (this.topicRegex['web_rtc_sdp_offer'].test(topic)) {
                    handleRemoteSdpMessage(msg);
                }
                if (this.topicRegex['web_rtc_ice_offer'].test(topic)) {
                    handleRemoteIceCandidate(msg);
                }
            });
        });

        $btnStopStream.on('click', e => {
            e.preventDefault();

            // mqtt connection
            stopLocalStream();

            this.mqttClient.off('message');
        });
    }

    getRandomCoordinate(center, radius) {
        const { lat, lng } = center; // Center of the circle
        const earthRadius = 6371e3; // Earth's radius in meters

        // Convert latitude and longitude from degrees to radians
        const latRad = (lat * Math.PI) / 180;
        const lonRad = (lng * Math.PI) / 180;

        // Generate a random distance within the circle radius
        const distance = Math.random() * radius;

        // Generate a random bearing (direction) in radians
        const bearing = Math.random() * 2 * Math.PI;

        // Calculate the new latitude
        const newLatRad = Math.asin(
            Math.sin(latRad) * Math.cos(distance / earthRadius) +
                Math.cos(latRad) * Math.sin(distance / earthRadius) * Math.cos(bearing)
        );

        // Calculate the new longitude
        const newLonRad =
            lonRad +
            Math.atan2(
                Math.sin(bearing) * Math.sin(distance / earthRadius) * Math.cos(latRad),
                Math.cos(distance / earthRadius) - Math.sin(latRad) * Math.sin(newLatRad)
            );

        // Convert back to degrees
        const newLatitude = (newLatRad * 180) / Math.PI;
        const newLongitude = (newLonRad * 180) / Math.PI;

        return { lat: newLatitude, lng: newLongitude };
    }

    gps() {
        const $btnGps = $('#btn-gps-auto');
        const $btnAddLoco = $('#btn-add-loco');
        const $btnGpsFake = $('#btn-gps-fake');
        const $btnGpsFakePanic = $('#btn-gps-fake-panic');

        let fakeGpsStart = false;
        let gpsTimer;

        const locomotiveGps = { lat: 30.672026, lng: -92.260802 };
        let lastGps = Object.assign({}, locomotiveGps);

        const addLoco = () => {
            const topic = `device/device-0000000000000000/gps`;
            this.mqttClient.publish(
                topic,
                JSON.stringify({
                    ts: getTimestamp(),
                    type: 'locomotive',
                    gps: locomotiveGps,
                })
            );
        };

        const fakeGps = (gps, panic) => {
            const deviceId = this.getSelectedDeviceId();
            console.log(deviceId, panic);
            const topic = `device/${deviceId}/gps`;

            this.mqttClient.publish(
                topic,
                JSON.stringify({
                    ts: getTimestamp(),
                    client_id: this.mqttClientId,
                    device_id: deviceId,
                    gps: gps,
                    panic: panic ? 1 : 0,
                })
            );
        };

        $btnGpsFake.on('click', () => {
            let gps = this.getRandomCoordinate(lastGps, 200);
            fakeGps(gps);
        });

        $btnGpsFakePanic.on('click', () => {
            let gps = this.getRandomCoordinate(lastGps, 200);
            fakeGps(gps, true);
        });

        $btnAddLoco.on('click', () => {
            let gps;
            addLoco(gps);
        });

        $btnGps.on('click', () => {
            let gpsActive = parseInt($btnGps.attr('data-active')) === 1;
            if (gpsActive) {
                fakeGpsStart = false;
                $btnGps.attr('data-active', 0).html('Fake Gps Start');
            } else {
                fakeGpsStart = true;
                $btnGps.attr('data-active', 1).html('Fake Gps Stop');
            }

            if (fakeGpsStart) {
                let gps = this.getRandomCoordinate(lastGps, 200);
                fakeGps(gps);

                gpsTimer = setInterval(() => {
                    lastGps = this.getRandomCoordinate(lastGps, 200);
                    fakeGps(gps);
                }, 2000);
            } else {
                clearInterval(gpsTimer);
                gpsTimer = null;
            }
        });
    }
}
