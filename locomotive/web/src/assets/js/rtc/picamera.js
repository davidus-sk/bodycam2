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
    // module constructor
    constructor(cameraId, options, mqttOptions, mqttClient) {
        this.options = this.initializeOptions(options);
        this.mqtt = mqttClient;

        this.mqtt = null;
        this.mqttClientId = null;

        this.dataChannel = null;
        this.remoteStream = null;
        this.mediaElement = null;
        this.transformFn = null;
        this.rtcTimer = null;
        this.peer = null;
        this.offer = null;
        this.remoteDescriptionSet = false;
        this.isFirstPacket = true;
        this.receivedLength = 0;
        this.completeFile = new Uint8Array();

        this.cameraId = cameraId;

        this._iceCandidateList = [];

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

        this.debug('[picamera] %s | initializing camera ...', this.cameraId, this.options);

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
            ai: false,
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
                this.debug('[picamera][mqtt] event: connect ');
            });

            // signaling
            const sdpTopic = this.constructTopic(MQTT_SDP_TOPIC);
            const iceTopic = this.constructTopic(MQTT_ICE_TOPIC);

            this.debug('[picamera][mqtt] %s | subscribe: %s', this.cameraId, sdpTopic);
            this.debug('[picamera][mqtt] %s | mqtt subscribe: %s', this.cameraId, iceTopic);

            this.mqtt.subscribe(sdpTopic, this.handleSdpMessage);
            this.mqtt.subscribe(iceTopic, this.handleIceMessage);

            //this.mqtt.on('disconnect', () => this.mqttDisconnected());
        }
    }

    attach(mediaElement) {
        this.mediaElement = null;
        this.mediaElement = mediaElement;
    }

    async connect() {
        // create webrtc peer connection
        this.peer = await this.createPeer();

        this.debug('[picamera] %s -----------------------------------', this.cameraId);
        this.debug('[picamera] %s Connect', this.cameraId);
        this.debug('[picamera] %s -----------------------------------', this.cameraId);

        // new offer
        if (!this.offer) {
            this.debug('[picamera][webrtc] %s | creating offer', this.cameraId);

            this.offer = await this.peer.createOffer({
                OfferToReceiveAudio: false,
                OfferToReceiveVideo: true,
            });

            this.debug(
                '[picamera][webrtc] %s | setting local description',
                this.cameraId,
                this.offer
            );

            // set the generated SDP to be our local session description
            await this.peer.setLocalDescription(this.offer);
        }

        // send offer
        const topic = this.constructTopic(MQTT_SDP_TOPIC, '/offer');
        this.debug(
            '[picamera][webrtc] %s | %csending local offer',
            this.cameraId,
            ConsoleColors.green,
            '| ' + topic
        );

        this.mqtt.publish(topic, JSON.stringify(this.offer));

        this.debug(
            '[picamera] %s | setting connection timeout (%ss)',
            this.cameraId,
            this.options.timeout / 1000
        );

        this.rtcTimer = setTimeout(() => {
            if (this.isConnected()) {
                return;
            }

            this.debug(
                '[picamera][webrtc] %s | %cdisconnecting on timeout',
                this.cameraId,
                ConsoleColors.red,
                '(' + this.options.timeout + ' ms)'
            );

            if (this.onTimeout) {
                this.onTimeout?.('closed');
            }
            //     this.terminate();
        }, this.options.timeout);
    }

    // get connection status
    getStatus() {
        if (!this.peer) {
            return 'new';
        }

        // (new, connecting, connected, disconnected, failed, closed)
        return this.peer.connectionState;
    }

    isConnected() {
        return this.getStatus() === 'connected';
    }

    reconnect(terminate) {
        this.debug(
            '[picamera] %s | reconnect() > ',
            this.cameraId,
            'connection status: ' + this.getStatus()
        );

        if (terminate === true) {
            this.terminate();

            setTimeout(() => {
                this.connect();
            }, 1000);
        } else {
            this.disconnect();
            setTimeout(() => {
                this.connect(true);
            }, 1000);
        }
    }

    disconnect() {
        if (this.rtcTimer) {
            clearTimeout(this.rtcTimer);
        }

        if (this.peer) {
            this.debug('[picamera][webrtc] %s | disconnect()', this.cameraId);
            this.peer.close();
        }

        this.peer = null;
    }

    terminate() {
        this.debug('[picamera] %s |  %cterminate', this.cameraId, ConsoleColors.orange);

        if (this.rtcTimer) {
            clearTimeout(this.rtcTimer);
        }

        // if (this.dataChannel) {
        //     if (this.dataChannel.readyState === 'open') {
        //         const command = new RtcMessage(CommandType_CONNECT, 'false');
        //         this.dataChannel.send(JSON.stringify(command));
        //     }

        //     this.dataChannel.close();
        //     this.dataChannel = undefined;
        // }

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

        if (this.peer) {
            this.peer.close();
        }

        this.offer = null;
        this.remoteDescriptionSet = false;
        this._iceCandidateList = [];
        this.peer = null;

        // trigger event
        this.onConnectionState?.('closed');
    }

    getRtcConfig() {
        let config = {};

        config.iceServers = [];
        config.iceCandidatePoolSize = 10;
        //config.bundlePolicy = 'max-bundle';

        // STUN servers
        if (this.options.stunUrls && this.options.stunUrls.length > 0) {
            this.options.stunUrls.forEach(url => {
                config.iceServers.push({ urls: url });
            });
        }

        // TURN servers
        if (
            this.options.turnUrl &&
            typeof this.options.turnUrl === 'string' &&
            this.options.turnUrl.length
        ) {
            config.iceServers.push({
                urls: this.options.turnUrl,
                username: this.options.turnUsername,
                credential: this.options.turnPassword,
            });
        }

        if (
            this.options.turnUrls &&
            typeof this.options.turnUrls === 'object' &&
            this.options.turnUrls.length
        ) {
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

        //this.remoteDescriptionSet = false;
        this._iceCandidateList = new Array();

        peer.addTransceiver('video', { direction: 'recvonly' });
        peer.addTransceiver('audio', { direction: 'recvonly' });

        peer.onicecandidate = event => this.onicecandidate(event);
        peer.onsignalingstatechange = event => this.onsignalingstatechange(event);
        peer.oniceconnectionstatechange = event => this.oniceconnectionstatechange(event);
        peer.onconnectionstatechange = event => this.onconnectionstatechange(event);
        peer.ontrack = event => this.ontrack(event);

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

    onicecandidate(event) {
        if (event.candidate !== null) {
            // this.debug(
            //     '[picamera][webrtc] %s | onicecandidate - %s',
            //     this.cameraId,
            //     event.candidate ? event.candidate.candidate : '???'
            // );

            if (this.mqtt?.isConnected()) {
                const topic = this.constructTopic(MQTT_ICE_TOPIC, '/offer');

                this.debug(
                    '[picamera][webrtc] %s | sending ICE candidate > %s: %s',
                    this.cameraId,
                    topic,
                    event.candidate ? event.candidate.candidate : '???'
                );

                this.mqtt.publish(topic, JSON.stringify(event.candidate));
            }
        }
    }

    // The connectionState read-only property of the RTCPeerConnection interface
    // indicates the current state of the peer connection by returning one of the
    // following string values: new, connecting, connected, disconnected, failed,
    // or closed.
    //
    // Before calling RTCPeerConnection.close(), it's crucial to ensure that the
    // connection is either connected or failed. Closing connections in transitional
    // states (connecting or disconnected) can lead to issues and can cause the
    // application to become unresponsive.
    onconnectionstatechange(event) {
        let stopTimer = false;
        let reconnect = false;

        this.debug(
            '[picamera][webrtc] %s | %conconnectionstatechange: %s',
            this.cameraId,
            ConsoleColors.yellow,
            this.peer.connectionState
        );

        switch (this.peer.connectionState) {
            case 'connected':
                stopTimer = true;
                break;

            // case 'disconnected':
            //     break;

            case 'failed':
                stopTimer = true;
                reconnect = true;
                break;

            // case 'closed':
            //     reconnect = true;
            //     break;
        }

        if (stopTimer && this.rtcTimer) {
            clearTimeout(this.rtcTimer);
            this.rtcTimer = null;
        }

        // event
        this.onConnectionState?.(this.peer.connectionState);

        if (reconnect) {
            this.reconnect();
        }
    }

    onsignalingstatechange(event) {
        this.debug(
            '[picamera][webrtc] %s | %csignalingstatechange: %s',
            this.cameraId,
            ConsoleColors.blue,
            event.target.signalingState
        );

        switch (this.peer.signalingState) {
            case 'stable':
                //case 'have-remote-offer':
                this.debug('[picamera][webrtc] %s | ICE negotiation complete', this.cameraId);

                while (this._iceCandidateList.length > 0) {
                    const c = this._iceCandidateList.shift();
                    this.peer.addIceCandidate(c);
                }

                break;
        }
    }

    oniceconnectionstatechange(event) {
        const state = event.target.iceConnectionState;

        if (state === 'connected' || state === 'disconnected') {
            //this._iceCandidateList = [];

            this.debug(
                '[picamera][webrtc] %s | %ciceconnectionstatechange: %s',
                this.cameraId,
                ConsoleColors.yellow,
                state
            );
        } else {
            this.debug(
                '[picamera][webrtc] %s | iceconnectionstatechange: %s',
                this.cameraId,
                state
            );
        }
    }

    ontrack(event) {
        this.debug('[picamera] %s| %cnew track added', this.cameraId, ConsoleColors.pink);
        this.debug('[picamera] %s | enable AI: %s', this.cameraId, this.options.ai ? 'yes' : 'no');

        this.remoteStream = new MediaStream();

        if (event.streams && event.streams.length) {
            event.streams[0].getTracks().forEach(track => {
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
            this.remoteStream?.addTrack(event.track);
        }

        if (this.mediaElement) {
            // our "clean" transform factory
            this.transformFn = TrackUtils.cleanStream();

            if (this.options.ai === true) {
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

    constructTopic(topic, subLevels) {
        let t = `${this.cameraId}/${topic}/${this.mqttClientId}`;
        if (typeof subLevels === 'string') {
            t += subLevels;
        }

        t = t.replace('/{1,}/', '/');

        return t;
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
        if (!this.peer) {
            return;
        }

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
            '[picamera][webrtc] ' + this.cameraId + ' | %creceived remote SDP (%s)',
            ConsoleColors.green,
            sdp.type,
            ' | ' + topic
        );

        if (this.peer.signalingState !== 'stable') {
            this.peer
                .setRemoteDescription(new RTCSessionDescription(sdp))
                .then(() => {
                    //this.remoteDescriptionSet = true;

                    this.debug('[picamera][webrtc] %s | remote description set', this.cameraId);
                })
                .catch(err => {
                    this.debug(
                        '[picamera] %s | %cerror -> %s',
                        this.cameraId,
                        ConsoleColors.error,
                        err
                    );
                    //Failed to set remote answer sdp: Called in wrong state: stable
                });
        }
    };

    handleIceMessage = async message => {
        //if (!this.isConnected() && this.peer) {
        if (this.peer) {
            const candidate = JSON.parse(message);

            //  && this.peer.signalingState === 'stable'
            if (this.peer.remoteDescription) {
                this.debug(
                    '[picamera][webrtc] %s | %creceived remote ICE candidate (set)',
                    this.cameraId,
                    ConsoleColors.green
                );

                try {
                    await this.peer.addIceCandidate(candidate);
                } catch (e) {
                    this.debug(
                        '[picamera][webrtc] %s | error: failure during addIceCandidate(): %s',
                        this.cameraId,
                        e.name
                    );
                }
            } else {
                this._iceCandidateList.push(candidate);
                this.debug(
                    '[picamera][webrtc] %s | %creceived remote ICE candidate (queue)',
                    this.cameraId,
                    ConsoleColors.green,
                    '< ',
                    candidate
                );
            }
        }
    };

    aiStatus = status => {
        if (status === true) {
            this.transformFn = TrackUtils.detectPersonsBoundingBox({
                stream: this.mediaElement,
            });
        } else {
            this.transformFn = TrackUtils.cleanStream();
        }
    };
}
