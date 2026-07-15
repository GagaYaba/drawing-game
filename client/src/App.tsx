import { ConnectionPanel } from "./components/ConnectionPanel";
import { DrawingScreen } from "./components/DrawingScreen";
import { HealthCheck } from "./components/HealthCheck";
import { HomeScreen } from "./components/HomeScreen";
import { LobbyScreen } from "./components/LobbyScreen";
import { RoundIntroScreen } from "./components/RoundIntroScreen";
import { useRoomSession } from "./hooks/useRoomSession";

export function App() {
  const roomSession = useRoomSession();
  const room = roomSession.session.room;
  const currentPlayerId = roomSession.session.currentPlayerId;
  const game = room?.game ?? null;
  const currentPlayerSecret =
    game !== null && game.currentDrawer.id === currentPlayerId
      ? roomSession.gameSecrets.secretLevel
      : null;

  return (
    <main className="app-shell">
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
      ) : (
        <DrawingScreen
          game={game}
          currentPlayerId={currentPlayerId}
          secretLevel={currentPlayerSecret}
          pendingAction={roomSession.pendingAction}
          errorMessage={roomSession.errorMessage}
          onLeaveRoom={roomSession.leaveRoom}
        />
      )}

      <details className="diagnostics">
        <summary>Diagnostic technique</summary>
        <div className="panels diagnostics-panels">
          <ConnectionPanel />
          <HealthCheck />
        </div>
      </details>

      <footer>React · Express · Socket.IO · TypeScript</footer>
    </main>
  );
}
