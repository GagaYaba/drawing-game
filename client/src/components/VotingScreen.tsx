import type { PublicGameState } from "@drawing-game/shared";

import type { PendingRoomAction } from "../hooks/useRoomSession";
import { DrawingPreview } from "./drawing/DrawingPreview";
import { ScaleGauge } from "./scale/ScaleGauge";

interface VotingScreenProps {
  game: PublicGameState;
  currentPlayerId: string | null;
  secretLevel: number | null;
  pendingAction: PendingRoomAction;
  errorMessage: string | null;
  onLeaveRoom: () => void;
}

export function VotingScreen({
  game,
  currentPlayerId,
  secretLevel,
  pendingAction,
  errorMessage,
  onLeaveRoom,
}: VotingScreenProps) {
  const isDrawer = currentPlayerId === game.currentDrawer.id;
  const isPending = pendingAction !== null;

  return (
    <section
      className="game-card game-phase voting-screen"
      aria-labelledby="voting-title"
      aria-busy={isPending}
    >
      <header className="phase-heading">
        <div>
          <p className="eyebrow">Dessin envoyé</p>
          <h2 id="voting-title">
            {isDrawer ? "Votre dessin a bien été envoyé" : "Observez le dessin"}
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

      <section className="phase-primary-card phase-primary-card--compact" aria-labelledby="voting-prompt-title">
        <div className="phase-prompt">
          <p className="card-label">Consigne du tour</p>
          <h3 id="voting-prompt-title">À représenter</h3>
          <p className="prompt-text">{game.prompt.statement}</p>
        </div>

        {isDrawer && secretLevel !== null ? (
          <ScaleGauge
            lowLabel={game.prompt.lowLabel}
            highLabel={game.prompt.highLabel}
            value={secretLevel}
            showValueText
            size="compact"
          />
        ) : (
          <ScaleGauge
            lowLabel={game.prompt.lowLabel}
            highLabel={game.prompt.highLabel}
            size="compact"
          />
        )}
      </section>

      <div className="voting-content">
        {game.submittedDrawing === null ? (
          <p className="form-message form-message--error" role="alert">
            Le dessin soumis est indisponible. Attendez le prochain état du
            serveur.
          </p>
        ) : (
          <DrawingPreview
            drawing={game.submittedDrawing.document}
            description={`Dessin soumis par ${game.currentDrawer.nickname} pour la consigne « ${game.prompt.statement} ».`}
          />
        )}

        {isDrawer ? (
          <aside className="secret-card voting-message" aria-labelledby="drawer-vote-title">
            <p className="card-label">Prochaine étape</p>
            <h3 id="drawer-vote-title">Le groupe votera bientôt</h3>
            <p>
              Votre niveau reste privé. Les autres joueurs devront bientôt
              estimer ce que votre dessin représente.
            </p>
          </aside>
        ) : (
          <aside className="waiting-card voting-message" aria-labelledby="observer-vote-title">
            <p className="card-label">Prochaine étape</p>
            <h3 id="observer-vote-title">Le vote arrive bientôt</h3>
            <p>
              Vous devrez bientôt estimer le niveau représenté. Aucun contrôle
              de vote n’est encore disponible.
            </p>
          </aside>
        )}
      </div>

      <div className="game-actions">
        <p id="voting-leave-warning">
          Quitter maintenant annulera la partie pour le groupe.
        </p>
        <button
          className="button button--danger-ghost"
          type="button"
          onClick={onLeaveRoom}
          disabled={isPending}
          aria-describedby="voting-leave-warning"
        >
          {pendingAction === "leave" ? "Départ…" : "Quitter la partie"}
        </button>
      </div>

      {pendingAction !== null && (
        <p className="visually-hidden" role="status" aria-live="polite">
          Départ de la partie en cours.
        </p>
      )}
    </section>
  );
}
