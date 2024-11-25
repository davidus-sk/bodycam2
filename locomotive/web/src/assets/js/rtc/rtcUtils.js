export class RtcMessage {
    constructor(type, message) {
        this.type = type;
        this.message = typeof message === 'string' ? message : String(message);
    }
}

export class MetaCmdMessage {
    constructor(command, message = '') {
        this.command = command;
        this.message = message;
    }
}

export function sortByMimeTypes(codecs, preferredOrder) {
    return codecs.sort((a, b) => {
        const indexA = preferredOrder.indexOf(a.mimeType);
        const indexB = preferredOrder.indexOf(b.mimeType);
        const orderA = indexA >= 0 ? indexA : Number.MAX_VALUE;
        const orderB = indexB >= 0 ? indexB : Number.MAX_VALUE;
        return orderA - orderB;
    });
}

/**
 * Remove a specific codec from SDP.
 * @param {string} sdp - Original SDP string.
 * @param {string} codec - Codec to be removed.
 * @returns {string} - Modified SDP string.
 */
export function removeCodec(orgsdp, codec) {
    const codecRegex = new RegExp(`a=rtpmap:(\\d*) ${codec}/90000\\r\\n`);
    let modifiedSdp = orgsdp.replace(codecRegex, '');

    // Remove associated rtcp-fb, fmtp, and apt lines
    modifiedSdp = modifiedSdp.replace(new RegExp(`a=rtcp-fb:(\\d*) ${codec}.*\\r\\n`, 'g'), '');
    modifiedSdp = modifiedSdp.replace(new RegExp(`a=fmtp:(\\d*) ${codec}.*\\r\\n`, 'g'), '');

    // Handle fmtp apt
    const aptRegex = new RegExp(`a=fmtp:(\\d*) apt=(\\d*)\\r\\n`);
    modifiedSdp = modifiedSdp.replace(aptRegex, '');

    // Process video line modifications
    const videoLineRegex = /m=video.*\r\n/;
    const videoLineMatch = modifiedSdp.match(videoLineRegex);
    if (videoLineMatch) {
        let videoLine = videoLineMatch[0].trim();
        const videoElements = videoLine.split(' ');
        videoLine = videoElements.filter(el => el !== codec).join(' ') + '\r\n';
        modifiedSdp = modifiedSdp.replace(videoLineRegex, videoLine);
    }

    return modifiedSdp;
}

/**
 * Convert an ArrayBuffer to a string.
 * @param {Uint8Array} buffer - The ArrayBuffer to convert.
 * @returns {string} - The resulting string.
 */
export function arrayBufferToString(buffer) {
    return buffer.reduce((acc, curr) => acc + String.fromCharCode(curr), '');
}

/**
 * Convert an ArrayBuffer to a string.
 * @param {string} str - The string to convert.
 * @returns {Uint8Array} - The resulting Uint8Array.
 */
export function stringToArrayBuffer(str) {
    const buffer = new Uint8Array(str.length);
    for (let i = 0; i < str.length; i++) {
        buffer[i] = str.charCodeAt(i);
    }

    return buffer;
}

/**
 * Convert an ArrayBuffer to a Base64 string.
 * @param {Uint8Array} buffer - The ArrayBuffer to convert.
 * @returns {string} - The resulting Base64 string.
 */
export function arrayBufferToBase64(buffer) {
    return btoa(arrayBufferToString(buffer));
}
