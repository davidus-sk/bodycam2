import { generateClientId } from "./functions.js";
import { EventDispatcher } from "./EventDispatcher.js";
import { MqttClient } from "./mqtt/client.js";

export class Settings {
    config = {};
    mqttClient = null;
    $btnRestart = null;
    $btnBlowAir = null;

    constructor(config) {
        // merge config
        this.config = Object.assign(this.config, config);

        // event dispatcher
        EventDispatcher.attach(this);

        // attach events
        window.onbeforeunload = function () {
            if (this.mqttClient) {
                this.mqttClient.disconnect();
                this.mqttClient = null;
            }
        };

        // dom elements
        this.$btnRestart = $("#btn-restart");
        this.$btnBlowAir = $("#btn-air");

        this.restartSystem();
        this.blowAir();
    }

    initMqtt() {
        // init mqtt client
        if (this.mqttClient) {
            if (this.mqttClient.isConnected()) {
                this.mqttClient.disconnect();
            }
        }

        this.mqttClient = new MqttClient(this.config.mqtt);

        // mqtt connected
        this.mqttClient.onConnect = async (conn) => {
            console.log("e: mqtt connected");

            this.emit("mqtt_connected", conn);
        };
    }

    blowAir() {
        let $modal = $("#blow-air"),
            $blowAirContent = $("#blow-air-content"),
            $btnBlowAirConfirm = $("#btn-blow-air-confirm"),
            $btnBlowAirCancel = $("#btn-blow-air-cancel"),
            $blowAirProgress = $("#blow-air-progress"),
            $blowAirTime = $("#blow-air-time"),
            blowAirTimer = null;

        this.$btnBlowAir.on("click", (e) => {
            this.$btnBlowAir.attr("disabled", "disabled");
            this.$btnBlowAir.attr("disabled", "disabled");
        });

        // hide modal window
        $modal.on("hide.bs.modal", (e) => {
            if (blowAirTimer) {
                clearInterval(blowAirTimer);
                blowAirTimer = null;
            }

            this.$btnBlowAir.attr("disabled", false);
            this.$btnBlowAir.attr("disabled", false);

            $btnBlowAirConfirm.attr("disabled", false);
            $btnBlowAirCancel.attr("disabled", false);

            $btnBlowAirConfirm
                .attr("data-confirmed", 0)
                .removeClass("btn-danger")
                .addClass("btn-warning")
                .html("Confirm restart");

            $blowAirProgress.hide();
            $blowAirContent.show();
        });

        $btnBlowAirConfirm.on("click", (e) => {
            e.preventDefault();
            var confirmed =
                parseInt($btnBlowAirConfirm.attr("data-confirmed")) || 0;

            if (confirmed) {
                // mqtt connected
                this.on("mqtt_connected", (conn) => {
                    const now = Math.round(new Date() / 1000);

                    // publish
                    conn.publish(
                        "camera/locomotive/button",
                        JSON.stringify({ ts: now, status: "emergency" })
                    );

                    // disconnect mqtt
                    this.mqttClient.disconnect();

                    $blowAirContent.hide();
                    $blowAirProgress.show();

                    var $bar = $blowAirProgress.find(".progress-bar");
                    var timeTotal = 5,
                        time = timeTotal,
                        p = (time / timeTotal) * 100;

                    $blowAirTime.html(time);
                    $btnBlowAirConfirm.attr("disabled", "disabled");
                    $btnBlowAirCancel.attr("disabled", "disabled");

                    blowAirTimer = setInterval(function () {
                        time = time - 1;
                        p = (time / timeTotal) * 100;
                        $bar.css("width", p + "%");

                        $blowAirTime.html(time);

                        if (time <= 0) {
                            clearInterval(blowAirTimer);
                            blowAirTimer = null;

                            $blowAirContent.html("Reloading ...");
                            $blowAirProgress.hide();
                            $blowAirContent.show();
                            setTimeout(() => {
                                window.location = "index.php";
                            }, 3000);
                        }
                    }, 1000);
                });

                this.initMqtt();
                this.mqttClient.connect();
            } else {
                $btnBlowAirConfirm
                    .attr("data-confirmed", 1)
                    .removeClass("btn-warning")
                    .addClass("btn-danger")
                    .html("Yes - Blow air");
            }
        });
    }

    restartSystem() {
        let $modal = $("#restart"),
            $restartContent = $("#restart-content"),
            $btnRestartConfirm = $("#btn-restart-confirm"),
            $btnRestartCancel = $("#btn-restart-cancel"),
            $restartProgress = $("#restart-progress"),
            $restartTime = $("#restart-time"),
            restartTimer = null;

        this.$btnRestart.on("click", (e) => {
            this.$btnRestart.attr("disabled", "disabled");
            this.$btnBlowAir.attr("disabled", "disabled");
        });

        // hide modal window
        $modal.on("hide.bs.modal", (e) => {
            if (restartTimer) {
                clearInterval(restartTimer);
                restartTimer = null;
            }

            this.$btnRestart.attr("disabled", false);
            this.$btnBlowAir.attr("disabled", false);

            $btnRestartConfirm.attr("disabled", false);
            $btnRestartCancel.attr("disabled", false);

            $btnRestartConfirm
                .attr("data-confirmed", 0)
                .removeClass("btn-danger")
                .addClass("btn-warning")
                .html("Confirm restart");

            $restartProgress.hide();
            $restartContent.show();
        });

        $btnRestartConfirm.on("click", (e) => {
            e.preventDefault();
            var confirmed =
                parseInt($btnRestartConfirm.attr("data-confirmed")) || 0;

            if (confirmed) {
                // mqtt connected
                this.on("mqtt_connected", (conn) => {
                    const now = Math.round(new Date() / 1000);

                    // publish
                    conn.publish(
                        "camera/locomotive/button",
                        JSON.stringify({ ts: now, status: "reboot" })
                    );

                    // disconnect mqtt
                    this.mqttClient.disconnect();

                    $restartContent.hide();
                    $restartProgress.show();

                    var $bar = $restartProgress.find(".progress-bar");
                    var timeTotal = 5,
                        time = timeTotal,
                        p = (time / timeTotal) * 100;

                    $restartTime.html(time);
                    $btnRestartConfirm.attr("disabled", "disabled");
                    $btnRestartCancel.attr("disabled", "disabled");

                    restartTimer = setInterval(function () {
                        time = time - 1;
                        p = (time / timeTotal) * 100;
                        $bar.css("width", p + "%");

                        $restartTime.html(time);

                        if (time <= 0) {
                            clearInterval(restartTimer);
                            restartTimer = null;

                            $restartContent.html("Reloading ...");
                            $restartProgress.hide();
                            $restartContent.show();
                            setTimeout(() => {
                                window.location = "index.php";
                            }, 3000);
                        }
                    }, 1000);
                });

                this.initMqtt();
                this.mqttClient.connect();
            } else {
                $btnRestartConfirm
                    .attr("data-confirmed", 1)
                    .removeClass("btn-warning")
                    .addClass("btn-danger")
                    .html("Yes - Restart");
            }
        });
    }
}
