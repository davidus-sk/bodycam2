let _workers = {};

export const worker = function (name, interval, callback) {
    if (interval !== false) {
        interval = interval && interval > 0 ? parseInt(interval) : 5000;
    }

    if (name in _workers) {
        if (_workers[name].timer) {
            clearTimeout(_workers[name].timer);
            _workers[name].timer = null;
        }

        if (interval === false) {
            delete _workers[name];
            return;
        }
    }

    _workers[name] = {
        timer: null,
        interval: interval,
        callback: typeof callback === "function" ? callback : function () {},
    };

    // return a Promise
    _workers[name].timer = setTimeout(() => {
        _workers[name].callback();

        if (interval > 0) {
            worker(name, interval, callback);
        }
    }, interval);
};
