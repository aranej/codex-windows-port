'use strict';

const { contextBridge, ipcRenderer } = require('electron');

function onOutput(handler) {
  if (typeof handler !== 'function') {
    throw new Error('onOutput(handler): handler must be a function');
  }
  const listener = (_evt, payload) => handler(payload);
  ipcRenderer.on('codex:output', listener);
  return () => ipcRenderer.removeListener('codex:output', listener);
}

const codexAPI = {
  start: () => ipcRenderer.invoke('codex:start'),
  send: (payload) => ipcRenderer.invoke('codex:send', payload),
  stop: () => ipcRenderer.invoke('codex:stop'),
  onOutput,
};

contextBridge.exposeInMainWorld('codexAPI', codexAPI);
