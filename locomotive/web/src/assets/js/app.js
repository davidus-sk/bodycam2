import { generateClientId } from './functions.js';
import { EventDispatcher } from './EventDispatcher.js';
import { MqttClient } from './mqtt/client.js';

export class App {
    options = {};

    constructor(options) {
        this.options = this.initializeOptions(options);

        // event dispatcher
        EventDispatcher.attach(this);

        // debug
        if (this.options.debug === true && typeof console != 'undefined') {
            this.debug = console.log.bind(console);
        } else {
            this.debug = function (message) {};
        }

        // attach events
        window.onbeforeunload = function () {
            if (this.mqttClient) {
                this.mqttClient.disconnect();
                this.mqttClient = null;
            }
        };

        // dom elements
        this.$mqttStatus = $('#mqtt-status');

        // mqtt
        this.initMqtt();
        setTimeout(() => {
            this.mqttClient.connect();
        }, 500);
    }

    initializeOptions(userOptions) {
        const defaultOptions = {
            debug: false,
        };

        return { ...defaultOptions, ...userOptions };
    }

    initMqtt() {
        // init mqtt client
        if (this.mqttClient) {
            if (this.mqttClient.isConnected()) {
                this.mqttClient.disconnect();
            }
        }

        this.mqttClient = new MqttClient(this.options.mqtt);
        this.mqttClient.on('connect', () => this.mqttConnected());
        this.mqttClient.on('disconnect', () => this.mqttDisconnected());
    }

    getMqttClient() {
        return this.mqttClient;
    }

    mqttConnected() {
        this.debug('e: mqtt connected');
        this.$mqttStatus.addClass('connected').html('ONLINE');
    }

    mqttDisconnected() {
        this.debug('e: mqtt disconnected');
        this.$mqttStatus
            .removeClass('connected')
            .html(
                '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="24" height="24" fill="currentColor"><path d="M2.80815 1.39343L20.4858 19.0711L19.0716 20.4853L15.3889 16.8024L12.0005 21L0.689941 6.99674C1.60407 6.25747 2.59204 5.60589 3.64107 5.05479L1.39394 2.80765L2.80815 1.39343ZM12.0005 3.00003C16.2849 3.00003 20.2196 4.49687 23.3104 6.99611L17.9039 13.689L7.72504 3.51088C9.09547 3.17702 10.5273 3.00003 12.0005 3.00003Z"></path></svg>'
            );
    }
}
