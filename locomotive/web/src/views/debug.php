<div class="p-5">

    <div class="mb-5">
        <button id="btn-connect" type="button" class="btn btn-sm btn-success" onclick="connect()">Connect</button>
        <button id="btn-disconnect" type="button" class="btn btn-sm btn-danger me-3" onclick="disconnect()" disabled>Disconnect</button>
    </div>

    <div class="buton">
        <button id="btn-cam-status" type="button" class="btn btn-sm btn-secondary" onclick="cameraStatus()" disabled>Connect camera</button>
        <button id="btn-panic" type="button" class="btn btn-sm btn-secondary ms-2" onclick="panic()" disabled>Panic button</button>
    </div>
</div>
<script>

let mqttClient;
let cameraId;
let mqttClientId;
let $btnConnect;
let $btnDisconnect;
let $btnCameraStatus;
let $btnPanic;

const config = <?= Config::read(true); ?>;

function constructTopic(topic, subLevels) {
    let t = `${this.options.cameraId}/${topic}/${this.mqttClientId}`;
    if (typeof subLevels === "string") {
        t += subLevels;
    }

    t = t.replace("/{1,}/", "/");

    return t;
}

function connect() {
    if (mqttClient) {
        mqttClient.connect();
    }
}

function disconnect() {
    if (mqttClient) {
        mqttClient.disconnect();
    }
}

function cameraStatus() {
    if (mqttClient && mqttClient.isConnected()) {
        console.log("f: cameraStatus()");
        
        let topic = `camera/${cameraId}/status`;
        mqttClient.publish(topic, JSON.stringify({
            'camera_id': cameraId,
            'status': 'alive',
            'lat': 23.3444,
            'lng': 23.2222,
            "ts": 1732379155,
        }));

        console.log("f: mqtt publish -> " + topic);
    }
}

function panic() {
    if (mqttClient && mqttClient.isConnected()) {
        console.log("f: cameraStatus()");
        
        let topic = `camera/${cameraId}/button`;
        mqttClient.publish(topic, JSON.stringify({
            'camera_id': cameraId,
            'client': 'js'
        }));

        console.log("f: mqtt publish -> " + topic);
    }
}

$(function() {
    $btnConnect = $("#btn-connect");
    $btnDisconnect = $("#btn-disconnect");
    $btnCameraStatus = $("#btn-cam-status");
    $btnPanic = $("#btn-panic");
});
</script>
<script type="module">
import { generateClientId } from "./assets/js/functions.js";
import { EventDispatcher } from "./assets/js/EventDispatcher.js";
import { MqttClient } from "./assets/js/mqtt/client.js";

$(function() {

    cameraId = "camera-00000000b203ade4";
    mqttClientId = generateClientId(23);
    config.mqtt.clientId = mqttClientId;

    // init mqtt client
    mqttClient = new MqttClient(config.mqtt);

    // mqtt connected
    mqttClient.onConnect = async (conn) => {

        // subscribe to all topics
        conn.subscribe("#");
        
        conn.on("message", (topic, message) => {
            console.log("e: mqtt message <--", topic, message.toString());
        });


        console.log("e: mqtt connected", conn);
        $btnConnect.attr("disabled", "disabled");
        $btnDisconnect.attr("disabled", false);

        $btnCameraStatus.attr("disabled", false);
        $btnPanic.attr("disabled", false);
    };

    mqttClient.onDisconnect = async (clientId) => {
        console.log("e: mqtt disconnected", clientId);
        $btnConnect.attr("disabled", false);
        $btnDisconnect.attr("disabled", "disabled");

        $btnCameraStatus.attr("disabled", "disabled");
        $btnPanic.attr("disabled", "disabled");
    };

});
</script>
