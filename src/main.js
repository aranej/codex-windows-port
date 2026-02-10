'use strict';

const path = require('path');
const os = require('os');

const { app, BrowserWindow, ipcMain, Menu, dialog } = require('electron');
const pty = require('node-pty');

/** @type {BrowserWindow | null} */
let mainWindow = null;

/** @type {import('node-pty').IPty | null} */
let codexPty = null;
let codexBuffer = '';
let codexEnv = null;

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

function resolveCodexCommand() {
  // Preferred explicit override
  if (process.env.CODEX_CLI_PATH) {
    return { kind: 'direct', file: process.env.CODEX_CLI_PATH, args: [] };
  }

  // Try local node_modules bin (cross-platform)
  const isWin = process.platform === 'win32';
  const bin = isWin ? 'codex.cmd' : 'codex';
  const localBin = path.join(__dirname, '..', 'node_modules', '.bin', bin);
  return { kind: 'direct', file: localBin, args: [] };
}

async function promptForOpenAIKey(parent) {
  return new Promise((resolve) => {
    const promptWin = new BrowserWindow({
      parent,
      modal: true,
      width: 520,
      height: 220,
      resizable: false,
      minimizable: false,
      maximizable: false,
      webPreferences: {
        // Trusted inline HTML for this prompt window only.
        nodeIntegration: true,
        contextIsolation: false,
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
          const { ipcRenderer } = require('electron');
          const k = document.getElementById('k');
          document.getElementById('cancel').onclick = () => ipcRenderer.send('openai-key:submit', null);
          document.getElementById('ok').onclick = () => ipcRenderer.send('openai-key:submit', k.value);
          k.addEventListener('keydown', (e) => { if (e.key === 'Enter') ipcRenderer.send('openai-key:submit', k.value); });
        </script>
      </body>
    </html>`;

    const done = (val) => {
      try { if (!promptWin.isDestroyed()) promptWin.close(); } catch {}
      resolve(val && String(val).trim() ? String(val).trim() : null);
    };

    ipcMain.once('openai-key:submit', (_evt, val) => done(val));
    promptWin.on('closed', () => done(null));

    promptWin.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html));
  });
}

function emitToRenderer(payload) {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  mainWindow.webContents.send('codex:output', payload);
}

function handleCodexData(chunk) {
  const s = String(chunk);
  codexBuffer += s;

  // Normalize \r\n and split. Keep trailing partial.
  codexBuffer = codexBuffer.replace(/\r\n/g, '\n');
  const parts = codexBuffer.split('\n');
  codexBuffer = parts.pop() ?? '';

  for (const line of parts) {
    const trimmed = line.trimEnd();
    if (!trimmed) continue;

    // Try JSON decode; fallback to raw.
    try {
      const obj = JSON.parse(trimmed);
      emitToRenderer(obj);
    } catch {
      emitToRenderer(trimmed);
    }
  }
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

  const { file, args } = resolveCodexCommand();

  // Spawn via node-pty (Windows-friendly). If file is a .cmd, run through cmd.exe.
  const isWin = process.platform === 'win32';
  let spawnFile = file;
  let spawnArgs = Array.isArray(args) ? [...args] : [];

  if (isWin && /\.cmd$/i.test(spawnFile)) {
    spawnArgs = ['/c', '"' + spawnFile + '"', ...spawnArgs];
    spawnFile = process.env.ComSpec || 'cmd.exe';
  }

  codexEnv = { ...process.env };

  codexPty = pty.spawn(spawnFile, spawnArgs, {
    name: 'xterm-color',
    cols: 120,
    rows: 30,
    cwd: process.cwd(),
    env: codexEnv,
  });

  codexPty.onData((data) => {
    handleCodexData(data);
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

  emitToRenderer({ type: 'process-start', pid: codexPty.pid });
  return { ok: true, pid: codexPty.pid };
}

function sendToCodex(input) {
  if (!codexPty) throw new Error('Codex is not running.');

  // JSON-RPC over stdio: accept object or string; always newline terminate.
  let line;
  if (typeof input === 'string') {
    line = input;
  } else {
    line = JSON.stringify(input);
  }

  // Ensure LF newline.
  if (!line.endsWith('\n')) line += '\n';

  codexPty.write(line);
  return { ok: true };
}

function stopCodex() {
  if (!codexPty) return { ok: true, alreadyStopped: true };

  try {
    codexPty.kill();
  } catch (e) {
    // Best-effort; surface error.
    throw new Error(`Failed to stop Codex: ${e && e.message ? e.message : String(e)}`);
  } finally {
    codexPty = null;
    codexBuffer = '';
  }

  return { ok: true };
}

function registerIpc() {
  ipcMain.handle('codex:start', async () => startCodex());
  ipcMain.handle('codex:send', async (_evt, payload) => sendToCodex(payload));
  ipcMain.handle('codex:stop', async () => stopCodex());
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
  // Typical behavior: quit on Windows/Linux.
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('before-quit', () => {
  try { stopCodex(); } catch {}
});
