import { getTimestamp } from './functions.js';

export class Debug {
    options = {};

    constructor(options) {
        this.options = this.initializeOptions(options);

        // generate device ID
        this.deviceId = this.options.deviceId ? this.options.deviceId : this.randomDeviceId();

        // debug
        if (this.debugMode === true && typeof console != 'undefined') {
            this.debug = console.log.bind(console);
        } else {
            this.debug = function (message) {};
        }

        // dom elements
        this.$debug = $('#debug');
        this.$selDevices = $('#sel-cameras');

        // regex map
        const deviceIdPattern = 'device-[0-9a-fA-F]{16}';

        this.topicRegex = {};
        this.topicRegex['camera_status'] = new RegExp(`^device\/device-[0-9a-fA-F]{16}\/status$`);
        this.topicRegex['camera_gps'] = new RegExp(`^device\/${deviceIdPattern}\/gps$`);

        this.topicRegex['web_rtc_sdp_offer'] = new RegExp(
            `^(${deviceIdPattern})\/sdp\/([^\/]+)\/offer$`
        );
        this.topicRegex['web_rtc_ice_offer'] = new RegExp(
            `^(${deviceIdPattern})\/ice\/([^\/]+)\/offer$`
        );

        // mqtt
        this.mqttClient = app?.getMqttClient();
        if (this.mqttClient) {
            this.mqttClient.on('connect', () => this.mqttConnected());
            this.mqttClient.on('disconnect', () => this.mqttDisconnect());
        }

        // buttons status
        this.buttonsStatus = {};

        // local variables
        this.colorReceived = 'background-color:#540101;color:#dbe2ff;font-weight:500';

        this.buttons();
        this.stream();
        this.cameraRestart();
        this.gps();
    }

    initializeOptions(userOptions) {
        const defaultOptions = {
            debug: false,
        };

        return { ...defaultOptions, ...userOptions };
    }

    getRtcConfig() {
        let config = {};

        config.iceServers = [];
        config.iceCandidatePoolSize = 5;

        // STUN servers
        if (this.options.camera.stunUrls && this.options.camera.stunUrls.length > 0) {
            config.iceServers.push({ urls: this.options.camera.stunUrls });
        }

        // TURN servers
        if (this.options.camera.turnUrls && typeof this.options.camera.turnUrls === 'object') {
            config.iceServers.push({
                urls: this.options.camera.turnUrls,
                username: this.options.camera.turnUsername,
                credential: this.options.camera.turnPassword,
            });
        }

        return config;
    }

    mqttConnected() {
        console.log(
            '[debug] mqtt connected - client id: ' + this.mqttClient.client.options.clientId
        );

        $('[data-mqtt=1]').attr('disabled', false);
    }

    mqttDisconnect() {
        console.log('e: mqtt disconnected');

        $('[data-mqtt=1]').attr('disabled', 'disabled');
    }

    getSelectedDeviceId(randomIfEmpty) {
        let deviceId = this.$selDevices.find(':selected').val();

        if (deviceId === '' && randomIfEmpty !== false) {
            deviceId = this.deviceId;
        }

        return deviceId;
    }

    checkMqttConnection() {
        if (!this.mqttClient || !this.mqttClient.isConnected()) {
            console.log('! mqtt is not connected');
            return false;
        }

        return true;
    }

    randomDeviceId() {
        var result = '';
        const length = 16;
        const chars = '0123456789abcdefABCDEF';

        for (var i = length; i > 0; --i) {
            result += chars[Math.floor(Math.random() * chars.length)];
        }

        return 'device-' + result;
    }

    buttons() {
        let deviceStatusTimer;

        // status buttons (emergency, fall...)
        this.$debug.on('click', '[data-status]', e => {
            e.preventDefault();

            const $btn = $(e.target);
            const mode = $btn.attr('data-status') || '';
            const deviceId = this.getSelectedDeviceId();

            let active = parseInt($btn.attr('data-active')) === 1;

            if (deviceStatusTimer) {
                clearInterval(deviceStatusTimer);
                deviceStatusTimer = null;
            }

            if (mode === 'auto') {
                if (active) {
                    active = false;
                    $btn.attr('data-active', 0).removeClass('btn-success');
                } else {
                    active = true;
                    $btn.attr('data-active', 1).addClass('btn-success');
                }

                if (active) {
                    this.sendDeviceStatus(deviceId);
                    deviceStatusTimer = setInterval(() => {
                        this.sendDeviceStatus(deviceId);
                    }, 5000);
                }
            } else {
                this.sendDeviceStatus(deviceId);
            }
        });

        // status buttons (emergency, fall...)
        this.$debug.on('click', '[data-button-status]', e => {
            e.preventDefault();
            let $btn = $(e.target);

            const deviceId = this.getSelectedDeviceId();
            const status = $btn.attr('data-button-status') || '';
            let active = parseInt($btn.attr('data-active')) === 1;

            if (active) {
                active = 0;
                this.buttonsStatus[status] = 0;
                $btn.attr('data-active', 0).removeClass('bg-success');
            } else {
                active = 1;
                this.buttonsStatus[status] = 1;
                $btn.attr('data-active', 1).addClass('bg-success');
            }

            if (status) {
                this.mqttButtonStatus(deviceId, status, active);
            }
        });
    }

    sendDeviceStatus(deviceId) {
        if (this.mqttClient && this.mqttClient.isConnected()) {
            const topic = `device/${deviceId}/status`;
            console.log('[debug] sending device status: ' + topic);

            this.mqttClient.publish(
                topic,
                JSON.stringify({
                    device_id: deviceId,
                    device_type: 'camera',
                    ts: getTimestamp(),
                    status: 'alive',
                })
            );
        }
    }

    mqttButtonStatus(deviceId, status, active) {
        if (this.mqttClient && this.mqttClient.isConnected()) {
            console.log('[debug] status button pressed: ' + status);

            const topic = `device/${deviceId}/button`;
            this.mqttClient.publish(
                topic,
                JSON.stringify({
                    device_id: deviceId,
                    device_type: 'camera',
                    ts: getTimestamp(),
                    status: parseInt(active) === 1 ? status : null,
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
                    device_id: deviceId,
                    ts: getTimestamp(),
                })
            );
        });
    }

    stream() {
        let localStream = undefined;
        let $localVideo = $('#local-video');
        let localVideo = $localVideo.get(0);
        let _deviceId;

        let _pc = {};
        let _iceCache = {};
        let _remoteDescriptionSet = {};

        let $btnStartStream = $('#btn-start-stream');
        let $btnStopStream = $('#btn-stop-stream');

        // attach events
        window.onbeforeunload = function () {
            console.log('e: window reload');

            stopLocalStream();
        };

        // attach events
        window.onbeforeunload = function () {
            console.log('e: window reload');
            stopLocalStream();
        };

        const handleICECandidateEvent = (e, clientId, deviceId) => {
            if (e.candidate) {
                const topic = `${deviceId}/ice/${clientId}`;

                console.log('[debug] sending local ICE candidate back to other peer', topic);

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
        const handleOfferMessage = async (clientId, deviceId, offer) => {
            const sdp = JSON.parse(offer);

            if (!sdp || sdp.type !== 'offer') {
                return;
            }

            console.log('');
            console.log(
                '[debug] %cgot remote offer SDP - client_id : ' +
                    clientId +
                    ', device_id: ' +
                    deviceId,
                this.colorReceived
            );

            // this.mqttClient.unsubscribe(`${deviceId}/sdp/+/offer`);
            // console.log('[mqtt_service] unsubscribe: ' + `${deviceId}/sdp/+/offer`);

            console.log('[debug] initializing webrtc connection');

            const key = deviceId + '___' + clientId;
            const webrtcConfig = this.getRtcConfig();

            _remoteDescriptionSet[key] = false;
            _iceCache[key] = [];

            _pc[key] = new RTCPeerConnection(webrtcConfig);
            //_pc[key].addTransceiver('video', { direction: 'sendonly' });
            //_pc[key].addTransceiver('audio', { direction: 'sendonly' });

            console.log('[debug] adding tracks to the RTCPeerConnection');

            // our local stream can provide different tracks, e.g. audio and
            // video. even though we're just using the video track, we should
            // add all tracks to the webrtc connection
            for (const track of localStream.getTracks()) {
                _pc[key]?.addTrack(track, localStream);
            }

            _pc[key].onicecandidate = e => handleICECandidateEvent(e, clientId, deviceId);
            _pc[key].onremovestream = handleRemoveStreamEvent;
            _pc[key].oniceconnectionstatechange = e =>
                handleICEConnectionStateChangeEvent(e, clientId, deviceId);
            _pc[key].onicegatheringstatechange = e =>
                handleICEGatheringStateChangeEvent(e, clientId, deviceId);
            _pc[key].onsignalingstatechange = handleSignalingStateChangeEvent;
            _pc[key].onnegotiationneeded = handleNegotiationNeededEvent;
            _pc[key].ontrack = handleTrackEvent;

            _pc[key]
                .setRemoteDescription(sdp)
                .then(() => {
                    _remoteDescriptionSet[key] = true;

                    console.log('[debug] creating answer');
                    // Now that we've successfully set the remote description, we need to
                    // start our stream up locally then create an SDP answer. This SDP
                    // data describes the local end of our call, including the codec
                    // information, options agreed upon, and so forth.
                    return _pc[key].createAnswer();
                })
                .then(answer => {
                    console.log('[debug] setting local description');

                    // We now have our answer, so establish that as the local description.
                    // This actually configures our end of the call to match the settings
                    // specified in the SDP.
                    return _pc[key].setLocalDescription(answer);
                })
                .then(() => {
                    // We've configured our end of the call now. Time to send our
                    // answer back to the caller so they know that we want to talk
                    // and how to talk to us.

                    const topic = `${deviceId}/sdp/${clientId}`;

                    console.log('[debug] sending answer back to other peer');
                    console.log('[mqtt_service] publish: ' + topic);

                    this.mqttClient.publish(topic, JSON.stringify(_pc[key].localDescription));
                })
                .catch(handleGetUserMediaError);
        };

        // A new ICE candidate has been received from the other peer. Call
        // RTCPeerConnection.addIceCandidate() to send it along to the
        // local ICE framework.
        const handleRemoteIceCandidate = (clientId, deviceId, message) => {
            let ice = JSON.parse(message);
            const key = deviceId + '___' + clientId;

            if (ice && ice.candidate) {
                const descSet =
                    _remoteDescriptionSet[key] !== undefined ? _remoteDescriptionSet[key] : false;

                console.log(
                    '[debug] got remote ICE (remote description set: ' +
                        (descSet ? 'yes' : 'no') +
                        ')'
                );

                if (descSet === true) {
                    _pc[key].addIceCandidate(new RTCIceCandidate(ice));

                    if (_iceCache[key] !== undefined) {
                        while (_iceCache[key].length > 0) {
                            const ice = _iceCache[key].shift();
                            console.log('[debug] adding cached remote ICE');
                            _pc[key].addIceCandidate(new RTCIceCandidate(ice));
                        }
                    }
                } else {
                    if (_iceCache[key] === undefined) {
                        _iceCache[key] = [];
                    }

                    _iceCache[key].push(ice);
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

        function handleICEGatheringStateChangeEvent(event, clientId, deviceId) {
            console.log(
                '[debug] ICE gathering state changed to: ' + event.target.iceGatheringState
            );

            if (event.target.iceGatheringState === 'complete') {
                const key = deviceId + '___' + clientId;

                _remoteDescriptionSet[key] = false;
                _iceCache[key] = [];
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
            console.log('[debug] track event', event);
        }

        // Handle |iceconnectionstatechange| events. This will detect
        // when the ICE connection is closed, failed, or disconnected.
        //
        // This is called when the state of the ICE agent changes.

        function handleICEConnectionStateChangeEvent(event, clientId, deviceId) {
            console.log(
                '[debug] ICE connection state changed to ' + event.target.iceConnectionState
            );

            switch (event.target.iceConnectionState) {
                case 'closed':
                case 'failed':
                case 'disconnected':
                    const key = deviceId + '___' + clientId;

                    _remoteDescriptionSet[key] = false;
                    _iceCache[key] = [];
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

        const stopLocalStream = deviceId => {
            console.log('f: stopLocalStream()', localStream);

            if (localStream) {
                localStream.getTracks().forEach(track => track.stop());
                localStream = null;
            }

            localVideo.srcObject = null;

            for (const key in _pc) {
                const val = _pc[key];

                if (val) {
                    val.close();
                }
            }

            _pc = {};
            _remoteDescriptionSet = {};
            _iceCache = {};

            $localVideo.hide();
            $btnStopStream.hide();
            $btnStartStream.attr('disabled', false).show();
        };

        let deviceStatusTimer;

        // start stream
        $btnStartStream.on('click', e => {
            e.preventDefault();

            if (localStream) {
                console.log('[debug] stream already started');
                return;
            }

            // mqtt connection
            if (!this.checkMqttConnection()) {
                return;
            }

            const deviceId = this.getSelectedDeviceId();

            _pc = {};
            _remoteDescriptionSet = {};
            _iceCache = {};

            $btnStartStream.attr('disabled', 'disabled');

            console.log('[debug] requesting media devices...');
            navigator.mediaDevices
                .getUserMedia({
                    audio: false,
                    video: {
                        facingMode: { ideal: 'environment' },
                    },
                })
                .then(stream => {
                    console.log(
                        '[debug] %cCamera initialized',
                        'background-color:#540101;color:#dbe2ff;font-weight:500'
                    );

                    console.log('[debug] stream started. waiting for signaling!');

                    $btnStartStream.hide();
                    $btnStopStream.show();

                    localStream = stream;
                    localVideo.srcObject = localStream;
                    $localVideo.show();

                    this.mqttClient.subscribe(`${deviceId}/sdp/+/offer`);
                    this.mqttClient.subscribe(`${deviceId}/ice/+/offer`);

                    console.log('[debug] mqtt subscribe: ' + `${deviceId}/sdp/+/offer`);
                    console.log('[debug] mqtt subscribe: ' + `${deviceId}/ice/+/offer`);

                    this.mqttClient.on('message', (topic, message) => {
                        const msg = message ? message.toString() : null;
                        let found;

                        found = topic.match(this.topicRegex['web_rtc_sdp_offer']);
                        if (found) {
                            handleOfferMessage(found[2], found[1], msg);
                        }

                        found = topic.match(this.topicRegex['web_rtc_ice_offer']);
                        if (found) {
                            handleRemoteIceCandidate(found[2], found[1], msg);
                        }
                    });

                    if (deviceStatusTimer) {
                        clearInterval(deviceStatusTimer);
                        deviceStatusTimer = null;
                    }

                    setTimeout(() => {
                        this.sendDeviceStatus(deviceId);
                    }, 1000);

                    deviceStatusTimer = setInterval(() => {
                        this.sendDeviceStatus(deviceId);
                    }, 15000);
                })
                .catch(e => {
                    console.log('[debug] error opening camera: ' + e.message);
                    $btnStartStream.attr('disabled', false);
                });
        });

        $btnStopStream.on('click', e => {
            e.preventDefault();

            let deviceId = this.getSelectedDeviceId();

            // mqtt connection
            stopLocalStream(deviceId);

            // stop sending status messages
            if (deviceStatusTimer) {
                clearInterval(deviceStatusTimer);
                deviceStatusTimer = null;
            }

            $localVideo.hide();
            $btnStopStream.hide();
            $btnStartStream.attr('disabled', false).show();

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

        const locomotiveGps = { lat: 30.672026, lng: -92.260802 };
        let lastGps = Object.assign({}, locomotiveGps);

        const sendGpsPosition = (deviceId, gps) => {
            if (deviceId && deviceId.length) {
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
            }
        };

        // locomotive gps
        $btnAddLoco.on('click', () => {
            const topic = `device/device-0000000000000000/gps`;
            this.mqttClient.publish(
                topic,
                JSON.stringify({
                    ts: getTimestamp(),
                    type: 'locomotive',
                    gps: locomotiveGps,
                })
            );
        });

        // gps

        let gpsTimer = null;
        let gpsWatchTimer = null;
        this.$debug.on('click', '[data-gps]', e => {
            e.preventDefault();

            const $btn = $(e.target);
            const gpsMode = $btn.attr('data-gps') || '';
            const deviceId = this.getSelectedDeviceId();
            const _deviceId = this.getSelectedDeviceId(false);
            let active = parseInt($btn.attr('data-active')) === 1;

            if (gpsMode === 'auto') {
                if (active) {
                    active = false;
                    $btn.attr('data-active', 0).removeClass('btn-success');
                } else {
                    active = true;
                    $btn.attr('data-active', 1).addClass('btn-success');
                }

                if (gpsTimer) {
                    clearInterval(gpsTimer);
                    gpsTimer = null;
                }

                if (gpsWatchTimer) {
                    navigator.geolocation.clearWatch(gpsWatchTimer);
                    gpsWatchTimer = null;
                }

                if (active) {
                    // gps from device
                    if (_deviceId === '') {
                        gpsWatchTimer = navigator.geolocation.watchPosition(
                            position => {
                                sendGpsPosition(deviceId, {
                                    lat: position.coords.latitude,
                                    lng: position.coords.longitude,
                                });
                            },
                            error => {
                                console.log(
                                    '[debug] failed to read GPS position - error: ',
                                    error.message
                                );
                            },
                            {
                                enableHighAccuracy: true,
                                maximumAge: 5000,
                                timeout: 0,
                            }
                        );

                        // fake gps
                    } else {
                        let gps = this.getRandomCoordinate(lastGps, 5);
                        sendGpsPosition(deviceId, gps);

                        gpsTimer = setInterval(() => {
                            lastGps = this.getRandomCoordinate(lastGps, 15);
                            sendGpsPosition(deviceId, lastGps);
                        }, 2000);
                    }
                }
            } else {
                // gps from device
                if (_deviceId === '') {
                    gpsWatchTimer = navigator.geolocation.getCurrentPosition(
                        position => {
                            sendGpsPosition(deviceId, {
                                lat: position.coords.latitude,
                                lng: position.coords.longitude,
                            });
                        },
                        error => {
                            console.log(
                                '[debug] failed to read GPS position - error: ',
                                error.message
                            );
                        },
                        {
                            enableHighAccuracy: true,
                            maximumAge: 1000,
                            timeout: 3000,
                        }
                    );

                    // fake gps
                } else {
                    let gps = this.getRandomCoordinate(lastGps, 5);
                    sendGpsPosition(deviceId, gps);
                }
            }
        });
    }
}
