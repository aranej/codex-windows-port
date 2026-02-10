/*
  Renderer (frontend) logic.
  Komunikuje cez window.codexAPI, ktoré poskytuje preload.js.

  PRELOAD API (podľa FÁZA 3 požiadaviek):
    - codexAPI.start()
    - codexAPI.stop()
    - codexAPI.send(payload)
    - codexAPI.onOutput((msg) => {})
    - codexAPI.login(...)
    - codexAPI.authStatus()
    - codexAPI.pickWorkspace()

  UI:
    - xterm.js terminal (#terminal)
    - onboarding wizard overlay pri prvom spustení
*/

(() => {
  const $ = (id) => document.getElementById(id);

  // Main UI
  const termHost = $("terminal");
  const formEl = $("commandForm");
  const inputEl = $("commandInput");
  const btnSend = $("btnSend");
  const btnStart = $("btnStart");
  const btnStop = $("btnStop");
  const btnClear = $("btnClear");
  const statusPill = $("statusPill");
  const statusText = $("statusText");

  // Wizard
  const wizardOverlay = $("wizardOverlay");
  const btnWizardNext1 = $("btnWizardNext1");
  const btnWizardChatGPT = $("btnWizardChatGPT");
  const apiKeyInput = $("apiKeyInput");
  const btnWizardUseApiKey = $("btnWizardUseApiKey");

  const btnWizardBack2 = $("btnWizardBack2");
  const btnWizardCheckAuth = $("btnWizardCheckAuth");
  const btnWizardNext2 = $("btnWizardNext2");
  const preflightPill = $("preflightPill");
  const preflightText = $("preflightText");

  const btnWizardBack3 = $("btnWizardBack3");
  const btnWizardPickWorkspace = $("btnWizardPickWorkspace");
  const btnWizardNext3 = $("btnWizardNext3");
  const workspacePath = $("workspacePath");

  const btnWizardBack4 = $("btnWizardBack4");
  const btnWizardFinish = $("btnWizardFinish");

  // --- helpers ---

  function ensureAPI() {
    const api = window.codexAPI;
    if (!api) {
      writeLine("[renderer] ERROR: window.codexAPI nie je dostupné (preload.js bridge chýba).\r\n");
      setStatus("disconnected", "Missing preload bridge.");
      return null;
    }
    return api;
  }

  function setStatus(state, text) {
    statusText.textContent = text || "";
    statusPill.classList.remove("pill--ok", "pill--bad");

    if (state === "connected") {
      statusPill.textContent = "CONNECTED";
      statusPill.classList.add("pill--ok");
      btnStart.disabled = true;
      btnStop.disabled = false;
      btnSend.disabled = false;
    } else if (state === "disconnected") {
      statusPill.textContent = "DISCONNECTED";
      statusPill.classList.add("pill--bad");
      btnStart.disabled = false;
      btnStop.disabled = true;
      btnSend.disabled = true;
    } else {
      statusPill.textContent = (state || "STATUS").toUpperCase();
      // send only if currently connected
      btnSend.disabled = btnStart.disabled === false;
    }
  }

  function wizardSetPill(state, text) {
    preflightText.textContent = text || "";
    preflightPill.classList.remove("pill--ok", "pill--bad");

    if (state === "ok") {
      preflightPill.textContent = "OK";
      preflightPill.classList.add("pill--ok");
    } else if (state === "bad") {
      preflightPill.textContent = "FAIL";
      preflightPill.classList.add("pill--bad");
    } else {
      preflightPill.textContent = "UNKNOWN";
    }
  }

  function showWizard(open) {
    if (!wizardOverlay) return;
    wizardOverlay.classList.toggle("is-open", !!open);
    wizardOverlay.setAttribute("aria-hidden", open ? "false" : "true");
  }

  function showWizardStep(n) {
    const steps = wizardOverlay.querySelectorAll(".wizard-step");
    steps.forEach((el) => {
      const step = Number(el.getAttribute("data-step"));
      el.hidden = step !== n;
    });
  }

  // --- xterm ---

  let term = null;
  let fitAddon = null;

  function initTerminal() {
    if (!termHost) return;

    if (!window.Terminal) {
      // xterm CDN failed
      termHost.textContent = "xterm.js sa nepodarilo načítať (CDN).";
      return;
    }

    term = new window.Terminal({
      fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, Liberation Mono, Courier New, monospace",
      fontSize: 13,
      theme: {
        background: "#11111b",
        foreground: "#cdd6f4",
        cursor: "#89b4fa",
        selectionBackground: "rgba(137, 180, 250, 0.25)",
        black: "#181825",
        brightBlack: "#313244",
        blue: "#89b4fa",
        brightBlue: "#b4befe",
        red: "#f38ba8",
        green: "#a6e3a1",
        yellow: "#f9e2af",
        magenta: "#cba6f7",
        cyan: "#94e2d5",
        white: "#cdd6f4",
        brightWhite: "#ffffff"
      },
      convertEol: true,
      scrollback: 5000
    });

    if (window.FitAddon && window.FitAddon.FitAddon) {
      fitAddon = new window.FitAddon.FitAddon();
      term.loadAddon(fitAddon);
    }

    term.open(termHost);
    if (fitAddon) fitAddon.fit();

    // Resize handling
    window.addEventListener("resize", () => {
      if (fitAddon) fitAddon.fit();
    });

    writeLine("[renderer] Terminal ready.\r\n");
  }

  function writeLine(s) {
    if (!term) return;
    term.write(s);
  }

  function writeOut(msg) {
    if (msg == null) return;
    if (typeof msg === "string") {
      writeLine(msg.endsWith("\n") ? msg.replaceAll("\n", "\r\n") : msg.replaceAll("\n", "\r\n") + "\r\n");
    } else {
      try {
        writeLine(JSON.stringify(msg, null, 2).replaceAll("\n", "\r\n") + "\r\n");
      } catch {
        writeLine(String(msg) + "\r\n");
      }
    }
  }

  // --- codex session ---

  async function start() {
    const api = ensureAPI();
    if (!api) return;

    try {
      setStatus("starting", "Starting…");
      writeLine("\r\n[system] Starting…\r\n");

      if (typeof api.start !== "function") throw new Error("codexAPI.start() nie je implementované");
      await api.start();

      // CONNECTED nastav až po úspešnom await
      setStatus("connected", "Session running.");
      writeLine("[system] Connected.\r\n");
      inputEl?.focus();

      // Fit once after start (layout may change)
      if (fitAddon) fitAddon.fit();
    } catch (e) {
      writeLine(`[system] Start failed: ${e?.message || String(e)}\r\n`);
      setStatus("disconnected", "Start failed.");
    }
  }

  async function stop() {
    const api = ensureAPI();
    if (!api) return;

    try {
      setStatus("stopping", "Stopping…");
      writeLine("\r\n[system] Stopping…\r\n");

      if (typeof api.stop !== "function") throw new Error("codexAPI.stop() nie je implementované");
      await api.stop();

      setStatus("disconnected", "Stopped.");
      writeLine("[system] Disconnected.\r\n");
    } catch (e) {
      writeLine(`[system] Stop failed: ${e?.message || String(e)}\r\n`);
      setStatus("unknown", "Stop failed.");
    }
  }

  async function sendCommand(text) {
    const api = ensureAPI();
    if (!api) return;

    const trimmed = (text || "").trim();
    if (!trimmed) return;

    try {
      writeLine(`\r\n> ${trimmed}\r\n`);
      if (typeof api.send !== "function") throw new Error("codexAPI.send() nie je implementované");
      await api.send(trimmed);
    } catch (e) {
      writeLine(`[system] Send failed: ${e?.message || String(e)}\r\n`);
    }
  }

  function wireOutputListener() {
    const api = ensureAPI();
    if (!api) return;

    if (typeof api.onOutput !== "function") {
      writeLine("[system] ERROR: codexAPI.onOutput() nie je implementované.\r\n");
      return;
    }

    api.onOutput((msg) => {
      writeOut(msg);
    });

    writeLine("[system] Output listener attached.\r\n");
  }

  // --- onboarding wizard ---

  async function wizardLoginChatGPT() {
    const api = ensureAPI();
    if (!api) return;

    try {
      if (typeof api.login !== "function") throw new Error("codexAPI.login() nie je implementované");
      await api.login();
      wizardSetPill("ok", "Login triggered (ChatGPT)." );
    } catch (e) {
      wizardSetPill("bad", `Login failed: ${e?.message || String(e)}`);
    }
  }

  async function wizardLoginApiKey() {
    const api = ensureAPI();
    if (!api) return;

    const key = (apiKeyInput?.value || "").trim();
    if (!key) {
      wizardSetPill("bad", "API key je prázdny.");
      return;
    }

    try {
      if (typeof api.login !== "function") throw new Error("codexAPI.login() nie je implementované");

      // Best-effort: ak preload akceptuje parameter, pošleme ho; inak to preload ignoruje.
      await api.login({ apiKey: key });
      wizardSetPill("ok", "API key provided (login called)." );
    } catch (e) {
      wizardSetPill("bad", `API key login failed: ${e?.message || String(e)}`);
    }
  }

  async function wizardCheckAuth() {
    const api = ensureAPI();
    if (!api) return;

    try {
      if (typeof api.authStatus !== "function") throw new Error("codexAPI.authStatus() nie je implementované");
      const st = await api.authStatus();

      // Ak st je boolean alebo objekt
      if (st === true) {
        wizardSetPill("ok", "Authenticated." );
      } else if (st === false) {
        wizardSetPill("bad", "Not authenticated." );
      } else {
        wizardSetPill("ok", `authStatus: ${JSON.stringify(st)}`);
      }
    } catch (e) {
      wizardSetPill("bad", `authStatus failed: ${e?.message || String(e)}`);
    }
  }

  async function wizardPickWorkspace() {
    const api = ensureAPI();
    if (!api) return;

    try {
      if (typeof api.pickWorkspace !== "function") throw new Error("codexAPI.pickWorkspace() nie je implementované");
      const res = await api.pickWorkspace();
      // res môže byť string path alebo objekt
      const p = typeof res === "string" ? res : (res?.path || JSON.stringify(res));
      workspacePath.textContent = p || "Selected.";
    } catch (e) {
      workspacePath.textContent = `Pick failed: ${e?.message || String(e)}`;
    }
  }

  function wizardShouldShow() {
    try {
      return localStorage.getItem("codexWizardDone") !== "1";
    } catch {
      return true;
    }
  }

  function wizardMarkDone() {
    try {
      localStorage.setItem("codexWizardDone", "1");
    } catch {
      // ignore
    }
  }

  // --- events ---

  btnStart?.addEventListener("click", () => start());
  btnStop?.addEventListener("click", () => stop());
  btnClear?.addEventListener("click", () => {
    if (term) term.reset();
    writeLine("[system] Cleared.\r\n");
  });

  formEl?.addEventListener("submit", async (ev) => {
    ev.preventDefault();
    const v = inputEl.value;
    inputEl.value = "";
    await sendCommand(v);
    inputEl.focus();
  });

  // Wizard nav
  btnWizardChatGPT?.addEventListener("click", () => wizardLoginChatGPT());
  btnWizardUseApiKey?.addEventListener("click", () => wizardLoginApiKey());

  btnWizardNext1?.addEventListener("click", () => showWizardStep(2));

  btnWizardBack2?.addEventListener("click", () => showWizardStep(1));
  btnWizardCheckAuth?.addEventListener("click", () => wizardCheckAuth());
  btnWizardNext2?.addEventListener("click", () => showWizardStep(3));

  btnWizardBack3?.addEventListener("click", () => showWizardStep(2));
  btnWizardPickWorkspace?.addEventListener("click", () => wizardPickWorkspace());
  btnWizardNext3?.addEventListener("click", () => showWizardStep(4));

  btnWizardBack4?.addEventListener("click", () => showWizardStep(3));
  btnWizardFinish?.addEventListener("click", async () => {
    wizardMarkDone();
    showWizard(false);
    // Po finish automaticky attach output + start (ak user chce)
    wireOutputListener();
    await start();
  });

  // --- init ---

  setStatus("disconnected", "Not connected.");
  initTerminal();

  // Attach output listener early (it’s safe even if disconnected)
  wireOutputListener();

  // Show onboarding on first run
  if (wizardShouldShow()) {
    showWizard(true);
    showWizardStep(1);
    wizardSetPill("unknown", "Not checked." );
  } else {
    showWizard(false);
    // Optional auto-start when wizard already done
    if (window.codexAPI) {
      start();
    }
  }
})();
