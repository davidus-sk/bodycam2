import { MqttClient } from '../mqtt/client.js';
import { generateClientId } from '../functions.js';
import {
    sortByMimeTypes,
    arrayBufferToBase64,
    arrayBufferToString,
    RtcMessage,
} from './rtcUtils.js';
import { addWatermarkToImage, addWatermarkToStream } from './watermark.js';

// https://www.micahbird.com/p/how-to-fix-webrtc-connection-issues-on-ungoogled-chromium/
// https://stackoverflow.com/questions/60387691/remote-video-not-showing-up-on-one-end-webrtc-video-chat-app

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
const DEFAULT_TIMEOUT = 5000;

// For answerer: NEVER add ICE candidates until that peer generates/creates answer SDP
// Stop adding ICE candidates when remote stream starts flowing
// Don't create peer connection for answerer until you get offer SDP

export class PiCamera {
    options = {};
    mqttOptions = {};
    cameraId = undefined;

    rtcTimer = undefined;
    rtcPeer = undefined;
    makingOffer = false;
    ignoreOffer = false;
    politePeer = true;
    dataChannel = undefined;
    localStream = undefined;
    remoteStream = undefined;
    mediaElement = undefined;

    cacheIceList = [];
    receivedLength = 0;
    isFirstPacket = true;
    completeFile = new Uint8Array();

    mqttClient = undefined;
    mqttClientId = undefined;

    constructor(cameraId, options, mqttOptions, mqttClient) {
        this.options = this.initializeOptions(options);
        this.mqttOptions = mqttOptions;
        this.mqttClient = mqttClient;

        this.cameraId = cameraId;

        // debug
        if (this.options.debug === true && typeof console != 'undefined') {
            this.debug = console.log.bind(console);
        } else {
            this.debug = function (message) {};
        }

        this.debug('[picamera] %cinitializing...', this.bgYellow, this.options);
    }

    initializeOptions(options) {
        const defaultOptions = {
            debug: false,
            timeout: DEFAULT_TIMEOUT,
            datachannelOnly: false,
            isMicOn: false,
            isSpeakerOn: false,
            showClock: false,
            setTimeout: 5000,
            stunUrls: [],
            turnUrls: [],
            turnUsername: '',
            turnPassword: '',
        };

        // remove duplicates
        let cfg = {
            ...defaultOptions,
            ...options,
        };

        cfg.stunUrls = [...new Set(cfg.stunUrls)];

        // debug
        this.bgRed = 'font-weight:500;background-color:#c1121f;color:#dbe2ff;';
        this.bgYellow = 'font-weight:500;background-color:#ffe45e;color:#432818;';
        this.bgBlue = 'font-weight:500;background-color:#a6e1fa;color:#001c55;';

        return cfg;
    }

    attach(mediaElement) {
        this.mediaElement = mediaElement;
    }

    async connect() {
        // init mqtt client
        if (!this.mqttClient) {
            // unique mqtt client id
            if (!this.mqttClientId) {
                this.mqttClientId = generateClientId(23);
                this.mqttOptions.clientId = this.mqttClientId;
            }

            this.mqttClient = new MqttClient(this.mqttOptions);
        } else {
            this.mqttClientId = this.mqttClient.client.options.clientId;
        }

        clearTimeout(this.rtcTimer);
        this.rtcTimer = undefined;

        this.makingOffer = false;
        this.cacheIceList = [];
        this.ignoreOffer = false;

        // camera status
        if (this.getStatus() === 'failed') {
            this.reconnect();
        } else {
            // create webrtc peer connection
            this.rtcPeer = await this.createPeer();

            this.debug('[picamera] camera initialized');

            // signaling
            const sdpTopic = this.constructTopic(MQTT_SDP_TOPIC);
            const iceTopic = this.constructTopic(MQTT_ICE_TOPIC);
            this.mqttClient.subscribe(sdpTopic, this.handleSdpMessage);
            this.mqttClient.subscribe(iceTopic, this.handleIceMessage);

            this.debug('[picamera] mqtt subscribe: ' + sdpTopic);
            this.debug('[picamera] mqtt subscribe: ' + iceTopic);

            this.rtcTimer = setTimeout(() => {
                let state = this.rtcPeer?.connectionState;

                if (state === 'connected' || state === 'closed') {
                    return;
                }

                this.debug('!: disconnecting on timeout (' + this.options.timeout + ' ms)');

                if (this.onTimeout) {
                    this.onTimeout();
                }

                this.terminate();
            }, this.options.timeout);
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
        const pc = new RTCPeerConnection(this.getRtcConfig());
        pc.addTransceiver('video', { direction: 'recvonly' });
        pc.addTransceiver('audio', { direction: 'recvonly' });

        pc.ontrack = e => {
            this.debug('[picamera] %cnew track added', self.bgRed);

            this.remoteStream = new MediaStream();

            if (e.streams && e.streams.length) {
                e.streams[0].getTracks().forEach(track => {
                    this.remoteStream?.addTrack(track);

                    // audio
                    if (track.kind === 'audio') {
                        track.enabled = this.options.isSpeakerOn ?? false;
                    }
                });
            } else {
                this.remoteStream?.addTrack(e.track);
            }

            if (this.mediaElement) {
                //this.mediaElement.srcObject = this.remoteStream;
                if (this.options.showClock) {
                    this.mediaElement.srcObject = addWatermarkToStream(this.remoteStream, ':)');
                } else {
                    this.mediaElement.srcObject = this.remoteStream;
                }
            }
        };

        pc.onicecandidate = e => {
            //this.debug('e: onicecandidate - candidate: ' + (e.candidate ? 'yes' : 'no'));
            if (e.candidate && this.mqttClient?.isConnected()) {
                const topic = this.constructTopic(MQTT_ICE_TOPIC, '/offer');

                this.debug('[picamera] sending ICE candidate to the remote peer - ' + topic);
                this.mqttClient.publish(topic, JSON.stringify(e.candidate));
            }
        };

        pc.onnegotiationneeded = async () => {
            this.debug('[picamera] webrtc event - %connegotiationneeded', this.bgBlue);

            try {
                //const offer = await pc.createOffer();
                this.makingOffer = true;

                // set the generated SDP to be our local session description
                this.debug('[picamera] setting local description');
                await pc.setLocalDescription();

                const topic = this.constructTopic(MQTT_SDP_TOPIC, '/offer');
                this.debug('[picamera] sending offer to the remote peer - ' + topic);

                this.mqttClient.publish(topic, JSON.stringify(pc.localDescription));
            } catch (err) {
                console.error(err);
            } finally {
                this.makingOffer = false;
            }
        };

        pc.oniceconnectionstatechange = () => {
            if (pc.iceConnectionState === 'failed' || pc.iceConnectionState === 'disconnected') {
                this.debug('[picamera] negotiation failed - restarting');
                pc.restartIce();
            } else if (pc.iceConnectionState === 'disconnected') {
                this.reconnect();
            }
        };

        /*
        this.dataChannel = pc.createDataChannel(generateClientId(10), {
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

        // The connectionState read-only property of the RTCPeerConnection interface
        // indicates the current state of the pc connection by returning one of the
        // following string values: new, connecting, connected, disconnected, failed,
        // or closed.
        pc.onconnectionstatechange = () => {
            this.debug('[picamera] webrtc event - connectionstatechange: ' + pc.connectionState);

            // event
            this.onConnectionState?.(pc.connectionState);

            if (pc.connectionState === 'connected') {
            } else if (pc.connectionState === 'failed') {
                this.reconnect();
            }
        };

        pc.onsignalingstatechange = e => {
            this.debug('[picamera] webrtc event - onsignalingstatechange: ' + pc.signalingState);
        };

        return pc;
    };

    reconnect() {
        // if (this.rtcPeer) {
        //     this.debug('[picamera] restarting webrtc negotiation');
        //     //this.rtcPeer.restartIce();
        // } else {
        //     this.debug('[picamera] reconnecting');
        //     this.connect();
        // }

        this.terminate();

        setTimeout(() => {
            this.connect();
        }, 1000);
    }

    restart() {
        if (this.mqttClient?.isConnected()) {
            const now = Math.floor(Date.now() / 1000);
            this.mqttClient.publish(
                `device/${this.cameraId}/restart`,
                JSON.stringify({
                    ts: now,
                    device_id: cameraId,
                })
            );
        }
    }

    terminate() {
        console.trace('[picamera] terminate');

        clearTimeout(this.rtcTimer);
        this.rtcTimer = undefined;

        this.makingOffer = false;
        this.cacheIceList = [];
        this.ignoreOffer = false;

        if (this.dataChannel) {
            if (this.dataChannel.readyState === 'open') {
                const command = new RtcMessage(CommandType_CONNECT, 'false');
                this.dataChannel.send(JSON.stringify(command));
            }

            this.dataChannel.close();
            this.dataChannel = undefined;
        }

        // if (this.localStream) {
        //     this.localStream.getTracks().forEach(track => {
        //         track.stop();
        //     });

        //     this.localStream = undefined;
        // }

        if (this.remoteStream) {
            this.remoteStream.getTracks().forEach(track => {
                track.stop();
            });

            this.remoteStream = undefined;
        }

        if (this.mediaElement) {
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

        // if (this.mqttClient) {
        //     this.mqttClient.disconnect();
        //     this.mqttClient = undefined;
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

    handleSdpMessage = async message => {
        const description = JSON.parse(message);
        if (!description) {
            return;
        }

        this.debug('[picamera] got remote SDP: ', description);

        const offerCollision =
            description.type === 'offer' &&
            (this.makingOffer || this.rtcPeer?.signalingState !== 'stable');

        this.ignoreOffer = !this.politePeer && offerCollision;
        if (this.ignoreOffer) {
            return;
        }

        //const topic = this.constructTopic(MQTT_SDP_TOPIC);
        //await this.rtcPeer?.setRemoteDescription(new RTCSessionDescription(sdp));
        await this.rtcPeer?.setRemoteDescription(description);
    };

    handleIceMessage = async message => {
        const candidate = JSON.parse(message);
        if (!candidate) {
            return;
        }

        const topic = this.constructTopic(MQTT_ICE_TOPIC);
        this.debug('[picamera] got remote ICE: ' + topic);

        try {
            if (this.rtcPeer?.currentRemoteDescription) {
                await this.rtcPeer?.addIceCandidate(candidate);

                while (this.cacheIceList.length > 0) {
                    const cachedCandidate = this.cacheIceList.shift();
                    await this.rtcPeer.addIceCandidate(cachedCandidate);
                }
            } else {
                this.cacheIceList.push(candidate);
            }
        } catch (err) {
            if (!this.ignoreOffer) {
                throw err;
            }
        }

        /*
        if (this.rtcPeer?.currentRemoteDescription) {
            this.rtcPeer.addIceCandidate(new RTCIceCandidate(ice));

            while (this.cacheIceList.length > 0) {
                const cacheIce = this.cacheIceList.shift();
                this.rtcPeer.addIceCandidate(new RTCIceCandidate(cacheIce));
            }
        } else {
            this.cacheIceList.push(ice);
        }
        */
    };
}
