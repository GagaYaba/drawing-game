import { performance } from "node:perf_hooks";

export const DEFAULT_REQUEST_TIMEOUT_MS = 7_500;
export const DEFAULT_SOCKET_TIMEOUT_MS = 10_000;

export const APPLICATION_SOCKET_EVENTS = Object.freeze({
  clientPing: "client:ping",
  serverPong: "server:pong",
});

export function describeError(error) {
  return error instanceof Error ? error.message : String(error);
}

function assertTimeout(timeoutMs, label) {
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs <= 0) {
    throw new Error(`${label} must be a positive integer.`);
  }
}

export function normalizeBaseUrl(value) {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error("The deployment URL is required.");
  }

  let parsedUrl;
  try {
    parsedUrl = new URL(value.trim());
  } catch (error) {
    throw new Error(`The deployment URL is invalid: ${value}.`, {
      cause: error,
    });
  }

  if (parsedUrl.protocol !== "http:" && parsedUrl.protocol !== "https:") {
    throw new Error("The deployment URL must use http or https.");
  }
  if (parsedUrl.username.length > 0 || parsedUrl.password.length > 0) {
    throw new Error("The deployment URL must not contain credentials.");
  }

  parsedUrl.search = "";
  parsedUrl.hash = "";
  parsedUrl.pathname = parsedUrl.pathname.replace(/\/+$/u, "") || "/";

  return parsedUrl.href.replace(/\/$/u, "");
}

function applicationUrl(baseUrl, path) {
  const parsedBaseUrl = new URL(normalizeBaseUrl(baseUrl));
  const basePath =
    parsedBaseUrl.pathname === "/" ? "" : parsedBaseUrl.pathname;
  parsedBaseUrl.pathname = `${basePath}${path}`;
  return parsedBaseUrl.href;
}

function socketConnectionOptions(baseUrl, timeoutMs) {
  const parsedBaseUrl = new URL(normalizeBaseUrl(baseUrl));
  const basePath =
    parsedBaseUrl.pathname === "/" ? "" : parsedBaseUrl.pathname;

  return {
    origin: parsedBaseUrl.origin,
    options: {
      autoConnect: false,
      forceNew: true,
      path: `${basePath}/socket.io`,
      reconnection: false,
      timeout: timeoutMs,
      transports: ["websocket"],
    },
  };
}

export async function fetchText(
  url,
  {
    timeoutMs = DEFAULT_REQUEST_TIMEOUT_MS,
    label = "The request",
    fetchImplementation = globalThis.fetch,
  } = {},
) {
  assertTimeout(timeoutMs, "The request timeout");
  if (typeof fetchImplementation !== "function") {
    throw new Error("A fetch implementation is required.");
  }

  const controller = new AbortController();
  const startedAt = performance.now();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetchImplementation(url, {
      method: "GET",
      redirect: "error",
      signal: controller.signal,
    });
    const body = await response.text();

    return {
      response,
      body,
      durationMs: performance.now() - startedAt,
    };
  } catch (error) {
    if (controller.signal.aborted) {
      throw new Error(`${label} timed out after ${timeoutMs} ms.`, {
        cause: error,
      });
    }
    throw new Error(`${label} failed: ${describeError(error)}.`, {
      cause: error,
    });
  } finally {
    clearTimeout(timeout);
  }
}

export async function verifyHealth(
  baseUrl,
  {
    timeoutMs = DEFAULT_REQUEST_TIMEOUT_MS,
    fetchImplementation = globalThis.fetch,
  } = {},
) {
  const url = applicationUrl(baseUrl, "/api/health");
  const { response, body, durationMs } = await fetchText(url, {
    timeoutMs,
    label: "The health check",
    fetchImplementation,
  });

  if (response.status !== 200) {
    throw new Error(
      `The health check returned HTTP ${response.status} instead of 200.`,
    );
  }

  let payload;
  try {
    payload = JSON.parse(body);
  } catch (error) {
    throw new Error("The health check did not return valid JSON.", {
      cause: error,
    });
  }

  const keys =
    typeof payload === "object" && payload !== null
      ? Object.keys(payload).sort()
      : [];
  const isExpectedPayload =
    keys.length === 2 &&
    keys[0] === "service" &&
    keys[1] === "status" &&
    payload.status === "ok" &&
    payload.service === "drawing-game-server";

  if (!isExpectedPayload) {
    throw new Error(
      `The health check returned an unexpected payload: ${JSON.stringify(
        payload,
      )}.`,
    );
  }

  return {
    url,
    status: response.status,
    payload,
    durationMs,
  };
}

export async function verifyFrontend(
  baseUrl,
  {
    timeoutMs = DEFAULT_REQUEST_TIMEOUT_MS,
    fetchImplementation = globalThis.fetch,
  } = {},
) {
  const url = applicationUrl(baseUrl, "/");
  const { response, body, durationMs } = await fetchText(url, {
    timeoutMs,
    label: "The frontend request",
    fetchImplementation,
  });

  if (response.status !== 200) {
    throw new Error(
      `The frontend returned HTTP ${response.status} instead of 200.`,
    );
  }

  const contentType = response.headers.get("content-type")?.toLowerCase() ?? "";
  const hasRootElement = /<div[^>]*\bid=["']root["'][^>]*>/iu.test(body);
  const hasModuleScript =
    /<script[^>]*\btype=["']module["'][^>]*>/iu.test(body);
  const hasBuiltAsset = /\/assets\/[^"'\s>]+\.js\b/iu.test(body);

  if (
    !contentType.includes("text/html") ||
    !hasRootElement ||
    !hasModuleScript ||
    !hasBuiltAsset
  ) {
    throw new Error(
      "The frontend response is not the expected built Vite HTML document.",
    );
  }

  return {
    url,
    status: response.status,
    contentType,
    bodyBytes: Buffer.byteLength(body, "utf8"),
    durationMs,
  };
}

export async function connectSocket(
  baseUrl,
  {
    timeoutMs = DEFAULT_SOCKET_TIMEOUT_MS,
    createSocketClient,
  } = {},
) {
  assertTimeout(timeoutMs, "The Socket.IO connection timeout");
  const socketFactory =
    createSocketClient ?? (await import("socket.io-client")).io;
  if (typeof socketFactory !== "function") {
    throw new Error("A Socket.IO client factory is required.");
  }

  const connection = socketConnectionOptions(baseUrl, timeoutMs);
  const socket = socketFactory(connection.origin, connection.options);
  const startedAt = performance.now();

  try {
    await new Promise((resolvePromise, rejectPromise) => {
      let settled = false;
      const timeout = setTimeout(() => {
        settle(
          rejectPromise,
          new Error(
            `The Socket.IO client did not connect within ${timeoutMs} ms.`,
          ),
        );
      }, timeoutMs);

      const cleanup = () => {
        clearTimeout(timeout);
        socket.off("connect", handleConnect);
        socket.off("connect_error", handleConnectError);
      };
      const settle = (settler, value) => {
        if (settled) {
          return;
        }
        settled = true;
        cleanup();
        settler(value);
      };
      const handleConnect = () => settle(resolvePromise);
      const handleConnectError = (error) => {
        settle(
          rejectPromise,
          new Error(
            `The Socket.IO websocket connection failed: ${describeError(
              error,
            )}.`,
            { cause: error },
          ),
        );
      };

      socket.once("connect", handleConnect);
      socket.once("connect_error", handleConnectError);
      socket.connect();
    });
  } catch (error) {
    closeSocket(socket);
    throw error;
  }

  return {
    socket,
    durationMs: performance.now() - startedAt,
    transport: socket.io?.engine?.transport?.name ?? null,
  };
}

export async function pingSocket(
  socket,
  { timeoutMs = DEFAULT_SOCKET_TIMEOUT_MS } = {},
) {
  assertTimeout(timeoutMs, "The Socket.IO ping timeout");
  if (socket === null || typeof socket !== "object") {
    throw new Error("A Socket.IO socket is required.");
  }
  if (socket.connected !== true) {
    throw new Error("The Socket.IO socket is not connected.");
  }

  const sentAt = Date.now();
  const startedAt = performance.now();
  const pong = await new Promise((resolvePromise, rejectPromise) => {
    let settled = false;
    const timeout = setTimeout(() => {
      settle(
        rejectPromise,
        new Error(`The server:pong event was not received within ${timeoutMs} ms.`),
      );
    }, timeoutMs);

    const cleanup = () => {
      clearTimeout(timeout);
      socket.off(APPLICATION_SOCKET_EVENTS.serverPong, handlePong);
      socket.off("disconnect", handleDisconnect);
    };
    const settle = (settler, value) => {
      if (settled) {
        return;
      }
      settled = true;
      cleanup();
      settler(value);
    };
    const handlePong = (payload) => settle(resolvePromise, payload);
    const handleDisconnect = (reason) => {
      settle(
        rejectPromise,
        new Error(
          `The Socket.IO client disconnected before server:pong (${reason}).`,
        ),
      );
    };

    socket.once(APPLICATION_SOCKET_EVENTS.serverPong, handlePong);
    socket.once("disconnect", handleDisconnect);
    socket.emit(APPLICATION_SOCKET_EVENTS.clientPing, { sentAt });
  });
  const durationMs = performance.now() - startedAt;

  const isValidPong =
    typeof pong === "object" &&
    pong !== null &&
    pong.sentAt === sentAt &&
    typeof pong.receivedAt === "number" &&
    Number.isFinite(pong.receivedAt);
  if (!isValidPong) {
    throw new Error("The server:pong event returned an invalid payload.");
  }

  return {
    sentAt,
    receivedAt: pong.receivedAt,
    durationMs,
  };
}

export function closeSocket(socket) {
  const startedAt = performance.now();
  const wasConnected = socket?.connected === true;

  if (socket !== null && typeof socket === "object") {
    socket.removeAllListeners?.();
    socket.disconnect?.();
    socket.io?.removeAllListeners?.();
  }

  return {
    wasConnected,
    durationMs: performance.now() - startedAt,
  };
}

export async function verifySocketPing(
  baseUrl,
  {
    timeoutMs = DEFAULT_SOCKET_TIMEOUT_MS,
    createSocketClient,
  } = {},
) {
  const startedAt = performance.now();
  const connection = await connectSocket(baseUrl, {
    timeoutMs,
    createSocketClient,
  });

  let ping;
  let close;
  try {
    ping = await pingSocket(connection.socket, { timeoutMs });
  } finally {
    close = closeSocket(connection.socket);
  }

  return {
    connectionDurationMs: connection.durationMs,
    pingDurationMs: ping.durationMs,
    closeDurationMs: close.durationMs,
    durationMs: performance.now() - startedAt,
    transport: connection.transport,
    sentAt: ping.sentAt,
    receivedAt: ping.receivedAt,
  };
}
