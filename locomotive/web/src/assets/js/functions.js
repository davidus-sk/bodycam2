export function generateClientId(length) {
    if (length < 1 || length > 23) {
        throw new Error("Length must be between 1 and 23 characters.");
    }
    const timestamp = Date.now().toString(36);
    const randomLength = length - timestamp.length;
    const characters =
        "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
    let result = timestamp;
    for (let i = 0; i < randomLength; i++) {
        const randomIndex = Math.floor(Math.random() * characters.length);
        result += characters[randomIndex];
    }

    return result;
}

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
