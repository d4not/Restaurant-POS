/**
 * LAN-side discovery for ESC/POS network printers.
 *
 * Strategy:
 *   1. Pick a /24 subnet — explicit override from the request, or the first
 *      private IPv4 we own.
 *   2. Probe every host (.1 - .254) with a short TCP connect on the printer
 *      port (9100 by default). A successful socket connect is the signal:
 *      ESC/POS printers don't respond to plain TCP probes with anything
 *      meaningful, but they do open the port.
 *   3. For each hit attempt a reverse-DNS lookup to surface a friendlier name
 *      ("KITCHEN-PRINTER.local") — best-effort, NULL on failure.
 *
 * The scan caps concurrency so a tablet on a busy network doesn't burn
 * sockets. ~64 in-flight probes is the sweet spot empirically: a /24 finishes
 * in ~5 seconds with a 250 ms per-host timeout and most LANs are quiet.
 *
 * NOT a full mDNS / SSDP discovery. Many low-cost ESC/POS printers don't
 * advertise themselves; a TCP probe is the lowest-common-denominator that
 * still finds them.
 */
import net from 'node:net';
import os from 'node:os';
import dns from 'node:dns/promises';
import { logger } from '../../lib/logger.js';

export interface DiscoveredPrinter {
  ip: string;
  port: number;
  hostname: string | null;
  // Round-trip time of the successful TCP connect, in milliseconds. Lower is
  // better — useful when picking the kitchen printer (closest = LAN-native).
  latency_ms: number;
}

export interface ScanOptions {
  subnet?: string;
  port?: number;
  timeoutMs?: number;
}

const DEFAULT_PORT = 9100;
const DEFAULT_TIMEOUT_MS = 200;
const PARALLELISM = 64;

function tcpProbe(ip: string, port: number, timeoutMs: number): Promise<number | null> {
  return new Promise((resolve) => {
    const socket = new net.Socket();
    let settled = false;
    const start = Date.now();
    const finish = (latency: number | null): void => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolve(latency);
    };
    socket.setTimeout(timeoutMs);
    socket.once('connect', () => finish(Date.now() - start));
    socket.once('error', () => finish(null));
    socket.once('timeout', () => finish(null));
    try {
      socket.connect(port, ip);
    } catch {
      finish(null);
    }
  });
}

// Find the first non-internal IPv4 address on this host. We use it to derive
// the default /24 to scan — picking the wrong NIC on a multi-homed server is
// a foot-gun, but for a typical café tablet/POS box there's only one anyway.
function detectLocalSubnet(): string | null {
  const interfaces = os.networkInterfaces();
  for (const name of Object.keys(interfaces)) {
    const addrs = interfaces[name];
    if (!addrs) continue;
    for (const addr of addrs) {
      if (addr.family !== 'IPv4' || addr.internal) continue;
      // Strip the last octet — caller appends 1..254. We don't use the netmask
      // because most LANs are /24; a stricter interpretation isn't worth the
      // edge-case surface for a discovery scan.
      const parts = addr.address.split('.');
      if (parts.length === 4) {
        return `${parts[0]}.${parts[1]}.${parts[2]}`;
      }
    }
  }
  return null;
}

function normaliseSubnet(input: string): string {
  // Accept a full IP (192.168.1.50) or a /24 prefix (192.168.1) — we only
  // care about the first three octets either way.
  const parts = input.split('.');
  if (parts.length < 3) {
    throw new Error(`Invalid subnet: ${input}`);
  }
  return `${parts[0]}.${parts[1]}.${parts[2]}`;
}

async function reverseLookup(ip: string): Promise<string | null> {
  try {
    const names = await dns.reverse(ip);
    return names[0] ?? null;
  } catch {
    return null;
  }
}

export async function scanForPrinters(options: ScanOptions = {}): Promise<{
  subnet: string | null;
  port: number;
  scanned: number;
  printers: DiscoveredPrinter[];
}> {
  const port = options.port ?? DEFAULT_PORT;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const subnet = options.subnet ? normaliseSubnet(options.subnet) : detectLocalSubnet();

  if (!subnet) {
    logger.warn('Printer scan requested but no usable network interface found');
    return { subnet: null, port, scanned: 0, printers: [] };
  }

  const ips: string[] = [];
  for (let host = 1; host <= 254; host += 1) {
    ips.push(`${subnet}.${host}`);
  }

  const hits: { ip: string; latency_ms: number }[] = [];
  let cursor = 0;

  async function worker(): Promise<void> {
    while (cursor < ips.length) {
      const idx = cursor;
      cursor += 1;
      const ip = ips[idx];
      const latency = await tcpProbe(ip, port, timeoutMs);
      if (latency !== null) {
        hits.push({ ip, latency_ms: latency });
      }
    }
  }

  await Promise.all(Array.from({ length: PARALLELISM }, () => worker()));

  // Resolve hostnames in parallel AFTER all TCP probes — avoids blocking
  // workers on slow DNS servers.
  const hostnames = await Promise.all(hits.map((h) => reverseLookup(h.ip)));
  const found: DiscoveredPrinter[] = hits.map((h, i) => ({
    ip: h.ip,
    port,
    hostname: hostnames[i],
    latency_ms: h.latency_ms,
  }));

  found.sort((a, b) => a.latency_ms - b.latency_ms);

  return { subnet, port, scanned: ips.length, printers: found };
}
