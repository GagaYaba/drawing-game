import { useEffect, useRef, useState } from "react";

import {
  SOCKET_EVENTS,
  type DrawingDocument,
  type GameCancelledPayload,
  type GamePhase,
  type GuessValue,
  type PublicRoomState,
  type SubmitGuessPayload,
  type TurnSecretPayload,
} from "@drawing-game/shared";

import { socket } from "../socket/socket";

export interface ClientRoomSession {
  currentPlayerId: string | null;
  room: PublicRoomState | null;
}

export interface ClientGameSecrets {
  gameId: string | null;
  turnId: string | null;
  secretLevel: GuessValue | null;
}

export interface ClientGuessSubmission {
  value: GuessValue;
  submittedAt: number;
}

export interface ClientGuessState {
  selected: GuessValue | null;
  submitted: ClientGuessSubmission | null;
  isSubmitting: boolean;
  error: string | null;
}

export type PendingRoomAction =
  | "create"
  | "join"
  | "ready"
  | "start"
  | "continue"
  | "rematch"
  | "submitDrawing"
  | "leave"
  | null;

const EMPTY_SESSION: ClientRoomSession = {
  currentPlayerId: null,
  room: null,
};

const EMPTY_GAME_SECRETS: ClientGameSecrets = {
  gameId: null,
  turnId: null,
  secretLevel: null,
};

const EMPTY_GUESS_STATE: ClientGuessState = {
  selected: null,
  submitted: null,
  isSubmitting: false,
  error: null,
};

const ACTION_TIMEOUT_MS = 8_000;
const REMATCH_READY_NOTICE =
  "La revanche est prête. Indiquez lorsque vous êtes prêt à jouer.";

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

export function didPublicTurnChange(
  previousTurnId: string | null,
  nextTurnId: string | null,
) {
  return previousTurnId !== nextTurnId;
}

export function didPublicGameChange(
  previousGameId: string | null,
  nextGameId: string | null,
) {
  return previousGameId !== nextGameId;
}

export interface ClientGameActionContext {
  roomCode: string;
  gameId: string;
  turnId: string;
  phase: GamePhase;
}

export function getPublicGameActionContext(
  room: PublicRoomState | null,
): ClientGameActionContext | null {
  if (room === null || room.game === null) {
    return null;
  }

  return {
    roomCode: room.code,
    gameId: room.game.gameId,
    turnId: room.game.turnId,
    phase: room.game.phase,
  };
}

export function isGameActionContextCurrent(
  expected: ClientGameActionContext,
  current: ClientGameActionContext | null,
) {
  return (
    current !== null &&
    expected.roomCode === current.roomCode &&
    expected.gameId === current.gameId &&
    expected.turnId === current.turnId &&
    expected.phase === current.phase
  );
}

export function isTurnSecretForActiveDrawer(
  payload: TurnSecretPayload,
  context: {
    roomCode: string | null;
    gameId: string | null;
    turnId: string | null;
    playerId: string | null;
  },
) {
  return (
    context.playerId !== null &&
    context.roomCode !== null &&
    context.gameId !== null &&
    context.turnId !== null &&
    payload.roomCode === context.roomCode &&
    payload.gameId === context.gameId &&
    payload.turnId === context.turnId &&
    payload.drawerPlayerId === context.playerId &&
    Number.isInteger(payload.secretLevel) &&
    payload.secretLevel >= 1 &&
    payload.secretLevel <= 10
  );
}

export function createSubmitGuessPayload(
  turnId: string,
  value: GuessValue,
): SubmitGuessPayload {
  return { turnId, value };
}

export function useRoomSession() {
  const [nickname, setNickname] = useState("");
  const [roomCode, setRoomCode] = useState(getInitialRoomCode);
  const [session, setSession] = useState<ClientRoomSession>(EMPTY_SESSION);
  const currentPlayerIdRef = useRef<string | null>(null);
  const currentRoomCodeRef = useRef<string | null>(null);
  const currentGameIdRef = useRef<string | null>(null);
  const currentTurnIdRef = useRef<string | null>(null);
  const currentGamePhaseRef = useRef<GamePhase | null>(null);
  const [gameSecrets, setGameSecrets] =
    useState<ClientGameSecrets>(EMPTY_GAME_SECRETS);
  const [guessState, setGuessState] =
    useState<ClientGuessState>(EMPTY_GUESS_STATE);
  const guessStateRef = useRef<ClientGuessState>(EMPTY_GUESS_STATE);
  const guessActionTokenRef = useRef(0);
  const [pendingAction, setPendingAction] =
    useState<PendingRoomAction>(null);
  const pendingActionRef = useRef<PendingRoomAction>(null);
  const actionTokenRef = useRef(0);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [noticeMessage, setNoticeMessage] = useState<string | null>(null);

  const updateGuessState = (
    update:
      | ClientGuessState
      | ((currentState: ClientGuessState) => ClientGuessState),
  ) => {
    const nextState =
      typeof update === "function"
        ? update(guessStateRef.current)
        : update;

    guessStateRef.current = nextState;
    setGuessState(nextState);
  };

  const resetGuessState = () => {
    guessActionTokenRef.current += 1;
    updateGuessState(EMPTY_GUESS_STATE);
  };

  const updatePendingAction = (action: PendingRoomAction) => {
    pendingActionRef.current = action;
    setPendingAction(action);
  };

  const clearPendingAction = (invalidateAcknowledgement = false) => {
    if (invalidateAcknowledgement) {
      actionTokenRef.current += 1;
    }

    updatePendingAction(null);
  };

  const beginAction = (action: Exclude<PendingRoomAction, null>) => {
    actionTokenRef.current += 1;
    updatePendingAction(action);
    return actionTokenRef.current;
  };

  const clearTrackedGameContext = () => {
    currentGameIdRef.current = null;
    currentTurnIdRef.current = null;
    currentGamePhaseRef.current = null;
  };

  const clearTrackedSessionContext = () => {
    currentPlayerIdRef.current = null;
    currentRoomCodeRef.current = null;
    clearTrackedGameContext();
  };

  const syncTrackedRoomContext = (room: PublicRoomState) => {
    currentRoomCodeRef.current = room.code;
    currentGameIdRef.current = room.game?.gameId ?? null;
    currentTurnIdRef.current = room.game?.turnId ?? null;
    currentGamePhaseRef.current = room.game?.phase ?? null;
  };

  const getTrackedGameActionContext =
    (): ClientGameActionContext | null => {
      if (
        currentRoomCodeRef.current === null ||
        currentGameIdRef.current === null ||
        currentTurnIdRef.current === null ||
        currentGamePhaseRef.current === null
      ) {
        return null;
      }

      return {
        roomCode: currentRoomCodeRef.current,
        gameId: currentGameIdRef.current,
        turnId: currentTurnIdRef.current,
        phase: currentGamePhaseRef.current,
      };
    };

  const applyRoomState = (room: PublicRoomState) => {
    const currentPlayerId = currentPlayerIdRef.current;

    if (currentPlayerId === null) {
      return;
    }

    const currentPlayerIsPresent = room.players.some(
      (player) => player.id === currentPlayerId,
    );

    if (!currentPlayerIsPresent) {
      clearTrackedSessionContext();
      clearPendingAction(true);
      setGameSecrets(EMPTY_GAME_SECRETS);
      resetGuessState();
      setNoticeMessage(null);
      setErrorMessage(
        "Vous ne faites plus partie de ce salon. Vous pouvez en rejoindre un autre.",
      );
      setSession(EMPTY_SESSION);
      return;
    }

    const previousGameId = currentGameIdRef.current;
    const previousTurnId = currentTurnIdRef.current;
    const previousPhase = currentGamePhaseRef.current;
    const nextGame = room.game;
    const nextGameId = nextGame?.gameId ?? null;
    const nextTurnId = nextGame?.turnId ?? null;
    const nextPhase = nextGame?.phase ?? null;
    const gameChanged = didPublicGameChange(
      previousGameId,
      nextGameId,
    );
    const turnChanged = didPublicTurnChange(
      previousTurnId,
      nextTurnId,
    );
    const returnedToLobbyAfterFinished =
      previousGameId !== null &&
      previousPhase === "FINISHED" &&
      nextGame === null;

    syncTrackedRoomContext(room);

    const currentPendingAction = pendingActionRef.current;
    const pendingContextEnded =
      ((currentPendingAction === "ready" ||
        currentPendingAction === "start") &&
        nextGame !== null) ||
      (currentPendingAction === "submitDrawing" &&
        (gameChanged ||
          turnChanged ||
          nextPhase !== "DRAWING")) ||
      (currentPendingAction === "continue" &&
        (gameChanged ||
          turnChanged ||
          nextPhase !== "REVEAL")) ||
      (currentPendingAction === "rematch" &&
        (gameChanged || nextPhase !== "FINISHED"));

    if (pendingContextEnded) {
      clearPendingAction(true);
    }

    if (
      gameChanged ||
      turnChanged ||
      nextGame === null ||
      nextGame.currentDrawer.id !== currentPlayerId ||
      nextGame.phase === "REVEAL" ||
      nextGame.phase === "FINISHED"
    ) {
      setGameSecrets(EMPTY_GAME_SECRETS);
    }

    const shouldKeepGuessState =
      !gameChanged &&
      !turnChanged &&
      nextGame !== null &&
      nextGame.phase === "VOTING" &&
      nextGame.currentDrawer.id !== currentPlayerId;

    if (!shouldKeepGuessState) {
      resetGuessState();
    }

    if (returnedToLobbyAfterFinished) {
      setErrorMessage(null);
      setNoticeMessage(REMATCH_READY_NOTICE);
    } else if (nextGame !== null) {
      setNoticeMessage(null);
      setErrorMessage(null);
    }

    setSession({ currentPlayerId, room });
  };

  useEffect(() => {
    const handleRoomState = (room: PublicRoomState) => {
      applyRoomState(room);
    };

    const handleTurnSecret = (payload: TurnSecretPayload) => {
      if (!isTurnSecretForActiveDrawer(payload, {
        roomCode: currentRoomCodeRef.current,
        gameId: currentGameIdRef.current,
        turnId: currentTurnIdRef.current,
        playerId: currentPlayerIdRef.current,
      })) {
        return;
      }

      setGameSecrets({
        gameId: payload.gameId,
        turnId: payload.turnId,
        secretLevel: payload.secretLevel as GuessValue,
      });
    };

    const handleGameCancelled = (payload: GameCancelledPayload) => {
      if (
        currentPlayerIdRef.current === null ||
        currentRoomCodeRef.current === null
      ) {
        return;
      }

      clearTrackedGameContext();
      setGameSecrets(EMPTY_GAME_SECRETS);
      resetGuessState();
      setErrorMessage(null);
      setNoticeMessage(payload.message);

      if (pendingActionRef.current !== null) {
        clearPendingAction(true);
      }
    };

    const handleDisconnect = () => {
      const hadActiveSession = currentPlayerIdRef.current !== null;
      const hadPendingAction = pendingActionRef.current !== null;

      if (!hadActiveSession && !hadPendingAction) {
        return;
      }

      clearTrackedSessionContext();
      clearPendingAction(true);
      setGameSecrets(EMPTY_GAME_SECRETS);
      resetGuessState();
      setNoticeMessage(null);
      setErrorMessage(
        hadActiveSession
          ? "La connexion au salon a été interrompue. Rejoignez-le à nouveau pour continuer."
          : "La connexion au serveur a été interrompue avant sa réponse.",
      );
      setSession(EMPTY_SESSION);
    };

    socket.on(SOCKET_EVENTS.ROOM_STATE, handleRoomState);
    socket.on(SOCKET_EVENTS.TURN_SECRET, handleTurnSecret);
    socket.on(SOCKET_EVENTS.GAME_CANCELLED, handleGameCancelled);
    socket.on("disconnect", handleDisconnect);

    return () => {
      socket.off(SOCKET_EVENTS.ROOM_STATE, handleRoomState);
      socket.off(SOCKET_EVENTS.TURN_SECRET, handleTurnSecret);
      socket.off(SOCKET_EVENTS.GAME_CANCELLED, handleGameCancelled);
      socket.off("disconnect", handleDisconnect);
    };
  }, []);

  const resetAfterUncertainAction = (actionToken: number) => {
    if (actionToken !== actionTokenRef.current) {
      return;
    }

    clearTrackedSessionContext();
    clearPendingAction(true);
    setGameSecrets(EMPTY_GAME_SECRETS);
    resetGuessState();
    setNoticeMessage(null);
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
    setNoticeMessage(null);
    setGameSecrets(EMPTY_GAME_SECRETS);
    clearTrackedGameContext();
    resetGuessState();
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
        applyRoomState(result.data.room);
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
    setNoticeMessage(null);
    setGameSecrets(EMPTY_GAME_SECRETS);
    clearTrackedGameContext();
    resetGuessState();
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
        applyRoomState(result.data.room);
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

        applyRoomState(result.data);
      },
    );
  };

  const startGame = () => {
    if (
      pendingActionRef.current !== null ||
      session.room === null ||
      !ensureSocketIsConnected()
    ) {
      return;
    }

    setErrorMessage(null);
    setNoticeMessage(null);
    resetGuessState();
    const actionToken = beginAction("start");

    socket.timeout(ACTION_TIMEOUT_MS).emit(
      SOCKET_EVENTS.GAME_START,
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

        applyRoomState(result.data.room);
      },
    );
  };

  const continueGame = () => {
    if (
      pendingActionRef.current !== null ||
      session.room === null ||
      !ensureSocketIsConnected()
    ) {
      return false;
    }

    const game = session.room.game;
    const currentPlayer = session.room.players.find(
      (player) => player.id === session.currentPlayerId,
    );

    if (game === null || game.phase !== "REVEAL") {
      setErrorMessage(
        "La partie ne peut continuer que depuis l’écran de révélation.",
      );
      return false;
    }

    if (currentPlayer === undefined || !currentPlayer.isHost) {
      setErrorMessage("Seul l’hôte peut lancer la suite de la partie.");
      return false;
    }

    const actionContext = getPublicGameActionContext(session.room);
    if (actionContext === null) {
      setErrorMessage("Le contexte de la partie est indisponible.");
      return false;
    }

    setErrorMessage(null);
    setNoticeMessage(null);
    const actionToken = beginAction("continue");

    socket.timeout(ACTION_TIMEOUT_MS).emit(
      SOCKET_EVENTS.GAME_CONTINUE,
      (timeoutError, result) => {
        if (
          actionToken !== actionTokenRef.current ||
          !isGameActionContextCurrent(
            actionContext,
            getTrackedGameActionContext(),
          )
        ) {
          return;
        }

        if (timeoutError) {
          actionTokenRef.current += 1;
          updatePendingAction(null);
          setErrorMessage(
            "La réponse du serveur a expiré. Attendez la synchronisation de la partie avant de réessayer.",
          );
          return;
        }

        if (!result.success) {
          updatePendingAction(null);
          setErrorMessage(result.error.message);
          return;
        }

        updatePendingAction(null);
        applyRoomState(result.data.room);
      },
    );

    return true;
  };

  const requestRematch = () => {
    if (
      pendingActionRef.current !== null ||
      session.room === null ||
      !ensureSocketIsConnected()
    ) {
      return false;
    }

    const game = session.room.game;
    const currentPlayer = session.room.players.find(
      (player) => player.id === session.currentPlayerId,
    );

    if (game === null || game.phase !== "FINISHED") {
      setErrorMessage(
        "Une revanche ne peut être proposée qu’après la fin de la partie.",
      );
      return false;
    }

    if (currentPlayer === undefined || !currentPlayer.isHost) {
      setErrorMessage("Seul l’hôte peut proposer une revanche.");
      return false;
    }

    const actionContext = getPublicGameActionContext(session.room);
    if (actionContext === null) {
      setErrorMessage("Le contexte de la partie est indisponible.");
      return false;
    }

    setErrorMessage(null);
    setNoticeMessage(null);
    const actionToken = beginAction("rematch");

    socket.timeout(ACTION_TIMEOUT_MS).emit(
      SOCKET_EVENTS.GAME_REQUEST_REMATCH,
      (timeoutError, result) => {
        if (
          actionToken !== actionTokenRef.current ||
          !isGameActionContextCurrent(
            actionContext,
            getTrackedGameActionContext(),
          )
        ) {
          return;
        }

        if (timeoutError) {
          actionTokenRef.current += 1;
          updatePendingAction(null);
          setErrorMessage(
            "La réponse du serveur a expiré. Attendez la synchronisation du salon avant de reproposer une revanche.",
          );
          return;
        }

        if (!result.success) {
          updatePendingAction(null);
          setErrorMessage(result.error.message);
          return;
        }

        updatePendingAction(null);
        applyRoomState(result.data.room);
      },
    );

    return true;
  };

  const submitDrawing = (drawing: DrawingDocument) => {
    if (
      pendingActionRef.current !== null ||
      session.room === null ||
      !ensureSocketIsConnected()
    ) {
      return false;
    }

    const game = session.room.game;
    if (game === null) {
      setErrorMessage("Aucune partie n’est en cours.");
      return false;
    }

    if (game.phase !== "DRAWING") {
      setErrorMessage("Le dessin ne peut pas être envoyé pendant cette phase.");
      return false;
    }

    if (
      session.currentPlayerId === null ||
      game.currentDrawer.id !== session.currentPlayerId
    ) {
      setErrorMessage("Seul le dessinateur actuel peut envoyer un dessin.");
      return false;
    }

    if (drawing.strokes.length === 0) {
      setErrorMessage("Le dessin est vide.");
      return false;
    }

    const actionContext = getPublicGameActionContext(session.room);
    if (actionContext === null) {
      setErrorMessage("Le contexte du tour est indisponible.");
      return false;
    }

    setErrorMessage(null);
    setNoticeMessage(null);
    const actionToken = beginAction("submitDrawing");

    socket.timeout(ACTION_TIMEOUT_MS).emit(
      SOCKET_EVENTS.DRAWING_SUBMIT,
      { drawing },
      (timeoutError, result) => {
        if (
          actionToken !== actionTokenRef.current ||
          !isGameActionContextCurrent(
            actionContext,
            getTrackedGameActionContext(),
          )
        ) {
          return;
        }

        if (timeoutError) {
          actionTokenRef.current += 1;
          updatePendingAction(null);
          setErrorMessage(
            "La réponse du serveur a expiré. Votre dessin est conservé ; attendez la synchronisation du salon avant de réessayer.",
          );
          return;
        }

        if (!result.success) {
          updatePendingAction(null);
          setErrorMessage(result.error.message);
        }

        // En cas de succès, le serveur diffuse room:state. Cet événement est le
        // seul à faire quitter DRAWING ; on garde donc l'action bloquée jusque-là.
      },
    );

    return true;
  };

  const selectGuess = (value: GuessValue) => {
    const game = session.room?.game ?? null;

    if (
      game === null ||
      game.phase !== "VOTING" ||
      session.currentPlayerId === null ||
      game.currentDrawer.id === session.currentPlayerId ||
      guessStateRef.current.submitted !== null ||
      guessStateRef.current.isSubmitting
    ) {
      return;
    }

    updateGuessState((currentState) => ({
      ...currentState,
      selected: value,
      error: null,
    }));
  };

  const submitGuess = () => {
    const game = session.room?.game ?? null;
    const currentGuessState = guessStateRef.current;

    if (pendingActionRef.current !== null) {
      return false;
    }

    if (!socket.connected) {
      updateGuessState((currentState) => ({
        ...currentState,
        isSubmitting: false,
        error:
          "Connexion au serveur indisponible. Votre estimation n’a pas été envoyée.",
      }));
      return false;
    }

    if (game === null || game.phase !== "VOTING") {
      updateGuessState((currentState) => ({
        ...currentState,
        isSubmitting: false,
        error: "Le vote n’est plus ouvert.",
      }));
      return false;
    }

    if (
      session.currentPlayerId === null ||
      game.currentDrawer.id === session.currentPlayerId
    ) {
      updateGuessState((currentState) => ({
        ...currentState,
        isSubmitting: false,
        error: "Le dessinateur ne peut pas voter pendant son propre tour.",
      }));
      return false;
    }

    if (currentGuessState.submitted !== null) {
      updateGuessState((currentState) => ({
        ...currentState,
        error: "Votre estimation a déjà été envoyée.",
      }));
      return false;
    }

    if (currentGuessState.selected === null) {
      updateGuessState((currentState) => ({
        ...currentState,
        error: "Choisissez un niveau entre 1 et 10 avant de valider.",
      }));
      return false;
    }

    const selectedValue = currentGuessState.selected;
    const actionContext =
      session.room === null
        ? null
        : getPublicGameActionContext(session.room);
    if (actionContext === null) {
      updateGuessState((currentState) => ({
        ...currentState,
        isSubmitting: false,
        error: "Le contexte du vote est indisponible.",
      }));
      return false;
    }

    guessActionTokenRef.current += 1;
    const guessActionToken = guessActionTokenRef.current;

    updateGuessState((currentState) => ({
      ...currentState,
      isSubmitting: true,
      error: null,
    }));

    socket.timeout(ACTION_TIMEOUT_MS).emit(
      SOCKET_EVENTS.GUESS_SUBMIT,
      createSubmitGuessPayload(game.turnId, selectedValue),
      (timeoutError, result) => {
        if (
          guessActionToken !== guessActionTokenRef.current ||
          !isGameActionContextCurrent(
            actionContext,
            getTrackedGameActionContext(),
          )
        ) {
          return;
        }

        if (timeoutError) {
          updateGuessState((currentState) => ({
            ...currentState,
            isSubmitting: false,
            error:
              "La réponse du serveur a expiré. Votre sélection est conservée ; vérifiez la progression avant de réessayer.",
          }));
          return;
        }

        if (!result.success) {
          updateGuessState((currentState) => ({
            ...currentState,
            isSubmitting: false,
            error: result.error.message,
          }));
          return;
        }

        updateGuessState({
          selected: result.data.value,
          submitted: result.data,
          isSubmitting: false,
          error: null,
        });
      },
    );

    return true;
  };

  const leaveRoom = () => {
    if (
      pendingActionRef.current !== null ||
      guessStateRef.current.isSubmitting ||
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
        clearTrackedSessionContext();
        setGameSecrets(EMPTY_GAME_SECRETS);
        resetGuessState();
        setNoticeMessage(null);
        setSession(EMPTY_SESSION);
      },
    );
  };

  return {
    nickname,
    roomCode,
    session,
    gameSecrets,
    guessState,
    pendingAction,
    errorMessage,
    noticeMessage,
    setNickname,
    setRoomCode: (value: string) => setRoomCode(value.toUpperCase()),
    createRoom,
    joinRoom,
    setReady,
    startGame,
    continueGame,
    requestRematch,
    submitDrawing,
    selectGuess,
    submitGuess,
    leaveRoom,
  };
}
