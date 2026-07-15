import type {
  CreateRoomPayload,
  JoinRoomPayload,
  RoomErrorCode,
  SetPlayerReadyPayload,
} from "@drawing-game/shared";

type PayloadValidationResult<T> =
  | { success: true; data: T }
  | {
      success: false;
      error: {
        code: RoomErrorCode;
        message: string;
      };
    };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

export function validateCreateRoomPayload(
  payload: unknown,
): PayloadValidationResult<CreateRoomPayload> {
  if (!isRecord(payload) || typeof payload.nickname !== "string") {
    return {
      success: false,
      error: {
        code: "INVALID_NICKNAME",
        message: "Le pseudonyme est obligatoire.",
      },
    };
  }

  return { success: true, data: { nickname: payload.nickname } };
}

export function validateJoinRoomPayload(
  payload: unknown,
): PayloadValidationResult<JoinRoomPayload> {
  if (!isRecord(payload) || typeof payload.nickname !== "string") {
    return {
      success: false,
      error: {
        code: "INVALID_NICKNAME",
        message: "Le pseudonyme est obligatoire.",
      },
    };
  }

  if (typeof payload.roomCode !== "string") {
    return {
      success: false,
      error: {
        code: "INVALID_ROOM_CODE",
        message: "Le code du salon est invalide.",
      },
    };
  }

  return {
    success: true,
    data: { nickname: payload.nickname, roomCode: payload.roomCode },
  };
}

export function validateSetPlayerReadyPayload(
  payload: unknown,
): PayloadValidationResult<SetPlayerReadyPayload> {
  if (!isRecord(payload) || typeof payload.isReady !== "boolean") {
    return {
      success: false,
      error: {
        code: "INVALID_READY_STATUS",
        message: "Le statut prêt doit être un booléen.",
      },
    };
  }

  return { success: true, data: { isReady: payload.isReady } };
}
