#!/usr/bin/env node

import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import {
  delimiter,
  dirname,
  isAbsolute,
  join,
  resolve,
} from "node:path";
import process from "node:process";

const DEFAULT_BASE_URL = "http://127.0.0.1:3000";
const DEFAULT_TIMEOUT_MS = 20_000;
const CDP_COMMAND_TIMEOUT_MS = 10_000;
const CHROME_STARTUP_TIMEOUT_MS = 15_000;
const POLL_INTERVAL_MS = 50;
const MAX_CHROME_OUTPUT_LENGTH = 32 * 1024;
const CLIENT_INSTANCE_STORAGE_KEY =
  "drawing-scale-game-client-instance";
const PLAYER_SESSION_STORAGE_KEY = "drawing-scale-game-session";
const SECOND_TAB_ERROR =
  "Cette session est déjà ouverte dans un autre onglet.";
const VIEWPORTS = [
  { width: 1366, height: 768 },
  { width: 1440, height: 900 },
  { width: 1920, height: 1080 },
  { width: 320, height: 568 },
  { width: 375, height: 667 },
  { width: 390, height: 844 },
];
const PROMPT_HEADER_VIEWPORTS = [
  { width: 1366, height: 768 },
  { width: 1440, height: 900 },
  { width: 390, height: 844 },
  { width: 320, height: 568 },
];
const DESKTOP_VIEWPORT = VIEWPORTS[1];
const DIALOG_SELECTOR = ".game-dialog-card[role='dialog']";
const UUID_V4_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

function showHelp() {
  console.info(`Usage:
  node scripts/production-browser-check.mjs [options]

Options:
  --url <url>         Production server URL (default: ${DEFAULT_BASE_URL})
  --chrome <path>     Chrome/Chromium/Edge executable
  --timeout <ms>      Per-step timeout (default: ${DEFAULT_TIMEOUT_MS})
  --headful           Show the browser window instead of using headless mode
  --no-sandbox        Pass --no-sandbox to Chromium (only when required)
  --help              Show this help

Environment equivalents:
  PRODUCTION_BROWSER_CHECK_URL, CHROME_PATH

The production build/server must already be running at --url.`);
}

function parseArguments(argumentsReceived) {
  const options = {
    baseUrl:
      process.env.PRODUCTION_BROWSER_CHECK_URL ?? DEFAULT_BASE_URL,
    chromePath: process.env.CHROME_PATH ?? null,
    timeoutMs: DEFAULT_TIMEOUT_MS,
    headless: true,
    noSandbox: false,
    help: false,
  };

  for (let index = 0; index < argumentsReceived.length; index += 1) {
    const argument = argumentsReceived[index];
    const nextValue = () => {
      const value = argumentsReceived[index + 1];
      if (value === undefined || value.startsWith("--")) {
        throw new Error(`A value is required after ${argument}.`);
      }
      index += 1;
      return value;
    };

    if (argument === "--url") {
      options.baseUrl = nextValue();
    } else if (argument.startsWith("--url=")) {
      options.baseUrl = argument.slice("--url=".length);
    } else if (argument === "--chrome") {
      options.chromePath = nextValue();
    } else if (argument.startsWith("--chrome=")) {
      options.chromePath = argument.slice("--chrome=".length);
    } else if (argument === "--timeout") {
      options.timeoutMs = Number(nextValue());
    } else if (argument.startsWith("--timeout=")) {
      options.timeoutMs = Number(argument.slice("--timeout=".length));
    } else if (argument === "--headful") {
      options.headless = false;
    } else if (argument === "--no-sandbox") {
      options.noSandbox = true;
    } else if (argument === "--help" || argument === "-h") {
      options.help = true;
    } else {
      throw new Error(`Unknown option: ${argument}`);
    }
  }

  if (
    !Number.isSafeInteger(options.timeoutMs) ||
    options.timeoutMs < 1_000 ||
    options.timeoutMs > 120_000
  ) {
    throw new Error("--timeout must be an integer between 1000 and 120000.");
  }

  const parsedUrl = new URL(options.baseUrl);
  if (parsedUrl.protocol !== "http:" && parsedUrl.protocol !== "https:") {
    throw new Error("--url must use http or https.");
  }
  parsedUrl.hash = "";
  parsedUrl.search = "";
  options.baseUrl = parsedUrl.href.replace(/\/$/u, "");

  return options;
}

function describeError(error) {
  return error instanceof Error ? error.message : String(error);
}

function assertCondition(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

async function loadPromptHeaderCases() {
  const { DRAWING_PROMPTS } = await import(
    new URL("../server/dist/game/prompt-bank.js", import.meta.url)
  );
  assertCondition(
    Array.isArray(DRAWING_PROMPTS) && DRAWING_PROMPTS.length === 52,
    "The built prompt bank must expose exactly 52 prompts.",
  );

  const rankByLength = (selector, count) =>
    [...DRAWING_PROMPTS]
      .sort(
        (left, right) =>
          [...selector(right)].length - [...selector(left)].length,
      )
      .slice(0, count);
  const selectedById = new Map();
  for (const prompt of [
    ...rankByLength(({ statement }) => statement, 5),
    ...rankByLength(({ lowLabel }) => lowLabel, 1),
    ...rankByLength(({ highLabel }) => highLabel, 1),
  ]) {
    selectedById.set(prompt.id, {
      id: prompt.id,
      statement: prompt.statement,
      lowLabel: prompt.lowLabel,
      highLabel: prompt.highLabel,
    });
  }

  return [...selectedById.values()];
}

function delay(milliseconds) {
  return new Promise((resolvePromise) => {
    setTimeout(resolvePromise, milliseconds);
  });
}

async function waitUntil(
  condition,
  description,
  timeoutMs,
  diagnostics = () => "",
) {
  const deadline = Date.now() + timeoutMs;
  let lastError = null;

  while (Date.now() < deadline) {
    try {
      const value = await condition();
      if (value) {
        return value;
      }
      lastError = null;
    } catch (error) {
      lastError = error;
    }

    await delay(POLL_INTERVAL_MS);
  }

  const suffix = diagnostics();
  const cause =
    lastError === null ? "" : ` Last error: ${describeError(lastError)}.`;
  throw new Error(
    `Timed out waiting for ${description} after ${timeoutMs} ms.${cause}${
      suffix.length === 0 ? "" : `\n${suffix}`
    }`,
  );
}

async function reserveTcpPort() {
  const server = createServer();

  try {
    await new Promise((resolvePromise, rejectPromise) => {
      server.once("error", rejectPromise);
      server.listen(0, "127.0.0.1", resolvePromise);
    });
    const address = server.address();
    if (address === null || typeof address === "string") {
      throw new Error("Unable to reserve a TCP port for Chrome.");
    }
    return address.port;
  } finally {
    await new Promise((resolvePromise) => {
      server.close(() => resolvePromise());
    });
  }
}

function executableCandidates(explicitPath) {
  const candidates = [];
  const add = (candidate) => {
    if (typeof candidate !== "string" || candidate.length === 0) {
      return;
    }
    const absolute = isAbsolute(candidate)
      ? candidate
      : resolve(process.cwd(), candidate);
    if (!candidates.includes(absolute)) {
      candidates.push(absolute);
    }
  };

  add(explicitPath);

  if (process.platform === "win32") {
    const programFiles = [
      process.env.PROGRAMFILES,
      process.env["PROGRAMFILES(X86)"],
      process.env.LOCALAPPDATA,
    ];
    for (const root of programFiles) {
      if (root === undefined) {
        continue;
      }
      add(join(root, "Google", "Chrome", "Application", "chrome.exe"));
      add(
        join(root, "Microsoft", "Edge", "Application", "msedge.exe"),
      );
      add(
        join(root, "Chromium", "Application", "chrome.exe"),
      );
    }
  } else if (process.platform === "darwin") {
    add(
      "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    );
    add(
      "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
    );
    add("/Applications/Chromium.app/Contents/MacOS/Chromium");
  }

  const executableNames =
    process.platform === "win32"
      ? ["chrome.exe", "msedge.exe", "chromium.exe"]
      : [
          "google-chrome",
          "google-chrome-stable",
          "chromium",
          "chromium-browser",
          "microsoft-edge",
        ];
  for (const pathEntry of (process.env.PATH ?? "").split(delimiter)) {
    if (pathEntry.length === 0) {
      continue;
    }
    for (const executableName of executableNames) {
      add(join(pathEntry, executableName));
    }
  }

  return candidates;
}

function findChromeExecutable(explicitPath) {
  const candidates = executableCandidates(explicitPath);
  const executable = candidates.find((candidate) => existsSync(candidate));
  if (executable !== undefined) {
    return executable;
  }

  const explicitHint =
    explicitPath === null
      ? ""
      : ` The requested path was ${resolve(explicitPath)}.`;
  throw new Error(
    `Chrome, Chromium, or Edge was not found.${explicitHint} Pass --chrome <path> or set CHROME_PATH.`,
  );
}

async function fetchJson(url, timeoutMs) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      redirect: "error",
      signal: controller.signal,
    });
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    return await response.json();
  } finally {
    clearTimeout(timeout);
  }
}

function appendOutput(current, chunk) {
  const combined = current + String(chunk);
  return combined.length <= MAX_CHROME_OUTPUT_LENGTH
    ? combined
    : combined.slice(-MAX_CHROME_OUTPUT_LENGTH);
}

async function waitForChildExit(child, timeoutMs) {
  if (child.exitCode !== null || child.signalCode !== null) {
    return;
  }

  await new Promise((resolvePromise, rejectPromise) => {
    const timeout = setTimeout(() => {
      cleanup();
      rejectPromise(new Error("Chrome did not exit in time."));
    }, timeoutMs);
    const cleanup = () => {
      clearTimeout(timeout);
      child.off("exit", handleExit);
    };
    const handleExit = () => {
      cleanup();
      resolvePromise();
    };
    child.once("exit", handleExit);
  });
}

class CdpConnection {
  constructor(webSocketUrl) {
    this.webSocketUrl = webSocketUrl;
    this.socket = null;
    this.nextCommandId = 0;
    this.pendingCommands = new Map();
    this.eventListeners = new Map();
    this.closed = false;
  }

  async connect() {
    if (typeof WebSocket !== "function") {
      throw new Error(
        "This check requires the global WebSocket available in Node.js 22.",
      );
    }

    const socket = new WebSocket(this.webSocketUrl);
    this.socket = socket;

    await new Promise((resolvePromise, rejectPromise) => {
      const cleanup = () => {
        socket.removeEventListener("open", handleOpen);
        socket.removeEventListener("error", handleError);
      };
      const handleOpen = () => {
        cleanup();
        resolvePromise();
      };
      const handleError = () => {
        cleanup();
        rejectPromise(
          new Error("Unable to connect to Chrome's CDP WebSocket."),
        );
      };
      socket.addEventListener("open", handleOpen);
      socket.addEventListener("error", handleError);
    });

    socket.addEventListener("message", (event) => {
      this.handleMessage(event.data);
    });
    socket.addEventListener("close", () => {
      this.handleClose();
    });
  }

  handleMessage(data) {
    let message;
    try {
      message = JSON.parse(String(data));
    } catch {
      return;
    }

    if (typeof message.id === "number") {
      const pending = this.pendingCommands.get(message.id);
      if (pending === undefined) {
        return;
      }
      this.pendingCommands.delete(message.id);
      clearTimeout(pending.timeout);

      if (message.error !== undefined) {
        pending.reject(
          new Error(
            `CDP ${pending.method} failed: ${message.error.message ?? "unknown error"}`,
          ),
        );
      } else {
        pending.resolve(message.result ?? {});
      }
      return;
    }

    if (typeof message.method !== "string") {
      return;
    }
    const listeners = this.eventListeners.get(message.method);
    if (listeners === undefined) {
      return;
    }
    for (const listener of [...listeners]) {
      listener({
        params: message.params ?? {},
        sessionId:
          typeof message.sessionId === "string"
            ? message.sessionId
            : null,
      });
    }
  }

  handleClose() {
    if (this.closed) {
      return;
    }
    this.closed = true;
    for (const pending of this.pendingCommands.values()) {
      clearTimeout(pending.timeout);
      pending.reject(
        new Error(`CDP closed while waiting for ${pending.method}.`),
      );
    }
    this.pendingCommands.clear();
  }

  send(method, params = {}, sessionId = null) {
    if (
      this.closed ||
      this.socket === null ||
      this.socket.readyState !== WebSocket.OPEN
    ) {
      return Promise.reject(new Error(`CDP is closed; cannot send ${method}.`));
    }

    const id = ++this.nextCommandId;
    const message = { id, method, params };
    if (sessionId !== null) {
      message.sessionId = sessionId;
    }

    return new Promise((resolvePromise, rejectPromise) => {
      const timeout = setTimeout(() => {
        this.pendingCommands.delete(id);
        rejectPromise(
          new Error(
            `CDP ${method} timed out after ${CDP_COMMAND_TIMEOUT_MS} ms.`,
          ),
        );
      }, CDP_COMMAND_TIMEOUT_MS);
      this.pendingCommands.set(id, {
        method,
        resolve: resolvePromise,
        reject: rejectPromise,
        timeout,
      });
      this.socket.send(JSON.stringify(message));
    });
  }

  on(method, listener) {
    let listeners = this.eventListeners.get(method);
    if (listeners === undefined) {
      listeners = new Set();
      this.eventListeners.set(method, listeners);
    }
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
      if (listeners.size === 0) {
        this.eventListeners.delete(method);
      }
    };
  }

  close() {
    if (this.socket === null || this.closed) {
      return;
    }
    this.socket.close();
  }
}

async function launchChrome(options) {
  const chromePath = findChromeExecutable(options.chromePath);
  const debuggingPort = await reserveTcpPort();
  const profilePrefix = join(tmpdir(), "drawing-game-chrome-");
  const profileDirectory = await mkdtemp(profilePrefix);
  const chromeArguments = [
    options.headless ? "--headless=new" : null,
    `--remote-debugging-port=${debuggingPort}`,
    "--remote-debugging-address=127.0.0.1",
    "--remote-allow-origins=*",
    `--user-data-dir=${profileDirectory}`,
    "--no-first-run",
    "--no-default-browser-check",
    "--disable-background-networking",
    "--disable-component-update",
    "--disable-default-apps",
    "--disable-extensions",
    "--disable-features=Translate",
    "--disable-sync",
    "--metrics-recording-only",
    "--mute-audio",
    options.noSandbox ? "--no-sandbox" : null,
    "about:blank",
  ].filter((argument) => argument !== null);
  const child = spawn(chromePath, chromeArguments, {
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  });
  let stdout = "";
  let stderr = "";
  let spawnError = null;
  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");
  child.stdout.on("data", (chunk) => {
    stdout = appendOutput(stdout, chunk);
  });
  child.stderr.on("data", (chunk) => {
    stderr = appendOutput(stderr, chunk);
  });
  child.once("error", (error) => {
    spawnError = error;
  });

  let connection = null;
  try {
    const version = await waitUntil(
      async () => {
        if (spawnError !== null) {
          throw spawnError;
        }
        if (child.exitCode !== null || child.signalCode !== null) {
          throw new Error(
            `Chrome exited early (code ${String(child.exitCode)}, signal ${String(
              child.signalCode,
            )}).`,
          );
        }
        try {
          const result = await fetchJson(
            `http://127.0.0.1:${debuggingPort}/json/version`,
            500,
          );
          return typeof result.webSocketDebuggerUrl === "string"
            ? result
            : false;
        } catch {
          return false;
        }
      },
      "Chrome's remote debugging endpoint",
      CHROME_STARTUP_TIMEOUT_MS,
      () =>
        [stdout.trim(), stderr.trim()].filter(Boolean).join("\n"),
    );
    connection = new CdpConnection(version.webSocketDebuggerUrl);
    await connection.connect();

    return {
      chromePath,
      child,
      connection,
      profileDirectory,
      async cleanup() {
        try {
          if (!connection.closed) {
            await connection.send("Browser.close");
          }
        } catch {
          // The browser may already have closed after a target failure.
        }

        try {
          await waitForChildExit(child, 3_000);
        } catch {
          try {
            child.kill();
          } catch {
            // Best-effort cleanup.
          }
          try {
            await waitForChildExit(child, 3_000);
          } catch {
            // The process may be reaped by its platform-specific launcher.
          }
        }

        connection.close();
        const normalizedProfile = resolve(profileDirectory);
        const normalizedPrefix = resolve(profilePrefix);
        if (normalizedProfile.startsWith(normalizedPrefix)) {
          await rm(normalizedProfile, { recursive: true, force: true });
        }
      },
    };
  } catch (error) {
    if (connection !== null) {
      connection.close();
    }
    try {
      child.kill();
    } catch {
      // Best-effort cleanup after startup failure.
    }
    const normalizedProfile = resolve(profileDirectory);
    const normalizedPrefix = resolve(profilePrefix);
    if (normalizedProfile.startsWith(normalizedPrefix)) {
      await rm(normalizedProfile, { recursive: true, force: true });
    }
    throw error;
  }
}

function parseSocketIoEvents(payloadData) {
  if (typeof payloadData !== "string") {
    return [];
  }

  const events = [];
  for (const packet of payloadData.split("\u001e")) {
    const jsonStart = packet.indexOf("[");
    if (jsonStart < 0 || !packet.slice(0, jsonStart).includes("42")) {
      continue;
    }
    try {
      const value = JSON.parse(packet.slice(jsonStart));
      if (Array.isArray(value) && typeof value[0] === "string") {
        events.push(value);
      }
    } catch {
      // Socket.IO acknowledgements and binary packets are irrelevant here.
    }
  }
  return events;
}

class BrowserPage {
  constructor(controller, targetId, sessionId, label, timeoutMs) {
    this.controller = controller;
    this.connection = controller.connection;
    this.targetId = targetId;
    this.sessionId = sessionId;
    this.label = label;
    this.timeoutMs = timeoutMs;
    this.latestRoomState = null;
    this.roomStateHistory = [];
    this.errors = [];
    this.openWebSocketIds = new Set();
    this.socketIoWebSocketReady = false;
    this.closed = false;
    this.removeListeners = [];
  }

  async initialize(viewport) {
    this.removeListeners.push(
      this.connection.on("Network.webSocketCreated", (event) => {
        if (event.sessionId === this.sessionId) {
          this.openWebSocketIds.add(event.params.requestId);
        }
      }),
      this.connection.on("Network.webSocketClosed", (event) => {
        if (event.sessionId !== this.sessionId) {
          return;
        }
        this.openWebSocketIds.delete(event.params.requestId);
        if (this.openWebSocketIds.size === 0) {
          this.socketIoWebSocketReady = false;
        }
      }),
      this.connection.on("Network.webSocketFrameSent", (event) => {
        if (event.sessionId !== this.sessionId) {
          return;
        }
        const payloadData = event.params.response?.payloadData;
        if (payloadData === "5" || payloadData === "40") {
          this.socketIoWebSocketReady = true;
        }
      }),
      this.connection.on(
        "Network.webSocketFrameReceived",
        (event) => {
          if (event.sessionId !== this.sessionId) {
            return;
          }
          const payloadData = event.params.response?.payloadData;
          for (const [eventName, payload] of parseSocketIoEvents(
            payloadData,
          )) {
            if (eventName === "room:state") {
              this.latestRoomState = payload;
              this.roomStateHistory.push(payload);
              if (this.roomStateHistory.length > 20) {
                this.roomStateHistory.shift();
              }
            }
          }
        },
      ),
      this.connection.on("Runtime.exceptionThrown", (event) => {
        if (event.sessionId !== this.sessionId) {
          return;
        }
        const details = event.params.exceptionDetails ?? {};
        const description =
          details.exception?.description ??
          details.text ??
          "Unknown page exception";
        this.errors.push(String(description));
      }),
      this.connection.on("Log.entryAdded", (event) => {
        if (
          event.sessionId === this.sessionId &&
          event.params.entry?.level === "error"
        ) {
          this.errors.push(String(event.params.entry.text));
        }
      }),
    );

    await Promise.all([
      this.connection.send("Page.enable", {}, this.sessionId),
      this.connection.send("Runtime.enable", {}, this.sessionId),
      this.connection.send("Network.enable", {}, this.sessionId),
      this.connection.send("Log.enable", {}, this.sessionId),
    ]);
    await this.setViewport(viewport);
  }

  diagnostics() {
    const errors = this.errors.slice(-5);
    return errors.length === 0
      ? `${this.label}: no page errors captured.`
      : `${this.label} page errors:\n${errors.join("\n")}`;
  }

  async evaluate(expression) {
    const response = await this.connection.send(
      "Runtime.evaluate",
      {
        expression,
        awaitPromise: true,
        returnByValue: true,
        userGesture: true,
      },
      this.sessionId,
    );
    if (response.exceptionDetails !== undefined) {
      const details = response.exceptionDetails;
      throw new Error(
        details.exception?.description ??
          details.text ??
          "Runtime.evaluate failed.",
      );
    }
    return response.result?.value;
  }

  async setViewport(viewport) {
    await this.connection.send(
      "Emulation.setDeviceMetricsOverride",
      {
        width: viewport.width,
        height: viewport.height,
        deviceScaleFactor: 1,
        mobile: false,
      },
      this.sessionId,
    );
    await this.evaluate(
      "new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))",
    );
  }

  async setNetworkLatency(latencyMs) {
    await this.connection.send(
      "Network.emulateNetworkConditions",
      {
        offline: false,
        latency: latencyMs,
        downloadThroughput: -1,
        uploadThroughput: -1,
        connectionType: "wifi",
      },
      this.sessionId,
    );
  }

  async navigate(url) {
    this.latestRoomState = null;
    const navigation = await this.connection.send(
      "Page.navigate",
      { url },
      this.sessionId,
    );
    if (
      typeof navigation.errorText === "string" &&
      navigation.errorText.length > 0
    ) {
      throw new Error(`${this.label} navigation failed: ${navigation.errorText}`);
    }
    await waitUntil(
      async () =>
        (await this.evaluate("document.readyState")) === "complete",
      `${this.label} document load`,
      this.timeoutMs,
      () => this.diagnostics(),
    );
  }

  async reload() {
    this.latestRoomState = null;
    await this.connection.send(
      "Page.reload",
      { ignoreCache: true },
      this.sessionId,
    );
    await waitUntil(
      async () =>
        (await this.evaluate("document.readyState")) === "complete",
      `${this.label} reload`,
      this.timeoutMs,
      () => this.diagnostics(),
    );
  }

  async waitForSelector(selector, description = selector) {
    const serializedSelector = JSON.stringify(selector);
    await waitUntil(
      () =>
        this.evaluate(
          `Boolean(document.querySelector(${serializedSelector}))`,
        ),
      `${description} in ${this.label}`,
      this.timeoutMs,
      () => this.diagnostics(),
    );
  }

  async waitForSocketWebSocket() {
    await waitUntil(
      () => this.socketIoWebSocketReady,
      `${this.label} Socket.IO WebSocket upgrade`,
      this.timeoutMs,
      () => this.diagnostics(),
    );
  }

  async waitForNoSelector(selector, description = selector) {
    const serializedSelector = JSON.stringify(selector);
    await waitUntil(
      async () =>
        !(await this.evaluate(
          `Boolean(document.querySelector(${serializedSelector}))`,
        )),
      `${description} to disappear in ${this.label}`,
      this.timeoutMs,
      () => this.diagnostics(),
    );
  }

  async waitForText(text) {
    const serializedText = JSON.stringify(text);
    await waitUntil(
      () =>
        this.evaluate(
          `document.body?.innerText.includes(${serializedText}) === true`,
        ),
      `"${text}" in ${this.label}`,
      this.timeoutMs,
      () => this.diagnostics(),
    );
  }

  async setInput(selector, value) {
    const result = await this.evaluate(`(() => {
      const input = document.querySelector(${JSON.stringify(selector)});
      if (!(input instanceof HTMLInputElement)) {
        return { success: false, reason: "input not found" };
      }
      const setter = Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        "value",
      )?.set;
      if (setter === undefined) {
        return { success: false, reason: "native value setter unavailable" };
      }
      setter.call(input, ${JSON.stringify(value)});
      input.dispatchEvent(new Event("input", { bubbles: true }));
      input.dispatchEvent(new Event("change", { bubbles: true }));
      return { success: true };
    })()`);
    assertCondition(
      result?.success === true,
      `${this.label} could not fill ${selector}: ${result?.reason ?? "unknown reason"}.`,
    );
  }

  buttonExpression(label, requireEnabled) {
    return `(() => {
      const normalize = (value) => value.replace(/\\s+/gu, " ").trim();
      const button = [...document.querySelectorAll("button")].find(
        (candidate) =>
          normalize(candidate.textContent ?? "") === ${JSON.stringify(label)} &&
          ${requireEnabled ? "!candidate.disabled" : "true"},
      );
      return button === undefined
        ? null
        : { disabled: button.disabled, text: normalize(button.textContent ?? "") };
    })()`;
  }

  async waitForButton(label, requireEnabled = true) {
    await waitUntil(
      () => this.evaluate(this.buttonExpression(label, requireEnabled)),
      `${requireEnabled ? "enabled " : ""}"${label}" button in ${this.label}`,
      this.timeoutMs,
      () => this.diagnostics(),
    );
  }

  async clickButton(label) {
    await this.waitForButton(label, true);
    const result = await this.evaluate(`(() => {
      const normalize = (value) => value.replace(/\\s+/gu, " ").trim();
      const button = [...document.querySelectorAll("button")].find(
        (candidate) =>
          normalize(candidate.textContent ?? "") === ${JSON.stringify(label)} &&
          !candidate.disabled,
      );
      if (!(button instanceof HTMLButtonElement)) {
        return false;
      }
      button.click();
      return true;
    })()`);
    assertCondition(
      result === true,
      `${this.label} could not click "${label}".`,
    );
  }

  accessibleButtonExpression(label, scopeSelector = null) {
    const serializedScope = JSON.stringify(scopeSelector);
    return `(() => {
      const normalize = (value) => value.replace(/\\s+/gu, " ").trim();
      const scopeSelector = ${serializedScope};
      const scope =
        scopeSelector === null
          ? document
          : document.querySelector(scopeSelector);
      if (scope === null) {
        return null;
      }
      const button = [...scope.querySelectorAll("button")].find(
        (candidate) => {
          const accessibleName =
            candidate.getAttribute("aria-label") ??
            candidate.textContent ??
            "";
          return (
            normalize(accessibleName) === ${JSON.stringify(label)} &&
            !candidate.disabled
          );
        },
      );
      if (!(button instanceof HTMLButtonElement)) {
        return null;
      }
      button.scrollIntoView({
        block: "center",
        inline: "center",
        behavior: "instant",
      });
      const rect = button.getBoundingClientRect();
      return {
        disabled: button.disabled,
        left: rect.left,
        top: rect.top,
        width: rect.width,
        height: rect.height,
      };
    })()`;
  }

  async waitForAccessibleButton(label, scopeSelector = null) {
    return waitUntil(
      () =>
        this.evaluate(
          this.accessibleButtonExpression(label, scopeSelector),
        ),
      `enabled accessible "${label}" button in ${this.label}`,
      this.timeoutMs,
      () => this.diagnostics(),
    );
  }

  async dispatchMouseClickAt(x, y) {
    await this.connection.send(
      "Input.dispatchMouseEvent",
      {
        type: "mouseMoved",
        x,
        y,
      },
      this.sessionId,
    );
    await this.connection.send(
      "Input.dispatchMouseEvent",
      {
        type: "mousePressed",
        x,
        y,
        button: "left",
        buttons: 1,
        clickCount: 1,
      },
      this.sessionId,
    );
    await this.connection.send(
      "Input.dispatchMouseEvent",
      {
        type: "mouseReleased",
        x,
        y,
        button: "left",
        buttons: 0,
        clickCount: 1,
      },
      this.sessionId,
    );
  }

  async clickAccessibleButton(label, scopeSelector = null) {
    const rect = await this.waitForAccessibleButton(
      label,
      scopeSelector,
    );
    assertCondition(
      rect.width > 0 && rect.height > 0,
      `${this.label}'s "${label}" button has no clickable area.`,
    );
    await this.dispatchMouseClickAt(
      rect.left + rect.width / 2,
      rect.top + rect.height / 2,
    );
    await this.evaluate(
      "new Promise((resolve) => requestAnimationFrame(resolve))",
    );
  }

  async getVisibleElementRect(selector) {
    return waitUntil(
      () =>
        this.evaluate(`(() => {
          const element = document.querySelector(${JSON.stringify(selector)});
          if (!(element instanceof HTMLElement)) {
            return null;
          }
          element.scrollIntoView({
            block: "center",
            inline: "center",
            behavior: "instant",
          });
          const rect = element.getBoundingClientRect();
          if (rect.width <= 0 || rect.height <= 0) {
            return null;
          }
          return {
            left: rect.left,
            top: rect.top,
            width: rect.width,
            height: rect.height,
          };
        })()`),
      `visible ${selector} in ${this.label}`,
      this.timeoutMs,
      () => this.diagnostics(),
    );
  }

  async clickElementAt(
    selector,
    normalizedX = 0.5,
    normalizedY = 0.5,
  ) {
    const rect = await this.getVisibleElementRect(selector);
    const x = rect.left + rect.width * normalizedX;
    const y = rect.top + rect.height * normalizedY;
    await this.dispatchMouseClickAt(x, y);
    await this.evaluate(
      "new Promise((resolve) => requestAnimationFrame(resolve))",
    );
  }

  async drawNormalizedPath(selector, normalizedPoints) {
    assertCondition(
      Array.isArray(normalizedPoints) && normalizedPoints.length >= 2,
      "A real drawing path needs at least two points.",
    );
    const rect = await this.getVisibleElementRect(selector);
    const toViewportPoint = ([normalizedX, normalizedY]) => ({
      x: rect.left + rect.width * normalizedX,
      y: rect.top + rect.height * normalizedY,
    });
    const points = normalizedPoints.map(toViewportPoint);
    const firstPoint = points[0];

    await this.connection.send(
      "Input.dispatchMouseEvent",
      {
        type: "mouseMoved",
        ...firstPoint,
      },
      this.sessionId,
    );
    await this.connection.send(
      "Input.dispatchMouseEvent",
      {
        type: "mousePressed",
        ...firstPoint,
        button: "left",
        buttons: 1,
        clickCount: 1,
      },
      this.sessionId,
    );
    for (const point of points.slice(1)) {
      await this.connection.send(
        "Input.dispatchMouseEvent",
        {
          type: "mouseMoved",
          ...point,
          button: "none",
          buttons: 1,
        },
        this.sessionId,
      );
    }
    const lastPoint = points.at(-1);
    await this.connection.send(
      "Input.dispatchMouseEvent",
      {
        type: "mouseReleased",
        ...lastPoint,
        button: "left",
        buttons: 0,
        clickCount: 1,
      },
      this.sessionId,
    );
    await this.evaluate(
      "new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))",
    );
  }

  async pressKey(key) {
    const keyMetadata =
      key === "Escape"
        ? {
            code: "Escape",
            key: "Escape",
            windowsVirtualKeyCode: 27,
            nativeVirtualKeyCode: 27,
          }
        : { code: key, key };
    await this.connection.send(
      "Input.dispatchKeyEvent",
      {
        type: "rawKeyDown",
        ...keyMetadata,
      },
      this.sessionId,
    );
    await this.connection.send(
      "Input.dispatchKeyEvent",
      {
        type: "keyUp",
        ...keyMetadata,
      },
      this.sessionId,
    );
  }

  async sampleCanvas(normalizedX, normalizedY) {
    return this.evaluate(`(() => {
      const canvas = document.querySelector(".drawing-canvas");
      if (!(canvas instanceof HTMLCanvasElement)) {
        return null;
      }
      const context = canvas.getContext("2d");
      if (context === null || canvas.width < 1 || canvas.height < 1) {
        return null;
      }
      const x = Math.min(
        canvas.width - 1,
        Math.max(0, Math.floor(canvas.width * ${normalizedX})),
      );
      const y = Math.min(
        canvas.height - 1,
        Math.max(0, Math.floor(canvas.height * ${normalizedY})),
      );
      return [...context.getImageData(x, y, 1, 1).data];
    })()`);
  }

  async captureScreenshot(filePath) {
    const screenshot = await this.connection.send(
      "Page.captureScreenshot",
      {
        format: "png",
        fromSurface: true,
        captureBeyondViewport: false,
      },
      this.sessionId,
    );
    assertCondition(
      typeof screenshot.data === "string" &&
        screenshot.data.length > 0,
      `${this.label} did not return screenshot data.`,
    );
    await writeFile(filePath, Buffer.from(screenshot.data, "base64"));
    return filePath;
  }

  async installNativeConfirmGuard() {
    await this.evaluate(`(() => {
      window.__drawingGameNativeConfirmCalls = 0;
      window.confirm = () => {
        window.__drawingGameNativeConfirmCalls += 1;
        return false;
      };
    })()`);
  }

  async getNativeConfirmCallCount() {
    return this.evaluate(
      "Number(window.__drawingGameNativeConfirmCalls ?? 0)",
    );
  }

  async getStorageSnapshot() {
    return this.evaluate(`(() => {
      const serializedSession = localStorage.getItem(
        ${JSON.stringify(PLAYER_SESSION_STORAGE_KEY)},
      );
      let session = null;
      try {
        session =
          serializedSession === null ? null : JSON.parse(serializedSession);
      } catch {
        session = null;
      }
      return {
        clientInstanceId: sessionStorage.getItem(
          ${JSON.stringify(CLIENT_INSTANCE_STORAGE_KEY)},
        ),
        session,
      };
    })()`);
  }

  async waitForRoomState(predicate, description) {
    return waitUntil(
      () => {
        const state = this.latestRoomState;
        return state !== null && predicate(state) ? state : false;
      },
      `${description} from ${this.label}'s Socket.IO stream`,
      this.timeoutMs,
      () => this.diagnostics(),
    );
  }

  async inspectWaitingLayout(viewport) {
    await this.setViewport(viewport);
    await this.waitForSelector(
      ".drawing-observer-stage",
      "drawing waiting stage",
    );
    const result = await this.evaluate(`(() => {
      window.scrollTo({ top: 0, left: 0, behavior: "instant" });
      const stage = document.querySelector(".drawing-observer-stage");
      const content = stage?.querySelector(
        ".drawing-observer-stage__content",
      );
      const mascot = stage?.querySelector(
        ".drawing-observer-stage__mascot",
      );
      const message = stage?.querySelector(
        ".drawing-observer-stage__message",
      );
      if (
        !(stage instanceof HTMLElement) ||
        !(content instanceof HTMLElement) ||
        !(mascot instanceof HTMLImageElement) ||
        !(message instanceof HTMLElement)
      ) {
        return { present: false };
      }
      const stageRect = stage.getBoundingClientRect();
      const contentRect = content.getBoundingClientRect();
      const mascotRect = mascot.getBoundingClientRect();
      const stageStyle = getComputedStyle(stage);
      const epsilon = 1;
      return {
        present: true,
        noHorizontalOverflow:
          document.documentElement.scrollWidth <= window.innerWidth + epsilon &&
          document.body.scrollWidth <= window.innerWidth + epsilon,
        stage: {
          left: stageRect.left,
          right: stageRect.right,
          width: stageRect.width,
          height: stageRect.height,
          backgroundColor: stageStyle.backgroundColor,
        },
        contentCentered:
          Math.abs(
            contentRect.left +
              contentRect.width / 2 -
              (stageRect.left + stageRect.width / 2),
          ) <= 2 &&
          Math.abs(
            contentRect.top +
              contentRect.height / 2 -
              (stageRect.top + stageRect.height / 2),
          ) <= 2,
        mascotContained:
          mascotRect.left >= stageRect.left - epsilon &&
          mascotRect.right <= stageRect.right + epsilon &&
          mascotRect.top >= stageRect.top - epsilon &&
          mascotRect.bottom <= stageRect.bottom + epsilon,
        flyAsset: /\\/fly\\.png(?:[?#].*)?$/u.test(mascot.currentSrc || mascot.src),
        message: message.textContent?.replace(/\\s+/gu, " ").trim() ?? "",
      };
    })()`);

    assertCondition(
      result?.present === true,
      `The drawing waiting scene is missing at ${viewport.width}x${viewport.height}.`,
    );
    assertCondition(
      result.noHorizontalOverflow,
      `The drawing waiting scene causes horizontal overflow at ${viewport.width}x${viewport.height}.`,
    );
    assertCondition(
      result.stage.left >= -1 &&
        result.stage.right <= viewport.width + 1 &&
        result.stage.width > 0 &&
        result.stage.height > 0,
      `The drawing waiting stage escapes the viewport at ${viewport.width}x${viewport.height}.`,
    );
    assertCondition(
      result.stage.backgroundColor === "rgb(255, 255, 255)" ||
        result.stage.backgroundColor === "rgba(255, 255, 255, 1)",
      `The drawing waiting stage is not white at ${viewport.width}x${viewport.height}.`,
    );
    assertCondition(
      result.contentCentered && result.mascotContained,
      `The waiting fly composition is not centered and contained at ${viewport.width}x${viewport.height}.`,
    );
    assertCondition(
      result.flyAsset && result.message.length > 0,
      `The waiting scene is missing its fly mascot or message at ${viewport.width}x${viewport.height}.`,
    );

    return {
      viewport: `${viewport.width}x${viewport.height}`,
      width: Math.round(result.stage.width),
      height: Math.round(result.stage.height),
      flyAsset: result.flyAsset,
      whiteStage: true,
      noHorizontalOverflow: true,
    };
  }

  async inspectDrawingLayout(viewport) {
    await this.setViewport(viewport);
    await this.waitForSelector(".drawing-canvas", "drawing editor canvas");
    const result = await this.evaluate(`(() => {
      window.scrollTo({ top: 0, left: 0, behavior: "instant" });
      const stage = document.querySelector(
        ".drawing-editor__canvas-stage",
      );
      const canvas = document.querySelector(".drawing-canvas");
      const toolbar = document.querySelector(".drawing-toolbar");
      if (
        !(stage instanceof HTMLElement) ||
        !(canvas instanceof HTMLCanvasElement) ||
        !(toolbar instanceof HTMLElement)
      ) {
        return { present: false };
      }
      const stageRect = stage.getBoundingClientRect();
      const canvasRect = canvas.getBoundingClientRect();
      const iconButtons = [
        "Stylo",
        "Gomme",
        "Pot de peinture",
        "Annuler",
        "Tout effacer",
      ].map((label) => {
        const button = toolbar.querySelector(
          "button[aria-label='" + label + "']",
        );
        return {
          label,
          present: button instanceof HTMLButtonElement,
          hasSvg:
            button instanceof HTMLButtonElement &&
            button.querySelector("svg") instanceof SVGElement,
        };
      });
      const palette = [
        ...toolbar.querySelectorAll("button[aria-label^='Couleur ']"),
      ];
      const epsilon = 1;
      return {
        present: true,
        noHorizontalOverflow:
          document.documentElement.scrollWidth <= window.innerWidth + epsilon &&
          document.body.scrollWidth <= window.innerWidth + epsilon,
        stage: {
          left: stageRect.left,
          right: stageRect.right,
          width: stageRect.width,
          height: stageRect.height,
        },
        canvas: {
          width: canvasRect.width,
          height: canvasRect.height,
        },
        paletteCount: palette.length,
        iconButtons,
      };
    })()`);

    assertCondition(
      result?.present === true,
      `The drawing editor is missing at ${viewport.width}x${viewport.height}.`,
    );
    assertCondition(
      result.noHorizontalOverflow,
      `The drawing editor causes horizontal overflow at ${viewport.width}x${viewport.height}.`,
    );
    assertCondition(
      result.stage.left >= -1 &&
        result.stage.right <= viewport.width + 1 &&
        result.stage.width > 0 &&
        result.stage.height > 0,
      `The drawing editor stage escapes the viewport at ${viewport.width}x${viewport.height}.`,
    );
    assertCondition(
      result.canvas.width > 0 &&
        result.canvas.height > 0 &&
        Math.abs(result.canvas.width / result.canvas.height - 4 / 3) <
          0.03,
      `The drawing canvas lost its 4:3 ratio at ${viewport.width}x${viewport.height}.`,
    );
    assertCondition(
      result.paletteCount >= 16,
      `The drawing palette is not Paint-like at ${viewport.width}x${viewport.height}.`,
    );
    assertCondition(
      result.iconButtons.every(
        (button) => button.present && button.hasSvg,
      ),
      `One or more drawing actions lack their icon at ${viewport.width}x${viewport.height}.`,
    );

    return {
      viewport: `${viewport.width}x${viewport.height}`,
      width: Math.round(result.canvas.width),
      height: Math.round(result.canvas.height),
      paletteCount: result.paletteCount,
      iconButtons: result.iconButtons.map((button) => button.label),
      noHorizontalOverflow: true,
    };
  }

  async inspectPromptHeaderLayout(viewport, prompt) {
    await this.setViewport(viewport);
    await this.waitForSelector(
      ".game-prompt-header",
      "game prompt header",
    );
    const result = await this.evaluate(`(async () => {
      window.scrollTo({ top: 0, left: 0, behavior: "instant" });
      const prompt = ${JSON.stringify(prompt)};
      const header = document.querySelector(".game-prompt-header");
      const statement = header?.querySelector(".game-prompt-text");
      const gauge = header?.querySelector(".scale-gauge");
      const track = header?.querySelector(".scale-gauge__track");
      const labels = [
        ...(header?.querySelectorAll(".scale-gauge__labels span") ?? []),
      ];
      const canvasStage = document.querySelector(
        ".drawing-editor__canvas-stage",
      );
      const canvas = document.querySelector(".drawing-canvas");
      if (
        !(header instanceof HTMLElement) ||
        !(statement instanceof HTMLElement) ||
        !(gauge instanceof HTMLElement) ||
        !(track instanceof HTMLElement) ||
        labels.length !== 2 ||
        !labels.every((label) => label instanceof HTMLElement) ||
        !(canvasStage instanceof HTMLElement) ||
        !(canvas instanceof HTMLCanvasElement)
      ) {
        return { present: false };
      }

      const original = {
        statement: statement.textContent ?? "",
        lowLabel: labels[0].textContent ?? "",
        highLabel: labels[1].textContent ?? "",
      };
      const waitForLayout = () =>
        new Promise((resolve) =>
          requestAnimationFrame(() => requestAnimationFrame(resolve)),
        );
      const rectangle = (element) => {
        const value = element.getBoundingClientRect();
        return {
          top: value.top,
          right: value.right,
          bottom: value.bottom,
          left: value.left,
          width: value.width,
          height: value.height,
        };
      };
      const containedBy = (inner, outer, epsilon = 1) =>
        inner.top >= outer.top - epsilon &&
        inner.right <= outer.right + epsilon &&
        inner.bottom <= outer.bottom + epsilon &&
        inner.left >= outer.left - epsilon;

      try {
        statement.textContent =
          "Une consigne courte sert de référence. Créez-la, du minuscule au gigantesque.";
        labels[0].textContent = "Minuscule";
        labels[1].textContent = "Gigantesque";
        await waitForLayout();
        const beforeCanvas = canvas.getBoundingClientRect();

        statement.textContent = prompt.statement;
        labels[0].textContent = prompt.lowLabel;
        labels[1].textContent = prompt.highLabel;
        await waitForLayout();

        const headerRect = rectangle(header);
        const statementRect = rectangle(statement);
        const gaugeRect = rectangle(gauge);
        const trackRect = rectangle(track);
        const labelRects = labels.map(rectangle);
        const canvasStageRect = rectangle(canvasStage);
        const afterCanvas = rectangle(canvas);
        const labelStyles = labels.map((label) =>
          getComputedStyle(label),
        );
        const epsilon = 1;

        return {
          present: true,
          noHorizontalOverflow:
            document.documentElement.scrollWidth <=
              window.innerWidth + epsilon &&
            document.body.scrollWidth <= window.innerWidth + epsilon,
          headerContained:
            headerRect.left >= -epsilon &&
            headerRect.right <= window.innerWidth + epsilon &&
            headerRect.top >= -epsilon &&
            headerRect.bottom <= window.innerHeight + epsilon,
          statementVisible:
            statementRect.width > 0 &&
            statementRect.height > 0 &&
            containedBy(statementRect, headerRect) &&
            statement.scrollWidth <= statement.clientWidth + epsilon &&
            statement.scrollHeight <= statement.clientHeight + epsilon,
          gaugeVisible:
            gaugeRect.width > 0 &&
            gaugeRect.height > 0 &&
            trackRect.width > 0 &&
            trackRect.height > 0 &&
            containedBy(gaugeRect, headerRect) &&
            gaugeRect.bottom <= window.innerHeight + epsilon,
          labelsReadable: labels.every(
            (label, index) =>
              labelRects[index].width > 0 &&
              labelRects[index].height > 0 &&
              containedBy(labelRects[index], headerRect) &&
              label.scrollWidth <= label.clientWidth + epsilon &&
              label.scrollHeight <= label.clientHeight + epsilon &&
              labelStyles[index].display !== "none" &&
              labelStyles[index].visibility !== "hidden" &&
              Number.parseFloat(labelStyles[index].fontSize) >= 10,
          ),
          canvasPreserved:
            beforeCanvas.width > 0 &&
            beforeCanvas.height > 0 &&
            afterCanvas.width >= beforeCanvas.width * 0.8 &&
            afterCanvas.height >= beforeCanvas.height * 0.8 &&
            containedBy(afterCanvas, canvasStageRect) &&
            (window.innerWidth < 900 ||
              (afterCanvas.top >= -epsilon &&
                afterCanvas.bottom <= window.innerHeight + epsilon)),
          headerHeight: headerRect.height,
          statementHeight: statementRect.height,
          gaugeHeight: gaugeRect.height,
          canvas: {
            beforeWidth: beforeCanvas.width,
            beforeHeight: beforeCanvas.height,
            afterWidth: afterCanvas.width,
            afterHeight: afterCanvas.height,
          },
        };
      } finally {
        statement.textContent = original.statement;
        labels[0].textContent = original.lowLabel;
        labels[1].textContent = original.highLabel;
        await waitForLayout();
      }
    })()`);

    assertCondition(
      result?.present === true,
      `The prompt header is incomplete for "${prompt.id}" at ${viewport.width}x${viewport.height}.`,
    );
    assertCondition(
      result.noHorizontalOverflow,
      `Prompt "${prompt.id}" causes horizontal overflow at ${viewport.width}x${viewport.height}.`,
    );
    assertCondition(
      result.headerContained && result.statementVisible,
      `Prompt "${prompt.id}" is clipped at ${viewport.width}x${viewport.height}.`,
    );
    assertCondition(
      result.gaugeVisible && result.labelsReadable,
      `Prompt "${prompt.id}" hides its gauge or labels at ${viewport.width}x${viewport.height}.`,
    );
    assertCondition(
      result.canvasPreserved,
      `Prompt "${prompt.id}" reduces the drawing canvas excessively at ${viewport.width}x${viewport.height}.`,
    );

    return {
      id: prompt.id,
      viewport: `${viewport.width}x${viewport.height}`,
      statementLength: [...prompt.statement].length,
      lowLabelLength: [...prompt.lowLabel].length,
      highLabelLength: [...prompt.highLabel].length,
      headerHeight: Math.round(result.headerHeight),
      statementHeight: Math.round(result.statementHeight),
      gaugeHeight: Math.round(result.gaugeHeight),
      canvasWidth: Math.round(result.canvas.afterWidth),
      canvasHeight: Math.round(result.canvas.afterHeight),
      noHorizontalOverflow: true,
      textAndGaugeVisible: true,
      labelsReadable: true,
      canvasPreserved: true,
    };
  }

  async inspectDialog({
    title,
    confirmLabel,
    cancelLabel,
    valueLabel = null,
  }) {
    await this.waitForSelector(DIALOG_SELECTOR, `${title} dialog`);
    await this.evaluate(
      "new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))",
    );
    const result = await this.evaluate(`(() => {
      const normalize = (value) => value.replace(/\\s+/gu, " ").trim();
      const dialog = document.querySelector(${JSON.stringify(DIALOG_SELECTOR)});
      if (!(dialog instanceof HTMLElement)) {
        return { present: false };
      }
      const titleId = dialog.getAttribute("aria-labelledby");
      const descriptionIds = (
        dialog.getAttribute("aria-describedby") ?? ""
      )
        .split(/\\s+/u)
        .filter(Boolean);
      const titleElement =
        titleId === null ? null : document.getElementById(titleId);
      const descriptionElements = descriptionIds
        .map((id) => document.getElementById(id))
        .filter((element) => element !== null);
      const buttons = [...dialog.querySelectorAll("button")].map(
        (button) =>
          normalize(
            button.getAttribute("aria-label") ??
              button.textContent ??
              "",
          ),
      );
      const value = dialog.querySelector(".game-dialog__value");
      const labelledValue = value?.querySelector("[aria-label]");
      const rect = dialog.getBoundingClientRect();
      const epsilon = 1;
      return {
        present: true,
        role: dialog.getAttribute("role"),
        ariaModal: dialog.getAttribute("aria-modal"),
        title: normalize(titleElement?.textContent ?? ""),
        description: normalize(
          descriptionElements
            .map((element) => element.textContent ?? "")
            .join(" "),
        ),
        buttons,
        valueText: normalize(value?.textContent ?? ""),
        valueLabel: labelledValue?.getAttribute("aria-label") ?? null,
        valueDescribed:
          value instanceof HTMLElement &&
          value.id.length > 0 &&
          descriptionIds.includes(value.id),
        activeButton:
          document.activeElement instanceof HTMLButtonElement
            ? normalize(
                document.activeElement.getAttribute("aria-label") ??
                  document.activeElement.textContent ??
                  "",
              )
            : null,
        viewportContained:
          rect.left >= -epsilon &&
          rect.right <= window.innerWidth + epsilon &&
          rect.top >= -epsilon &&
          rect.bottom <= window.innerHeight + epsilon,
        noHorizontalOverflow:
          document.documentElement.scrollWidth <= window.innerWidth + epsilon &&
          document.body.scrollWidth <= window.innerWidth + epsilon,
      };
    })()`);

    assertCondition(
      result?.present === true &&
        result.role === "dialog" &&
        result.ariaModal === "true",
      `${this.label}'s "${title}" confirmation is not an accessible modal dialog.`,
    );
    assertCondition(
      result.title === title && result.description.length > 0,
      `${this.label}'s "${title}" dialog is not correctly labelled and described.`,
    );
    assertCondition(
      result.buttons.includes(confirmLabel) &&
        result.buttons.includes(cancelLabel),
      `${this.label}'s "${title}" dialog is missing its confirmation labels.`,
    );
    assertCondition(
      valueLabel === null ||
        (result.valueLabel === valueLabel && result.valueDescribed === true),
      `${this.label}'s "${title}" dialog does not expose the selected value.`,
    );
    assertCondition(
      result.activeButton === cancelLabel,
      `${this.label}'s "${title}" dialog did not focus its safe cancel action.`,
    );
    assertCondition(
      result.viewportContained && result.noHorizontalOverflow,
      `${this.label}'s "${title}" dialog overflows its viewport.`,
    );

    return {
      title: result.title,
      confirmLabel,
      cancelLabel,
      valueLabel: result.valueLabel,
      defaultFocus: result.activeButton,
    };
  }

  async inspectFinishedLayout(viewport, expectedLeaderboard) {
    await this.setViewport(viewport);
    await this.waitForSelector(".finished-podium", "finished podium");
    const result = await this.evaluate(`(() => {
      window.scrollTo({ top: 0, left: 0, behavior: "instant" });
      const podium = document.querySelector(".finished-podium");
      if (!(podium instanceof HTMLOListElement)) {
        return { present: false };
      }
      const entries = [...podium.children].map((entry) => {
        const rect = entry.getBoundingClientRect();
        const mascot = entry.querySelector(".finished-podium__mascot");
        const mascotRect = mascot?.getBoundingClientRect();
        return {
          classes: [...entry.classList],
          nickname:
            entry.querySelector(".finished-podium__nickname")?.textContent
              ?.replace(/\\s+/gu, " ")
              .trim() ?? "",
          score:
            entry.querySelector(".finished-podium__score")?.textContent
              ?.replace(/\\s+/gu, " ")
              .trim() ?? "",
          rank:
            entry.querySelector(".finished-podium__step")
              ?.getAttribute("data-rank") ?? null,
          centerX: rect.left + rect.width / 2,
          top: rect.top,
          mascotSize:
            mascotRect === undefined
              ? 0
              : Math.max(mascotRect.width, mascotRect.height),
        };
      });
      const rematch = document.querySelector(".finished-rematch-button");
      const leave = document.querySelector(
        ".finished-actions .game-sidebar-leave button",
      );
      const epsilon = 1;
      return {
        present: true,
        entries,
        podiumClasses: [...podium.classList],
        ariaLabel: podium.getAttribute("aria-label"),
        rematchEnabled:
          rematch instanceof HTMLButtonElement && !rematch.disabled,
        leaveEnabled:
          leave instanceof HTMLButtonElement && !leave.disabled,
        noHorizontalOverflow:
          document.documentElement.scrollWidth <= window.innerWidth + epsilon &&
          document.body.scrollWidth <= window.innerWidth + epsilon,
      };
    })()`);

    const winners = expectedLeaderboard.filter((entry) => entry.rank === 1);
    const defaultPodium = expectedLeaderboard.slice(0, 3);
    const boundaryRank = defaultPodium.at(-1)?.rank;
    const expectedPodium =
      winners.length > 1
        ? winners
        : boundaryRank === undefined
          ? []
          : expectedLeaderboard.filter(
              (entry) => entry.rank <= boundaryRank,
            );
    assertCondition(
      result?.present === true && result.ariaLabel === "Podium final",
      `The final podium is missing at ${viewport.width}x${viewport.height}.`,
    );
    assertCondition(
      result.noHorizontalOverflow,
      `The finished screen causes horizontal overflow at ${viewport.width}x${viewport.height}.`,
    );
    assertCondition(
      result.entries.length === expectedPodium.length &&
        result.entries.every((entry, index) => {
          const expected = expectedPodium[index];
          const pointsLabel = `${expected.score} point${
            expected.score === 1 ? "" : "s"
          }`;
          return (
            entry.nickname === expected.player.nickname &&
            entry.score === pointsLabel &&
            entry.rank === String(expected.rank) &&
            entry.classes.includes(
              `finished-podium__entry--slot-${index + 1}`,
            )
          );
        }),
      `The final podium order or scores are incorrect at ${viewport.width}x${viewport.height}.`,
    );
    assertCondition(
      result.rematchEnabled && result.leaveEnabled,
      `The finished screen lost its rematch or leave action at ${viewport.width}x${viewport.height}.`,
    );

    if (
      result.entries.length === 3 &&
      !result.podiumClasses.includes("finished-podium--shared-first") &&
      !result.podiumClasses.includes("finished-podium--extended")
    ) {
      const [first, second, third] = result.entries;
      if (viewport.width <= 360) {
        assertCondition(
          first.top <= second.top && second.top <= third.top,
          `The compact podium order is wrong at ${viewport.width}x${viewport.height}.`,
        );
      } else {
        assertCondition(
          second.centerX < first.centerX &&
            first.centerX < third.centerX,
          `The winner is not centered on the podium at ${viewport.width}x${viewport.height}.`,
        );
      }
      assertCondition(
        first.mascotSize >= second.mascotSize &&
          first.mascotSize >= third.mascotSize,
        `The winner mascot is not emphasized at ${viewport.width}x${viewport.height}.`,
      );
    }

    return {
      viewport: `${viewport.width}x${viewport.height}`,
      order: result.entries.map((entry) => entry.nickname),
      scores: result.entries.map((entry) => entry.score),
      rematchEnabled: result.rematchEnabled,
      leaveEnabled: result.leaveEnabled,
      noHorizontalOverflow: true,
    };
  }

  async inspectRecoveryOverlay(viewport) {
    await this.setViewport(viewport);
    const result = await this.evaluate(`(() => {
      const overlay = document.querySelector(".connection-recovery-overlay");
      const card = document.querySelector(".connection-recovery-card");
      const tile = document.querySelector(
        ".connection-recovery__mascot-tile",
      );
      const mascot = tile?.querySelector(".mascot");
      const title = document.querySelector("#connection-recovery-title");
      if (
        !(overlay instanceof HTMLElement) ||
        !(card instanceof HTMLElement) ||
        !(tile instanceof HTMLElement) ||
        !(mascot instanceof HTMLImageElement) ||
        !(title instanceof HTMLElement)
      ) {
        return { present: false };
      }

      const tileRect = tile.getBoundingClientRect();
      const mascotRect = mascot.getBoundingClientRect();
      const cardRect = card.getBoundingClientRect();
      const titleRect = title.getBoundingClientRect();
      const tileStyle = getComputedStyle(tile);
      const mascotStyle = getComputedStyle(mascot);
      const epsilon = 1;
      const contained =
        mascotRect.left >= tileRect.left - epsilon &&
        mascotRect.top >= tileRect.top - epsilon &&
        mascotRect.right <= tileRect.right + epsilon &&
        mascotRect.bottom <= tileRect.bottom + epsilon;
      const overlapsTitle =
        tileRect.left < titleRect.right &&
        tileRect.right > titleRect.left &&
        tileRect.top < titleRect.bottom &&
        tileRect.bottom > titleRect.top;
      const viewportContained =
        cardRect.left >= -epsilon &&
        cardRect.top >= -epsilon &&
        cardRect.right <= window.innerWidth + epsilon &&
        cardRect.bottom <= window.innerHeight + epsilon;
      const noHorizontalOverflow =
        document.documentElement.scrollWidth <= window.innerWidth + epsilon &&
        document.body.scrollWidth <= window.innerWidth + epsilon;
      const retryButton = document.querySelector(
        ".connection-recovery-retry",
      );

      return {
        present: true,
        contained,
        overlapsTitle,
        viewportContained,
        noHorizontalOverflow,
        tile: {
          width: tileRect.width,
          height: tileRect.height,
          overflowX: tileStyle.overflowX,
          overflowY: tileStyle.overflowY,
        },
        mascot: {
          width: mascotRect.width,
          height: mascotRect.height,
          display: mascotStyle.display,
          objectFit: mascotStyle.objectFit,
          objectPosition: mascotStyle.objectPosition,
          transform: mascotStyle.transform,
          animationName: mascotStyle.animationName,
        },
        retry: retryButton instanceof HTMLButtonElement
          ? {
              disabled: retryButton.disabled,
              ariaBusy: retryButton.getAttribute("aria-busy"),
              text: retryButton.textContent?.replace(/\\s+/gu, " ").trim() ?? "",
            }
          : null,
      };
    })()`);

    assertCondition(
      result?.present === true,
      `Recovery overlay elements are missing at ${viewport.width}x${viewport.height}.`,
    );
    assertCondition(
      result.contained,
      `The recovery mascot escapes its tile at ${viewport.width}x${viewport.height}.`,
    );
    assertCondition(
      !result.overlapsTitle,
      `The recovery mascot overlaps the title at ${viewport.width}x${viewport.height}.`,
    );
    assertCondition(
      result.viewportContained,
      `The recovery card escapes the viewport at ${viewport.width}x${viewport.height}.`,
    );
    assertCondition(
      result.noHorizontalOverflow,
      `The recovery overlay causes horizontal overflow at ${viewport.width}x${viewport.height}.`,
    );
    assertCondition(
      Math.abs(result.tile.width - 44) <= 1 &&
        Math.abs(result.tile.height - 44) <= 1,
      `The recovery tile is not 44x44 CSS pixels at ${viewport.width}x${viewport.height}.`,
    );
    assertCondition(
      Math.abs(result.mascot.width - 34) <= 1 &&
        Math.abs(result.mascot.height - 34) <= 1,
      `The recovery mascot is not 34x34 CSS pixels at ${viewport.width}x${viewport.height}.`,
    );
    assertCondition(
      result.tile.overflowX === "hidden" &&
        result.tile.overflowY === "hidden",
      `The recovery tile does not clip overflow at ${viewport.width}x${viewport.height}.`,
    );
    assertCondition(
      result.mascot.display === "block" &&
        result.mascot.objectFit === "contain" &&
        (result.mascot.objectPosition === "50% 50%" ||
          result.mascot.objectPosition === "center"),
      `The recovery mascot is not centered with object-fit containment at ${viewport.width}x${viewport.height}.`,
    );
    assertCondition(
      result.mascot.transform === "none" &&
        result.mascot.animationName === "none",
      `The recovery mascot is translated or animated at ${viewport.width}x${viewport.height}.`,
    );

    return {
      viewport: `${viewport.width}x${viewport.height}`,
      tile: `${Math.round(result.tile.width)}x${Math.round(result.tile.height)}`,
      mascot: `${Math.round(result.mascot.width)}x${Math.round(
        result.mascot.height,
      )}`,
    };
  }

  async clickRetryAndCaptureLoadingState() {
    const clicked = await this.evaluate(`(() => {
      const button = document.querySelector(".connection-recovery-retry");
      if (!(button instanceof HTMLButtonElement) || button.disabled) {
        return false;
      }
      button.click();
      return true;
    })()`);

    if (clicked !== true) {
      return { clicked: false, loading: false };
    }

    let loading = false;
    try {
      await waitUntil(
        () =>
          this.evaluate(`(() => {
            const current = document.querySelector(
              ".connection-recovery-retry",
            );
            return (
              current instanceof HTMLButtonElement &&
              current.disabled &&
              current.getAttribute("aria-busy") === "true" &&
              (current.textContent ?? "").includes(
                "Restauration en cours",
              )
            );
          })()`),
        `disabled retry loading state in ${this.label}`,
        Math.min(this.timeoutMs, 2_000),
        () => this.diagnostics(),
      );
      loading = true;
    } catch {
      // A very fast local restoration can remove the overlay first.
    }

    return { clicked: true, loading };
  }

  async close() {
    if (this.closed) {
      return;
    }
    this.closed = true;
    try {
      await this.connection.send("Target.closeTarget", {
        targetId: this.targetId,
      });
    } finally {
      for (const removeListener of this.removeListeners) {
        removeListener();
      }
      this.removeListeners = [];
      this.controller.pages.delete(this);
    }
  }
}

class BrowserController {
  constructor(connection, timeoutMs) {
    this.connection = connection;
    this.timeoutMs = timeoutMs;
    this.contextIds = new Set();
    this.pages = new Set();
  }

  async createContext() {
    const result = await this.connection.send(
      "Target.createBrowserContext",
      {
        disposeOnDetach: true,
      },
    );
    this.contextIds.add(result.browserContextId);
    return result.browserContextId;
  }

  async createPage(contextId, label, viewport = VIEWPORTS[1]) {
    const target = await this.connection.send("Target.createTarget", {
      url: "about:blank",
      browserContextId: contextId,
      background: false,
    });
    const attached = await this.connection.send("Target.attachToTarget", {
      targetId: target.targetId,
      flatten: true,
    });
    const page = new BrowserPage(
      this,
      target.targetId,
      attached.sessionId,
      label,
      this.timeoutMs,
    );
    this.pages.add(page);
    await page.initialize(viewport);
    return page;
  }

  async dispose() {
    for (const page of [...this.pages]) {
      try {
        await page.close();
      } catch {
        // Disposing the containing browser context will close leftovers.
      }
    }
    for (const contextId of [...this.contextIds]) {
      try {
        await this.connection.send("Target.disposeBrowserContext", {
          browserContextId: contextId,
        });
      } catch {
        // Chrome may already be closing.
      }
      this.contextIds.delete(contextId);
    }
  }
}

async function verifyHealth(baseUrl, timeoutMs) {
  const payload = await fetchJson(`${baseUrl}/api/health`, timeoutMs);
  const keys =
    typeof payload === "object" && payload !== null
      ? Object.keys(payload).sort()
      : [];
  assertCondition(
    keys.length === 2 &&
      keys[0] === "service" &&
      keys[1] === "status" &&
      payload.service === "drawing-game-server" &&
      payload.status === "ok",
    "The /api/health response is not the expected healthy payload.",
  );
}

function playerById(room, playerId) {
  return room.players.find((player) => player.id === playerId);
}

function assertNoDuplicatePlayers(room, expectedCount, description) {
  assertCondition(
    room.playerCount === expectedCount &&
      room.players.length === expectedCount,
    `${description} has an unexpected player count.`,
  );
  assertCondition(
    new Set(room.players.map((player) => player.id)).size === expectedCount,
    `${description} contains a duplicated player.`,
  );
}

async function createRoom(page, nickname) {
  await page.navigate(page.controller.baseUrl);
  await page.waitForSelector("#nickname", "home nickname input");
  await page.waitForSocketWebSocket();
  await page.setInput("#nickname", nickname);
  await page.clickButton("Créer une partie");
  await page.waitForSelector(".lobby", "host lobby");
  const state = await page.waitForRoomState(
    (room) => room.playerCount === 1,
    "one-player lobby",
  );
  const storage = await page.getStorageSnapshot();
  assertCondition(
    storage?.session?.roomCode === state.code &&
      typeof storage.session.playerId === "string",
    "The host session was not persisted after room creation.",
  );
  assertCondition(
    UUID_V4_PATTERN.test(storage.clientInstanceId ?? ""),
    "The host clientInstanceId is missing or invalid.",
  );
  return { state, storage };
}

async function joinRoom(page, baseUrl, nickname, roomCode, expectedCount) {
  const joinUrl = new URL(baseUrl);
  joinUrl.searchParams.set("room", roomCode);
  await page.navigate(joinUrl.href);
  await page.waitForSelector("#nickname", `${nickname} nickname input`);
  await page.waitForSocketWebSocket();
  await page.setInput("#nickname", nickname);
  await page.setInput("#room-code", roomCode);
  await page.clickButton("Rejoindre la partie");
  await page.waitForSelector(".lobby", `${nickname} lobby`);
  const state = await page.waitForRoomState(
    (room) => room.code === roomCode && room.playerCount === expectedCount,
    `${expectedCount}-player lobby`,
  );
  const storage = await page.getStorageSnapshot();
  assertCondition(
    storage?.session?.roomCode === roomCode &&
      typeof storage.session.playerId === "string",
    `${nickname}'s session was not persisted after joining.`,
  );
  assertCondition(
    UUID_V4_PATTERN.test(storage.clientInstanceId ?? ""),
    `${nickname}'s clientInstanceId is missing or invalid.`,
  );
  return { state, storage };
}

async function setPlayerReady(page, observer, nickname) {
  await page.clickButton("Je suis prêt");
  await observer.waitForRoomState(
    (room) =>
      room.players.some(
        (player) => player.nickname === nickname && player.isReady,
      ),
    `${nickname} ready state`,
  );
}

function rgbIsNear(actual, expected, tolerance = 4) {
  return (
    Array.isArray(actual) &&
    actual.length === 4 &&
    actual.slice(0, 3).every(
      (channel, index) =>
        Math.abs(channel - expected[index]) <= tolerance,
    ) &&
    actual[3] === 255
  );
}

async function waitForPhaseAcrossClients(
  pages,
  phase,
  turnNumber,
  description,
) {
  const states = await Promise.all(
    pages.map((page) =>
      page.waitForRoomState(
        (room) =>
          room.game?.phase === phase &&
          (turnNumber === null ||
            room.game.currentTurnNumber === turnNumber),
        description,
      ),
    ),
  );
  return states[0];
}

async function assertToolSelected(page, ariaLabel) {
  const selected = await page.evaluate(`(() => {
    const button = document.querySelector(
      ${JSON.stringify(`button[aria-label="${ariaLabel}"]`)},
    );
    return (
      button instanceof HTMLButtonElement &&
      button.getAttribute("aria-pressed") === "true"
    );
  })()`);
  assertCondition(
    selected === true,
    `${page.label}'s ${ariaLabel} drawing tool was not selected.`,
  );
}

async function exerciseDetailedDrawingTurn({
  drawerPage,
  phaseObserver,
  screenshotDirectory,
}) {
  await drawerPage.setViewport(DESKTOP_VIEWPORT);
  await drawerPage.waitForSelector(".drawing-canvas", "drawer canvas");

  await drawerPage.clickAccessibleButton("Stylo");
  await assertToolSelected(drawerPage, "Stylo");
  await drawerPage.clickAccessibleButton("Couleur Noir");
  await drawerPage.drawNormalizedPath(".drawing-canvas", [
    [0.3, 0.3],
    [0.7, 0.3],
    [0.7, 0.7],
    [0.3, 0.7],
    [0.3, 0.3],
  ]);

  const sampleBeforeFill = await drawerPage.sampleCanvas(0.5, 0.5);
  assertCondition(
    rgbIsNear(sampleBeforeFill, [255, 255, 255]),
    "The closed test shape was not white before using the bucket.",
  );

  await drawerPage.clickAccessibleButton("Pot de peinture");
  await assertToolSelected(drawerPage, "Pot de peinture");
  await drawerPage.clickAccessibleButton("Couleur Jaune");
  await drawerPage.clickElementAt(".drawing-canvas", 0.5, 0.5);
  const sampleAfterFill = await waitUntil(
    async () => {
      const sample = await drawerPage.sampleCanvas(0.5, 0.5);
      return rgbIsNear(sample, [253, 216, 53], 6) ? sample : false;
    },
    "a yellow bucket fill inside the closed shape",
    drawerPage.timeoutMs,
    () => drawerPage.diagnostics(),
  );

  await drawerPage.clickAccessibleButton("Gomme");
  await assertToolSelected(drawerPage, "Gomme");
  await drawerPage.drawNormalizedPath(".drawing-canvas", [
    [0.27, 0.5],
    [0.33, 0.5],
  ]);
  const sampleAfterEraser = await waitUntil(
    async () => {
      const sample = await drawerPage.sampleCanvas(0.3, 0.5);
      return rgbIsNear(sample, [255, 255, 255]) ? sample : false;
    },
    "a white gap created by the eraser",
    drawerPage.timeoutMs,
    () => drawerPage.diagnostics(),
  );
  await drawerPage.clickAccessibleButton("Annuler");
  const sampleAfterUndo = await waitUntil(
    async () => {
      const sample = await drawerPage.sampleCanvas(0.3, 0.5);
      return rgbIsNear(sample, [17, 17, 17]) ? sample : false;
    },
    "the erased outline restored by undo",
    drawerPage.timeoutMs,
    () => drawerPage.diagnostics(),
  );
  const undoPreservedDrawing = await drawerPage.evaluate(`(() => {
    const clear = document.querySelector(
      "button[aria-label='Tout effacer']",
    );
    const actionCount =
      document.querySelector(".drawing-editor-heading > p")
        ?.textContent?.replace(/\\s+/gu, " ")
        .trim() ?? "";
    return {
      clearEnabled:
        clear instanceof HTMLButtonElement && !clear.disabled,
      actionCount,
    };
  })()`);
  assertCondition(
    undoPreservedDrawing?.clearEnabled === true &&
      /^2 actions?$/u.test(undoPreservedDrawing.actionCount),
    "Undo did not remove only the last eraser action.",
  );

  await drawerPage.clickAccessibleButton("Tout effacer");
  const clearDialogChecks = [];
  for (const viewport of VIEWPORTS) {
    await drawerPage.setViewport(viewport);
    clearDialogChecks.push({
      viewport: `${viewport.width}x${viewport.height}`,
      ...(await drawerPage.inspectDialog({
        title: "Tout effacer ?",
        confirmLabel: "Tout effacer",
        cancelLabel: "Garder mon dessin",
      })),
    });
  }
  await drawerPage.setViewport(DESKTOP_VIEWPORT);
  const clearDialogScreenshot = await drawerPage.captureScreenshot(
    join(screenshotDirectory, "drawing-clear-dialog.png"),
  );
  await drawerPage.clickAccessibleButton(
    "Garder mon dessin",
    DIALOG_SELECTOR,
  );
  await drawerPage.waitForNoSelector(
    DIALOG_SELECTOR,
    "cancelled clear dialog",
  );
  assertCondition(
    phaseObserver.latestRoomState?.game?.phase === "DRAWING",
    "Cancelling the clear dialog changed the game phase.",
  );

  const stateAfterClearCancel = await drawerPage.evaluate(`(() => ({
    actionCount:
      document.querySelector(".drawing-editor-heading > p")
        ?.textContent?.replace(/\\s+/gu, " ")
        .trim() ?? "",
    focusedLabel:
      document.activeElement instanceof HTMLButtonElement
        ? document.activeElement.getAttribute("aria-label")
        : null,
  }))()`);
  assertCondition(
    /^2 actions?$/u.test(stateAfterClearCancel?.actionCount ?? "") &&
      stateAfterClearCancel?.focusedLabel === "Tout effacer",
    "Cancelling the clear dialog changed the drawing or lost its trigger focus.",
  );

  await drawerPage.clickAccessibleButton("Tout effacer");
  await drawerPage.inspectDialog({
    title: "Tout effacer ?",
    confirmLabel: "Tout effacer",
    cancelLabel: "Garder mon dessin",
  });
  await drawerPage.clickAccessibleButton(
    "Tout effacer",
    DIALOG_SELECTOR,
  );
  await drawerPage.waitForNoSelector(
    DIALOG_SELECTOR,
    "confirmed clear dialog",
  );
  const clearResult = await drawerPage.evaluate(`(() => {
    const actionCount =
      document.querySelector(".drawing-editor-heading > p")
        ?.textContent?.replace(/\\s+/gu, " ")
        .trim() ?? "";
    const submit = document.querySelector(".drawing-submit-button");
    return {
      actionCount,
      submitDisabled:
        submit instanceof HTMLButtonElement && submit.disabled,
      focusFallback:
        document.activeElement instanceof HTMLElement &&
        document.activeElement.classList.contains("game-phase-layout"),
    };
  })()`);
  assertCondition(
    clearResult?.actionCount === "0 action" &&
      clearResult.submitDisabled === true &&
      clearResult.focusFallback === true,
    "Confirming clear did not empty the drawing, disable submission, or preserve a logical focus target.",
  );

  await drawerPage.clickAccessibleButton("Stylo");
  await drawerPage.clickAccessibleButton("Couleur Violet");
  await drawerPage.drawNormalizedPath(".drawing-canvas", [
    [0.2, 0.3],
    [0.5, 0.55],
    [0.8, 0.7],
  ]);

  await drawerPage.clickAccessibleButton("Valider le dessin");
  const submitDialogCheck = await drawerPage.inspectDialog({
    title: "Valider le dessin ?",
    confirmLabel: "Valider mon dessin",
    cancelLabel: "Continuer \u00e0 dessiner",
  });
  await drawerPage.pressKey("Escape");
  await drawerPage.waitForNoSelector(
    DIALOG_SELECTOR,
    "drawing submission dialog after Escape",
  );
  assertCondition(
    phaseObserver.latestRoomState?.game?.phase === "DRAWING",
    "Pressing Escape in the drawing dialog changed the game phase.",
  );

  await drawerPage.clickAccessibleButton("Valider le dessin");
  await drawerPage.inspectDialog({
    title: "Valider le dessin ?",
    confirmLabel: "Valider mon dessin",
    cancelLabel: "Continuer \u00e0 dessiner",
  });
  await drawerPage.clickAccessibleButton(
    "Valider mon dessin",
    DIALOG_SELECTOR,
  );

  return {
    sampleBeforeFill,
    sampleAfterFill,
    sampleAfterEraser,
    sampleAfterUndo,
    clearDialogChecks,
    clearResult,
    submitDialogCheck,
    clearDialogScreenshot,
  };
}

async function submitSimpleDrawing(drawerPage) {
  await drawerPage.setViewport(DESKTOP_VIEWPORT);
  await drawerPage.waitForSelector(".drawing-canvas", "drawer canvas");
  await drawerPage.clickAccessibleButton("Stylo");
  await drawerPage.clickAccessibleButton("Couleur Bleu");
  await drawerPage.drawNormalizedPath(".drawing-canvas", [
    [0.2, 0.25],
    [0.42, 0.48],
    [0.8, 0.72],
  ]);
  await drawerPage.clickAccessibleButton("Valider le dessin");
  await drawerPage.inspectDialog({
    title: "Valider le dessin ?",
    confirmLabel: "Valider mon dessin",
    cancelLabel: "Continuer \u00e0 dessiner",
  });
  await drawerPage.clickAccessibleButton(
    "Valider mon dessin",
    DIALOG_SELECTOR,
  );
}

async function submitTurnGuesses({
  phaseObserver,
  pagesByPlayerId,
  roomState,
  turnNumber,
  shouldTestCancellation,
}) {
  const drawerId = roomState.game.currentDrawer.id;
  const voters = roomState.players.filter(
    (player) => player.id !== drawerId,
  );
  let cancellationTested = false;
  let guessDialogCheck = null;

  for (const [voterIndex, voter] of voters.entries()) {
    const voterPage = pagesByPlayerId.get(voter.id);
    assertCondition(
      voterPage !== undefined,
      `No real browser page is mapped to voter ${voter.id}.`,
    );
    await voterPage.setViewport(DESKTOP_VIEWPORT);
    await voterPage.waitForSelector(
      ".guess-scale",
      `${voter.nickname}'s guess scale`,
    );
    const guessValue = ((turnNumber + voterIndex * 3) % 10) + 1;
    await voterPage.clickAccessibleButton(
      `Choisir ${guessValue} sur 10`,
    );

    const previousSubmittedCount =
      phaseObserver.latestRoomState?.game?.voting
        ?.submittedGuessCount ?? voterIndex;
    await voterPage.clickAccessibleButton("Valider mon estimation");
    const valueLabel =
      `Estimation choisie : ${guessValue} sur 10`;
    const currentDialogCheck = await voterPage.inspectDialog({
      title: "Valider votre estimation ?",
      confirmLabel: "Valider mon estimation",
      cancelLabel: "Modifier mon choix",
      valueLabel,
    });
    guessDialogCheck ??= currentDialogCheck;

    if (shouldTestCancellation && !cancellationTested) {
      await voterPage.clickAccessibleButton(
        "Modifier mon choix",
        DIALOG_SELECTOR,
      );
      await voterPage.waitForNoSelector(
        DIALOG_SELECTOR,
        "cancelled guess dialog",
      );
      await delay(100);
      assertCondition(
        phaseObserver.latestRoomState?.game?.phase === "VOTING" &&
          phaseObserver.latestRoomState.game.voting
            ?.submittedGuessCount === previousSubmittedCount,
        "Cancelling the guess dialog submitted a guess or changed the phase.",
      );
      cancellationTested = true;
      await voterPage.clickAccessibleButton("Valider mon estimation");
      await voterPage.inspectDialog({
        title: "Valider votre estimation ?",
        confirmLabel: "Valider mon estimation",
        cancelLabel: "Modifier mon choix",
        valueLabel,
      });
    }

    await voterPage.clickAccessibleButton(
      "Valider mon estimation",
      DIALOG_SELECTOR,
    );

    if (voterIndex < voters.length - 1) {
      await phaseObserver.waitForRoomState(
        (room) =>
          room.game?.phase === "VOTING" &&
          room.game.currentTurnNumber === turnNumber &&
          room.game.voting?.submittedGuessCount ===
            previousSubmittedCount + 1,
        `guess ${voterIndex + 1} of turn ${turnNumber}`,
      );
    }
  }

  await phaseObserver.waitForRoomState(
    (room) =>
      room.game?.phase === "REVEAL" &&
      room.game.currentTurnNumber === turnNumber,
    `reveal after all guesses in turn ${turnNumber}`,
  );

  return {
    cancellationTested,
    guessDialogCheck,
  };
}

async function runUiScenario({
  hostPage,
  pagesByPlayerId,
  screenshotDirectory,
  promptHeaderCases,
}) {
  const pages = [...pagesByPlayerId.values()];
  assertCondition(
    pages.length === 3 &&
      new Set(pages).size === 3 &&
      pages.includes(hostPage),
    "The production UI scenario did not map three distinct playerIds to browser pages.",
  );

  await Promise.all(
    pages.map((page) => page.installNativeConfirmGuard()),
  );

  const firstDrawingState = await waitForPhaseAcrossClients(
    pages,
    "DRAWING",
    1,
    "first drawing phase",
  );
  assertCondition(
    firstDrawingState.game.totalTurns === 6 &&
      firstDrawingState.game.totalRounds === 2,
    "The three-player production scenario is not the expected six-turn game.",
  );

  const screenshotPaths = [];
  const drawingVisualChecks = [];
  const promptHeaderVisualChecks = [];
  const completedTurnIds = new Set();
  let detailedDrawingCheck = null;
  let guessDialogCheck = null;
  let guessCancellationTested = false;

  for (
    let turnNumber = 1;
    turnNumber <= firstDrawingState.game.totalTurns;
    turnNumber += 1
  ) {
    const drawingState = await waitForPhaseAcrossClients(
      pages,
      "DRAWING",
      turnNumber,
      `drawing phase for turn ${turnNumber}`,
    );
    const drawerId = drawingState.game.currentDrawer.id;
    const drawerPage = pagesByPlayerId.get(drawerId);
    const observerPage = pages.find(
      (candidate) => candidate !== drawerPage,
    );
    assertCondition(
      drawerPage !== undefined && observerPage !== undefined,
      `Turn ${turnNumber} has no mapped drawer or observer page.`,
    );
    completedTurnIds.add(drawingState.game.turnId);
    await drawerPage.waitForSelector(
      ".drawing-canvas",
      `drawing editor for turn ${turnNumber}`,
    );
    await observerPage.waitForSelector(
      ".drawing-observer-stage",
      `waiting stage for turn ${turnNumber}`,
    );

    if (turnNumber === 1) {
      for (const prompt of promptHeaderCases) {
        for (const viewport of PROMPT_HEADER_VIEWPORTS) {
          promptHeaderVisualChecks.push(
            await drawerPage.inspectPromptHeaderLayout(
              viewport,
              prompt,
            ),
          );
        }
      }

      for (const viewport of VIEWPORTS) {
        const waiting = await observerPage.inspectWaitingLayout(
          viewport,
        );
        const editor = await drawerPage.inspectDrawingLayout(viewport);
        assertCondition(
          Math.abs(waiting.width - editor.width) <= 2 &&
            (viewport.width < 900 ||
              Math.abs(waiting.height - editor.height) <=
                Math.max(24, editor.height * 0.12)),
          `The drawing and waiting stages are not harmonized at ${viewport.width}x${viewport.height}: waiting ${waiting.width}x${waiting.height}, canvas ${editor.width}x${editor.height}.`,
        );
        drawingVisualChecks.push({
          viewport: waiting.viewport,
          waiting,
          editor,
        });
      }

      await observerPage.setViewport(DESKTOP_VIEWPORT);
      await drawerPage.setViewport(DESKTOP_VIEWPORT);
      screenshotPaths.push(
        await observerPage.captureScreenshot(
          join(screenshotDirectory, "drawing-waiting.png"),
        ),
      );
      screenshotPaths.push(
        await drawerPage.captureScreenshot(
          join(screenshotDirectory, "drawing-editor.png"),
        ),
      );
      detailedDrawingCheck = await exerciseDetailedDrawingTurn({
        drawerPage,
        phaseObserver: hostPage,
        screenshotDirectory,
      });
      screenshotPaths.push(
        detailedDrawingCheck.clearDialogScreenshot,
      );
    } else {
      await submitSimpleDrawing(drawerPage);
    }

    const votingState = await waitForPhaseAcrossClients(
      pages,
      "VOTING",
      turnNumber,
      `voting phase for turn ${turnNumber}`,
    );
    const voteCheck = await submitTurnGuesses({
      phaseObserver: hostPage,
      pagesByPlayerId,
      roomState: votingState,
      turnNumber,
      shouldTestCancellation: !guessCancellationTested,
    });
    guessCancellationTested ||= voteCheck.cancellationTested;
    guessDialogCheck ??= voteCheck.guessDialogCheck;

    await waitForPhaseAcrossClients(
      pages,
      "REVEAL",
      turnNumber,
      `reveal phase for turn ${turnNumber}`,
    );
    await hostPage.setViewport(DESKTOP_VIEWPORT);
    await hostPage.waitForSelector(
      ".reveal-continue-button",
      `host continuation for turn ${turnNumber}`,
    );
    await hostPage.clickElementAt(".reveal-continue-button");

    if (turnNumber < firstDrawingState.game.totalTurns) {
      await hostPage.waitForRoomState(
        (room) =>
          room.game?.phase === "ROUND_INTRO" &&
          room.game.currentTurnNumber === turnNumber + 1,
        `round introduction after turn ${turnNumber}`,
      );
    }
  }

  const finishedRoom = await waitForPhaseAcrossClients(
    pages,
    "FINISHED",
    firstDrawingState.game.totalTurns,
    "finished phase",
  );
  const finished = finishedRoom.game.finished;
  assertCondition(
    finished !== null &&
      finished.completedTurns === 6 &&
      finished.completedRounds === 2,
    "The final state does not report all six completed turns.",
  );
  const finishedVisualChecks = [];
  for (const viewport of VIEWPORTS) {
    finishedVisualChecks.push(
      await hostPage.inspectFinishedLayout(
        viewport,
        finished.leaderboard,
      ),
    );
  }
  await hostPage.setViewport(DESKTOP_VIEWPORT);
  screenshotPaths.push(
    await hostPage.captureScreenshot(
      join(screenshotDirectory, "finished-podium.png"),
    ),
  );

  for (const [playerId, page] of pagesByPlayerId) {
    const actions = await page.evaluate(`(() => {
      const leave = document.querySelector(
        ".finished-actions .game-sidebar-leave button",
      );
      const rematch = document.querySelector(
        ".finished-rematch-button",
      );
      return {
        leaveEnabled:
          leave instanceof HTMLButtonElement && !leave.disabled,
        hasRematch: rematch instanceof HTMLButtonElement,
        rematchEnabled:
          rematch instanceof HTMLButtonElement && !rematch.disabled,
      };
    })()`);
    const isHost =
      finishedRoom.players.find((player) => player.id === playerId)
        ?.isHost === true;
    assertCondition(
      actions?.leaveEnabled === true &&
        (isHost
          ? actions.hasRematch && actions.rematchEnabled
          : !actions.hasRematch),
      `${page.label}'s final rematch or leave actions are incorrect.`,
    );
  }

  const nativeConfirmCalls = Object.fromEntries(
    await Promise.all(
      [...pagesByPlayerId].map(async ([playerId, page]) => [
        playerId,
        await page.getNativeConfirmCallCount(),
      ]),
    ),
  );
  assertCondition(
    Object.values(nativeConfirmCalls).every((count) => count === 0),
    "A drawing or guessing flow invoked window.confirm.",
  );
  assertCondition(
    completedTurnIds.size === 6 && guessCancellationTested,
    "The UI scenario did not complete six distinct turns or its guess cancellation check.",
  );

  return {
    playerPages: Object.fromEntries(
      [...pagesByPlayerId].map(([playerId, page]) => [
        playerId,
        page.label,
      ]),
    ),
    totalTurnsCompleted: completedTurnIds.size,
    nativeConfirmCalls,
    drawingVisualChecks,
    promptHeaderVisualChecks,
    detailedDrawingCheck,
    guessDialogCheck,
    guessCancellationTested,
    finishedVisualChecks,
    finalLeaderboard: finished.leaderboard,
    screenshotDirectory,
    screenshotPaths,
  };
}

async function runBrowserScenario(
  controller,
  baseUrl,
  promptHeaderCases,
) {
  controller.baseUrl = baseUrl;
  const hostContext = await controller.createContext();
  const guestOneContext = await controller.createContext();
  const guestTwoContext = await controller.createContext();
  const host = await controller.createPage(hostContext, "host");
  const guestOne = await controller.createPage(
    guestOneContext,
    "guest one",
  );
  const guestTwo = await controller.createPage(
    guestTwoContext,
    "guest two",
  );

  const hostCreated = await createRoom(host, "HostBrowserCheck");
  const roomCode = hostCreated.state.code;
  const hostPlayerId = hostCreated.storage.session.playerId;
  const guestOneJoined = await joinRoom(
    guestOne,
    baseUrl,
    "GuestOneCheck",
    roomCode,
    2,
  );
  const guestTwoJoined = await joinRoom(
    guestTwo,
    baseUrl,
    "GuestTwoCheck",
    roomCode,
    3,
  );
  const threePlayers = await host.waitForRoomState(
    (room) => room.code === roomCode && room.playerCount === 3,
    "three-player host lobby",
  );
  assertNoDuplicatePlayers(threePlayers, 3, "The initial lobby");

  await setPlayerReady(host, host, "HostBrowserCheck");
  await setPlayerReady(guestOne, host, "GuestOneCheck");
  await setPlayerReady(guestTwo, host, "GuestTwoCheck");
  await host.waitForButton("Lancer la partie", true);
  await host.clickButton("Lancer la partie");
  const beforeReload = structuredClone(
    await host.waitForRoomState(
      (room) => room.code === roomCode && room.game !== null,
      "active game before host reload",
    ),
  );
  await host.waitForSelector(".app-shell--active", "active game screen");
  assertNoDuplicatePlayers(beforeReload, 3, "The active game");
  assertCondition(
    beforeReload.game?.gameId !== undefined &&
      beforeReload.game?.turnId !== undefined,
    "The game did not expose its gameId and turnId before reload.",
  );

  const hostInstanceBeforeReload =
    hostCreated.storage.clientInstanceId;
  guestOne.latestRoomState = null;
  await host.reload();
  const afterReload = await guestOne.waitForRoomState(
    (room) =>
      room.code === roomCode &&
      playerById(room, hostPlayerId)?.isConnected === true &&
      room.game !== null,
    "restored host state after reload",
  );
  await host.waitForSelector(".app-shell--active", "restored game screen");
  await host.waitForNoSelector(
    ".connection-recovery-overlay",
    "host recovery overlay",
  );
  const hostStorageAfterReload = await host.getStorageSnapshot();
  const restoredHost = playerById(afterReload, hostPlayerId);
  assertNoDuplicatePlayers(afterReload, 3, "The reloaded game");
  assertCondition(
    hostStorageAfterReload.clientInstanceId ===
      hostInstanceBeforeReload,
    "Reloading the same target changed its clientInstanceId.",
  );
  assertCondition(
    restoredHost?.isHost === true &&
      restoredHost.score === playerById(beforeReload, hostPlayerId)?.score,
    "The restored host lost its role or score.",
  );
  assertCondition(
    afterReload.game?.gameId === beforeReload.game?.gameId &&
      afterReload.game?.turnId === beforeReload.game?.turnId,
    "Reloading the host changed the active game or turn.",
  );

  const secondTab = await controller.createPage(
    hostContext,
    "host second tab",
  );
  await secondTab.navigate(baseUrl);
  await secondTab.waitForSelector(
    ".connection-recovery-overlay",
    "second-tab recovery overlay",
  );
  await secondTab.waitForText(SECOND_TAB_ERROR);
  const secondTabStorage = await secondTab.getStorageSnapshot();
  assertCondition(
    secondTabStorage.session?.roomCode ===
      hostStorageAfterReload.session?.roomCode &&
      secondTabStorage.session?.playerId ===
        hostStorageAfterReload.session?.playerId &&
      secondTabStorage.session?.token ===
        hostStorageAfterReload.session?.token,
    "The real second tab did not share the host's localStorage session.",
  );
  assertCondition(
    UUID_V4_PATTERN.test(secondTabStorage.clientInstanceId ?? "") &&
      secondTabStorage.clientInstanceId !==
        hostStorageAfterReload.clientInstanceId,
    "The real second tab did not receive an independent sessionStorage clientInstanceId.",
  );
  const secondTabErrorState = await secondTab.evaluate(`(() => {
    const button = document.querySelector(".connection-recovery-retry");
    return {
      hasExpectedError: document.body.innerText.includes(
        ${JSON.stringify(SECOND_TAB_ERROR)},
      ),
      retryEnabled:
        button instanceof HTMLButtonElement &&
        !button.disabled &&
        button.getAttribute("aria-busy") === "false",
    };
  })()`);
  assertCondition(
    secondTabErrorState?.hasExpectedError === true &&
      secondTabErrorState.retryEnabled === true,
    "The real second tab did not expose an enabled manual retry.",
  );
  await delay(200);
  const hostStillActive = guestOne.latestRoomState;
  assertCondition(
    hostStillActive !== null &&
      playerById(hostStillActive, hostPlayerId)?.isConnected === true &&
      playerById(hostStillActive, hostPlayerId)?.isHost === true &&
      host.openWebSocketIds.size > 0,
    "The refused second tab broke the original host session.",
  );
  await host.waitForNoSelector(
    ".connection-recovery-overlay",
    "original host overlay after second-tab refusal",
  );

  const visualChecks = [];
  for (const viewport of VIEWPORTS) {
    visualChecks.push(
      await secondTab.inspectRecoveryOverlay(viewport),
    );
  }

  guestOne.latestRoomState = null;
  await host.close();
  await guestOne.waitForRoomState(
    (room) => playerById(room, hostPlayerId)?.isConnected === false,
    "real host disconnection before second-tab retry",
  );

  await secondTab.setViewport(VIEWPORTS[1]);
  await secondTab.setNetworkLatency(350);
  guestOne.latestRoomState = null;
  const loadingState =
    await secondTab.clickRetryAndCaptureLoadingState();
  assertCondition(
    loadingState?.clicked === true,
    "The second tab could not trigger the manual restore retry.",
  );
  assertCondition(
    loadingState.loading === true,
    "The manual retry button did not expose its disabled loading state.",
  );
  await secondTab.setNetworkLatency(0);
  const afterManualRetry = await guestOne.waitForRoomState(
    (room) =>
      room.code === roomCode &&
      playerById(room, hostPlayerId)?.isConnected === true &&
      room.game !== null,
    "successful manual restoration in the second tab",
  );
  await secondTab.waitForNoSelector(
    ".connection-recovery-overlay",
    "second-tab recovery overlay after success",
  );
  await secondTab.waitForSelector(
    ".app-shell--active",
    "restored second-tab game screen",
  );
  assertNoDuplicatePlayers(
    afterManualRetry,
    3,
    "The game after manual retry",
  );
  assertCondition(
    playerById(afterManualRetry, hostPlayerId)?.isHost === true &&
      afterManualRetry.game?.gameId === beforeReload.game?.gameId &&
      afterManualRetry.game?.turnId === beforeReload.game?.turnId,
    "The manual retry did not restore the same host and game.",
  );
  await guestOne.waitForRoomState(
    (room) => playerById(room, hostPlayerId)?.isConnected === true,
    "host reconnection broadcast after manual retry",
  );

  const guestOnePlayerId = guestOneJoined.storage.session.playerId;
  const guestTwoPlayerId = guestTwoJoined.storage.session.playerId;
  assertCondition(
    typeof guestOnePlayerId === "string" &&
      typeof guestTwoPlayerId === "string" &&
      new Set([
        hostPlayerId,
        guestOnePlayerId,
        guestTwoPlayerId,
      ]).size === 3,
    "The browser clients do not have three distinct playerIds.",
  );
  const pagesByPlayerId = new Map([
    [hostPlayerId, secondTab],
    [guestOnePlayerId, guestOne],
    [guestTwoPlayerId, guestTwo],
  ]);
  const screenshotDirectory = await mkdtemp(
    join(tmpdir(), "drawing-game-ui-check-"),
  );
  const uiChecks = await runUiScenario({
    hostPage: secondTab,
    pagesByPlayerId,
    screenshotDirectory,
    promptHeaderCases,
  });

  return {
    roomCode,
    playerCount: afterManualRetry.playerCount,
    samePlayerId: true,
    hostPreserved: true,
    gamePreserved: true,
    sameTabReloadRestored: true,
    realSecondTabRefused: true,
    manualRetryRestored: true,
    loadingStateObserved: loadingState.loading === true,
    visualChecks,
    uiChecks,
  };
}

async function main() {
  const options = parseArguments(process.argv.slice(2));
  if (options.help) {
    showHelp();
    return;
  }

  const promptHeaderCases = await loadPromptHeaderCases();
  await verifyHealth(options.baseUrl, options.timeoutMs);
  const chrome = await launchChrome(options);
  const controller = new BrowserController(
    chrome.connection,
    options.timeoutMs,
  );

  try {
    const result = await runBrowserScenario(
      controller,
      options.baseUrl,
      promptHeaderCases,
    );
    await verifyHealth(options.baseUrl, options.timeoutMs);
    console.info(
      `Production browser check passed with ${chrome.chromePath}.`,
    );
    console.info(
      JSON.stringify(
        {
          ...result,
          socketIoVerifiedBy:
            "three real browser clients and room:state WebSocket frames",
          health: "ok",
        },
        null,
        2,
      ),
    );
  } finally {
    await controller.dispose();
    await chrome.cleanup();
  }
}

try {
  await main();
} catch (error) {
  console.error(
    `Production browser check failed: ${describeError(error)}`,
  );
  process.exitCode = 1;
}
