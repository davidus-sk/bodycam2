import mqtt from "./mqtt.min.js";

export class MqttClient {
    constructor(clientId, options) {
        this.clientId = clientId;
        this.options = this.initializeOptions(options);
        this.subscribedFnMap = new Map();
    }

    initializeOptions(userOptions) {
        const defaultOptions = {
            host: "127.0.0.1",
            port: 8000,
            path: "",
            username: "",
            password: "",
            protocol: "ws",
            keepalive: 60,
            protocolVersion: 4,
            clean: true,
            manualConnect: true,
            reconnectPeriod: 0,
        };

        return { ...defaultOptions, ...userOptions };
    }

    connect() {
        const connectionOptions = {
            host: this.options.host,
            port: this.options.port,
            path: this.options.path,
            clientId: this.clientId,
            username: this.options.username,
            password: this.options.password,
            protocol: this.options.protocol,
            protocolVersion: this.options.protocolVersion,
            keepalive: this.optionsKeepalive,
            clean: this.options.clean,
            manualConnect: this.options.manualConnect,
            reconnectPeriod: this.options.reconnectPeriod,
            //log: console.log,
        };

        this.client = mqtt.connect(connectionOptions);
        this.attachClientListeners();
        this.client.reconnect();
    }

    disconnect() {
        if (!this.client) return;

        console.log(`! mqtt disconnect (${this.clientId}).`);
        this.client.removeAllListeners();
        this.client.end(true);
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

        this.client.on("connect", () => {
            console.log("on: connect");
            console.log(`MQTT connection (${this.clientId}) established.`);
            this.onConnect?.(this);
        });

        this.client.on("message", (topic, message) =>
            this.handleMessage(topic, message)
        );
    }

    handleMessage(topic, message) {
        //console.log("on: message");
        //console.log(`${topic} -> ${message.toString()}`);
        console.log("e: mqtt <- handleMessage()", topic);
        const callback = this.subscribedFnMap.get(topic);

        this.onMessage?.(this);
        callback?.(message.toString());
    }

    subscribe = (topic, callback) => {
        if (!this.client) {
            console.warn("Subscribe failed: client is undefined.");
            return;
        }

        //const t = this.constructTopic(topic);
        console.log("f: mqtt subscribe(" + topic + ")");

        this.client.subscribe(topic, { qos: 0 });
        this.subscribedFnMap.set(topic, callback);
    };

    unsubscribe = (topic) => {
        if (!this.client) {
            console.warn("Unsubscribe failed: client is undefined.");
            return;
        }

        //const t = this.constructTopic(topic);
        console.log("f: mqtt unsubscribe(" + topic + ")");

        this.client.unsubscribe(topic);
        this.subscribedFnMap.delete(topic);
    };

    publish = (topic, message) => {
        if (!this.client) {
            console.warn("Publish failed: client is undefined.");
            return;
        }

        //const t = this.constructTopic(topic, "/offer");
        console.log(
            "f: mqtt -> publish(" + topic + ") %c%s",
            "background-color:#151515;color:#d65cb9",
            topic
        );

        this.client.publish(topic, message);
    };

    constructTopic(topic, subLevels) {
        let t = `${this.options.deviceUuid}/${topic}/${this.clientId}`;
        if (typeof subLevels === "string") {
            t += subLevels;
        }

        t = t.replace("/{1,}/", "/");

        return t;
    }
}
