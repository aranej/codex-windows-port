/*
  Renderer (frontend) logic.
  Komunikuje cez window.codexAPI, ktoré poskytuje preload.js.

  Očakávané API (best-effort podľa zadania):
    - codexAPI.send(payload)
    - codexAPI.onOutput((msg) => {})
    - codexAPI.startSession()
    - codexAPI.stopSession()

  Pozn.: ak niektoré metódy neexistujú, UI to zobrazí ako error v outpute.
*/

(() => {
  const $ = (id) => document.getElementById(id);

  const outputEl = $("output");
  const formEl = $("commandForm");
  const inputEl = $("commandInput");
  const btnSend = $("btnSend");
  const btnStart = $("btnStart");
  const btnStop = $("btnStop");
  const btnClear = $("btnClear");
  const statusPill = $("statusPill");
  const statusText = $("statusText");

  let isConnected = false;

  function nowTs() {
    const d = new Date();
    // HH:MM:SS
    return d.toLocaleTimeString(undefined, { hour12: false });
  }

  function setStatus(state, text) {
    statusText.textContent = text || "";

    statusPill.classList.remove("pill--ok", "pill--bad");

    if (state === "connected") {
      isConnected = true;
      statusPill.textContent = "CONNECTED";
      statusPill.classList.add("pill--ok");
      btnStart.disabled = true;
      btnStop.disabled = false;
      btnSend.disabled = false;
    } else if (state === "disconnected") {
      isConnected = false;
      statusPill.textContent = "DISCONNECTED";
      statusPill.classList.add("pill--bad");
      btnStart.disabled = false;
      btnStop.disabled = true;
      btnSend.disabled = true;
    } else {
      // unknown / busy
      statusPill.textContent = (state || "STATUS").toUpperCase();
      btnSend.disabled = !isConnected;
    }
  }

  function appendLine(kind, msg) {
    const line = document.createElement("div");
    line.className = `line line--${kind}`;

    const ts = document.createElement("div");
    ts.className = "line__ts";
    ts.textContent = nowTs();

    const body = document.createElement("div");
    body.className = "line__msg";
    body.textContent = msg;

    line.appendChild(ts);
    line.appendChild(body);
    outputEl.appendChild(line);

    // Auto-scroll to bottom
    outputEl.scrollTop = outputEl.scrollHeight;
  }

  function ensureAPI() {
    const api = window.codexAPI;
    if (!api) {
      appendLine("err", "window.codexAPI nie je dostupné (preload.js bridge chýba)." );
      setStatus("disconnected", "Missing preload bridge.");
      return null;
    }
    return api;
  }

  async function startSession() {
    const api = ensureAPI();
    if (!api) return;

    try {
      setStatus("starting", "Starting session…");
      appendLine("sys", "Starting session…");

      if (typeof api.startSession === "function") {
        await api.startSession();
      } else {
        // fallback: some bridges auto-start on first send
        appendLine("sys", "codexAPI.startSession() nie je implementované — pokračujem bez explicitného start." );
      }

      setStatus("connected", "Session running.");
      appendLine("sys", "Session started.");
      inputEl.focus();
    } catch (e) {
      appendLine("err", `Start failed: ${e?.message || String(e)}`);
      setStatus("disconnected", "Start failed.");
    }
  }

  async function stopSession() {
    const api = ensureAPI();
    if (!api) return;

    try {
      setStatus("stopping", "Stopping session…");
      appendLine("sys", "Stopping session…");

      if (typeof api.stopSession === "function") {
        await api.stopSession();
      } else {
        appendLine("sys", "codexAPI.stopSession() nie je implementované." );
      }

      setStatus("disconnected", "Stopped.");
      appendLine("sys", "Session stopped.");
    } catch (e) {
      appendLine("err", `Stop failed: ${e?.message || String(e)}`);
      // Keep state unknown; user can retry
      setStatus("unknown", "Stop failed (see log)." );
    }
  }

  async function sendCommand(text) {
    const api = ensureAPI();
    if (!api) return;

    const trimmed = (text || "").trim();
    if (!trimmed) return;

    try {
      appendLine("in", `> ${trimmed}`);
      setStatus(isConnected ? "connected" : "unknown", "Sending…" );

      if (typeof api.send !== "function") {
        throw new Error("codexAPI.send() nie je funkcia");
      }

      // payload môže byť string alebo objekt — necháme simplest: string
      await api.send(trimmed);

      setStatus(isConnected ? "connected" : "unknown", "Sent." );
    } catch (e) {
      appendLine("err", `Send failed: ${e?.message || String(e)}`);
      setStatus("unknown", "Send failed (see log)." );
    }
  }

  function wireOutputListener() {
    const api = ensureAPI();
    if (!api) return;

    if (typeof api.onOutput !== "function") {
      appendLine("err", "codexAPI.onOutput() nie je implementované." );
      return;
    }

    api.onOutput((msg) => {
      // msg môže byť string alebo objekt
      if (msg == null) return;

      if (typeof msg === "string") {
        appendLine("out", msg);
      } else {
        // pretty-print object (best-effort)
        try {
          appendLine("out", JSON.stringify(msg, null, 2));
        } catch {
          appendLine("out", String(msg));
        }
      }
    });

    appendLine("sys", "Output listener attached.");
  }

  // --- UI events ---

  btnStart.addEventListener("click", () => startSession());
  btnStop.addEventListener("click", () => stopSession());
  btnClear.addEventListener("click", () => { outputEl.innerHTML = ""; appendLine("sys", "Cleared."); });

  formEl.addEventListener("submit", async (ev) => {
    ev.preventDefault();
    const v = inputEl.value;
    inputEl.value = "";
    await sendCommand(v);
    inputEl.focus();
  });

  // Initial state
  setStatus("disconnected", "Not connected.");
  appendLine("sys", "Renderer ready.");

  // Attach output ASAP (preload may already be ready)
  wireOutputListener();

  // Convenience: auto-start when API exists (optional)
  // Comment out if undesired.
  if (window.codexAPI) {
    // Do not hard-fail if startSession isn't supported
    startSession();
  }
})();
