import { useEffect, useRef, useState } from "react";

import {
  SOCKET_EVENTS,
  type PublicRoomState,
} from "@drawing-game/shared";

import { socket } from "../socket/socket";

export interface ClientRoomSession {
  currentPlayerId: string | null;
  room: PublicRoomState | null;
}

export type PendingRoomAction = "create" | "join" | "ready" | "leave" | null;

const EMPTY_SESSION: ClientRoomSession = {
  currentPlayerId: null,
  room: null,
};

const ACTION_TIMEOUT_MS = 8_000;

function getInitialRoomCode() {
  const roomCode = new URLSearchParams(window.location.search).get("room");
  return roomCode?.trim().toUpperCase() ?? "";
}

function normalizeNickname(nickname: string) {
  return nickname.trim().replace(/\s+/g, " ");
}

function validateNickname(nickname: string) {
  if (nickname.length < 2 || nickname.length > 20) {
    return "Le pseudonyme doit contenir entre 2 et 20 caractères.";
  }

  if (/\p{Cc}/u.test(nickname)) {
    return "Le pseudonyme contient un caractère non autorisé.";
  }

  return null;
}

function validateRoomCode(roomCode: string) {
  return /^[A-Z0-9]{5}$/.test(roomCode)
    ? null
    : "Le code de la partie doit contenir 5 lettres ou chiffres.";
}

export function useRoomSession() {
  const [nickname, setNickname] = useState("");
  const [roomCode, setRoomCode] = useState(getInitialRoomCode);
  const [session, setSession] = useState<ClientRoomSession>(EMPTY_SESSION);
  const currentPlayerIdRef = useRef<string | null>(null);
  const [pendingAction, setPendingAction] =
    useState<PendingRoomAction>(null);
  const pendingActionRef = useRef<PendingRoomAction>(null);
  const actionTokenRef = useRef(0);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  useEffect(() => {
    const handleRoomState = (room: PublicRoomState) => {
      const currentPlayerId = currentPlayerIdRef.current;

      if (currentPlayerId === null) {
        return;
      }

      const currentPlayerIsPresent = room.players.some(
        (player) => player.id === currentPlayerId,
      );

      if (!currentPlayerIsPresent) {
        currentPlayerIdRef.current = null;
        pendingActionRef.current = null;
        actionTokenRef.current += 1;
        setPendingAction(null);
        setErrorMessage(
          "Vous ne faites plus partie de ce salon. Vous pouvez en rejoindre un autre.",
        );
        setSession(EMPTY_SESSION);
        return;
      }

      setSession({ currentPlayerId, room });
    };

    const handleDisconnect = () => {
      const hadActiveSession = currentPlayerIdRef.current !== null;
      const hadPendingAction = pendingActionRef.current !== null;

      if (!hadActiveSession && !hadPendingAction) {
        return;
      }

      currentPlayerIdRef.current = null;
      pendingActionRef.current = null;
      actionTokenRef.current += 1;
      setPendingAction(null);
      setErrorMessage(
        hadActiveSession
          ? "La connexion au salon a été interrompue. Rejoignez-le à nouveau pour continuer."
          : "La connexion au serveur a été interrompue avant sa réponse.",
      );
      setSession(EMPTY_SESSION);
    };

    socket.on(SOCKET_EVENTS.ROOM_STATE, handleRoomState);
    socket.on("disconnect", handleDisconnect);

    return () => {
      socket.off(SOCKET_EVENTS.ROOM_STATE, handleRoomState);
      socket.off("disconnect", handleDisconnect);
    };
  }, []);

  const updatePendingAction = (action: PendingRoomAction) => {
    pendingActionRef.current = action;
    setPendingAction(action);
  };

  const beginAction = (action: Exclude<PendingRoomAction, null>) => {
    actionTokenRef.current += 1;
    updatePendingAction(action);
    return actionTokenRef.current;
  };

  const resetAfterUncertainAction = (actionToken: number) => {
    if (actionToken !== actionTokenRef.current) {
      return;
    }

    actionTokenRef.current += 1;
    currentPlayerIdRef.current = null;
    updatePendingAction(null);
    setSession(EMPTY_SESSION);
    setErrorMessage(
      "La réponse du serveur est incertaine. La connexion a été réinitialisée ; rejoignez le salon avant de réessayer.",
    );

    if (socket.connected) {
      socket.disconnect();
      socket.connect();
    }
  };

  const ensureSocketIsConnected = () => {
    if (socket.connected) {
      return true;
    }

    setErrorMessage(
      "Connexion au serveur indisponible. Réessayez dans quelques instants.",
    );
    return false;
  };

  const createRoom = () => {
    if (pendingActionRef.current !== null || !ensureSocketIsConnected()) {
      return;
    }

    const normalizedNickname = normalizeNickname(nickname);
    const validationError = validateNickname(normalizedNickname);

    if (validationError !== null) {
      setErrorMessage(validationError);
      return;
    }

    setNickname(normalizedNickname);
    setErrorMessage(null);
    const actionToken = beginAction("create");

    socket.timeout(ACTION_TIMEOUT_MS).emit(
      SOCKET_EVENTS.ROOM_CREATE,
      { nickname: normalizedNickname },
      (timeoutError, result) => {
        if (actionToken !== actionTokenRef.current) {
          return;
        }

        if (timeoutError) {
          resetAfterUncertainAction(actionToken);
          return;
        }

        updatePendingAction(null);

        if (!result.success) {
          setErrorMessage(result.error.message);
          return;
        }

        setRoomCode(result.data.roomCode);
        currentPlayerIdRef.current = result.data.playerId;
        setSession({
          currentPlayerId: result.data.playerId,
          room: result.data.room,
        });
      },
    );
  };

  const joinRoom = () => {
    if (pendingActionRef.current !== null || !ensureSocketIsConnected()) {
      return;
    }

    const normalizedNickname = normalizeNickname(nickname);
    const normalizedRoomCode = roomCode.trim().toUpperCase();
    const validationError =
      validateNickname(normalizedNickname) ?? validateRoomCode(normalizedRoomCode);

    if (validationError !== null) {
      setErrorMessage(validationError);
      return;
    }

    setNickname(normalizedNickname);
    setRoomCode(normalizedRoomCode);
    setErrorMessage(null);
    const actionToken = beginAction("join");

    socket.timeout(ACTION_TIMEOUT_MS).emit(
      SOCKET_EVENTS.ROOM_JOIN,
      { nickname: normalizedNickname, roomCode: normalizedRoomCode },
      (timeoutError, result) => {
        if (actionToken !== actionTokenRef.current) {
          return;
        }

        if (timeoutError) {
          resetAfterUncertainAction(actionToken);
          return;
        }

        updatePendingAction(null);

        if (!result.success) {
          setErrorMessage(result.error.message);
          return;
        }

        setRoomCode(result.data.roomCode);
        currentPlayerIdRef.current = result.data.playerId;
        setSession({
          currentPlayerId: result.data.playerId,
          room: result.data.room,
        });
      },
    );
  };

  const setReady = (isReady: boolean) => {
    if (
      pendingActionRef.current !== null ||
      session.room === null ||
      !ensureSocketIsConnected()
    ) {
      return;
    }

    setErrorMessage(null);
    const actionToken = beginAction("ready");

    socket.timeout(ACTION_TIMEOUT_MS).emit(
      SOCKET_EVENTS.PLAYER_SET_READY,
      { isReady },
      (timeoutError, result) => {
        if (actionToken !== actionTokenRef.current) {
          return;
        }

        if (timeoutError) {
          resetAfterUncertainAction(actionToken);
          return;
        }

        updatePendingAction(null);

        if (!result.success) {
          setErrorMessage(result.error.message);
          return;
        }

        setSession((currentSession) => ({
          currentPlayerId: currentSession.currentPlayerId,
          room:
            currentSession.currentPlayerId === null
              ? currentSession.room
              : result.data,
        }));
      },
    );
  };

  const leaveRoom = () => {
    if (
      pendingActionRef.current !== null ||
      session.room === null ||
      !ensureSocketIsConnected()
    ) {
      return;
    }

    setErrorMessage(null);
    const actionToken = beginAction("leave");

    socket.timeout(ACTION_TIMEOUT_MS).emit(
      SOCKET_EVENTS.ROOM_LEAVE,
      (timeoutError, result) => {
        if (actionToken !== actionTokenRef.current) {
          return;
        }

        if (timeoutError) {
          resetAfterUncertainAction(actionToken);
          return;
        }

        updatePendingAction(null);

        if (!result.success) {
          setErrorMessage(result.error.message);
          return;
        }

        setErrorMessage(null);
        currentPlayerIdRef.current = null;
        setSession(EMPTY_SESSION);
      },
    );
  };

  return {
    nickname,
    roomCode,
    session,
    pendingAction,
    errorMessage,
    setNickname,
    setRoomCode: (value: string) => setRoomCode(value.toUpperCase()),
    createRoom,
    joinRoom,
    setReady,
    leaveRoom,
  };
}
