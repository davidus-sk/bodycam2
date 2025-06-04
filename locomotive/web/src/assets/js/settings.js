import { EventDispatcher } from './EventDispatcher.js';

export class Settings {
    options = {};
    mqttClient = null;

    constructor(options, app) {
        this.options = this.initializeOptions(options);
        this.app = app;

        // event dispatcher
        EventDispatcher.attach(this);

        // debug
        if (
            (this.options.debug === true || this.options.app.debug === true) &&
            typeof console != 'undefined'
        ) {
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
        this.$btnBlowAir = $('#btn-air');
        this.$btnRestart = $('#btn-restart');
        this.$btnRestartCamera = $('#btn-restart-camera');
        this.$btnStream = $('#btn-stream');

        this.blowAir();
        this.restartCamera();
        this.restartSystem();

        this.initMqtt();
        //this.mqttClient.connect();
    }

    initializeOptions(userOptions) {
        const defaultOptions = {
            debug: false,
        };

        return { ...defaultOptions, ...userOptions };
    }

    initMqtt() {
        /*
        // init mqtt client
        if (this.mqttClient) {
            if (this.mqttClient.isConnected()) {
                this.mqttClient.disconnect();
            }
        }

        this.mqttClient = new MqttClient(this.options.mqtt);
        */

        // mqtt
        this.mqttClient = this.app?.getMqttClient();
        if (this.mqttClient) {
            this.mqttClient.on('connect', () => this.mqttConnected());
            this.mqttClient.on('disconnect', () => this.mqttDisconnect());
        }
    }

    mqttConnected() {
        this.debug('e: mqtt connected');

        this.$btnBlowAir.attr('disabled', false);
        this.$btnRestartCamera.attr('disabled', false);
    }

    mqttDisconnect() {
        this.debug('e: mqtt disconnected');

        this.$btnBlowAir.attr('disabled', 'disabled');
        this.$btnRestartCamera.attr('disabled', 'disabled');
    }

    blowAir() {
        let $modal = $('#blow-air'),
            $blowAirContent = $('#blow-air-content'),
            $btnBlowAirConfirm = $('#btn-blow-air-confirm'),
            $btnBlowAirCancel = $('#btn-blow-air-cancel'),
            $blowAirProgress = $('#blow-air-progress'),
            $blowAirTime = $('#blow-air-time'),
            blowAirTimer = null;

        this.$btnBlowAir.on('click', e => {
            this.$btnBlowAir.attr('disabled', 'disabled');
            this.$btnBlowAir.attr('disabled', 'disabled');
        });

        // hide modal window
        $modal.on('hide.bs.modal', e => {
            if (blowAirTimer) {
                clearInterval(blowAirTimer);
                blowAirTimer = null;
            }

            this.$btnBlowAir.attr('disabled', false);
            this.$btnBlowAir.attr('disabled', false);

            $btnBlowAirConfirm.attr('disabled', false);
            $btnBlowAirCancel.attr('disabled', false);

            $btnBlowAirConfirm
                .attr('data-confirmed', 0)
                .removeClass('btn-danger')
                .addClass('btn-warning')
                .html('Confirm restart');

            $blowAirProgress.hide();
            $blowAirContent.show();
        });

        $btnBlowAirConfirm.on('click', e => {
            e.preventDefault();
            var confirmed = parseInt($btnBlowAirConfirm.attr('data-confirmed')) || 0;

            if (confirmed) {
                // mqtt connected
                this.on('mqtt_connected', conn => {
                    const now = Math.round(new Date() / 1000);

                    // publish
                    conn.publish(
                        'device/locomotive/button',
                        JSON.stringify({ ts: now, status: 'emergency' })
                    );

                    // disconnect mqtt
                    this.mqttClient.disconnect();

                    $blowAirContent.hide();
                    $blowAirProgress.show();

                    var $bar = $blowAirProgress.find('.progress-bar');
                    var timeTotal = 5,
                        time = timeTotal,
                        p = (time / timeTotal) * 100;

                    $blowAirTime.html(time);
                    $btnBlowAirConfirm.attr('disabled', 'disabled');
                    $btnBlowAirCancel.attr('disabled', 'disabled');

                    blowAirTimer = setInterval(function () {
                        time = time - 1;
                        p = (time / timeTotal) * 100;
                        $bar.css('width', p + '%');

                        $blowAirTime.html(time);

                        if (time <= 0) {
                            clearInterval(blowAirTimer);
                            blowAirTimer = null;

                            $blowAirContent.html('Reloading ...');
                            $blowAirProgress.hide();
                            $blowAirContent.show();
                            setTimeout(() => {
                                window.location = 'index.php';
                            }, 3000);
                        }
                    }, 1000);
                });

                this.initMqtt();
                this.mqttClient.connect();
            } else {
                $btnBlowAirConfirm
                    .attr('data-confirmed', 1)
                    .removeClass('btn-warning')
                    .addClass('btn-danger')
                    .html('Yes - Blow air');
            }
        });
    }

    restartCamera() {
        this.$btnRestartCamera.on('click', e => {
            e.preventDefault();

            // mqtt connected
            if (!this.mqttClient.isConnected()) {
                console.log('! mqtt is not connected');
                return;
            }

            const now = Math.round(new Date() / 1000);

            // publish
            this.mqttClient.publish(
                'device/locomotive/restart',
                JSON.stringify({ ts: now, status: 'reboot' })
            );

            return;

            // disconnect mqtt
            this.mqttClient.disconnect();

            $restartContent.hide();
            $restartProgress.show();

            var $bar = $restartProgress.find('.progress-bar');
            var timeTotal = 5,
                time = timeTotal,
                p = (time / timeTotal) * 100;

            $restartTime.html(time);
            $btnRestartConfirm.attr('disabled', 'disabled');
            $btnRestartCancel.attr('disabled', 'disabled');

            restartTimer = setInterval(function () {
                time = time - 1;
                p = (time / timeTotal) * 100;
                $bar.css('width', p + '%');

                $restartTime.html(time);

                if (time <= 0) {
                    clearInterval(restartTimer);
                    restartTimer = null;

                    $restartContent.html('Reloading ...');
                    $restartProgress.hide();
                    $restartContent.show();
                    setTimeout(() => {
                        window.location = 'index.php';
                    }, 3000);
                }
            }, 1000);
        });
    }

    restartSystem() {
        let $modal = $('#restart'),
            $restartContent = $('#restart-content'),
            $btnRestartConfirm = $('#btn-restart-confirm'),
            $btnRestartCancel = $('#btn-restart-cancel'),
            $restartProgress = $('#restart-progress'),
            $restartTime = $('#restart-time'),
            restartTimer = null;

        this.$btnRestart.on('click', e => {
            this.$btnRestart.attr('disabled', 'disabled');
            this.$btnBlowAir.attr('disabled', 'disabled');
        });

        // hide modal window
        $modal.on('hide.bs.modal', e => {
            if (restartTimer) {
                clearInterval(restartTimer);
                restartTimer = null;
            }

            this.$btnRestart.attr('disabled', false);
            this.$btnBlowAir.attr('disabled', false);

            $btnRestartConfirm.attr('disabled', false);
            $btnRestartCancel.attr('disabled', false);

            $btnRestartConfirm
                .attr('data-confirmed', 0)
                .removeClass('btn-danger')
                .addClass('btn-warning')
                .html('Confirm restart');

            $restartProgress.hide();
            $restartContent.show();
        });

        $btnRestartConfirm.on('click', e => {
            e.preventDefault();
            var confirmed = parseInt($btnRestartConfirm.attr('data-confirmed')) || 0;

            if (confirmed) {
                // mqtt connected
                this.on('mqtt_connected', conn => {
                    const now = Math.round(new Date() / 1000);

                    // publish
                    conn.publish(
                        'device/locomotive/button',
                        JSON.stringify({ ts: now, status: 'reboot' })
                    );

                    // disconnect mqtt
                    this.mqttClient.disconnect();

                    $restartContent.hide();
                    $restartProgress.show();

                    var $bar = $restartProgress.find('.progress-bar');
                    var timeTotal = 5,
                        time = timeTotal,
                        p = (time / timeTotal) * 100;

                    $restartTime.html(time);
                    $btnRestartConfirm.attr('disabled', 'disabled');
                    $btnRestartCancel.attr('disabled', 'disabled');

                    restartTimer = setInterval(function () {
                        time = time - 1;
                        p = (time / timeTotal) * 100;
                        $bar.css('width', p + '%');

                        $restartTime.html(time);

                        if (time <= 0) {
                            clearInterval(restartTimer);
                            restartTimer = null;

                            $restartContent.html('Reloading ...');
                            $restartProgress.hide();
                            $restartContent.show();
                            setTimeout(() => {
                                window.location = 'index.php';
                            }, 3000);
                        }
                    }, 1000);
                });

                this.initMqtt();
                this.mqttClient.connect();
            } else {
                $btnRestartConfirm
                    .attr('data-confirmed', 1)
                    .removeClass('btn-warning')
                    .addClass('btn-danger')
                    .html('Yes - Restart');
            }
        });
    }
}
