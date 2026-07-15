import { existsSync } from "node:fs";
import { createServer } from "node:http";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import type {
  ClientToServerEvents,
  HealthResponse,
  ServerToClientEvents,
} from "@drawing-game/shared";
import { SOCKET_EVENTS } from "@drawing-game/shared";
import express from "express";
import { Server } from "socket.io";

import { GameManager } from "./game/game-manager.js";
import type { GameManagerOptions } from "./game/game-types.js";
import { RoomManager } from "./rooms/room-manager.js";
import { registerSocketHandlers } from "./socket/register-socket-handlers.js";

export interface CreateDrawingGameServerOptions {
  serveClient?: boolean;
  roomManager?: RoomManager;
  gameManagerOptions?: GameManagerOptions;
}

// A canonical 30,000-point drawing can exceed Engine.IO's 1 MB default once
// serialized with full-precision coordinates. Keep this finite and comfortably
// above the largest document allowed by the shared complexity limits.
export const MAX_SOCKET_MESSAGE_BYTES = 2_500_000;

export function createDrawingGameServer(
  options: CreateDrawingGameServerOptions = {},
) {
  const app = express();
  const httpServer = createServer(app);
  const io = new Server<ClientToServerEvents, ServerToClientEvents>(
    httpServer,
    { maxHttpBufferSize: MAX_SOCKET_MESSAGE_BYTES },
  );
  const roomManager = options.roomManager ?? new RoomManager();
  const externalRoomStateListener =
    options.gameManagerOptions?.onPublicRoomStateChanged;
  const gameManager = new GameManager(roomManager, {
    ...options.gameManagerOptions,
    onPublicRoomStateChanged: (roomCode, room) => {
      externalRoomStateListener?.(roomCode, room);
      io.to(roomCode).emit(SOCKET_EVENTS.ROOM_STATE, room);
    },
  });

  app.get("/api/health", (_request, response) => {
    const health: HealthResponse = {
      status: "ok",
      service: "drawing-game-server",
    };

    response.json(health);
  });

  app.use("/api", (_request, response) => {
    response.status(404).json({ error: "API route not found" });
  });

  registerSocketHandlers(io, roomManager, gameManager);
  httpServer.once("close", () => gameManager.dispose());

  if (options.serveClient !== false) {
    const currentDirectory = dirname(fileURLToPath(import.meta.url));
    const clientDistPath = resolve(currentDirectory, "../../client/dist");
    const clientIndexPath = resolve(clientDistPath, "index.html");

    if (existsSync(clientIndexPath)) {
      app.use(express.static(clientDistPath));

      app.use((request, response, next) => {
        const isApiRoute =
          request.path === "/api" || request.path.startsWith("/api/");
        const isSocketRoute =
          request.path === "/socket.io" ||
          request.path.startsWith("/socket.io/");
        const isFrontendRoute =
          request.method === "GET" && !isApiRoute && !isSocketRoute;

        if (!isFrontendRoute) {
          next();
          return;
        }

        response.sendFile(clientIndexPath);
      });
    }
  }

  return { app, httpServer, io, roomManager, gameManager };
}
