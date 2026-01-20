import mqtt from './mqtt.min.js';
import { EventDispatcher } from './../EventDispatcher.js';

export class MqttClient {
    client = null;

    constructor(options) {
        this.options = this.initializeOptions(options);
        this.subscribedFnMap = new Map();

        // event dispatcher
        EventDispatcher.attach(this);

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
    }

    initializeOptions(userOptions) {
        const defaultOptions = {
            debug: false,
            host: '127.0.0.1',
            port: 8000,
            path: '/mqtt',
            clientId: null,
            username: null,
            password: null,
            protocol: 'ws',
            keepalive: 15,
            protocolVersion: 5,
            clean: true,
            manualConnect: true,
            reconnectPeriod: 5000,
            resubscribe: false,
            queueQoSZero: false,
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
            keepalive: this.options.keepalive,
            protocolVersion: this.options.protocolVersion,
            clean: this.options.clean,
            manualConnect: this.options.manualConnect,
            reconnectPeriod: this.options.reconnectPeriod,
            resubscribe: this.options.resubscribe,
            queueQoSZero: this.options.queueQoSZero,
        };

        this.client = mqtt.connect(connectionOptions);
        this.clientId = this.options.clientId;

        this.attachClientListeners();

        this.debug('[mqtt ] %s | connecting - broker: %s', this.clientId, connectionOptions.host);
        this.client.connect();
    }

    disconnect() {
        if (!this.client) return;
        this.debug(`[mqtt ] %s | disconnect`, this.clientId);

        this.client.removeAllListeners();
        this.client.end(true, { reasonCode: 0 });

        this.subscribedFnMap.clear();
    }

    reconnect() {
        return new Promise(resolve => {
            if (!this.client) return resolve();

            this.client.end(true, {}, () => {
                this.client.reconnect();
                resolve();
            });
        });
    }

    isConnected() {
        return this.client?.connected ?? false;
    }

    attachClientListeners() {
        if (!this.client) return;

        // emitted on successful (re)connection
        this.client.on('connect', () => {
            this.debug(`[mqtt ] %s | event: connected`, this.clientId);

            this.emit('connect', this);
            this.onConnect?.(this);
        });

        // emitted on successful (re)connection
        this.client.on('close', () => {
            this.debug(`[mqtt ] %s | event: close`, this.clientId);

            this.emit('disconnect', this);
            this.onDisconnect?.(this);
        });

        // emitted when the client receives a publish packet
        this.client.on('message', (topic, message) => {
            const msg = message?.toString() ?? null;

            //this.debug('[mqtt ] %s | message: %s', this.clientId, topic, msg);

            // global callback
            this.emit('message', ...[topic, message]);
            this.onMessage?.(topic, msg);

            // topic callback
            const callback = this.subscribedFnMap.get(topic);
            callback?.(msg);
        });
    }

    on(topic, callback) {
        if (!this.client) return;

        this.client.on(topic, callback);
    }

    subscribe(topic, callback) {
        if (!this.client) {
            this.debug('[mqtt ] %s | Subscribe failed: client is undefined.', this.clientId);
            return;
        }

        this.client.subscribe(topic, { qos: 1 });
        this.subscribedFnMap.set(topic, callback);
        this.emit('subscribe', ...[topic]);
    }

    unsubscribe(topic) {
        if (!this.client) {
            console.warn('[mqtt ] %s | Unsubscribe failed: client is undefined.', this.clientId);
            return;
        }

        //const t = this.constructTopic(topic);
        this.debug('f: mqtt unsubscribe(' + topic + ')');

        this.client.unsubscribe(topic);
        this.subscribedFnMap.delete(topic);
    }

    publish(topic, message) {
        if (!this.client) {
            console.warn('[mqtt ] %s | Publish failed: client is undefined.', this.clientId);
            return;
        }

        //const t = this.constructTopic(topic, "/offer");
        this.debug(
            '[mqtt ] %s | -> publish() %c%s',
            this.clientId,
            'background-color:#151515;color:#d65cb9',
            topic
        );

        this.client.publish(topic, message);

        this.emit('publish', ...[topic, message]);
        this.onPublish?.(topic, message);
    }
}
