import { MqttClient } from '../mqtt/client.js';
import { generateClientId } from '../functions.js';
import {
    sortByMimeTypes,
    arrayBufferToBase64,
    arrayBufferToString,
    RtcMessage,
} from './rtc-utils.js';
import { addWatermarkToImage, addWatermarkToStream } from './watermark.js';
import { ConsoleColors } from './../utils.js';
import * as TrackUtils from './track-utils.js';

// https://www.micahbird.com/p/how-to-fix-webrtc-connection-issues-on-ungoogled-chromium/
// https://stackoverflow.com/questions/60387691/remote-video-not-showing-up-on-one-end-webrtc-video-chat-app
// https://stackoverflow.com/questions/62020695/webrtc-stuck-in-connecting-state

// const MetadataCommand_LATEST = 'LATEST'
// const MetadataCommand_OLDER = 'OLDER'
// const MetadataCommand_SPECIFIC_TIME = 'SPECIFIC_TIME'

const CommandType_CONNECT = 'CONNECT';
const CommandType_SNAPSHOT = 'SNAPSHOT';
// const CommandType_METADATA = 'METADATA'
// const CommandType_RECORD = 'RECORD'
// const CommandType_UNKNOWN = 'UNKNOWN'

const MQTT_SDP_TOPIC = 'sdp';
const MQTT_ICE_TOPIC = 'ice';

// For answerer: NEVER add ICE candidates until that peer generates/creates answer SDP
// Stop adding ICE candidates when remote stream starts flowing
// Don't create peer connection for answerer until you get offer SDP

export class PiCamera {
    options = {};
    cameraId = undefined;

    mqtt = undefined;
    mqttClientId = undefined;

    rtcTimer = undefined;
    rtcPeer = undefined;
    remoteDescriptionSet = false;
    makingOffer = false;
    reconnectPeer = false;
    dataChannel = undefined;
    localStream = undefined;
    remoteStream = undefined;
    mediaElement = undefined;
    transformFn = undefined;

    _iceCandidateList = [];
    receivedLength = 0;
    isFirstPacket = true;
    completeFile = new Uint8Array();

    constructor(cameraId, options, mqttOptions, mqttClient) {
        this.options = this.initializeOptions(options);
        this.mqtt = mqttClient;

        this.cameraId = cameraId;

        // debug
        if (
            (!this.options.hasOwnProperty('app') ||
                !this.options.app.hasOwnProperty('debug') ||
                this.options.app.debug !== false) &&
            (!this.options.hasOwnProperty('camera') ||
                !this.options.camera.hasOwnProperty('debug') ||
                this.options.camera.debug !== false) &&
            typeof console != 'undefined'
        ) {
            this.debug = console.log.bind(console);
        } else {
            this.debug = function (message) {};
        }

        this.debug('[picamera] %s | initializing...', this.cameraId, this.options);

        // mqtt
        this.initMqtt(app?.getMqttClient());
    }

    initializeOptions(options) {
        const defaultOptions = {
            debug: false,
            timeout: 5000,
            datachannelOnly: false,
            isMicOn: false,
            isSpeakerOn: false,
            showClock: false,
            stunUrls: [],
            turnUrls: [],
            turnUsername: '',
            turnPassword: '',
            enableAi: false,
        };

        let opt = { ...defaultOptions, ...options };

        // remove duplicates
        opt.stunUrls = [...new Set(opt.stunUrls)];
        opt.turnUrls = [...new Set(opt.turnUrls)];

        return opt;
    }

    setOptions(options) {
        this.options = { ...this.options, ...options };
    }

    initMqtt(mqttClient) {
        if (mqttClient && typeof mqttClient === 'object') {
            this.mqtt = mqttClient;
            this.mqttClientId = mqttClient.client.options.clientId;

            this.mqtt.on('connect', () => {
                console.log('[picamera][mqtt] event: connect ');
            });

            // signaling
            const sdpTopic = this.constructTopic(MQTT_SDP_TOPIC);
            const iceTopic = this.constructTopic(MQTT_ICE_TOPIC);
            this.debug('[picamera][mqtt] ' + this.cameraId + ' | subscribe: ' + sdpTopic);
            this.debug('[picamera][mqtt] ' + this.cameraId + ' | mqtt subscribe: ' + iceTopic);
            this.mqtt.subscribe(sdpTopic, this.handleSdpMessage);
            this.mqtt.subscribe(iceTopic, this.handleIceMessage);

            //this.mqtt.on('disconnect', () => this.mqttDisconnected());
        }
    }

    attach(mediaElement) {
        this.mediaElement = null;
        this.mediaElement = mediaElement;
    }

    async connect(reconnectPeer) {
        let offer;

        // reconnect peer
        // if (reconnectPeer === true) {
        //     this.debug('[picamera] ----------------------------------------------------------');
        //     this.debug('[picamera] ----------------------------------------------------------');
        //     this.debug('[picamera] ' + this.cameraId + ' | reconnecting');

        //     offer = await this.rtcPeer.createOffer({
        //         OfferToReceiveAudio: false,
        //         OfferToReceiveVideo: false,
        //         iceRestart: true,
        //     });

        //     await this.rtcPeer.setLocalDescription(offer);

        //     const topic = this.constructTopic(MQTT_SDP_TOPIC, '/offer');
        //     this.debug(
        //         '[picamera] ' + this.cameraId + ' | %csending local SDP (' + offer.type + ')',
        //         ConsoleColors.green,
        //         '| ' + topic
        //     );
        //     this.mqtt.publish(topic, JSON.stringify(this.rtcPeer.localDescription));
        //     return;
        // }

        // create webrtc peer connection
        this.rtcPeer = await this.createPeer();

        this.debug('[picamera] ' + this.cameraId + ' -----------------------------------');
        this.debug('[picamera] ' + this.cameraId + ' -----------------------------------');
        this.debug('[picamera] ' + this.cameraId + ' | connect');

        // new offer
        offer = await this.rtcPeer.createOffer({
            OfferToReceiveAudio: false,
            OfferToReceiveVideo: true,
        });

        // set the generated SDP to be our local session description
        this.debug('[picamera] ' + this.cameraId + ' | setting local description', offer);
        await this.rtcPeer.setLocalDescription(offer);

        const topic = this.constructTopic(MQTT_SDP_TOPIC, '/offer');
        this.debug(
            '[picamera] ' + this.cameraId + ' | %csending local SDP (' + offer.type + ')',
            ConsoleColors.green,
            '| ' + topic
        );
        this.mqtt.publish(topic, JSON.stringify(this.rtcPeer.localDescription));

        this.rtcTimer = setTimeout(() => {
            let state = this.rtcPeer?.connectionState;

            if (state === 'connected' || state === 'closed') {
                return;
            }

            this.debug(
                '[picamera] ' + this.cameraId + ' | %cdisconnecting on timeout',
                ConsoleColors.red,
                '(' + this.options.timeout + ' ms) - client id: ' + this.cameraId
            );

            if (this.onTimeout) {
                this.onTimeout();
            }
        }, this.options.timeout);
    }

    async reconnect() {
        this.debug('[picamera] reconnect');

        if (this.reconnectPeer) {
            this.connect(true);
        } else {
            this.terminate();

            setTimeout(() => {
                this.connect();
            }, 1000);
        }
    }

    getRtcConfig() {
        let config = {};

        config.iceServers = [];
        config.iceCandidatePoolSize = 1;
        config.bundlePolicy = 'max-bundle';

        // STUN servers
        if (this.options.stunUrls && this.options.stunUrls.length > 0) {
            config.iceServers.push({ urls: this.options.stunUrls });
        }

        // TURN servers
        if (this.options.turnUrls && typeof this.options.turnUrls === 'object') {
            config.iceServers.push({
                urls: this.options.turnUrls,
                username: this.options.turnUsername,
                credential: this.options.turnPassword,
            });
        }

        return config;
    }

    createPeer = async () => {
        const peer = new RTCPeerConnection(this.getRtcConfig());

        this.remoteDescriptionSet = false;
        this._iceCandidateList = new Array();

        // local stream
        // this.localStream = await navigator.mediaDevices.getUserMedia({
        //     audio: true,
        //     video: false,
        // });

        // this.localStream.getAudioTracks().forEach(track => {
        //     peer.addTrack(track, this.localStream);
        //     track.enabled = this.options.isMicOn ?? false;
        // });

        peer.addTransceiver('video', { direction: 'recvonly' });
        peer.addTransceiver('audio', { direction: 'recvonly' });

        peer.ontrack = e => {
            this.debug('[picamera] ' + this.cameraId + ' | %cnew track added', ConsoleColors.red);
            this.debug(
                '[picamera] %s | enable AI: ' + (this.options.enableAi ? 'yes' : 'no'),
                this.cameraId
            );

            this.remoteStream = new MediaStream();

            if (e.streams && e.streams.length) {
                e.streams[0].getTracks().forEach(track => {
                    this.remoteStream?.addTrack(track);

                    // audio
                    if (track.kind === 'audio') {
                        track.enabled = this.options.isSpeakerOn ?? false;
                    }

                    // video
                    // if (track.kind === 'video') {
                    // }
                });
            } else {
                this.remoteStream?.addTrack(e.track);
            }

            if (this.mediaElement) {
                // our "clean" transform factory
                this.transformFn = TrackUtils.cleanStream();

                if (this.options.enableAi === true) {
                    // enable Ai
                    // start the video processing pipeline

                    // create a transform function and assign it to transformFn variable
                    let transformFn = TrackUtils.detectPersonsBoundingBox({
                        stream: this.mediaElement,
                    });

                    const pTrack = TrackUtils.createProcessedTrack({
                        track: this.remoteStream.getVideoTracks()[0],
                        transform: transformFn,
                    });

                    const processedStream = new MediaStream();
                    processedStream.addTrack(pTrack);

                    this.mediaElement.srcObject = processedStream;
                } else {
                    this.mediaElement.srcObject = this.remoteStream;
                }

                //this.mediaElement.srcObject = this.remoteStream;
                // if (this.options.showClock) {
                //     this.mediaElement.srcObject = addWatermarkToStream(this.remoteStream, ':)');
                // } else {
                //     this.mediaElement.srcObject = this.remoteStream;
                // }
            }
        };

        peer.onicecandidate = event => this.onicecandidateCallback(event);
        peer.onnegotiationneeded = event => this.onnegotiationneededCallback(event);
        peer.oniceconnectionstatechange = event => this.oniceconnectionstatechangeCallback(event);
        peer.onconnectionstatechange = event => this.onconnectionstatechangeCallback(event);
        peer.onsignalingstatechange = event => this.onsignalingstatechangeCallback(event);

        /*
        this.dataChannel = peer.createDataChannel(generateClientId(10), {
            negotiated: true,
            ordered: true,
            id: 0,
        });

        this.dataChannel.binaryType = 'arraybuffer';
        this.dataChannel.addEventListener('open', () => {
            if (this.onDatachannel && this.dataChannel) {
                this.onDatachannel(this.dataChannel);
            }
        });

        this.dataChannel.addEventListener('message', e => {
            this.debug('e: dataChannel:message');
            const packet = new Uint8Array(e.data);
            const header = packet[0];
            const body = packet.slice(1);

            switch (header) {
                case CommandType_SNAPSHOT:
                    this.receiveSnapshot(body);
                    break;
            }
        });
        */

        return peer;
    };

    async onnegotiationneededCallback(event) {
        this.debug('[picamera] ' + this.cameraId + ' | %cnegotiationneeded', ConsoleColors.blue);

        // try {
        //     this.makingOffer = true;

        //     const offer = await peer.createOffer();

        //     // set the generated SDP to be our local session description
        //     this.debug('[picamera] setting local description');
        //     await peer.setLocalDescription(offer);

        //     const topic = this.constructTopic(MQTT_SDP_TOPIC, '/offer');
        //     this.debug('[picamera] sending offer to remote peer');
        //     this.debug('[picamera] mqtt publish: ' + topic);
        //     this.mqtt.publish(topic, JSON.stringify(peer.localDescription));
        // } catch (err) {
        //     console.error(err);
        // } finally {
        //     this.makingOffer = false;
        // }
    }

    onicecandidateCallback(event) {
        //this.debug('e: onicecandidate - candidate: ' + (e.candidate ? 'yes' : 'no'));
        if (event.candidate && this.mqtt?.isConnected()) {
            if (!this.isConnected()) {
                const topic = this.constructTopic(MQTT_ICE_TOPIC, '/offer');

                this.debug('[picamera] ' + this.cameraId + ' | sending ICE candidate | ' + topic);
                this.mqtt.publish(topic, JSON.stringify(event.candidate));
            }
        }
    }

    // The connectionState read-only property of the RTCPeerConnection interface
    // indicates the current state of the peer connection by returning one of the
    // following string values: new, connecting, connected, disconnected, failed,
    // or closed.
    onconnectionstatechangeCallback(event) {
        const state = event.target.connectionState;
        let stopTimer = false;

        switch (state) {
            case 'closed':
            case 'connected':
                this.reconnectPeer = false;
                stopTimer = true;
                break;

            case 'disconnected':
            case 'closed':
                this.reconnectPeer = true;
                break;
            default:
                this.reconnectPeer = false;
                break;
        }

        if (stopTimer && this.rtcTimer) {
            clearInterval(this.rtcTimer);
            this.rtcTimer = null;
        }

        if (state === 'connected' || state === 'disconnected') {
            this.debug(
                '[picamera] %s | %cconnectionstatechange: %s',
                this.cameraId,
                ConsoleColors.yellow,
                state
            );
        } else {
            this.debug('[picamera] %s | iceconnectionstatechange: %s', this.cameraId, state);
        }

        // event
        this.onConnectionState?.(state);

        if (this.reconnectPeer) {
            this.reconnect();
        }
    }

    onsignalingstatechangeCallback(event) {
        this.debug(
            '[picamera] ' +
                this.cameraId +
                ' | signalingstatechange: ' +
                event.target.signalingState
        );
    }

    oniceconnectionstatechangeCallback(event) {
        const state = event.target.iceConnectionState;

        if (state === 'connected' || state === 'disconnected') {
            this.debug(
                '[picamera] %s | %ciceconnectionstatechange: %s',
                this.cameraId,
                ConsoleColors.yellow,
                state
            );
        } else {
            this.debug('[picamera] %s | iceconnectionstatechange: %s', this.cameraId, state);
        }

        // switch (state) {
        //     case 'connected':
        //         this.reconnectPeer = false;
        //         break;
        //     case 'failed':
        //     case 'disconnected':
        //         //this.rtcPeer?.restartIce();
        //         this.reconnectPeer = true;
        //         break;
        // }
    }

    restart() {
        if (this.mqtt?.isConnected()) {
            const now = Math.floor(Date.now() / 1000);
            this.mqtt.publish(
                `device/${this.cameraId}/restart`,
                JSON.stringify({
                    ts: now,
                    device_id: cameraId,
                })
            );
        }
    }

    terminate() {
        this.debug('[picamera] ' + this.cameraId + ' | terminate');

        if (this.rtcTimer) {
            clearTimeout(this.rtcTimer);
        }

        this.rtcTimer = null;

        this.makingOffer = false;
        this.reconnectPeer = false;
        this._iceCandidateList = [];

        if (this.dataChannel) {
            if (this.dataChannel.readyState === 'open') {
                const command = new RtcMessage(CommandType_CONNECT, 'false');
                this.dataChannel.send(JSON.stringify(command));
            }

            this.dataChannel.close();
            this.dataChannel = undefined;
        }

        if (this.remoteStream) {
            this.remoteStream.getTracks().forEach(track => {
                track.stop();
            });

            this.remoteStream = undefined;
        }

        if (this.mediaElement) {
            if (!this.mediaElement.paused) {
                this.mediaElement.pause();
            }

            this.mediaElement.removeAttribute('src');
            this.mediaElement.srcObject = null;
        }

        if (this.rtcPeer) {
            this.rtcPeer.ontrack = null;
            this.rtcPeer.onicecandidate = null;
            this.rtcPeer.onnegotiationneeded = null;
            this.rtcPeer.oniceconnectionstatechange = null;
            this.rtcPeer.onconnectionstatechange = null;
            this.rtcPeer.onsignalingstatechange = null;
            this.rtcPeer.close();
        }

        this.rtcPeer = null;

        // if (this.mqtt) {
        //     this.mqtt.disconnect();
        //     this.mqtt = undefined;
        // }

        // trigger event
        this.onConnectionState?.('closed');
    }

    constructTopic(topic, subLevels) {
        let t = `${this.cameraId}/${topic}/${this.mqttClientId}`;
        if (typeof subLevels === 'string') {
            t += subLevels;
        }

        t = t.replace('/{1,}/', '/');

        return t;
    }

    getStatus() {
        if (!this.rtcPeer) {
            return 'new';
        }

        return this.rtcPeer.connectionState;
    }

    isConnected() {
        return this.getStatus() === 'connected';
    }

    snapshot = (quality = 30) => {
        if (this.dataChannel?.readyState === 'open') {
            quality = Math.max(0, Math.min(quality, 100));
            const command = new RtcMessage(CommandType_SNAPSHOT, String(quality));
            this.dataChannel.send(JSON.stringify(command));
        }
    };

    toggleMic = (enabled = !this.options.isMicOn) => {
        this.options.isMicOn = enabled;
        //this.toggleTrack(this.options.isMicOn, this.localStream);
    };

    toggleSpeaker = (enabled = !this.options.isSpeakerOn) => {
        this.options.isSpeakerOn = enabled;
        this.toggleTrack(this.options.isSpeakerOn, this.remoteStream);

        if (this.mediaElement) {
            this.mediaElement.muted = !this.options.isSpeakerOn;
        }
    };

    toggleTrack = (isOn, stream) => {
        stream?.getAudioTracks().forEach(track => {
            track.enabled = isOn;
        });
    };

    receiveSnapshot = body => {
        if (!this.onSnapshot) {
            return;
        }

        if (this.isFirstPacket) {
            this.completeFile = new Uint8Array(Number(arrayBufferToString(body)));
            this.isFirstPacket = false;
        } else if (body.byteLength > 0) {
            this.completeFile.set(body, this.receivedLength);
            this.receivedLength += body.byteLength;
        } else if (body.byteLength === 0) {
            this.receivedLength = 0;
            this.isFirstPacket = true;
            // addWatermarkToImage(
            //     "data:image/jpeg;base64," +
            //         arrayBufferToBase64(this.completeFile),
            //     "github.com/TzuHuanTai"
            // ).then((base64Image) => {
            //     if (this.onSnapshot) {
            //         this.onSnapshot(base64Image);
            //     }
            // });
        }
    };

    handleSdpMessage = message => {
        if (this.makingOffer === true) {
            return;
        }

        if (this.rtcPeer) {
            let sdp;

            try {
                sdp = JSON.parse(message);
            } catch (e) {
                this.debug(
                    '[picamera] %s | mqtt message parsing error: %s',
                    this.mqtt.client.options.clientId,
                    e
                );

                return;
            }

            const topic = this.constructTopic(MQTT_SDP_TOPIC);

            this.debug(
                '[picamera] ' + this.cameraId + ' | %cgot remote SDP',
                ConsoleColors.green,
                '| ' + sdp.type + ' | ' + topic
            );

            this.rtcPeer
                .setRemoteDescription(new RTCSessionDescription(sdp))
                .then(() => {
                    this.remoteDescriptionSet = true;
                    const length = this._iceCandidateList.length;

                    this.debug('[picamera] ' + this.cameraId + ' | remote description set');
                    this.debug(
                        '[picamera] ' +
                            this.cameraId +
                            ' | ice candidate list size to be added: ' +
                            length
                    );

                    while (this._iceCandidateList.length > 0) {
                        const c = this._iceCandidateList.shift();
                        this.rtcPeer.addIceCandidate(c);
                    }
                })
                .catch(err => {
                    console.error(err);
                });
        }
    };

    handleIceMessage = message => {
        if (!this.isConnected()) {
            const candidate = JSON.parse(message);
            if (this.remoteDescriptionSet === true) {
                //console.log(this.rtcPeer);

                this.rtcPeer.addIceCandidate(new RTCIceCandidate(candidate));
                this.debug('[picamera] ' + this.cameraId + ' | got remote ICE candidate - set');
            } else {
                this._iceCandidateList.push(new RTCIceCandidate(candidate));
                this.debug(
                    '[picamera] ' + this.cameraId + ' | got remote ICE candidate - added to list'
                );
            }
        }
    };
}
