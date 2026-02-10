'use strict';

const path = require('path');

const { app, BrowserWindow, ipcMain, Menu, dialog } = require('electron');
const pty = require('node-pty');

/** @type {BrowserWindow | null} */
let mainWindow = null;

/** @type {import('node-pty').IPty | null} */
let codexPty = null;
let codexBuffer = '';
let codexEnv = null;

/** @type {import('node-pty').IPty | null} */
let authPty = null;

/** @type {string} */
let workspaceDir = process.cwd();

function buildMenu() {
  const template = [
    {
      label: 'File',
      submenu: [
        {
          label: 'Exit',
          role: 'quit',
        },
      ],
    },
    {
      label: 'Help',
      submenu: [
        {
          label: 'About',
          click: async () => {
            const detail = [
              `App: ${app.getName()}`,
              `Version: ${app.getVersion()}`,
              `Electron: ${process.versions.electron}`,
              `Node: ${process.versions.node}`,
              `Platform: ${process.platform} ${process.arch}`,
              `Workspace: ${workspaceDir}`,
            ].join('\n');

            await dialog.showMessageBox({
              type: 'info',
              title: 'About',
              message: 'Codex Desktop (Windows Port)',
              detail,
            });
          },
        },
      ],
    },
  ];

  const menu = Menu.buildFromTemplate(template);
  Menu.setApplicationMenu(menu);
}

function createMainWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      preload: path.join(__dirname, 'preload.js'),
    },
  });

  mainWindow.loadFile(path.join(__dirname, 'index.html'));

  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  return mainWindow;
}

function resolveCodexCommand(extraArgs = []) {
  // Preferred explicit override
  if (process.env.CODEX_CLI_PATH) {
    return { file: process.env.CODEX_CLI_PATH, args: [...extraArgs] };
  }

  // Try local node_modules bin (cross-platform)
  const isWin = process.platform === 'win32';
  const bin = isWin ? 'codex.cmd' : 'codex';
  const localBin = path.join(__dirname, '..', 'node_modules', '.bin', bin);
  return { file: localBin, args: [...extraArgs] };
}

function emitToRenderer(payload) {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  mainWindow.webContents.send('codex:output', payload);
}

function handleJsonlLikeStream(bufferState, chunk, onLine) {
  bufferState.value += String(chunk);
  bufferState.value = bufferState.value.replace(/\r\n/g, '\n');

  const parts = bufferState.value.split('\n');
  bufferState.value = parts.pop() ?? '';

  for (const line of parts) {
    const trimmed = line.trimEnd();
    if (!trimmed) continue;
    onLine(trimmed);
  }
}

function handleCodexData(chunk) {
  handleJsonlLikeStream({ value: codexBuffer }, chunk, (trimmed) => {
    // Note: handleJsonlLikeStream uses a temporary object, so keep codexBuffer in sync.
  });
}

// Keep original buffer logic but share helper.
function handleCodexDataFixed(chunk) {
  const state = { value: codexBuffer };
  handleJsonlLikeStream(state, chunk, (trimmed) => {
    try {
      emitToRenderer(JSON.parse(trimmed));
    } catch {
      emitToRenderer(trimmed);
    }
  });
  codexBuffer = state.value;
}

function ptySpawnCodex(extraArgs = [], opts = {}) {
  const { file, args } = resolveCodexCommand(extraArgs);

  // Spawn via node-pty (Windows-friendly). If file is a .cmd, run through cmd.exe.
  const isWin = process.platform === 'win32';
  let spawnFile = file;
  let spawnArgs = Array.isArray(args) ? [...args] : [];

  if (isWin && /\.cmd$/i.test(spawnFile)) {
    spawnArgs = ['/c', '"' + spawnFile + '"', ...spawnArgs];
    spawnFile = process.env.ComSpec || 'cmd.exe';
  }

  const env = { ...process.env };

  return pty.spawn(spawnFile, spawnArgs, {
    name: 'xterm-color',
    cols: 120,
    rows: 30,
    cwd: opts.cwd || process.cwd(),
    env,
  });
}

async function promptForOpenAIKey(parent) {
  // SECURITY FIX: no nodeIntegration; use contextIsolation + preload bridge.
  return new Promise((resolve) => {
    const promptWin = new BrowserWindow({
      parent,
      modal: true,
      width: 560,
      height: 260,
      resizable: false,
      minimizable: false,
      maximizable: false,
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true,
        preload: path.join(__dirname, 'preload.js'),
      },
    });

    const html = `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <title>OPENAI_API_KEY</title>
    <style>
      body { font-family: system-ui, Segoe UI, Arial; margin: 16px; }
      input { width: 100%; padding: 10px; font-family: ui-monospace, Consolas, monospace; }
      .row { margin-top: 12px; display: flex; gap: 10px; justify-content: flex-end; }
      button { padding: 8px 14px; }
      .hint { color: #555; font-size: 12px; margin-top: 8px; }
    </style>
  </head>
  <body>
    <h3>Enter OPENAI_API_KEY</h3>
    <input id="k" type="password" placeholder="sk-..." autofocus />
    <div class="hint">Key will be used for this run (not persisted by this prompt).</div>
    <div class="row">
      <button id="cancel">Cancel</button>
      <button id="ok">OK</button>
    </div>
    <script>
      const k = document.getElementById('k');
      document.getElementById('cancel').onclick = async () => {
        try { await window.codexAPI.__submitOpenAIKey(null); } catch {};
        window.close();
      };
      document.getElementById('ok').onclick = async () => {
        try { await window.codexAPI.__submitOpenAIKey(k.value); } catch {};
        window.close();
      };
      k.addEventListener('keydown', async (e) => {
        if (e.key === 'Enter') {
          try { await window.codexAPI.__submitOpenAIKey(k.value); } catch {};
          window.close();
        }
      });
    </script>
  </body>
</html>`;

    const done = (val) => {
      try {
        if (!promptWin.isDestroyed()) promptWin.close();
      } catch {}
      resolve(val && String(val).trim() ? String(val).trim() : null);
    };

    ipcMain.once('openai-key:submit', (_evt, val) => done(val));
    promptWin.on('closed', () => done(null));

    promptWin.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html));
  });
}

async function startCodex() {
  if (codexPty) {
    return { ok: true, alreadyRunning: true };
  }

  if (!process.env.OPENAI_API_KEY) {
    const key = await promptForOpenAIKey(mainWindow);
    if (!key) {
      throw new Error('OPENAI_API_KEY is required to start Codex.');
    }
    process.env.OPENAI_API_KEY = key;
  }

  codexEnv = { ...process.env };

  codexPty = ptySpawnCodex([], { cwd: workspaceDir });

  codexPty.onData((data) => {
    handleCodexDataFixed(data);
  });

  codexPty.onExit(({ exitCode, signal }) => {
    emitToRenderer({
      type: 'process-exit',
      exitCode,
      signal,
    });
    codexPty = null;
    codexBuffer = '';
  });

  emitToRenderer({ type: 'process-start', pid: codexPty.pid, cwd: workspaceDir });
  return { ok: true, pid: codexPty.pid, cwd: workspaceDir };
}

function sendToCodex(input) {
  if (!codexPty) throw new Error('Codex is not running.');

  // JSON-RPC communication over stdio (JSONL). Accept object or string.
  let line;
  if (typeof input === 'string') {
    line = input;
  } else {
    line = JSON.stringify(input);
  }

  if (!line.endsWith('\n')) line += '\n';
  codexPty.write(line);
  return { ok: true };
}

function stopCodex() {
  if (!codexPty) return { ok: true, alreadyStopped: true };

  try {
    codexPty.kill();
  } catch (e) {
    throw new Error(`Failed to stop Codex: ${e && e.message ? e.message : String(e)}`);
  } finally {
    codexPty = null;
    codexBuffer = '';
  }

  return { ok: true };
}

async function codexAuthLogin() {
  if (authPty) {
    return { ok: true, alreadyRunning: true };
  }

  // Login flow typically opens a browser. We stream output back to renderer.
  const buf = { value: '' };
  authPty = ptySpawnCodex(['auth', 'login'], { cwd: workspaceDir });

  authPty.onData((data) => {
    handleJsonlLikeStream(buf, data, (line) => emitToRenderer({ type: 'auth:login', line }));
  });

  authPty.onExit(({ exitCode, signal }) => {
    emitToRenderer({ type: 'auth:login-exit', exitCode, signal });
    authPty = null;
  });

  emitToRenderer({ type: 'auth:login-start', pid: authPty.pid });
  return { ok: true, pid: authPty.pid };
}

function runCodexAuthCommand(args) {
  return new Promise((resolve, reject) => {
    const buf = { value: '' };
    const lines = [];

    const p = ptySpawnCodex(['auth', ...args], { cwd: workspaceDir });

    p.onData((data) => {
      handleJsonlLikeStream(buf, data, (line) => lines.push(line));
    });

    p.onExit(({ exitCode, signal }) => {
      if (exitCode === 0) {
        resolve({ ok: true, exitCode, signal, output: lines.join('\n').trim() });
      } else {
        reject(new Error(`codex auth ${args.join(' ')} failed (exitCode=${exitCode}, signal=${signal ?? 'n/a'}): ${lines.join('\n').trim()}`));
      }
    });
  });
}

async function pickWorkspace() {
  const res = await dialog.showOpenDialog(mainWindow, {
    title: 'Pick workspace folder',
    properties: ['openDirectory'],
  });

  if (res.canceled || !res.filePaths || res.filePaths.length === 0) {
    return { ok: true, canceled: true, workspaceDir };
  }

  workspaceDir = res.filePaths[0];
  emitToRenderer({ type: 'workspace:set', workspaceDir });
  return { ok: true, workspaceDir };
}

function registerIpc() {
  ipcMain.handle('codex:start', async () => startCodex());
  ipcMain.handle('codex:send', async (_evt, payload) => sendToCodex(payload));
  ipcMain.handle('codex:stop', async () => stopCodex());

  // Preload-secured OpenAI key submission
  ipcMain.handle('openai-key:submit', async (_evt, key) => {
    ipcMain.emit('openai-key:submit', _evt, key);
    return { ok: true };
  });

  // Auth flows
  ipcMain.handle('codex:login', async () => codexAuthLogin());
  ipcMain.handle('codex:auth-status', async () => runCodexAuthCommand(['status']));
  ipcMain.handle('codex:logout', async () => runCodexAuthCommand(['logout']));

  // Workspace
  ipcMain.handle('codex:pick-workspace', async () => pickWorkspace());
}

app.whenReady().then(() => {
  buildMenu();
  registerIpc();
  createMainWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createMainWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('before-quit', () => {
  try {
    stopCodex();
  } catch {}
  try {
    if (authPty) authPty.kill();
  } catch {}
});
