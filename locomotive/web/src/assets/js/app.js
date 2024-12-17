import { getTimestamp, worker } from './functions.js';
import { EventDispatcher } from './EventDispatcher.js';
import { MqttClient } from './mqtt/client.js';

export class App {
    options = {};
    liveDevices = [];

    LIVE_DEVICE_TIMEOUT = 120;

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
        this.$mqttStatusCount = $('#mqtt-status-count');

        // mqtt
        this.initMqtt();
        setTimeout(() => {
            this.mqttClient.connect();
        }, 500);

        // sidebar
        this.sidebar();

        // workers
        this.initWorkers();
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
        this.debug('[app] mqtt connected - client id: ' + this.mqttClient.client.options.clientId);
        this.$mqttStatus.addClass('connected').html('ONLINE');

        this.liveDevices = [];
        this.mqttClient.subscribe('device/+/status');
        this.mqttClient.on('message', (topic, message) => {
            const data = JSON.parse(message);

            if (data && data.device_id) {
                this.liveDevices[data.device_id] = data.ts;
            }

            this.$mqttStatusCount.html(Object.keys(this.liveDevices).length);
        });
    }

    mqttDisconnected() {
        this.debug('[app] mqtt disconnected');
        this.$mqttStatus.removeClass('connected').html('OFFLINE');

        this.liveDevices = [];
    }

    initWorkers() {
        worker('live_devices', 5000, () => {
            let now = getTimestamp();

            for (const deviceId in this.liveDevices) {
                const deviceTs = this.liveDevices[deviceId];
                const delta = now - deviceTs;

                // remove old map object
                if (delta > this.LIVE_DEVICE_TIMEOUT) {
                    delete this.liveDevices[deviceId];
                }
            }

            this.$mqttStatusCount.html(Object.keys(this.liveDevices).length);
        });
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
