import { isIP } from 'node:net';
import { lookup } from 'node:dns/promises';

export class FetchError extends Error {
  constructor(public code: 'blocked' | 'dns' | 'timeout' | 'network' | 'content_type' | 'robots' | 'robots_unavailable' | 'redirects' | 'http', message: string) {
    super(message);
  }
}

function v4ToInt(ip: string): number {
  return ip.split('.').reduce((a, o) => (a << 8) + parseInt(o, 10), 0) >>> 0;
}
const V4_BLOCKED: [string, number][] = [
  ['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8], ['169.254.0.0', 16], ['172.16.0.0', 12],
  ['192.0.0.0', 24], ['192.0.2.0', 24], ['192.88.99.0', 24], ['192.168.0.0', 16], ['198.18.0.0', 15],
  ['198.51.100.0', 24], ['203.0.113.0', 24], ['224.0.0.0', 4], ['240.0.0.0', 4],
];
function isPrivateV4(ip: string): boolean {
  const n = v4ToInt(ip);
  return V4_BLOCKED.some(([base, bits]) => {
    const mask = bits === 0 ? 0 : (~0 << (32 - bits)) >>> 0;
    return (n & mask) >>> 0 === (v4ToInt(base) & mask) >>> 0;
  });
}

/** Expands an IPv6 string into 8 numeric hextets. Returns null if malformed. */
function expandV6(ip: string): number[] | null {
  let s = ip.split('%')[0]!;
  const dotted = /(\d+\.\d+\.\d+\.\d+)$/.exec(s);
  if (dotted) {
    const n = v4ToInt(dotted[1]!);
    s = s.slice(0, dotted.index) + ((n >>> 16) & 0xffff).toString(16) + ':' + (n & 0xffff).toString(16);
  }
  const halves = s.split('::');
  if (halves.length > 2) return null;
  const head = halves[0] ? halves[0].split(':') : [];
  const tail = halves[1] ? halves[1].split(':') : [];
  const missing = 8 - head.length - tail.length;
  if (halves.length === 1 ? head.length !== 8 : missing < 0) return null;
  const all = halves.length === 1 ? head : [...head, ...Array(missing).fill('0'), ...tail];
  const nums = all.map((h) => parseInt(h || '0', 16));
  return nums.length === 8 && nums.every((x) => Number.isInteger(x) && x >= 0 && x <= 0xffff) ? nums : null;
}

export function isPrivateIp(ip: string): boolean {
  const fam = isIP(ip);
  if (fam === 4) return isPrivateV4(ip);
  if (fam !== 6) return true; // unknown format: refuse
  const h = expandV6(ip);
  if (!h) return true;
  const [a, b, c, d, e, f, g, hh] = h as [number, number, number, number, number, number, number, number];
  const embeddedV4 = `${g >> 8}.${g & 255}.${hh >> 8}.${hh & 255}`;
  if (h.every((x) => x === 0)) return true; // ::
  if (h.slice(0, 7).every((x) => x === 0) && hh === 1) return true; // ::1
  if (a === 0 && b === 0 && c === 0 && d === 0 && e === 0 && f === 0xffff) return isPrivateV4(embeddedV4); // ::ffff:v4
  if (a === 0 && b === 0 && c === 0 && d === 0 && e === 0 && f === 0) return isPrivateV4(embeddedV4); // ::v4 (deprecated)
  if (a === 0x64 && b === 0xff9b) return isPrivateV4(embeddedV4); // NAT64
  if (a === 0x2002) return isPrivateV4(`${b >> 8}.${b & 255}.${c >> 8}.${c & 255}`); // 6to4
  if ((a & 0xffc0) === 0xfe80) return true; // link-local
  if ((a & 0xfe00) === 0xfc00) return true; // unique local
  if ((a & 0xff00) === 0xff00) return true; // multicast
  if (a === 0x2001 && b === 0x0db8) return true; // documentation
  if (a === 0x0100 && b === 0 && c === 0 && d === 0) return true; // discard
  return false;
}

const BLOCKED_NAMES = /(^|\.)(localhost|local|internal|localdomain|lan|home|corp|intranet)$/i;

/** Cheap, synchronous check used at save time and before every fetch hop. Throws FetchError('blocked'). */
export function assertPublicUrlShape(raw: string, allowPrivate = false): URL {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    throw new FetchError('blocked', 'That is not a valid web address.');
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') throw new FetchError('blocked', 'Only http and https addresses can be tracked.');
  if (u.username || u.password) throw new FetchError('blocked', 'Addresses with credentials are not allowed.');
  if (allowPrivate) return u;
  if (u.port && !['80', '443'].includes(u.port)) throw new FetchError('blocked', 'Only the standard web ports (80 and 443) are allowed.');
  const host = u.hostname.replace(/^\[|\]$/g, '');
  if (isIP(host)) {
    if (isPrivateIp(host)) throw new FetchError('blocked', 'That address points to a private or reserved network and cannot be tracked.');
  } else if (BLOCKED_NAMES.test(host)) {
    throw new FetchError('blocked', 'Internal hostnames cannot be tracked.');
  }
  return u;
}

/** Resolve a hostname and refuse if ANY returned address is non-public. Returns the address to pin the connection to. */
export async function resolvePublic(hostname: string, allowPrivate: boolean): Promise<{ address: string; family: 4 | 6 }> {
  const host = hostname.replace(/^\[|\]$/g, '');
  if (isIP(host)) {
    if (!allowPrivate && isPrivateIp(host)) throw new FetchError('blocked', 'Address is on a private or reserved network.');
    return { address: host, family: isIP(host) as 4 | 6 };
  }
  let addrs: { address: string; family: number }[];
  try {
    addrs = await lookup(host, { all: true, verbatim: true });
  } catch {
    throw new FetchError('dns', `Could not resolve ${host}.`);
  }
  if (!addrs.length) throw new FetchError('dns', `Could not resolve ${host}.`);
  if (!allowPrivate && addrs.some((a) => isPrivateIp(a.address))) {
    throw new FetchError('blocked', 'Hostname resolves to a private or reserved network.');
  }
  const pick = addrs.find((a) => a.family === 4) ?? addrs[0]!;
  return { address: pick.address, family: pick.family as 4 | 6 };
}
