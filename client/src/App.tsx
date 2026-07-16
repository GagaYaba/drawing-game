import type { ReactNode } from "react";

import { ConnectionPanel } from "./components/ConnectionPanel";
import { DrawingScreen } from "./components/DrawingScreen";
import { FinishedScreen } from "./components/FinishedScreen";
import { HealthCheck } from "./components/HealthCheck";
import { HomeScreen } from "./components/HomeScreen";
import { LobbyScreen } from "./components/LobbyScreen";
import { RevealScreen } from "./components/RevealScreen";
import { RoundIntroScreen } from "./components/RoundIntroScreen";
import { VotingScreen } from "./components/VotingScreen";
import { useRoomSession } from "./hooks/useRoomSession";

interface AppLayoutProps {
  isGameActive: boolean;
  children: ReactNode;
}

export function AppLayout({
  isGameActive,
  children,
}: AppLayoutProps) {
  return (
    <main
      className={
        isGameActive ? "app-shell app-shell--active" : "app-shell"
      }
    >
      {!isGameActive && (
        <header className="hero">
          <span className="hero-mark" aria-hidden="true">
            ✦
          </span>
          <p className="kicker">Jeu multijoueur</p>
          <h1>Drawing Scale Game</h1>
          <p className="subtitle">
            Réunissez votre groupe dans un salon avant de commencer à dessiner.
          </p>
        </header>
      )}

      {children}

      <details
        className="diagnostics"
        hidden={isGameActive}
        aria-hidden={isGameActive ? true : undefined}
      >
        <summary>Diagnostic technique</summary>
        <div className="panels diagnostics-panels">
          <ConnectionPanel />
          <HealthCheck />
        </div>
      </details>

      {!isGameActive && (
        <footer>React · Express · Socket.IO · TypeScript</footer>
      )}
    </main>
  );
}

export function App() {
  const roomSession = useRoomSession();
  const room = roomSession.session.room;
  const currentPlayerId = roomSession.session.currentPlayerId;
  const game = room?.game ?? null;
  const isGameActive = game !== null && game.phase !== "LOBBY";
  const currentPlayer =
    room?.players.find((player) => player.id === currentPlayerId) ?? null;
  const currentPlayerSecret =
    game !== null &&
    game.currentDrawer.id === currentPlayerId &&
    roomSession.gameSecrets.gameId === game.gameId &&
    roomSession.gameSecrets.turnId === game.turnId
      ? roomSession.gameSecrets.secretLevel
      : null;

  return (
    <AppLayout isGameActive={isGameActive}>
      {room === null ? (
        <HomeScreen
          nickname={roomSession.nickname}
          roomCode={roomSession.roomCode}
          pendingAction={roomSession.pendingAction}
          errorMessage={roomSession.errorMessage}
          onNicknameChange={roomSession.setNickname}
          onRoomCodeChange={roomSession.setRoomCode}
          onCreateRoom={roomSession.createRoom}
          onJoinRoom={roomSession.joinRoom}
        />
      ) : game === null || game.phase === "LOBBY" ? (
        <LobbyScreen
          room={room}
          currentPlayerId={currentPlayerId}
          pendingAction={roomSession.pendingAction}
          errorMessage={roomSession.errorMessage}
          noticeMessage={roomSession.noticeMessage}
          onSetReady={roomSession.setReady}
          onStartGame={roomSession.startGame}
          onLeaveRoom={roomSession.leaveRoom}
        />
      ) : game.phase === "ROUND_INTRO" ? (
        <RoundIntroScreen
          game={game}
          currentPlayerId={currentPlayerId}
          secretLevel={currentPlayerSecret}
          pendingAction={roomSession.pendingAction}
          errorMessage={roomSession.errorMessage}
          onLeaveRoom={roomSession.leaveRoom}
        />
      ) : game.phase === "DRAWING" ? (
        <DrawingScreen
          game={game}
          currentPlayerId={currentPlayerId}
          secretLevel={currentPlayerSecret}
          pendingAction={roomSession.pendingAction}
          errorMessage={roomSession.errorMessage}
          onSubmitDrawing={roomSession.submitDrawing}
          onLeaveRoom={roomSession.leaveRoom}
        />
      ) : game.phase === "VOTING" ? (
        <VotingScreen
          game={game}
          currentPlayerId={currentPlayerId}
          secretLevel={currentPlayerSecret}
          guessState={roomSession.guessState}
          pendingAction={roomSession.pendingAction}
          errorMessage={roomSession.errorMessage}
          onSelectGuess={roomSession.selectGuess}
          onSubmitGuess={roomSession.submitGuess}
          onLeaveRoom={roomSession.leaveRoom}
        />
      ) : game.phase === "REVEAL" ? (
        <RevealScreen
          game={game}
          currentPlayerId={currentPlayerId}
          isHost={currentPlayer?.isHost ?? false}
          pendingAction={roomSession.pendingAction}
          errorMessage={roomSession.errorMessage}
          onContinueGame={roomSession.continueGame}
          onLeaveRoom={roomSession.leaveRoom}
        />
      ) : (
        <FinishedScreen
          finished={game.finished}
          currentPlayerId={currentPlayerId}
          isHost={currentPlayer?.isHost ?? false}
          pendingAction={roomSession.pendingAction}
          errorMessage={roomSession.errorMessage}
          onRequestRematch={roomSession.requestRematch}
          onLeaveRoom={roomSession.leaveRoom}
        />
      )}
    </AppLayout>
  );
}
