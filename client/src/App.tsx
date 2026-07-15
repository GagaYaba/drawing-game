import { ConnectionPanel } from "./components/ConnectionPanel";
import { HealthCheck } from "./components/HealthCheck";
import { HomeScreen } from "./components/HomeScreen";
import { LobbyScreen } from "./components/LobbyScreen";
import { useRoomSession } from "./hooks/useRoomSession";

export function App() {
  const roomSession = useRoomSession();

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

      {roomSession.session.room === null ? (
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
      ) : (
        <LobbyScreen
          room={roomSession.session.room}
          currentPlayerId={roomSession.session.currentPlayerId}
          pendingAction={roomSession.pendingAction}
          errorMessage={roomSession.errorMessage}
          onSetReady={roomSession.setReady}
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
