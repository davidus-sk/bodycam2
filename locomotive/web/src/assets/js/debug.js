import { getTimestamp } from './functions.js';

export class Debug {
    constructor() {
        // dom elements
        this.$debug = $('#debug');
        this.$selDevices = $('#sel-cameras');

        const $btnDeviceStatus = $('#btn-cam-status');
        const $btnDeviceStatusAuto = $('#btn-cam-status-auto');
        const $btnPanic = $('#btn-panic');

        // regex map
        const deviceIdPattern = 'device-[0-9a-fA-F]{16}';

        this.topicRegex = {};
        this.topicRegex['camera_status'] = new RegExp(`^device\/${deviceIdPattern}\/status$`);
        this.topicRegex['camera_gps'] = new RegExp(`^device\/${deviceIdPattern}\/gps$`);

        this.topicRegex['web_rtc_sdp_offer'] = new RegExp(
            `^${deviceIdPattern}\/sdp\/([^\/]+)\/offer$`
        );
        this.topicRegex['web_rtc_ice_offer'] = new RegExp(
            `^${deviceIdPattern}\/ice\/([^\/]+)\/offer$`
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

        let deviceStatusTimer;
        $btnDeviceStatusAuto.on('click', () => {
            let active = parseInt($btnDeviceStatusAuto.attr('data-active')) === 1;
            if (active) {
                active = false;
                $btnDeviceStatusAuto.attr('data-active', 0).html('Device Status Start');
            } else {
                active = true;
                $btnDeviceStatusAuto.attr('data-active', 1).html('Device Status Stop');
            }

            if (active) {
                this.sendDeviceStatus();
                deviceStatusTimer = setInterval(() => {
                    this.sendDeviceStatus();
                }, 4000);
            } else {
                clearInterval(timer);
                deviceStatusTimer = null;
            }
        });

        //
        this.stream();
        this.cameraRestart();
        this.gps();
    }

    mqttConnected() {
        console.log('e: mqtt connected');

        // client id
        this.mqttClientId = this.mqttClient.getClientId();

        // this.mqttClient.on('publish', (topic, message) => {
        //     console.log('!: mqtt publish: -->', topic);
        // });

        // this.mqttClient.on('subscribe', topic => {
        //     console.log('!: mqtt subscribe: ' + topic);
        // });

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
            const deviceId = this.getSelectedDeviceId();
            const topic = `device/${deviceId}/status`;

            this.mqttClient.publish(
                topic,
                JSON.stringify({
                    ts: getTimestamp(),
                    client_id: this.mqttClientId,
                    device_id: deviceId,
                    status: 'alive',
                })
            );
        }
    }

    panicButton() {
        if (this.mqttClient && this.mqttClient.isConnected()) {
            console.log('[debug] panic button pressed', this);

            const $btnPanic = $('#btn-panic');
            if ($btnPanic.attr('data-panic') == '1') {
                $btnPanic.attr('data-panic', 0).html('Panic OFF');
            } else {
                $btnPanic.attr('data-panic', 1).html('Panic ON');
            }

            const deviceId = this.getSelectedDeviceId();
            const topic = `device/${deviceId}/button`;

            this.mqttClient.publish(
                topic,
                JSON.stringify({
                    ts: getTimestamp(),
                    client_id: this.mqttClientId,
                    device_id: deviceId,
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
                    device_id: deviceId,
                })
            );
        });
    }

    stream() {
        let localStream = undefined;
        let $localVideo = $('#local-video');
        let localVideo = $localVideo.get(0);
        let deviceId;

        let _pc = {};
        let _cacheIceList = {};
        let _remoteDescriptionSet = {};

        let pc = undefined;
        let cacheIceList = [];
        let remoteDescriptionSet = false;

        let $btnStartStream = $('#btn-start-stream');
        let $btnStopStream = $('#btn-stop-stream');

        // attach events
        window.onbeforeunload = function () {
            console.log('e: window reload');
            stopLocalStream();
        };

        const handleICECandidateEvent = (e, clientId) => {
            if (e.candidate) {
                const topic = `${deviceId}/ice/${clientId}`;

                console.log('[debug] sending local ICE candidate back to other peer');
                console.log('[mqtt_service] publish: ' + topic);

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
            console.log('[debug] stream removed');
            closeVideoCall();
        }

        // Called by the WebRTC layer to let us know when it's time to
        // begin (or restart) ICE negotiation. Starts by creating a WebRTC
        // offer, then sets it as the description of our local media
        // (which configures our local media stream), then sends the
        // description to the callee as an offer. This is a proposed media
        // format, codec, resolution, etc.

        const handleNegotiationNeededEvent = () => {
            console.log('[debug] negotiation needed');
        };

        // Accept an offer to video chat. We configure our local settings,
        // create our RTCPeerConnection, get and attach our local camera
        // stream, then create and send an answer to the caller.
        const handleOfferMessage = async (clientId, offer) => {
            const sdp = JSON.parse(offer);

            if (!sdp || sdp.type !== 'offer') {
                return;
            }

            console.log('[debug] received remote offer SDP - client_id : ' + clientId);

            // this.mqttClient.unsubscribe(`${deviceId}/sdp/+/offer`);
            // console.log('[mqtt_service] unsubscribe: ' + `${deviceId}/sdp/+/offer`);

            console.log('[debug] initializing webrtc connection');

            _remoteDescriptionSet[clientId] = false;
            _cacheIceList[clientId] = [];

            _pc[clientId] = new RTCPeerConnection({ iceCandidatePoolSize: 10 });
            // _pc[clientId].addTransceiver('video', { direction: 'sendonly' });
            // _pc[clientId].addTransceiver('audio', { direction: 'sendonly' });

            console.log('[debug] adding tracks to the RTCPeerConnection');

            // our local stream can provide different tracks, e.g. audio and
            // video. even though we're just using the video track, we should
            // add all tracks to the webrtc connection
            for (const track of localStream.getTracks()) {
                console.log(localStream);
                _pc[clientId]?.addTrack(track, localStream);
            }

            _pc[clientId].onicecandidate = e => handleICECandidateEvent(e, clientId);
            _pc[clientId].onremovestream = handleRemoveStreamEvent;
            _pc[clientId].oniceconnectionstatechange = handleICEConnectionStateChangeEvent;
            _pc[clientId].onicegatheringstatechange = e =>
                handleICEGatheringStateChangeEvent(e, clientId);
            _pc[clientId].onsignalingstatechange = handleSignalingStateChangeEvent;
            _pc[clientId].onnegotiationneeded = handleNegotiationNeededEvent;
            _pc[clientId].ontrack = handleTrackEvent;

            _pc[clientId]
                .setRemoteDescription(sdp)
                .then(() => {
                    _remoteDescriptionSet[clientId] = true;

                    console.log('[debug] creating answer');
                    // Now that we've successfully set the remote description, we need to
                    // start our stream up locally then create an SDP answer. This SDP
                    // data describes the local end of our call, including the codec
                    // information, options agreed upon, and so forth.
                    return _pc[clientId].createAnswer();
                })
                .then(answer => {
                    console.log('[debug] setting local description');

                    // We now have our answer, so establish that as the local description.
                    // This actually configures our end of the call to match the settings
                    // specified in the SDP.
                    return _pc[clientId].setLocalDescription(answer);
                })
                .then(() => {
                    // We've configured our end of the call now. Time to send our
                    // answer back to the caller so they know that we want to talk
                    // and how to talk to us.

                    console.log('[debug] sending answer back to other peer');

                    const topic = `${deviceId}/sdp/${clientId}`;
                    console.log('[mqtt_service] publish: ' + topic, _pc[clientId].localDescription);
                    this.mqttClient.publish(topic, JSON.stringify(_pc[clientId].localDescription));
                })
                .catch(handleGetUserMediaError);
        };

        // A new ICE candidate has been received from the other peer. Call
        // RTCPeerConnection.addIceCandidate() to send it along to the
        // local ICE framework.
        const handleRemoteIceCandidate = (clientId, message) => {
            let ice = JSON.parse(message);

            if (ice && ice.candidate) {
                const descSet =
                    _remoteDescriptionSet[clientId] !== undefined
                        ? _remoteDescriptionSet[clientId]
                        : false;

                console.log(
                    '[debug] got remote ICE (remote description set: ' +
                        (descSet ? 'yes' : 'no') +
                        ')'
                );

                if (descSet === true) {
                    _pc[clientId].addIceCandidate(new RTCIceCandidate(ice));

                    if (_cacheIceList[clientId] !== undefined) {
                        while (_cacheIceList[clientId].length > 0) {
                            const ice = _cacheIceList[clientId].shift();
                            console.log('[debug] adding cached remote ICE');
                            _pc[clientId].addIceCandidate(new RTCIceCandidate(ice));
                        }
                    }
                } else {
                    if (_cacheIceList[clientId] === undefined) {
                        _cacheIceList[clientId] = [];
                    }

                    _cacheIceList[clientId].push(ice);
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

        function handleICEGatheringStateChangeEvent(event, clientId) {
            console.log(
                '[debug] ICE gathering state changed to: ' + event.target.iceGatheringState
            );
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
            console.log('[debug] track event', event);
        }

        // Handle |iceconnectionstatechange| events. This will detect
        // when the ICE connection is closed, failed, or disconnected.
        //
        // This is called when the state of the ICE agent changes.

        function handleICEConnectionStateChangeEvent(event) {
            console.log(
                '[debug] ICE connection state changed to ' + event.target.iceConnectionState
            );

            switch (event.target.iceConnectionState) {
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
            console.log(
                '[debug] WebRTC signaling state changed to: ' + event.target.signalingState
            );
            switch (event.target.signalingState) {
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
            console.log('[debug] user media error. ' + e.message);

            // Make sure we shut down our end of the RTCPeerConnection so we're
            // ready to try again.

            closeVideoCall();
        }

        const stopLocalStream = () => {
            console.log('f: stopLocalStream()', localStream);

            _pc = {};
            _remoteDescriptionSet = {};
            _cacheIceList = {};

            if (localStream) {
                localStream.getTracks().forEach(track => track.stop());
                localStream = null;
            }

            localVideo.srcObject = null;

            for (const clientId in _pc) {
                const val = _pc[clientId];

                if (val) {
                    val.close();
                    delete _pc[clientId];
                }
            }

            $localVideo.hide();
            $btnStartStream.attr('disabled', false);
        };

        // start stream
        $btnStartStream.on('click', e => {
            e.preventDefault();

            if (localStream) {
                console.log('[debug] stream already started');
                return;
            }

            $btnStartStream.attr('disabled', 'disabled');

            // mqtt connection
            if (!this.checkMqttConnection()) {
                return;
            }

            deviceId = this.getSelectedDeviceId();
            cacheIceList = [];

            console.log('[debug] requesting media devices...');
            navigator.mediaDevices
                .getUserMedia({
                    audio: false,
                    video: true,
                })
                .then(stream => {
                    console.log(
                        '[debug] %cCamera initialized',
                        'background-color:#540101;color:#dbe2ff;font-weight:500'
                    );
                    console.log('[debug] stream started. waiting for signaling!');

                    localStream = stream;
                    localVideo.srcObject = localStream;
                    $localVideo.show();

                    this.mqttClient.subscribe(`${deviceId}/sdp/+/offer`);
                    this.mqttClient.subscribe(`${deviceId}/ice/+/offer`);

                    console.log('[debug] mqtt subscribe: ' + `${deviceId}/sdp/+/offer`);
                    console.log('[debug] mqtt subscribe: ' + `${deviceId}/ice/+/offer`);

                    this.mqttClient.on('message', (topic, message) => {
                        const msg = message ? message.toString() : null;
                        let found, clientId;

                        found = topic.match(this.topicRegex['web_rtc_sdp_offer']);
                        if (found) {
                            handleOfferMessage(found[1], msg);
                        }

                        found = topic.match(this.topicRegex['web_rtc_ice_offer']);
                        if (found) {
                            handleRemoteIceCandidate(found[1], msg);
                        }
                    });
                })
                .catch(e => {
                    console.log('[debug] error opening camera: ' + e.message);
                    $btnStartStream.attr('disabled', false);
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
        const $btnAddLoco = $('#btn-add-loco');
        const $btnGps = $('#btn-gps');
        const $btnGpsAuto = $('#btn-gps-auto');

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

        const fakeGps = gps => {
            const deviceId = this.getSelectedDeviceId();
            const topic = `device/${deviceId}/gps`;

            this.mqttClient.publish(
                topic,
                JSON.stringify({
                    ts: getTimestamp(),
                    client_id: this.mqttClientId,
                    device_id: deviceId,
                    gps: gps,
                })
            );
        };

        $btnGps.on('click', () => {
            let gps = this.getRandomCoordinate(lastGps, 200);
            fakeGps(gps);
        });

        $btnAddLoco.on('click', () => {
            let gps;
            addLoco(gps);
        });

        $btnGpsAuto.on('click', () => {
            let gpsActive = parseInt($btnGpsAuto.attr('data-active')) === 1;
            if (gpsActive) {
                fakeGpsStart = false;
                $btnGpsAuto.attr('data-active', 0).html('Fake Gps Start');
            } else {
                fakeGpsStart = true;
                $btnGpsAuto.attr('data-active', 1).html('Fake Gps Stop');
            }

            if (fakeGpsStart) {
                let gps = this.getRandomCoordinate(lastGps, 200);
                fakeGps(gps);

                gpsTimer = setInterval(() => {
                    lastGps = this.getRandomCoordinate(lastGps, 15);
                    fakeGps(lastGps);
                }, 4000);
            } else {
                clearInterval(gpsTimer);
                gpsTimer = null;
            }
        });
    }
}
