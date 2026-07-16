import type {
  RestoreSessionPayload,
  RestoreSessionSuccessData,
} from "@drawing-game/shared";

import type {
  RoomManager,
  SessionRestoreCandidate,
} from "../rooms/room-manager.js";
import type { ReconnectManager } from "./reconnect-manager.js";

export type SessionRestorationClock = () => number;

export interface SessionRestorationManagerOptions {
  clock?: SessionRestorationClock;
}

export class SessionRestorationManager {
  private readonly clock: SessionRestorationClock;

  constructor(
    private readonly roomManager: RoomManager,
    private readonly reconnectManager: ReconnectManager,
    options: SessionRestorationManagerOptions = {},
  ) {
    this.clock = options.clock ?? Date.now;
  }

  prepareSessionRestore(
    socketId: string,
    payload: RestoreSessionPayload,
  ): SessionRestoreCandidate {
    return this.roomManager.prepareSessionRestore(
      socketId,
      payload,
      this.clock(),
    );
  }

  restoreSession(
    socketId: string,
    payload: RestoreSessionPayload,
  ): RestoreSessionSuccessData {
    const restored = this.roomManager.restoreSession({
      ...payload,
      socketId,
      restoredAt: this.clock(),
    });
    this.reconnectManager.clearPlayerReconnectTimer(
      restored.session.roomCode,
      restored.session.playerId,
    );
    return restored;
  }

  rollbackRoomAdmission(
    roomCode: string,
    playerId: string,
  ): void {
    this.reconnectManager.clearPlayerReconnectTimer(roomCode, playerId);
    this.roomManager.removePlayerById(roomCode, playerId);
  }
}
