import mqtt from './mqtt.min.js';
import { EventDispatcher } from './../EventDispatcher.js';

export class MqttClient {
    clientId = null;
    client = null;

    constructor(options) {
        this.options = this.initializeOptions(options);
        this.subscribedFnMap = new Map();

        // event dispatcher
        EventDispatcher.attach(this);

        // debug
        if (this.options.debug === true && typeof console != 'undefined') {
            this.debug = console.log.bind(console);
        } else {
            this.debug = function (message) {};
        }
    }

    initializeOptions(userOptions) {
        const defaultOptions = {
            host: '127.0.0.1',
            port: 8000,
            path: '',
            clientId: null,
            username: null,
            password: null,
            protocol: 'ws',
            clientId: null,
            keepalive: 60,
            protocolVersion: 4,
            clean: true,
            manualConnect: true,
            reconnectPeriod: 1000,
            resubscribe: true,
            debug: false,
        };

        return { ...defaultOptions, ...userOptions };
    }

    connect() {
        const connectionOptions = {
            host: this.options.host,
            port: this.options.port,
            path: this.options.path,
            clientId: this.options.clientId,
            username: this.options.username,
            password: this.options.password,
            protocol: this.options.protocol,
            protocolVersion: this.options.protocolVersion,
            keepalive: this.optionsKeepalive,
            clean: this.options.clean,
            manualConnect: this.options.manualConnect,
            resubscribe: this.options.resubscribe,
            reconnectPeriod: this.options.reconnectPeriod,
        };

        this.client = mqtt.connect(connectionOptions);
        console.log(connectionOptions);

        this.attachClientListeners();
        this.client.reconnect();
    }

    getClientId() {
        return this.client?.options.clientId;
    }

    disconnect() {
        if (!this.client) return;
        this.debug(`f: mqtt disconnect`);

        this.client.removeAllListeners();
        this.client.end(true);

        this.emit('disconnect', this.getClientId());
        this.onDisconnect?.(this.getClientId());

        this.subscribedFnMap.clear();
    }

    reconnect() {
        return new Promise((resolve, reject) => {
            if (this.client) {
                this.client.end(true, {}, () => {
                    this.this.client.reconnect();
                    resolve();
                });
            }

            resolve();
        });
    }

    isConnected() {
        return this.client?.connected ?? false;
    }

    attachClientListeners() {
        if (!this.client) return;

        // emitted on successful (re)connection (i.
        this.client.on('connect', () => {
            this.debug(`e: connect - client id: ${this.getClientId()}`);

            this.emit('connect', this);
            this.onConnect?.(this);
        });

        // emitted when the client receives a publish packet
        this.client.on('message', (topic, message) => {
            //this.debug('e: message:', topic);

            const msg = message?.toString() ?? null;

            // global callback
            this.emit('message', ...[topic, message]);
            this.onMessage?.(topic, msg);

            // topic callback
            const callback = this.subscribedFnMap.get(topic);
            callback?.(msg);
        });
    }

    on(topic, callback) {
        this.client.on(topic, callback);
    }

    subscribe(topic, callback) {
        if (!this.client) {
            this.debug('! Subscribe failed: client is undefined.');
            return;
        }

        this.client.subscribe(topic, { qos: 2 });
        this.subscribedFnMap.set(topic, callback);
        this.emit('subscribe', ...[topic]);
    }

    unsubscribe(topic) {
        if (!this.client) {
            console.warn('Unsubscribe failed: client is undefined.');
            return;
        }

        //const t = this.constructTopic(topic);
        this.debug('f: mqtt unsubscribe(' + topic + ')');

        this.client.unsubscribe(topic);
        this.subscribedFnMap.delete(topic);
    }

    publish(topic, message) {
        if (!this.client) {
            console.warn('Publish failed: client is undefined.');
            return;
        }

        //const t = this.constructTopic(topic, "/offer");
        this.debug('f: mqtt -> publish() %c%s', 'background-color:#151515;color:#d65cb9', topic);

        this.client.publish(topic, message);

        this.emit('publish', ...[topic, message]);
        this.onPublish?.(topic, message);
    }
}
