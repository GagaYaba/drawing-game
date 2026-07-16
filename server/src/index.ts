import { createDrawingGameServer } from "./create-server.js";
import {
  DEFAULT_RECONNECT_GRACE_MS,
  isValidReconnectGraceMs,
} from "./sessions/reconnect-manager.js";

const DEFAULT_PORT = 3000;
const parsedPort = Number.parseInt(process.env.PORT ?? String(DEFAULT_PORT), 10);
const port = Number.isNaN(parsedPort) ? DEFAULT_PORT : parsedPort;
const reconnectGraceValue = process.env.PLAYER_RECONNECT_GRACE_MS;
const parsedReconnectGraceMs =
  reconnectGraceValue !== undefined && /^\d+$/u.test(reconnectGraceValue)
    ? Number(reconnectGraceValue)
    : Number.NaN;
const reconnectGraceMs =
  isValidReconnectGraceMs(parsedReconnectGraceMs)
    ? parsedReconnectGraceMs
    : DEFAULT_RECONNECT_GRACE_MS;

const { httpServer } = createDrawingGameServer({ reconnectGraceMs });

httpServer.listen(port, "0.0.0.0", () => {
  console.info(`Drawing game server listening on http://0.0.0.0:${port}`);
});
