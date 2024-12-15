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

        // sidebar
        this.sidebar();
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
        this.debug('[app] mqtt connected');
        this.$mqttStatus.addClass('connected').html('ONLINE');
    }

    mqttDisconnected() {
        this.debug('[app] mqtt disconnected');
        this.$mqttStatus.removeClass('connected').html('OFFLINE');
    }

    sidebar() {
        const $btn = $('#sidebar-toggle');
        const $body = $('body');
        let sidebarHide = true;

        $btn.on('click', e => {
            e.preventDefault();
            if ($body.hasClass('sidebar-hide')) {
                $body.removeClass('sidebar-hide');
                sidebarHide = false;
            } else {
                $body.addClass('sidebar-hide');
                sidebarHide = true;
            }
        });
    }
}
