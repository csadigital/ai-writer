const dns = require('node:dns').promises;
const net = require('node:net');

function isPublicAddress(address) {
    if (net.isIP(address) === 4) {
        const [a, b] = address.split('.').map(Number);
        return !(a === 0 || a === 10 || a === 127 || a >= 224 ||
            (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254) ||
            (a === 172 && b >= 16 && b <= 31) || (a === 192 && (b === 168 || b === 0)) ||
            (a === 198 && (b === 18 || b === 19 || b === 51)) || (a === 203 && b === 0));
    }
    // Only globally routable IPv6 unicast; excludes loopback, mapped IPv4 and local ranges.
    return net.isIP(address) === 6 && /^[23]/i.test(address) && !address.toLowerCase().startsWith('2001:db8:');
}

async function validatePublicUrl(value) {
    let url;
    try { url = new URL(value); } catch { throw new Error('Enter a valid public HTTPS image or website URL.'); }
    if (url.protocol !== 'https:' || url.username || url.password || (url.port && url.port !== '443')) {
        throw new Error('Only public HTTPS URLs without credentials are supported.');
    }
    const hostname = url.hostname.replace(/^\[|\]$/g, '');
    const addresses = net.isIP(hostname) ? [{ address: hostname }] : await dns.lookup(hostname, { all: true });
    if (!addresses.length || addresses.some(({ address }) => !isPublicAddress(address))) {
        throw new Error('Private and local network addresses are not supported.');
    }
    return url.href;
}

module.exports = { isPublicAddress, validatePublicUrl };
