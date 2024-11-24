export class Debug {
    constructor() {
        this.$btnCameraStatus = $('#btn-cam-status');
        this.$btnPanic = $('#btn-panic');

        this.cameraId = 'camera-00000000b203ade4';

        // mqtt
        this.mqttClient = app?.getMqttClient();
        if (this.mqttClient) {
            this.mqttClient.on('connect', () => this.mqttConnected());
            this.mqttClient.on('disconnect', () => this.mqttDisconnect());
        }
    }

    constructTopic(topic, subLevels) {
        let t = `${this.cameraId}/${topic}/${this.mqttClientId}`;
        if (typeof subLevels === 'string') {
            t += subLevels;
        }

        t = t.replace('/{1,}/', '/');

        return t;
    }

    cameraStatus() {
        if (this.mqttClient && this.mqttClient.isConnected()) {
            console.log('f: cameraStatus()');

            let topic = `camera/${this.cameraId}/status`;
            this.mqttClient.publish(
                topic,
                JSON.stringify({
                    camera_id: this.cameraId,
                    status: 'alive',
                    lat: 23.3444,
                    lng: 23.2222,
                    ts: 1732379155,
                })
            );

            console.log('f: mqtt publish -> ' + topic);
        }
    }

    panic() {
        if (this.mqttClient && this.mqttClient.isConnected()) {
            console.log('f: cameraStatus()');

            let topic = `camera/${this.cameraId}/button`;
            this.mqttClient.publish(
                topic,
                JSON.stringify({
                    camera_id: this.cameraId,
                    client: 'js',
                })
            );

            console.log('f: mqtt publish -> ' + topic);
        }
    }

    mqttConnected() {
        console.log('e: mqtt connected');

        // client id
        this.mqttClientId = this.mqttClient.getClientId();

        // subscribe
        this.mqttClient.subscribe('#');

        this.mqttClient.on('message', (topic, message) => {
            const msg = message ? message.toString() : null;
            console.log('e: mqtt message <--', topic, msg);
        });

        this.$btnCameraStatus.attr('disabled', false);
        this.$btnPanic.attr('disabled', false);
    }

    mqttDisconnect() {
        console.log('e: mqtt disconnected');

        // unsubscribe
        conn.unsubscribe('#');

        this.$btnCameraStatus.attr('disabled', 'disabled');
        this.$btnPanic.attr('disabled', 'disabled');
    }
}
