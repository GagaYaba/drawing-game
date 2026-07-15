import { ConnectionPanel } from "./components/ConnectionPanel";
import { HealthCheck } from "./components/HealthCheck";

export function App() {
  return (
    <main className="app-shell">
      <header className="hero">
        <span className="hero-mark" aria-hidden="true">
          ✦
        </span>
        <p className="kicker">Fondation technique</p>
        <h1>Drawing Scale Game</h1>
        <p className="subtitle">Prototype multijoueur en ligne</p>
      </header>

      <div className="panels">
        <ConnectionPanel />
        <HealthCheck />
      </div>

      <footer>
        React · Express · Socket.IO · TypeScript
      </footer>
    </main>
  );
}
