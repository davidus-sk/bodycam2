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

// For answerer: NEVER add ICE candidates until that peer generates/creates answer SDP
// Stop adding ICE candidates when remote stream starts flowing
// Don't create peer connection for answerer until you get offer SDP

export class PiCamera {
    // module constructor
    constructor(cameraId, options, mqttOptions, mqttClient) {
        this.options = this.initializeOptions(options);

        this.dataChannel = null;
        this.remoteStream = null;
        this.mediaElement = null;
        this.transformFn = null;
        this.rtcTimer = null;
        this.peer = null;
        this.offer = null;
        this.isFirstPacket = true;
        this.receivedLength = 0;
        this.completeFile = new Uint8Array();

        this.cameraId = cameraId;

        this._iceCandidates_local = [];
        this._iceCandidates_remote = [];

        // debug
        if (
            (!this.options.hasOwnProperty('app') ||
                !this.options.app.hasOwnProperty('debug') ||
                this.options.app.debug !== false) &&
            (!this.options.hasOwnProperty('debug') || this.options.debug !== false) &&
            typeof console != 'undefined'
        ) {
            this.debug = console.log.bind(console);
        } else {
            this.debug = function (message) {};
        }

        this.debug('[picam] %s | initializing the camera', this.cameraId, this.options);

        // mqtt
        this.initMqtt(mqttClient);
    }

    initializeOptions(options) {
        const defaultOptions = {
            debug: false,
            timeout: 15000,
            datachannelOnly: false,
            isMicOn: false,
            isSpeakerOn: false,
            showClock: false,
            stunUrl: '',
            stunUrls: [],
            turnUrl: '',
            turnUrls: [],
            turnUsername: '',
            turnPassword: '',
            iceTransportPolicy: 'all',
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

            const clientId = mqttClient.client.options.clientId;

            // topics
            this.mqttTopicLocalSdp = `${this.cameraId}/sdp/${clientId}/offer`;
            this.mqttTopicRemoteSdp = `${this.cameraId}/sdp/${clientId}`;
            this.mqttTopicLocalIce = `${this.cameraId}/ice/${clientId}/offer`;
            this.mqttTopicRemoteIce = `${this.cameraId}/ice/${clientId}`;

            this.mqttClientId = clientId;

            this.mqtt.on('connect', () => {
                this.debug('[picam][mqtt] event: connect ');
            });

            // signaling
            this.debug('[picam] %s | mqtt subscribed: %s', this.cameraId, this.mqttTopicRemoteSdp);
            this.debug('[picam] %s | mqtt subscribed: %s', this.cameraId, this.mqttTopicRemoteIce);

            this.mqtt.subscribe(this.mqttTopicRemoteSdp, this.handleSdpMessage);
            this.mqtt.subscribe(this.mqttTopicRemoteIce, this.handleIceMessage);

            //this.mqtt.on('disconnect', () => this.mqttDisconnected());
        }
    }

    attach(mediaElement) {
        this.mediaElement = mediaElement;
    }

    async connect() {
        this.debug('[picam] %s | connect()', this.cameraId);

        // Check if already connected
        if (
            this.peer &&
            (this.peer.connectionState === 'connected' ||
                this.peer.connectionState === 'connecting')
        ) {
            this.debug(
                '[picam] %s | connect() - already connected/connecting (state: %s)',
                this.cameraId,
                this.peer.connectionState
            );

            return;
        }

        if (!this.mqtt?.isConnected()) {
            this.debug('[picam] %s | connect() - mqtt is not connected!', this.cameraId);
            return;
        }

        try {
            // create webrtc peer connection
            this.peer = await this.createPeer();

            // new offer
            this.debug(
                '[picam] %s | webrtc - %ccreateOffer()',
                this.cameraId,
                ConsoleColors.pink,
                '| connectionState: ' + this.peer.connectionState,
                '| signalingState: ' + this.peer.signalingState
            );

            // create the offer
            this.offer = await this.peer.createOffer();
            this.debug('[picam] %s | webrtc - offer', this.cameraId, this.offer);
            this.debug('[picam] %s | webrtc - setLocalDescription(offer)', this.cameraId);

            // Null check before setLocalDescription
            if (!this.peer) {
                throw new Error('Peer connection closed during offer creation');
            }

            // set the generated SDP to be our local session description
            await this.peer.setLocalDescription(this.offer);

            // Null check after setLocalDescription
            if (!this.peer) {
                throw new Error('Peer connection closed after setLocalDescription');
            }

            // check mqtt is still connected before publishing
            if (!this.mqtt?.isConnected()) {
                throw new Error('MQTT disconnected during connection setup');
            }

            // send local SDP offer to the mqtt broker
            this.mqtt.publish(this.mqttTopicLocalSdp, JSON.stringify(this.offer));
            this.debug(
                '[picam] %s | webrtc - %c>>> sending local SDP (offer)',
                this.cameraId,
                ConsoleColors.green,
                '> ' + this.mqttTopicLocalSdp
            );

            // set connection timeout
            this.debug(
                '[picam] %s | webrtc - setting connection timeout (%s ms)',
                this.cameraId,
                this.options.timeout
            );

            // connection timeout
            this.rtcTimer = setTimeout(() => {
                if (this.isConnected()) {
                    return;
                }

                this.debug(
                    '[picam] %s | webrtc - %cdisconnecting on timeout (%s ms)',
                    this.cameraId,
                    ConsoleColors.warning,
                    this.options.timeout
                );

                // callback event
                //this.onTimeout?.('timed_out');

                // stop ICE gathering by closing the peer
                this.disconnect();
            }, this.options.timeout);
        } catch (error) {
            this.debug(
                '[picam] %s | webrtc - %cerror during connect(): %s',
                this.cameraId,
                ConsoleColors.error,
                error.message || error
            );

            // clean up on error
            this.disconnect();

            // notify error via callback
            this.onConnectionState?.('failed');
        }
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

    reconnect() {
        this.debug('[picam] %s | reconnect()', this.cameraId);

        // disconnect
        this.disconnect();

        // connect
        setTimeout(() => {
            this.connect();
        }, 1000);
    }

    disconnect() {
        // clear connection timeout
        if (this.rtcTimer) {
            clearTimeout(this.rtcTimer);
            this.rtcTimer = null;
        }

        if (this.remoteStream) {
            this.remoteStream.getTracks().forEach(track => {
                track.stop();
            });

            this.remoteStream = null;
        }

        // close peer connection
        if (this.peer) {
            this.peer.close();
        }

        this.debug(
            '[picam] %s | webrtc - %cdisconnect()',
            this.cameraId,
            ConsoleColors.warning,
            '| connectionState: ' + (this.peer ? this.peer.connectionState : 'unknown'),
            '| signalingState: ' + (this.peer ? this.peer.signalingState : 'unknown')
        );

        // connection state event
        this.onConnectionState?.(this.peer ? this.peer.connectionState : 'closed');

        // reset all connection state
        this.peer = null;
        this.offer = null;
        this._iceCandidates_local = [];
        this._iceCandidates_remote = [];
    }

    terminate() {
        if (this.peer) {
            this.debug(
                '[picam] %s | %cterminate()',
                this.cameraId,
                ConsoleColors.warning,
                '| connectionState: ' + this.peer.connectionState,
                '| signalingState: ' + this.peer.signalingState
            );
        } else {
            this.debug('[picam] %s | %cterminate()', this.cameraId, ConsoleColors.warning);
        }

        // if (this.dataChannel) {
        //     if (this.dataChannel.readyState === 'open') {
        //         const command = new RtcMessage(CommandType_CONNECT, 'false');
        //         this.dataChannel.send(JSON.stringify(command));
        //     }

        //     this.dataChannel.close();
        //     this.dataChannel = undefined;
        // }

        if (this.peer) {
            this.disconnect();
        }

        if (this.mediaElement) {
            if (!this.mediaElement.paused) {
                this.mediaElement.pause();
            }

            this.mediaElement.removeAttribute('src');
            this.mediaElement.srcObject = null;
        }
    }

    getRtcConfig() {
        let config = {};

        config.iceServers = [];
        // config.iceCandidatePoolSize = 1;
        // config.icetransportpolicy = 'relay';
        // config.rtcpmuxpolicy = 'negotiate';

        // ICE stun, turn configuration:
        // iceServers (optional)
        // An array of objects, each describing one server which may be used by
        // the ICE agent; these are typically STUN and/or TURN servers. If this isn't
        // specified, the connection attempt will be made with no STUN or TURN server
        // available, which limits the connection to local peers.

        // 'urls':
        // This required property is either a single string or an array of strings,
        // each specifying a URL which can be used to connect to the server.
        //
        // 'credential' (optional)
        // The credential to use when logging into the server.
        // This is only used if the object represents a TURN server

        // ---------------------------------------------
        // STUN servers
        // ---------------------------------------------
        if (
            this.options.stunUrl &&
            typeof this.options.stunUrl === 'string' &&
            this.options.stunUrl.length
        ) {
            // string
            config.iceServers.push({
                urls: this.options.stunUrl,
            });
        }

        if (
            this.options.stunUrls &&
            typeof this.options.stunUrls === 'object' &&
            this.options.stunUrls.length
        ) {
            // array
            for (const url of this.options.stunUrls) {
                config.iceServers.push({
                    urls: url,
                });
            }
        }

        // ---------------------------------------------
        // TURN servers
        // ---------------------------------------------
        if (
            this.options.turnUrl &&
            typeof this.options.turnUrl === 'string' &&
            this.options.turnUrl.length
        ) {
            // string
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
            // array
            for (const url of this.options.turnUrls) {
                config.iceServers.push({
                    urls: url,
                    username: this.options.turnUsername,
                    credential: this.options.turnPassword,
                });
            }
        }

        // ICE transport policy - use 'relay' to force TURN for cross-network connections
        // Options: 'all' (default), 'relay' (force TURN only)
        if (this.options.iceTransportPolicy) {
            config.iceTransportPolicy = this.options.iceTransportPolicy;
        }

        return config;
    }

    createPeer = async () => {
        const webrtcConfig = this.getRtcConfig();
        const peer = new RTCPeerConnection(webrtcConfig);

        this.debug('[picam] %s | webrtc - RTCPeerConnection()', this.cameraId, webrtcConfig, peer);

        this._iceCandidates_local = [];
        this._iceCandidates_remote = [];

        peer.addTransceiver('video', { direction: 'recvonly' });
        //peer.addTransceiver('audio', { direction: 'recvonly' });

        this.debug('[picam] %s | webrtc - setting up the listeners', this.cameraId);

        peer.onicecandidate = event => this.onicecandidate(event);
        peer.onconnectionstatechange = event => this.onconnectionstatechange(event);
        peer.onsignalingstatechange = event => this.onsignalingstatechange(event);
        peer.onicegatheringstatechange = event => this.onicegatheringstatechange(event);
        peer.oniceconnectionstatechange = event => this.oniceconnectionstatechange(event);
        peer.ontrack = event => this.ontrack(event);
        peer.addEventListener('icecandidateerror', event => this.onicecandidateerror(event));

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
        if (!event.candidate) return;

        const candidate = JSON.stringify(event.candidate);

        // add to queue
        this._iceCandidates_local.push(candidate);

        // try to send the candidate
        // (MQTT must be connected and remoteDescription already set)
        this.flushLocalIceQueue();
    }

    // new, connecting, connected, disconnected, closed, failed
    onconnectionstatechange(event) {
        if (!this.peer) {
            return;
        }

        let stopTimer = false;
        let reconnect = false;

        this.debug(
            '[picam] %s | webrtc - %conconnectionstatechange: %s',
            this.cameraId,
            ConsoleColors.yellow,
            this.peer.connectionState
        );

        switch (this.peer.connectionState) {
            case 'connected':
                this._iceCandidates_local = [];
                this._iceCandidates_remote = [];
                break;
            case 'disconnected':
            case 'failed':
            case 'closed':
                this._iceCandidates_local = [];
                this._iceCandidates_remote = [];
                stopTimer = true;
                reconnect = true;

                break;
        }

        if (stopTimer) {
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
        if (this.peer) {
            if (this.peer.signalingState === 'stable') {
                this.debug(
                    '[picam] %s | webrtc - %consignalingstatechange: %s',
                    this.cameraId,
                    ConsoleColors.blue,
                    this.peer.signalingState
                );
            } else {
                this.debug(
                    '[picam] %s | webrtc - onsignalingstatechange: %s',
                    this.cameraId,
                    this.peer.signalingState
                );
            }
        }
    }

    onicegatheringstatechange(event) {
        const state = event.target.iceGatheringState;
        this.debug('[picam] %s | webrtc - icegatheringstatechange: %s', this.cameraId, state);
    }

    oniceconnectionstatechange(event) {
        const state = event.target.iceConnectionState;

        this.debug('[picam] %s | webrtc - iceconnectionstatechange: %s', this.cameraId, state);

        // if (state === 'connected' || state === 'disconnected') {
        // } else {
        //     if (state === 'failed') {
        //         this.peer.restartIce();
        //     }
        // }
    }

    onicecandidateerror(event) {
        // -----
        // event.errorCode >= 300 && event.errorCode <= 699
        // -----
        // STUN errors are in the range 300-699. See RFC 5389, section 15.6
        // for a list of codes. TURN adds a few more error codes; see
        // RFC 5766, section 15 for details.

        // -----
        // event.errorCode >= 700 && event.errorCode <= 799
        // -----
        // Server could not be reached; a specific error number is
        // provided but these are not yet specified.

        this.debug(
            '[picam] %s | webrtc - %conicecandidateerror (error code: %s)',
            this.cameraId,
            ConsoleColors.orange,
            event.errorCode,
            event
        );
    }

    ontrack(event) {
        this.debug('[picam] %s | webrtc - new track added', this.cameraId);
        this.debug(
            '[picam] %s | webrtc - enable AI: %s',
            this.cameraId,
            this.options.ai ? 'yes' : 'no'
        );

        // Clean up existing remote stream before reassignment to prevent memory leaks
        if (this.remoteStream) {
            this.remoteStream.getTracks().forEach(track => {
                track.stop();
            });
        }

        if (event.streams && event.streams[0]) {
            this.remoteStream = event.streams[0];
        } else {
            this.remoteStream = new MediaStream();
            this.remoteStream.addTrack(event.track);
        }

        // audio
        this.remoteStream.getAudioTracks().forEach(t => {
            t.enabled = !!this.options.isSpeakerOn;
        });

        // this.remoteStream = new MediaStream();

        // if (event.streams && event.streams.length) {
        //     event.streams[0].getTracks().forEach(track => {
        //         this.remoteStream?.addTrack(track);

        //         // audio
        //         if (track.kind === 'audio') {
        //             track.enabled = this.options.isSpeakerOn ?? false;
        //         }

        //         // video
        //         // if (track.kind === 'video') {
        //         // }
        //     });
        // } else {
        //     this.remoteStream?.addTrack(event.track);
        // }

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

            this.mediaElement.muted = true;
            this.mediaElement.play().catch(() => {});

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
                    device_id: this.cameraId,
                })
            );
        }
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
                '[picam] %s | webrtc - %cfailed to decode remote SDP: %s',
                this.mqtt.client.options.clientId,
                ConsoleColors.error,
                e
            );

            return;
        }

        this.debug(
            '[picam] %s | webrtc - %c<<< received remote SDP (%s)',
            this.cameraId,
            ConsoleColors.pink,
            sdp.type,
            '| connectionState: ' + this.peer.connectionState,
            '| signalingState: ' + this.peer.signalingState,
            '| topic: ' + this.mqttTopicRemoteSdp
            //sdp.sdp
        );

        if (sdp.type !== 'answer') {
            this.debug(
                '[picam] %s | webrtc - %c<<< invalid SDP type: %s',
                this.cameraId,
                ConsoleColors.error,
                sdp.type
            );

            return;
        }

        // Check if we're in the correct state to receive an answer
        // For the offerer, we should be in 'have-local-offer' state
        if (this.peer.signalingState !== 'have-local-offer') {
            this.debug(
                '[picam] %s | webrtc - %cignoring remote answer - wrong signaling state: %s (expected: have-local-offer)',
                this.cameraId,
                ConsoleColors.warning,
                this.peer.signalingState
            );

            return;
        }

        this.peer
            .setRemoteDescription(new RTCSessionDescription(sdp))
            .then(() => {
                this.debug('[picam] %s | webrtc - setRemoteDescription()', this.cameraId);

                // set remote candidates
                this.setRemoteIceQueue();

                // send local candidates
                this.flushLocalIceQueue();
            })
            .catch(err => {
                this.debug('[picam] %s | %cerror -> %s', this.cameraId, ConsoleColors.error, err);
            });
    };

    handleIceMessage = async message => {
        //if (!this.isConnected() && this.peer) {
        if (this.peer) {
            const candidate = JSON.parse(message);

            if (typeof candidate !== 'object') {
                this.debug(
                    '[picam] %s | webrtc - !!! ICE (received) - invalid format',
                    this.cameraId,
                    '| connectionState: ' + this.peer.connectionState,
                    '| signalingState: ' + this.peer.signalingState
                );

                return;
            }

            if (candidate.candidate === null) {
                this.debug(
                    '[picam] %s | webrtc - ICE (received) - client finished gathering',
                    this.cameraId,
                    '| connectionState: ' + this.peer.connectionState,
                    '| signalingState: ' + this.peer.signalingState
                );

                return;
            }

            this.setRemoteIceQueue(candidate);
        }
    };

    setRemoteIceQueue = candidate => {
        if (this.peer && this.peer.connectionState === 'connected') return;

        if (candidate) {
            this._iceCandidates_remote.push(candidate);
        }

        // we need answer (remote description)
        if (this.peer && this.peer.remoteDescription) {
            this.debug(
                '[picam] %s | webrtc - ICE (received) - set',
                this.cameraId,
                ' | connectionState: ' + this.peer.connectionState,
                ' | signalingState: ' + this.peer.signalingState,
                candidate
                    ? candidate.candidate.length > 75
                        ? candidate.candidate.substring(0, 75) + '...'
                        : candidate.candidate
                    : ''
            );

            while (this._iceCandidates_remote.length > 0) {
                const c = this._iceCandidates_remote.shift();

                try {
                    this.peer.addIceCandidate(c);
                } catch (e) {
                    this.debug(
                        '[picam] %s | webrtc - %cerror: failure during addIceCandidate(): %s',
                        this.cameraId,
                        ConsoleColors.warning,
                        e
                    );
                }
            }
        } else {
            this.debug(
                '[picam] %s | webrtc - ICE (received) - queue',
                this.cameraId,
                '| connectionState: ' + this.peer.connectionState,
                '| signalingState: ' + this.peer.signalingState,
                '| remoteDescription: ' + this.peer.remoteDescription,
                candidate.candidate.length > 75
                    ? candidate.candidate.substring(0, 75) + '...'
                    : candidate.candidate
            );
        }
    };

    flushLocalIceQueue = () => {
        if (!this.mqtt?.isConnected?.() && this.mqtt?.connected !== true) return;
        if (!this.peer) return;
        //if (!this.peer.remoteDescription) return; // we need answer (remote description)
        if (this.peer.connectionState === 'connected') return;

        while (this._iceCandidates_local.length > 0) {
            const c = this._iceCandidates_local.shift();
            this.mqtt.publish(this.mqttTopicLocalIce, c);

            this.debug(
                '[picam] %s | webrtc - ICE sending | connectionState: %s | signalingState: %s | %s',
                this.cameraId,
                this.peer.connectionState,
                this.peer.signalingState,
                this.mqttTopicLocalIce
            );
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
