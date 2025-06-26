import { getTimestamp, worker } from './functions.js';
import { EventDispatcher } from './EventDispatcher.js';
import { MqttClient } from './mqtt/client.js';

export class App {
    options = {};

    LIVE_DEVICE_TIMEOUT = 30;

    mqtt = undefined;
    mqttClientId = undefined;

    _connectedDevices = [];

    constructor(options) {
        this.options = this.initializeOptions(options);

        // event dispatcher
        EventDispatcher.attach(this);

        // debug
        if (
            (!this.options.hasOwnProperty('app') ||
                !this.options.app.hasOwnProperty('debug') ||
                this.options.app.debug !== false) &&
            typeof console != 'undefined'
        ) {
            this.debug = console.log.bind(console);
        } else {
            this.debug = function (message) {};
        }

        // attach events
        window.onbeforeunload = function () {
            if (this.mqtt) {
                this.mqtt.disconnect();
                this.mqtt = null;
            }
        };

        // dom elements
        this.$mqttStatus = $('#mqtt-status');
        this.$mqttStatusCount = $('#mqtt-status-count');

        // mqtt
        this.initMqtt();

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
        if (this.mqtt) {
            if (this.mqtt.isConnected()) {
                this.mqtt.disconnect();
            }
        }

        this.mqtt = new MqttClient(this.options.mqtt);
        this.mqtt.on('connect', () => this.mqttConnected());
        this.mqtt.on('disconnect', () => this.mqttDisconnected());

        setTimeout(() => {
            this.mqtt.connect();
        }, 500);
    }

    getMqttClient() {
        return this.mqtt;
    }

    mqttConnected() {
        this.debug('[app] mqtt connected - client id: ' + this.mqtt.client.options.clientId);
        this.$mqttStatus.addClass('connected').html('ONLINE');

        this._connectedDevices = new Array();

        this.mqtt.subscribe('device/+/status');

        this.mqtt.on('message', (topic, message) => {
            try {
                const data = JSON.parse(message);

                if (data && data.device_id) {
                    this._connectedDevices[data.device_id] = data.ts;
                }
            } catch (e) {
                this.debug(
                    '[app] %s | mqtt message parsing error: %s',
                    this.mqtt.client.options.clientId,
                    e
                );
            }

            this.updateLiveDevicesCount();
        });
    }

    mqttDisconnected() {
        this.debug('[app] mqtt disconnected');
        this.$mqttStatus.removeClass('connected').html('OFFLINE');

        this._connectedDevices = [];

        this.updateLiveDevicesCount();
    }

    initWorkers() {
        worker('live_devices', 5000, () => {
            let now = getTimestamp();

            for (const deviceId in this._connectedDevices) {
                const deviceTs = this._connectedDevices[deviceId];
                const delta = now - deviceTs;

                // remove old map object
                if (delta > this.LIVE_DEVICE_TIMEOUT) {
                    delete this._connectedDevices[deviceId];
                }
            }

            this.updateLiveDevicesCount();
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

    updateLiveDevicesCount() {
        // update count in sidebar
        this.$mqttStatusCount.html(Object.keys(this._connectedDevices).length);
    }
}
