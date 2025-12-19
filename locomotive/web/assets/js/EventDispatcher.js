export class EventDispatcher {
    constructor(target) {
        this._listeners = null;

        if (target) {
            EventDispatcher.attach(target);
        }
    }

    /**
     * Static initializer to mix EventDispatcher methods into a target object or prototype.
     *
     * 		EventDispatcher.attach(MyClass.prototype); // add to the prototype of the class
     * 		EventDispatcher.attach(myObject); // add to a specific instance
     *
     * @method attach
     * @static
     * @param {Object} target The target object to inject EventDispatcher methods into.
     * This can be an instance or a
     * prototype.
     */
    static attach(target) {
        this._listeners = null;

        var p = EventDispatcher.prototype;

        p._listeners = null;

        target.on = p.on;
        target.off = p.off;
        target.emit = p.emit;
        target.hasEventListener = p.hasEventListener;
        target.removeAllEventListeners = p.removeAllEventListeners;
    }

    on(type, listener) {
        if (this._listeners === undefined) this._listeners = {};
        if (this._listeners[type] === undefined) {
            this._listeners[type] = [];
        }
        if (this._listeners[type].indexOf(listener) === -1) {
            this._listeners[type].push(listener);
        }
    }

    off(type, listener) {
        if (Object.keys(this._listeners).length === 0) return;
        if (Array.isArray(type)) {
            type.forEach((t) => {
                if (typeof this._listeners[t] !== undefined) {
                    this._listeners[t] = [];
                }
            });
        } else {
            const listenerArray = this._listeners[type];
            if (listenerArray !== undefined) {
                if (listener === undefined) {
                    this._listeners[type] = [];
                } else {
                    listenerArray = listenerArray.filter((l) => {
                        return l.toString() !== listener.toString();
                    });
                }
            }
        }
    }

    emit(type, ...argument) {
        if (this._listeners === undefined) return;
        const listenerArray = this._listeners[type];
        if (listenerArray !== undefined) {
            // Make a copy, in case listeners are removed while iterating.
            const array = listenerArray.slice(0);
            for (let i = 0, l = array.length; i < l; i++) {
                array[i].apply(this, argument);
            }
        }

        // "*" listener
        if (this._listeners["*"] !== undefined) {
            const all = this._listeners["*"];
            const arr = all.slice(0);
            for (let i = 0, l = arr.length; i < l; i++) {
                arr[i].apply(this, [type, argument]);
            }
        }
    }

    hasEventListener(type) {
        return !!(this._listeners && this._listeners[type]);
    }

    removeAllEventListeners(type) {
        if (!type) {
            this._listeners = null;
        } else {
            if (this._listeners) {
                delete this._listeners[type];
            }
        }
    }

    /**
     * @method toString
     * @return {String} a string representation of the instance.
     */
    toString() {
        return "[EventDispatcher]";
    }
}
