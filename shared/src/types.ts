import { SOCKET_EVENTS } from "./events.js";

export interface ClientPingPayload {
  sentAt: number;
}

export interface ServerPongPayload {
  sentAt: number;
  receivedAt: number;
}

export interface ClientToServerEvents {
  [SOCKET_EVENTS.CLIENT_PING]: (payload: ClientPingPayload) => void;
}

export interface ServerToClientEvents {
  [SOCKET_EVENTS.SERVER_PONG]: (payload: ServerPongPayload) => void;
}

export interface HealthResponse {
  status: "ok";
  service: "drawing-game-server";
}
