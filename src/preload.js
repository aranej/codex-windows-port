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
  // Required names (renderer depends on these):
  start: () => ipcRenderer.invoke('codex:start'),
  send: (payload) => ipcRenderer.invoke('codex:send', payload),
  stop: () => ipcRenderer.invoke('codex:stop'),
  onOutput,

  // New API (Phase 3):
  login: () => ipcRenderer.invoke('codex:login'),
  authStatus: () => ipcRenderer.invoke('codex:auth-status'),
  logout: () => ipcRenderer.invoke('codex:logout'),
  pickWorkspace: () => ipcRenderer.invoke('codex:pick-workspace'),

  // Internal: used by the OPENAI_API_KEY prompt window (no nodeIntegration).
  __submitOpenAIKey: (keyOrNull) => ipcRenderer.invoke('openai-key:submit', keyOrNull),
};

contextBridge.exposeInMainWorld('codexAPI', codexAPI);
