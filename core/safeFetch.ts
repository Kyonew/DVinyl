/**
 * Fetching an image from an address someone typed, without letting that address reach
 * the machine's own network (#136). The server would otherwise fetch whatever it is told
 * to, from inside: a router's admin page, a cloud metadata endpoint, a service bound to
 * localhost.
 *
 * Every host is resolved first and refused when any of its addresses is private,
 * loopback, link-local, reserved or multicast. The connection then goes to the address
 * that was checked, not to a second lookup, so a name answering differently the second
 * time cannot slip through. Redirects are followed by hand, each hop checked the same
 * way. Only http and https on their usual ports, a size cap and a time limit.
 */
import dns from 'dns';
import http from 'http';
import https from 'https';
import net from 'net';

export class UnsafeAddressError extends Error {
  constructor(message = 'unsafe_address') { super(message); this.name = 'UnsafeAddressError'; }
}

const blocked = new net.BlockList();
for (const [range, bits] of [
  ['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8], ['169.254.0.0', 16],
  ['172.16.0.0', 12], ['192.0.0.0', 24], ['192.0.2.0', 24], ['192.88.99.0', 24], ['192.168.0.0', 16],
  ['198.18.0.0', 15], ['198.51.100.0', 24], ['203.0.113.0', 24], ['224.0.0.0', 4], ['240.0.0.0', 4]
] as const) blocked.addSubnet(range, bits, 'ipv4');
for (const [range, bits] of [
  ['::', 128], ['::1', 128], ['100::', 64], ['2001:db8::', 32], ['fc00::', 7], ['fe80::', 10], ['ff00::', 8]
] as const) blocked.addSubnet(range, bits, 'ipv6');

/** Whether an address may be fetched from: a public one, never one of the machine's networks. */
export function isPublicAddress(address: string): boolean {
  const family = net.isIP(address);
  if (family === 4) return !blocked.check(address, 'ipv4');
  if (family !== 6) return false;
  const lower = address.toLowerCase();
  // An IPv4 address written as IPv6 (::ffff:10.0.0.1, or NAT64 64:ff9b::) is judged as
  // the IPv4 one it carries.
  const embedded = /^(?:::ffff:|64:ff9b::)(?:0:)?(\d+\.\d+\.\d+\.\d+)$/.exec(lower);
  if (embedded) return isPublicAddress(embedded[1]!);
  const hexMapped = /^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/.exec(lower);
  if (hexMapped) {
    const high = parseInt(hexMapped[1]!, 16);
    const low = parseInt(hexMapped[2]!, 16);
    return isPublicAddress(`${high >> 8}.${high & 255}.${low >> 8}.${low & 255}`);
  }
  return !blocked.check(address, 'ipv6');
}

/**
 * The addresses to try for `hostname`, once every address it has is known public. IPv4
 * first: a container often has no IPv6 route, and a host answering both would otherwise
 * fail there for no reason of its own.
 */
async function resolvePublic(hostname: string): Promise<{ address: string; family: number }[]> {
  const bare = hostname.replace(/^\[|\]$/g, '');
  if (net.isIP(bare)) {
    if (!isPublicAddress(bare)) throw new UnsafeAddressError();
    return [{ address: bare, family: net.isIP(bare) }];
  }
  const found = await dns.promises.lookup(bare, { all: true, verbatim: true });
  if (found.length === 0 || found.some(entry => !isPublicAddress(entry.address))) throw new UnsafeAddressError();
  return [...found].sort((a, b) => a.family - b.family);
}

// Errors of the connection itself, after which the next address may well answer.
const CONNECT_ERRORS = new Set(['ENETUNREACH', 'EHOSTUNREACH', 'ECONNREFUSED', 'EADDRNOTAVAIL', 'ETIMEDOUT']);

/** Whether a URL is one this module would even try: http or https on the usual port. */
export function isFetchableUrl(raw: string): boolean {
  try {
    const url = new URL(raw);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return false;
    if (url.username || url.password) return false;
    return url.port === '' || url.port === '80' || url.port === '443';
  } catch {
    return false;
  }
}

export interface SafeFetchOptions {
  maxBytes: number;
  timeoutMs?: number;
  maxRedirects?: number;
}

function requestOnce(url: URL, target: { address: string; family: number }, options: SafeFetchOptions, signal: AbortSignal)
  : Promise<{ status: number; location?: string; body?: Buffer }> {
  return new Promise((resolve, reject) => {
    const client = url.protocol === 'https:' ? https : http;
    const request = client.request(url, {
      method: 'GET',
      headers: { 'User-Agent': 'DVinylApp/4.0', 'Accept': 'image/*' },
      // The checked address, whatever a second lookup would answer.
      lookup: (_host: string, opts: any, callback: any) => {
        if (opts && opts.all) callback(null, [{ address: target.address, family: target.family }]);
        else callback(null, target.address, target.family);
      },
      signal
    }, response => {
      const status = response.statusCode || 0;
      if (status >= 300 && status < 400) {
        response.resume();
        return resolve({ status, location: response.headers.location || '' });
      }
      if (status !== 200) {
        response.resume();
        return resolve({ status });
      }
      const declared = Number(response.headers['content-length'] || 0);
      if (declared > options.maxBytes) {
        response.destroy();
        return reject(new Error('too_large'));
      }
      const chunks: Buffer[] = [];
      let size = 0;
      response.on('data', (chunk: Buffer) => {
        size += chunk.length;
        if (size > options.maxBytes) {
          response.destroy();
          reject(new Error('too_large'));
          return;
        }
        chunks.push(chunk);
      });
      response.on('end', () => resolve({ status, body: Buffer.concat(chunks) }));
      response.on('error', reject);
    });
    request.on('error', reject);
    request.end();
  });
}

/** The bytes at `raw`, fetched as described above. Throws on anything else. */
export async function fetchPublic(raw: string, options: SafeFetchOptions): Promise<Buffer> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), options.timeoutMs ?? 15000);
  try {
    let current = raw;
    for (let hop = 0; hop <= (options.maxRedirects ?? 3); hop++) {
      if (!isFetchableUrl(current)) throw new UnsafeAddressError('unsupported_url');
      const url = new URL(current);
      const targets = await resolvePublic(url.hostname);
      let reply: { status: number; location?: string; body?: Buffer } | null = null;
      let lastError: any = null;
      for (const target of targets) {
        try {
          reply = await requestOnce(url, target, options, controller.signal);
          break;
        } catch (err: any) {
          lastError = err;
          if (!CONNECT_ERRORS.has(err?.code)) throw err;
        }
      }
      if (!reply) throw lastError || new Error('unreachable');
      if (reply.body) return reply.body;
      if (reply.location !== undefined) {
        current = new URL(reply.location, url).toString();
        continue;
      }
      throw new Error(`http_${reply.status}`);
    }
    throw new Error('too_many_redirects');
  } finally {
    clearTimeout(timer);
  }
}
