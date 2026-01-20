import { getTimestamp, worker } from './functions.js';
import { EventDispatcher } from './EventDispatcher.js';
import { MqttClient } from './mqtt/client.js';
import { ConsoleColors } from './utils.js';

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
        this.$content = $('#content');
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

        console.log(this.options);
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
        this.debug('[app  ] %s | mqtt connected', this.mqtt.client.options.clientId);
        this.$mqttStatus.addClass('connected').html('ONLINE');

        this._connectedDevices = new Array();

        this.mqtt.subscribe('device/+/status');

        this.mqtt.on('message', (topic, message) => {
            try {
                const data = JSON.parse(message);

                if (data && data.device_id) {
                    this._connectedDevices[data.device_id] = data;
                }
            } catch (e) {
                this.debug(
                    '[video] %s | topic: %s - %cmessage parsing error: %s',
                    this.mqttId,
                    topic,
                    ConsoleColors.error,
                    e
                );
            }

            this.updateLiveDevicesCount();
        });
    }

    mqttDisconnected() {
        this.debug('[app  ] %s | mqtt disconnected', this.mqtt.client.options.clientId);
        this.$mqttStatus.removeClass('connected').html('OFFLINE');

        this._connectedDevices = [];

        this.updateLiveDevicesCount();
    }

    initWorkers() {
        worker('live_devices', 5000, () => {
            let now = getTimestamp();

            for (const deviceId in this._connectedDevices) {
                const deviceTs = this._connectedDevices[deviceId]['ts'];
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

        let mqttDebugTimer = null;
        let $mqttDebug = null;

        // mqtt /status debug info
        this.$mqttStatus.on('dblclick', e => {
            if (mqttDebugTimer) {
                clearInterval(mqttDebugTimer);
            }

            if ($('#mqtt-debug').length) {
                $('#mqtt-debug').remove();
            } else {
                this.$content.append('<div id="mqtt-debug"></div>');
                $mqttDebug = $('#mqtt-debug');

                const debugRefresh = () => {
                    var html = '<div style="margin-bottom: 5px;">Mqtt /status:</div>';
                    html += '<table>';
                    var idx = 1;
                    var added = {};
                    var self = this;

                    if ($('#video-grid').length) {
                        $('#video-grid')
                            .find('.video-wrapper')
                            .each(function () {
                                const deviceId = $(this).attr('data-device-id');
                                if (self._connectedDevices[deviceId]) {
                                    const _d = self._connectedDevices[deviceId];

                                    html += '<tr>';
                                    html += '<td>' + idx + '</td>';
                                    html += '<td>' + _d['device_id'] + '</td>';
                                    html += '</tr>';

                                    added[deviceId] = 1;
                                    idx++;
                                }
                            });
                    }

                    for (let deviceId in this._connectedDevices) {
                        if (added[deviceId]) {
                            continue;
                        }

                        const _d = this._connectedDevices[deviceId];

                        html += '<tr>';
                        html += '<td>' + idx + '</td>';
                        html += '<td>' + _d['device_id'] + '</td>';
                        html += '</tr>';

                        idx++;
                    }

                    html += '</table>';

                    $mqttDebug.html(html);
                };

                debugRefresh();

                setInterval(() => debugRefresh(), 2500);
            }
        });
    }

    updateLiveDevicesCount() {
        // update count in sidebar
        this.$mqttStatusCount.html(Object.keys(this._connectedDevices).length);
    }
}
