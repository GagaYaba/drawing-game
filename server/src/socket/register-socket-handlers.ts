import {
  SOCKET_EVENTS,
  type ActionAcknowledgement,
  type ActionResult,
  type ClientPingPayload,
  type ClientToServerEvents,
  type PublicRoomState,
  type RoomSessionData,
  type ServerToClientEvents,
  type StartGameSuccessData,
  type SubmitDrawingSuccessData,
} from "@drawing-game/shared";
import type { Server } from "socket.io";

import { GameManager } from "../game/game-manager.js";
import { RoomManager, RoomManagerError } from "../rooms/room-manager.js";
import {
  validateCreateRoomPayload,
  validateJoinRoomPayload,
  validateSetPlayerReadyPayload,
  validateStartGamePayload,
} from "./validate-room-payloads.js";

type DrawingGameIo = Server<ClientToServerEvents, ServerToClientEvents>;

interface ActionRequest<T> {
  payload: unknown;
  acknowledge: ActionAcknowledgement<T>;
}

function isActionAcknowledgement<T>(
  value: unknown,
): value is ActionAcknowledgement<T> {
  return typeof value === "function";
}

function getActionRequest<T>(argumentsReceived: unknown[]): ActionRequest<T> | null {
  const possibleAcknowledgement = argumentsReceived.at(-1);

  if (!isActionAcknowledgement<T>(possibleAcknowledgement)) {
    return null;
  }

  const payloadArguments = argumentsReceived.slice(0, -1);
  return {
    payload:
      payloadArguments.length === 0
        ? undefined
        : payloadArguments.length === 1
          ? payloadArguments[0]
          : payloadArguments,
    acknowledge: possibleAcknowledgement,
  };
}

function isClientPingPayload(payload: unknown): payload is ClientPingPayload {
  return (
    typeof payload === "object" &&
    payload !== null &&
    "sentAt" in payload &&
    typeof payload.sentAt === "number" &&
    Number.isFinite(payload.sentAt)
  );
}

function actionFailure<T>(error: unknown): ActionResult<T> {
  if (error instanceof RoomManagerError) {
    return {
      success: false,
      error: { code: error.code, message: error.message },
    };
  }

  console.error("[rooms] Unexpected room action error", error);
  return {
    success: false,
    error: {
      code: "INTERNAL_ERROR",
      message: "Une erreur interne est survenue.",
    },
  };
}

export function registerSocketHandlers(
  io: DrawingGameIo,
  roomManager: RoomManager,
  gameManager: GameManager,
) {
  io.on("connection", (socket) => {
    console.info(`[socket] Client connected: ${socket.id}`);

    socket.on(SOCKET_EVENTS.CLIENT_PING, (payload) => {
      if (!isClientPingPayload(payload)) {
        return;
      }

      socket.emit(SOCKET_EVENTS.SERVER_PONG, {
        sentAt: payload.sentAt,
        receivedAt: Date.now(),
      });
    });

    socket.on(SOCKET_EVENTS.ROOM_CREATE, async (...argumentsReceived: unknown[]) => {
      const request = getActionRequest<RoomSessionData>(argumentsReceived);
      if (request === null) {
        return;
      }

      const validation = validateCreateRoomPayload(request.payload);
      if (!validation.success) {
        request.acknowledge(validation);
        return;
      }

      let session: RoomSessionData;
      try {
        session = roomManager.createRoom(socket.id, validation.data.nickname);
      } catch (error) {
        request.acknowledge(actionFailure(error));
        return;
      }

      try {
        await socket.join(session.roomCode);
      } catch (error) {
        roomManager.handleSocketDisconnect(socket.id);
        request.acknowledge(actionFailure(error));
        return;
      }

      request.acknowledge({ success: true, data: session });
      io.to(session.roomCode).emit(SOCKET_EVENTS.ROOM_STATE, session.room);
    });

    socket.on(SOCKET_EVENTS.ROOM_JOIN, async (...argumentsReceived: unknown[]) => {
      const request = getActionRequest<RoomSessionData>(argumentsReceived);
      if (request === null) {
        return;
      }

      const validation = validateJoinRoomPayload(request.payload);
      if (!validation.success) {
        request.acknowledge(validation);
        return;
      }

      let session: RoomSessionData;
      try {
        session = roomManager.joinRoom(
          socket.id,
          validation.data.nickname,
          validation.data.roomCode,
        );
      } catch (error) {
        request.acknowledge(actionFailure(error));
        return;
      }

      try {
        await socket.join(session.roomCode);
      } catch (error) {
        roomManager.handleSocketDisconnect(socket.id);
        request.acknowledge(actionFailure(error));
        return;
      }

      request.acknowledge({ success: true, data: session });
      io.to(session.roomCode).emit(SOCKET_EVENTS.ROOM_STATE, session.room);
    });

    socket.on(SOCKET_EVENTS.ROOM_LEAVE, async (...argumentsReceived: unknown[]) => {
      const request = getActionRequest<null>(argumentsReceived);
      if (request === null) {
        return;
      }

      try {
        const currentRoom = roomManager.getPlayerRoomBySocketId(socket.id);
        const gameWasCancelled =
          currentRoom === undefined
            ? false
            : gameManager.cancelGame(currentRoom.code);
        const departure = roomManager.leaveRoom(socket.id);
        await socket.leave(departure.roomCode);
        request.acknowledge({ success: true, data: null });

        if (departure.room !== null) {
          if (gameWasCancelled) {
            io.to(departure.roomCode).emit(SOCKET_EVENTS.GAME_CANCELLED, {
              reason: "PLAYER_LEFT",
              message: "La partie a été annulée car un joueur a quitté le salon.",
            });
          }
          io.to(departure.roomCode).emit(
            SOCKET_EVENTS.ROOM_STATE,
            departure.room,
          );
        }
      } catch (error) {
        request.acknowledge(actionFailure<null>(error));
      }
    });

    socket.on(
      SOCKET_EVENTS.PLAYER_SET_READY,
      (...argumentsReceived: unknown[]) => {
        const request = getActionRequest<PublicRoomState>(argumentsReceived);
        if (request === null) {
          return;
        }

        const validation = validateSetPlayerReadyPayload(request.payload);
        if (!validation.success) {
          request.acknowledge(validation);
          return;
        }

        let room: PublicRoomState;
        try {
          room = roomManager.setPlayerReady(
            socket.id,
            validation.data.isReady,
          );
        } catch (error) {
          request.acknowledge(actionFailure(error));
          return;
        }

        request.acknowledge({ success: true, data: room });
        io.to(room.code).emit(SOCKET_EVENTS.ROOM_STATE, room);
      },
    );

    socket.on(SOCKET_EVENTS.GAME_START, (...argumentsReceived: unknown[]) => {
      const request = getActionRequest<StartGameSuccessData>(
        argumentsReceived,
      );
      if (request === null) {
        return;
      }

      const validation = validateStartGamePayload(request.payload);
      if (!validation.success) {
        request.acknowledge(validation);
        return;
      }

      try {
        const startedGame = gameManager.startGame(socket.id);
        io.to(startedGame.room.code).emit(
          SOCKET_EVENTS.ROOM_STATE,
          startedGame.room,
        );
        io.to(startedGame.drawerSocketId).emit(
          SOCKET_EVENTS.TURN_SECRET,
          startedGame.secret,
        );
        request.acknowledge({
          success: true,
          data: { room: startedGame.room },
        });
      } catch (error) {
        request.acknowledge(actionFailure(error));
      }
    });

    socket.on(
      SOCKET_EVENTS.DRAWING_SUBMIT,
      (...argumentsReceived: unknown[]) => {
        const request = getActionRequest<SubmitDrawingSuccessData>(
          argumentsReceived,
        );
        if (request === null) {
          return;
        }

        try {
          const submission = gameManager.submitDrawing(
            socket.id,
            request.payload,
          );
          io.to(submission.room.code).emit(
            SOCKET_EVENTS.ROOM_STATE,
            submission.room,
          );
          request.acknowledge({ success: true, data: submission });
        } catch (error) {
          request.acknowledge(actionFailure(error));
        }
      },
    );

    socket.on("disconnect", (reason) => {
      const currentRoom = roomManager.getPlayerRoomBySocketId(socket.id);
      const gameWasCancelled =
        currentRoom === undefined
          ? false
          : gameManager.cancelGame(currentRoom.code);
      const departure = roomManager.handleSocketDisconnect(socket.id);

      if (departure !== null && departure.room !== null) {
        if (gameWasCancelled) {
          io.to(departure.roomCode).emit(SOCKET_EVENTS.GAME_CANCELLED, {
            reason: "PLAYER_DISCONNECTED",
            message:
              "La partie a été annulée car un joueur s’est déconnecté.",
          });
        }
        io.to(departure.roomCode).emit(
          SOCKET_EVENTS.ROOM_STATE,
          departure.room,
        );
      }

      console.info(`[socket] Client disconnected: ${socket.id} (${reason})`);
    });
  });
}
