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
    cameraId = null;

    rtcTimer = null;
    rtcPeer = null;
    dataChannel = null;
    localStream = null;
    remoteStream = null;
    mediaElement = null;

    cacheIceList = [];
    receivedLength = 0;
    isFirstPacket = true;
    completeFile = new Uint8Array();

    mqttClient = null;
    mqttClientId = null;

    constructor(cameraId, options, mqttOptions, mqttClient) {
        this.options = this.initializeOptions(options);
        this.mqttOptions = mqttOptions;
        this.mqttClient = mqttClient;

        this.cameraId = cameraId;

        if (this.options.debug === true && typeof console != 'undefined') {
            this.debug = console.log.bind(console);
        } else {
            this.debug = function (message) {};
        }
    }

    initializeOptions(options) {
        const defaultOptions = {
            stunUrls: [],
            turnUrl: null,
            turnUsername: '',
            turnPassword: '',
            timeout: DEFAULT_TIMEOUT,
            datachannelOnly: false,
            isMicOn: false,
            isSpeakerOn: false,
            setTimeout: 5000,
            debug: false,
        };

        // remove duplicates
        let cfg = {
            ...defaultOptions,
            ...options,
        };
        cfg.stunUrls = [...new Set(cfg.stunUrls)];

        // debug
        self.debugColor = 'background-color:#540101;color:#dbe2ff;';

        return cfg;
    }

    attach(mediaElement) {
        this.debug('attach()', mediaElement);
        this.mediaElement = mediaElement;
    }

    connect() {
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

        if (this.rtcTimer) {
            clearTimeout(this.rtcTimer);
            this.rtcTimer = null;
        }

        if (this.getStatus() === 'failed') {
            this.terminate();
            setTimeout(() => {
                this.connect();
            }, 1000);

            console.log(this.getStatus());
            //this.rtcPeer.restartIce();
        } else {
            // mqtt connected
            //this.mqttClient.onConnect = async conn => {
            (async () => {
                // create webrtc peer connection
                this.rtcPeer = await this.createWebRtcConnection();

                const sdpTopic = this.constructTopic(MQTT_SDP_TOPIC);
                const iceTopic = this.constructTopic(MQTT_ICE_TOPIC);

                this.mqttClient.subscribe(sdpTopic, this.handleSdpMessage);
                this.mqttClient.subscribe(iceTopic, this.handleIceMessage);

                // Create offer generates a blob of description data to
                // facilitate a PeerConnection to the local machine.
                // Use this when you've got a remote Peer connection
                // and you want to set up the local one.
                const offer = await this.rtcPeer.createOffer({});

                // set the generated SDP to be our local session description
                this.rtcPeer?.setLocalDescription(offer, () => {
                    this.debug('!: setLocalDescription() - done');
                    const topic = this.constructTopic(MQTT_SDP_TOPIC, '/offer');

                    this.mqttClient.publish(topic, JSON.stringify(offer));
                });
            })();
            //};

            // connect
            //this.mqttClient.connect();

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
        config.iceCandidatePoolSize = 5;

        if (this.options.stunUrls && this.options.stunUrls.length > 0) {
            config.iceServers.push({ urls: this.options.stunUrls });
        }

        if (this.options.turnUrl && this.options.turnUsername && this.options.turnPassword) {
            config.iceServers.push({
                urls: this.options.turnUrl,
                username: this.options.turnUsername,
                credential: this.options.turnPassword,
            });
        }

        this.debug(config.iceServers);
        return config;
    }

    createWebRtcConnection = async () => {
        // new peer connection
        const peer = new RTCPeerConnection(this.getRtcConfig());

        if (!this.options.datachannelOnly) {
            this.localStream = await navigator.mediaDevices.getUserMedia({
                audio: true,
                video: false,
            });

            this.localStream.getAudioTracks().forEach(track => {
                peer.addTrack(track, this.localStream);
                track.enabled = this.options.isMicOn ?? false;
            });

            peer.addTransceiver('video', { direction: 'recvonly' });
            peer.addTransceiver('audio', { direction: 'sendrecv' });

            //self.video.onplaying = onPlaying;
            // self.$video.on("ended", onEnded);
            // self.$video.on("loadeddata", onLoadedData);
            // self.$video.on("loadedmetadata", onLoadedMetadata);
            // self.$video.on("loadstart", loadstart);
            // self.$video.on("playing", onPlaying);
            // self.$video.on("suspend", onSuspend);
            // self.$video.on("error", onError);
            // self.$video.on("abort", onAbort);
            // self.$video.on("volumechange", onVolumeChange);
            // self.$video.on("muted", onMuted);

            peer.addEventListener('track', e => {
                this.remoteStream = new MediaStream();
                e.streams[0].getTracks().forEach(track => {
                    this.remoteStream?.addTrack(track);

                    // audio
                    if (track.kind === 'audio') {
                        track.enabled = this.options.isSpeakerOn ?? false;
                    }
                });

                this.debug(this.mediaElement);
                if (this.mediaElement) {
                    //this.mediaElement.srcObject = this.remoteStream;
                    this.mediaElement.srcObject = addWatermarkToStream(this.remoteStream, ':)');
                }
            });
        }

        peer.addEventListener('icecandidate', e => {
            this.debug('e: icecandidate', e);

            if (e.candidate && this.mqttClient?.isConnected()) {
                const topic = this.constructTopic(MQTT_ICE_TOPIC, '/offer');

                this.mqttClient.publish(topic, JSON.stringify(e.candidate));
            }
            //}
        });

        peer.addEventListener('addstream ', e => {
            this.debug('e: addstream ', e);
        });

        peer.addEventListener('iceconnectionstatechange ', e => {
            this.debug('e: iceconnectionstatechange ', e);
        });

        peer.addEventListener('negotiationneeded', e => {
            this.debug('e: negotiationneeded', e);
        });

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

        // The connectionState read-only property of the RTCPeerConnection interface
        // indicates the current state of the peer connection by returning one of the
        // following string values: new, connecting, connected, disconnected, failed,
        // or closed.
        peer.addEventListener('connectionstatechange', () => {
            this.debug('e: connectionstatechange', peer.connectionState);

            // event
            this.onConnectionState?.(peer.connectionState);

            if (peer.connectionState === 'connected') {
                this.debug(
                    'e: track - %cadding',
                    'background-color:#540101;color:#dbe2ff;font-weight:500'
                );

                // if (this.mqttClient?.isConnected()) {
                //     this.debug(
                //         "!: disconnecting after successfully camera connect"
                //     );

                //     this.mqttClient.disconnect();
                //     this.mqttClient = undefined;
                // }
            } else if (peer.connectionState === 'failed') {
                //this.terminate();
            }
        });

        peer.addEventListener('signalingstatechange', e => {
            this.debug('!: signaling status = ' + peer.signalingState);
        });

        return peer;
    };

    restart() {
        if (this.mqttClient?.isConnected()) {
            const now = Math.floor(Date.now() / 1000);
            this.mqttClient.publish(
                `camera/${this.cameraId}/restart`,
                JSON.stringify({
                    ts: now,
                    camera_id: cameraId,
                })
            );
        }
    }

    terminate() {
        this.debug('f: terminate()');

        clearTimeout(this.rtcTimer);
        this.rtcTimer = null;

        if (this.dataChannel) {
            if (this.dataChannel.readyState === 'open') {
                const command = new RtcMessage(CommandType_CONNECT, 'false');
                this.dataChannel.send(JSON.stringify(command));
            }

            this.dataChannel.close();
            this.dataChannel = undefined;
        }

        if (this.localStream) {
            this.localStream.getTracks().forEach(track => {
                track.stop();
            });

            this.localStream = undefined;
        }

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
            this.rtcPeer.close();
            this.rtcPeer = undefined;
        }

        // if (this.mqttClient) {
        //     this.mqttClient.disconnect();
        //     this.mqttClient = undefined;
        // }

        // event
        this.onConnectionState?.('closed');
        // if (this.onConnectionState) {
        //     this.onConnectionState("closed");
        // }
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
        this.toggleTrack(this.options.isMicOn, this.localStream);
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
        const sdp = JSON.parse(message);
        this.debug('e: handleSdpMessage()', sdp);

        //if (sdp.type === "answer") {
        this.rtcPeer?.setRemoteDescription(new RTCSessionDescription(sdp));
        //}
    };

    handleIceMessage = message => {
        const ice = JSON.parse(message);
        this.debug('e: handleIceMessage', ice);

        if (this.rtcPeer?.currentRemoteDescription) {
            this.rtcPeer.addIceCandidate(new RTCIceCandidate(ice));

            while (this.cacheIceList.length > 0) {
                const cacheIce = this.cacheIceList.shift();
                this.rtcPeer.addIceCandidate(new RTCIceCandidate(cacheIce));
            }
        } else {
            this.cacheIceList.push(ice);
        }
    };
}
