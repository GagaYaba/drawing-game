import { existsSync } from "node:fs";
import { createServer } from "node:http";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  SOCKET_EVENTS,
  type ClientToServerEvents,
  type HealthResponse,
  type ServerToClientEvents,
} from "@drawing-game/shared";
import express from "express";
import { Server } from "socket.io";

const DEFAULT_PORT = 3000;
const parsedPort = Number.parseInt(process.env.PORT ?? String(DEFAULT_PORT), 10);
const port = Number.isNaN(parsedPort) ? DEFAULT_PORT : parsedPort;

const app = express();
const httpServer = createServer(app);
const io = new Server<ClientToServerEvents, ServerToClientEvents>(httpServer);

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

io.on("connection", (socket) => {
  console.info(`[socket] Client connected: ${socket.id}`);

  socket.on(SOCKET_EVENTS.CLIENT_PING, (payload) => {
    socket.emit(SOCKET_EVENTS.SERVER_PONG, {
      sentAt: payload.sentAt,
      receivedAt: Date.now(),
    });
  });

  socket.on("disconnect", (reason) => {
    console.info(`[socket] Client disconnected: ${socket.id} (${reason})`);
  });
});

const currentDirectory = dirname(fileURLToPath(import.meta.url));
const clientDistPath = resolve(currentDirectory, "../../client/dist");
const clientIndexPath = resolve(clientDistPath, "index.html");

if (existsSync(clientIndexPath)) {
  app.use(express.static(clientDistPath));

  app.use((request, response, next) => {
    const isApiRoute =
      request.path === "/api" || request.path.startsWith("/api/");
    const isSocketRoute =
      request.path === "/socket.io" || request.path.startsWith("/socket.io/");
    const isFrontendRoute =
      request.method === "GET" &&
      !isApiRoute &&
      !isSocketRoute;

    if (!isFrontendRoute) {
      next();
      return;
    }

    response.sendFile(clientIndexPath);
  });
}

httpServer.listen(port, "0.0.0.0", () => {
  console.info(`Drawing game server listening on http://0.0.0.0:${port}`);
});
