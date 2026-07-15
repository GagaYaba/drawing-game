import { createDrawingGameServer } from "./create-server.js";

const DEFAULT_PORT = 3000;
const parsedPort = Number.parseInt(process.env.PORT ?? String(DEFAULT_PORT), 10);
const port = Number.isNaN(parsedPort) ? DEFAULT_PORT : parsedPort;

const { httpServer } = createDrawingGameServer();

httpServer.listen(port, "0.0.0.0", () => {
  console.info(`Drawing game server listening on http://0.0.0.0:${port}`);
});
