export function generateClientId(length) {
    if (length < 1 || length > 23) {
        throw new Error('Length must be between 1 and 23 characters.');
    }
    const timestamp = Date.now().toString(36);
    const randomLength = length - timestamp.length;
    const characters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    let result = timestamp;
    for (let i = 0; i < randomLength; i++) {
        const randomIndex = Math.floor(Math.random() * characters.length);
        result += characters[randomIndex];
    }

    return result;
}

export const wait = ms => new Promise(resolve => setTimeout(resolve, ms));

export function getTimestamp() {
    return Math.floor(Date.now() / 1000);
}

export function isObjectEmpty(obj) {
    for (const prop in obj) {
        if (Object.hasOwn(obj, prop)) {
            return false;
        }
    }

    return true;
}

let _workers = {};

export function worker(name, interval, callback) {
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
        callback: typeof callback === 'function' ? callback : function () {},
    };

    // return a Promise
    _workers[name].timer = setTimeout(() => {
        _workers[name].callback();

        if (interval > 0) {
            worker(name, interval, callback);
        }
    }, interval);
}

export function setCookie(name, value, days, path) {
    var expires = '';
    if (days) {
        var date = new Date();
        date.setTime(date.getTime() + days * 24 * 60 * 60 * 1000);
        expires = '; expires=' + date.toUTCString();
    }

    const pathName = location.pathname;
    path = path || pathName.substring(pathName.lastIndexOf('/') + 1, pathName.lastIndexOf('.'));

    document.cookie = name + '=' + (value || '') + expires + '; path=' + (path || '/');
}

export function getCookie(name) {
    var nameEQ = name + '=';
    var ca = document.cookie.split(';');
    for (var i = 0; i < ca.length; i++) {
        var c = ca[i];
        while (c.charAt(0) == ' ') c = c.substring(1, c.length);
        if (c.indexOf(nameEQ) == 0) return c.substring(nameEQ.length, c.length);
    }
    return null;
}

export function eraseCookie(name) {
    document.cookie = name + '=; Path=/; Expires=Thu, 01 Jan 1970 00:00:01 GMT;';
}
