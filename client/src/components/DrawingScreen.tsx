import type { PublicGameState } from "@drawing-game/shared";

import type { PendingRoomAction } from "../hooks/useRoomSession";

interface DrawingScreenProps {
  game: PublicGameState;
  currentPlayerId: string | null;
  secretLevel: number | null;
  pendingAction: PendingRoomAction;
  errorMessage: string | null;
  onLeaveRoom: () => void;
}

export function DrawingScreen({
  game,
  currentPlayerId,
  secretLevel,
  pendingAction,
  errorMessage,
  onLeaveRoom,
}: DrawingScreenProps) {
  const isDrawer = currentPlayerId === game.currentDrawer.id;
  const isPending = pendingAction !== null;

  return (
    <section
      className="game-card game-phase drawing-screen"
      aria-labelledby="drawing-title"
      aria-busy={isPending}
    >
      <header className="phase-heading">
        <div>
          <p className="eyebrow">Dessin en cours</p>
          <h2 id="drawing-title">
            {isDrawer
              ? "À vous de dessiner"
              : `${game.currentDrawer.nickname} est en train de dessiner…`}
          </h2>
        </div>
      </header>

      <ul className="phase-meta" aria-label="Progression de la partie">
        <li>
          <span>Manche</span>
          <strong>
            {game.currentRound} / {game.totalRounds}
          </strong>
        </li>
        <li>
          <span>Tour</span>
          <strong>
            {game.currentTurnNumber} / {game.totalTurns}
          </strong>
        </li>
        <li>
          <span>Dessinateur</span>
          <strong>{game.currentDrawer.nickname}</strong>
        </li>
      </ul>

      {errorMessage !== null && (
        <p className="form-message form-message--error" role="alert">
          {errorMessage}
        </p>
      )}

      <section className="prompt-card" aria-labelledby="drawing-prompt-title">
        <p className="card-label">Consigne publique</p>
        <h3 id="drawing-prompt-title">Consigne</h3>
        <p className="prompt-text">{game.prompt.text}</p>
      </section>

      {isDrawer ? (
        <div className="drawer-area">
          <aside className="secret-card" aria-labelledby="drawing-level-title">
            <p className="card-label">Information privée</p>
            <h3 id="drawing-level-title">Niveau à représenter</h3>
            {secretLevel === null ? (
              <p role="status" aria-live="polite">
                Réception de votre niveau secret…
              </p>
            ) : (
              <p
                className="secret-level"
                aria-label={`Niveau à représenter : ${secretLevel} sur 10`}
              >
                <strong>{secretLevel}</strong>
                <span>/ 10</span>
              </p>
            )}
          </aside>

          <div
            className="drawing-placeholder"
            role="img"
            aria-label="Emplacement de la future zone de dessin"
          >
            <strong>Zone de dessin à venir</strong>
            <span>Le canvas et ses outils seront ajoutés à l’étape suivante.</span>
          </div>
        </div>
      ) : (
        <aside className="waiting-card drawing-waiting" aria-labelledby="drawing-wait-title">
          <p className="card-label">En attendant le dessin</p>
          <h3 id="drawing-wait-title">
            {game.currentDrawer.nickname} dessine en ce moment
          </h3>
          <p>Vous découvrirez bientôt son dessin et pourrez estimer son niveau.</p>
        </aside>
      )}

      <div className="game-actions">
        <p id="drawing-leave-warning">
          Quitter maintenant annulera la partie pour le groupe.
        </p>
        <button
          className="button button--danger-ghost"
          type="button"
          onClick={onLeaveRoom}
          disabled={isPending}
          aria-describedby="drawing-leave-warning"
        >
          {pendingAction === "leave" ? "Départ…" : "Quitter la partie"}
        </button>
      </div>

      {pendingAction !== null && (
        <p className="visually-hidden" role="status" aria-live="polite">
          {pendingAction === "leave"
            ? "Départ de la partie en cours."
            : "Action en cours."}
        </p>
      )}
    </section>
  );
}
