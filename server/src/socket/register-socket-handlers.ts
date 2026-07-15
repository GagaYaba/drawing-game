import {
  SOCKET_EVENTS,
  type ActionAcknowledgement,
  type ActionResult,
  type ClientPingPayload,
  type ClientToServerEvents,
  type PublicRoomState,
  type RoomSessionData,
  type ServerToClientEvents,
} from "@drawing-game/shared";
import type { Server } from "socket.io";

import { RoomManager, RoomManagerError } from "../rooms/room-manager.js";
import {
  validateCreateRoomPayload,
  validateJoinRoomPayload,
  validateSetPlayerReadyPayload,
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

function getActionRequest<T>(
  payloadOrAcknowledgement: unknown,
  possibleAcknowledgement: unknown,
): ActionRequest<T> | null {
  if (isActionAcknowledgement<T>(possibleAcknowledgement)) {
    return {
      payload: payloadOrAcknowledgement,
      acknowledge: possibleAcknowledgement,
    };
  }

  if (isActionAcknowledgement<T>(payloadOrAcknowledgement)) {
    return { payload: undefined, acknowledge: payloadOrAcknowledgement };
  }

  return null;
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

export function registerSocketHandlers(io: DrawingGameIo, roomManager: RoomManager) {
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

    socket.on(SOCKET_EVENTS.ROOM_CREATE, async (payload, acknowledge) => {
      const request = getActionRequest<RoomSessionData>(payload, acknowledge);
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

    socket.on(SOCKET_EVENTS.ROOM_JOIN, async (payload, acknowledge) => {
      const request = getActionRequest<RoomSessionData>(payload, acknowledge);
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

    socket.on(SOCKET_EVENTS.ROOM_LEAVE, async (
      payloadOrAcknowledgement: unknown,
      possibleAcknowledgement?: unknown,
    ) => {
      const request = getActionRequest<null>(
        payloadOrAcknowledgement,
        possibleAcknowledgement,
      );
      if (request === null) {
        return;
      }

      try {
        const departure = roomManager.leaveRoom(socket.id);
        await socket.leave(departure.roomCode);
        request.acknowledge({ success: true, data: null });

        if (departure.room !== null) {
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
      (payload, acknowledge) => {
        const request = getActionRequest<PublicRoomState>(
          payload,
          acknowledge,
        );
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

    socket.on("disconnect", (reason) => {
      const departure = roomManager.handleSocketDisconnect(socket.id);

      if (departure !== null && departure.room !== null) {
        io.to(departure.roomCode).emit(
          SOCKET_EVENTS.ROOM_STATE,
          departure.room,
        );
      }

      console.info(`[socket] Client disconnected: ${socket.id} (${reason})`);
    });
  });
}
