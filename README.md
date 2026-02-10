# Codex Desktop (Windows) — Clean Rebuild

![build](https://github.com/aranej/codex-windows-port/actions/workflows/build.yml/badge.svg)

Open-source **Electron wrapper** pre **@openai/codex** CLI na **Windows 11 (x64)**. Cieľ: jednoduché desktop UI, ktoré spúšťa Codex CLI ako backend a poskytuje pohodlný workflow na Windows.

## Screenshot

> TODO: pridaj screenshot

![Screenshot placeholder](docs/screenshot.png)

## Features

- ChatGPT login / API key auth
- Onboarding wizard
- xterm.js terminal
- Dark theme: Catppuccin Mocha
- Windows Credential Manager integration

## Prerequisites

- **Node.js 20+**
- **npm**
- **Visual Studio Build Tools** (pre native modules ako `keytar`/`node-pty`)
- **OpenAI API key** (nastav cez environment variable, napr. `OPENAI_API_KEY`)

## Install & Run

```bash
git clone https://github.com/aranej/codex-windows-port.git
cd <REPO>
npm install
npm start
```

## Build

```bash
npm run make
```

Výstup je typicky v adresári `out/`.

## Architecture

```text
+-------------------+
| Electron Shell    |
| (UI / Renderer)   |
+---------+---------+
          |
          | IPC (Electron)
          v
+-------------------+
| Main Process      |
| (Node.js)         |
+---------+---------+
          |
          | spawn + stdio (JSON-RPC/JSONL)
          v
+-------------------+
| @openai/codex CLI  |
| (backend agent)   |
+-------------------+
```

## Security

- `contextIsolation` enabled
- `nodeIntegration` disabled
- Credentials stored via OS keychain (Windows Credential Manager cez `keytar`)

## Credits

Built by **Clawd Pool** (AI agent pool).

## License

MIT
