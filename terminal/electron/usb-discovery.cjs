// Cross-platform USB / spooler printer enumeration. Returns a flat list of
// detected printers — the operator picks one in Settings → Printers and the
// "Device path" field is filled in for them.
//
// Two sources are merged:
//
//   1. OS spooler  (Windows, macOS, Linux/CUPS)
//      Pulled from Electron's webContents.getPrintersAsync(). Anything the OS
//      knows about appears here: USB, network, virtual PDF printer, etc. We
//      flag USB-attached entries by checking `options.device-uri` (CUPS) or
//      `options.printer-location` / port hints (Windows).
//      → address  = "printer:NAME"   (node-thermal-printer's interface URI;
//                                     actual printing through this path needs
//                                     the optional native printer module)
//
//   2. Linux raw devices  (Linux only)
//      Scan of /dev/usb/lp*, /dev/usblp*, /dev/lp*. The Electron app can write
//      ESC/POS bytes straight to these without going through CUPS.
//      → address  = "/dev/usb/lpN"   (passed through verbatim by printer.cjs)
//
// Each entry includes enough metadata to render a useful row in the UI:
// kind, label, port hint, isUsb heuristic, write-permission flag, status.

const fs = require('node:fs');
const path = require('node:path');

// ─── Linux raw device scan ────────────────────────────────────────────────

const LINUX_DEVICE_DIRS = ['/dev/usb', '/dev'];
const LINUX_DEVICE_RX = /^(usb)?lp\d+$/i;

function listLinuxDevicePaths() {
  if (process.platform !== 'linux') return [];
  const paths = new Set();
  for (const dir of LINUX_DEVICE_DIRS) {
    let entries;
    try {
      entries = fs.readdirSync(dir);
    } catch {
      continue;
    }
    for (const name of entries) {
      if (!LINUX_DEVICE_RX.test(name)) continue;
      paths.add(path.join(dir, name));
    }
  }
  return [...paths].sort();
}

function readSysfsIeee1284(devicePath) {
  // /sys/class/usbmisc/lp0/device/ieee1284_id has Manufacturer/Model strings
  // when the printer driver loaded. Best-effort — many setups don't expose it.
  const base = path.basename(devicePath);
  const candidates = [
    `/sys/class/usbmisc/${base}/device/ieee1284_id`,
    `/sys/class/usb/${base}/device/ieee1284_id`,
  ];
  for (const c of candidates) {
    try {
      const raw = fs.readFileSync(c, 'utf8');
      return raw.trim();
    } catch {
      // next
    }
  }
  return null;
}

function parseIeee1284(raw) {
  // Format is semicolon-separated KEY:VALUE; e.g. "MFG:EPSON;MDL:TM-T20II;..."
  if (!raw) return { manufacturer: null, model: null };
  const out = { manufacturer: null, model: null };
  for (const part of raw.split(';')) {
    const [key, ...rest] = part.split(':');
    if (!key || !rest.length) continue;
    const value = rest.join(':').trim();
    const k = key.trim().toUpperCase();
    if (k === 'MFG' || k === 'MANUFACTURER') out.manufacturer = value;
    if (k === 'MDL' || k === 'MODEL') out.model = value;
  }
  return out;
}

function describeLinuxDevice(devicePath) {
  const id = parseIeee1284(readSysfsIeee1284(devicePath));
  let canWrite = false;
  try {
    fs.accessSync(devicePath, fs.constants.W_OK);
    canWrite = true;
  } catch {
    canWrite = false;
  }
  const label =
    id.manufacturer || id.model
      ? `${id.manufacturer ?? 'USB Printer'} ${id.model ?? ''}`.trim()
      : `USB device ${path.basename(devicePath)}`;
  return {
    id: `dev:${devicePath}`,
    kind: 'device',
    label,
    address: devicePath,
    port: path.basename(devicePath),
    isUsb: true,
    canWrite,
    isDefault: false,
    status: canWrite ? 'ready' : 'permission_denied',
    note: canWrite
      ? null
      : 'No write permission. Add your user to the "lp" group or set a udev rule.',
  };
}

// ─── OS spooler (Electron API) ────────────────────────────────────────────

// Heuristics to decide whether an OS-known printer is USB-attached. Different
// platforms surface this differently:
//   • CUPS (Linux/macOS):  options['device-uri'] starts with "usb://"
//   • Windows:             options['port'] or options['printer-port'] starts
//                          with "USB" (USB001, USB002, …) — but Electron's
//                          PrinterInfo on Windows may not surface this in a
//                          stable way, so we also look at any field whose
//                          value contains "USB".
function looksLikeUsb(info) {
  const opts = info && typeof info.options === 'object' ? info.options : {};
  const uri = String(opts['device-uri'] ?? '').toLowerCase();
  if (uri.startsWith('usb://')) return true;
  const port = String(opts['port'] ?? opts['printer-port'] ?? '').toLowerCase();
  if (port.startsWith('usb') || port.startsWith('lpt')) return true;
  // Final fallback: any option string containing "USB00" (Windows port name)
  for (const v of Object.values(opts)) {
    if (typeof v === 'string' && /\bUSB\d{2,}\b/.test(v)) return true;
  }
  return false;
}

// Pull the port label out of the printer's options in a platform-tolerant way.
// CUPS exposes the full device URI ("usb://EPSON/TM-T20II?..."); Windows uses
// the short port name ("USB001"). Either is useful to render in the UI.
function extractPort(info) {
  const opts = info && typeof info.options === 'object' ? info.options : {};
  const uri = opts['device-uri'];
  if (typeof uri === 'string' && uri) {
    return uri.length > 64 ? `${uri.slice(0, 61)}…` : uri;
  }
  const port = opts['port'] || opts['printer-port'];
  if (typeof port === 'string' && port) return port;
  // CUPS sometimes places a USB hint in printer-location.
  const loc = opts['printer-location'];
  if (typeof loc === 'string' && /usb/i.test(loc)) return loc;
  return null;
}

function mapStatus(info) {
  const opts = info && typeof info.options === 'object' ? info.options : {};
  // CUPS: printer-state 3=idle, 4=processing, 5=stopped
  const state = String(opts['printer-state'] ?? '').trim();
  if (state === '3') return 'ready';
  if (state === '4') return 'busy';
  if (state === '5') return 'stopped';
  // Windows status code from Electron's PrinterInfo.status
  // 0 = idle/ready, others mean trouble.
  if (info && typeof info.status === 'number') {
    return info.status === 0 ? 'ready' : 'attention';
  }
  return 'unknown';
}

async function listSystemPrinters(browserWindow) {
  if (!browserWindow || browserWindow.isDestroyed?.()) return [];
  const wc = browserWindow.webContents;
  if (!wc || typeof wc.getPrintersAsync !== 'function') return [];
  let infos;
  try {
    infos = await wc.getPrintersAsync();
  } catch {
    return [];
  }
  if (!Array.isArray(infos)) return [];
  return infos.map((info) => {
    const isUsb = looksLikeUsb(info);
    return {
      id: `spool:${info.name}`,
      kind: 'system',
      label: info.displayName || info.name,
      // node-thermal-printer's "printer:" interface URI. Actual printing via
      // this path needs the optional native printer module — the address is
      // still saved so the user can swap it in later without re-detecting.
      address: `printer:${info.name}`,
      port: extractPort(info),
      isUsb,
      canWrite: true, // OS spooler manages permissions for us
      isDefault: Boolean(info.isDefault),
      status: mapStatus(info),
      description: info.description || null,
      note: null,
    };
  });
}

// ─── Public entry point ────────────────────────────────────────────────────

async function listDetectedPrinters(browserWindow) {
  const [systemList, deviceList] = await Promise.all([
    listSystemPrinters(browserWindow),
    Promise.resolve(listLinuxDevicePaths().map(describeLinuxDevice)),
  ]);

  // System list first (the OS knows what it's talking about), then raw Linux
  // devices that the spooler might not cover. USB-flagged entries float to
  // the top of the system group so the operator's eye lands on them first.
  const sortedSystem = [...systemList].sort((a, b) => {
    if (a.isUsb !== b.isUsb) return a.isUsb ? -1 : 1;
    if (a.isDefault !== b.isDefault) return a.isDefault ? -1 : 1;
    return a.label.localeCompare(b.label);
  });

  return {
    platform: process.platform,
    printers: [...sortedSystem, ...deviceList],
    // Counters used by the UI to drive its "no USB printers found" empty
    // state — separate from a hard failure that left the lists empty.
    counts: {
      system: sortedSystem.length,
      device: deviceList.length,
      usb:
        sortedSystem.filter((p) => p.isUsb).length + deviceList.length,
    },
  };
}

module.exports = {
  listDetectedPrinters,
  // Exported for unit testing (none yet) and for the main process to call the
  // Linux-only path if it ever wants to render a "what's plugged in" panel
  // without involving the OS spooler.
  listLinuxDevicePaths,
};
