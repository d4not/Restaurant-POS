// Preload script — runs in an isolated context with access to a small Node
// surface, then exposes a curated `window.electron` API to the renderer.
// MUST be CommonJS (.cjs) when the package is "type": "module"; Electron's
// preload loader doesn't support ESM under contextIsolation+sandbox.
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electron', {
  printer: {
    status: () => ipcRenderer.invoke('printer:status'),
    printKitchen: (data) => ipcRenderer.invoke('printer:print-kitchen', data),
    printReceipt: (data) => ipcRenderer.invoke('printer:print-receipt', data),
    getConfig: () => ipcRenderer.invoke('printer:get-config'),
    setConfig: (next) => ipcRenderer.invoke('printer:set-config', next),
    testPrint: (role) => ipcRenderer.invoke('printer:test-print', role),
    listUsb: () => ipcRenderer.invoke('printer:list-usb'),
    resolve: () => ipcRenderer.invoke('printer:resolve'),
    applyCandidate: (payload) => ipcRenderer.invoke('printer:apply-candidate', payload),
    markWorking: (payload) => ipcRenderer.invoke('printer:mark-working', payload),
  },
  app: {
    openAdmin: (payload) => ipcRenderer.invoke('app:open-admin', payload),
  },
  platform: process.platform,
  isElectron: true,
});
