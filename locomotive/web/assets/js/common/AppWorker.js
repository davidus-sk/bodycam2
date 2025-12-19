export class AppWorker {
    constructor(name, interval, callback, options) {
        // the worker name for tracking
        this.name = name;
        // callback to simulate worker message passing
        this.onTick = null;
        // on tick callback
        this.callback = callback;
        // flag if is running or not
        this.isRunning = false;

        // ID returned by setTimeout
        this._timeoutId = null;

        // interval normalization
        if (interval === false) {
            this.interval = false;
        } else {
            const n = Number(interval);
            this.interval = Number.isFinite(n) && n > 0 ? Math.floor(n) : 5000;
        }

        // additional options
        this.options = {
            manual: false,
        };
        if (options && typeof options === 'object') {
            this.options = { ...this.options, ...options };
        }

        // run
        if (this.options.manual === false) {
            this.start();
        }
    }

    start() {
        if (this.isRunning) return;
        this.isRunning = true;
        this._run();
    }

    _run() {
        if (!this.isRunning) return;
        if (this.interval === false) return;

        this._timeoutId = setTimeout(() => {
            // callback
            if (this.callback && typeof this.callback === 'function') {
                try {
                    this.callback();
                } catch (e) {
                    // decide policy: either log and continue, or stop
                    // console.error(`[AppWorker:${this.name}] callback error`, e);
                }
            }

            // onTick
            if (this.onTick && typeof this.onTick === 'function') {
                try {
                    this.onTick();
                } catch (e) {}
            }

            // schedule next tick
            this._run();
        }, this.interval);
    }

    stop() {
        this.isRunning = false;

        if (this._timeoutId !== null) {
            clearTimeout(this._timeoutId);
            this._timeoutId = null;
        }
    }

    terminate() {
        this.stop();
    }
}
