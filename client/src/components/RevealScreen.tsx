import type { PublicGameState } from "@drawing-game/shared";

import type { PendingRoomAction } from "../hooks/useRoomSession";
import { DrawingPreview } from "./drawing/DrawingPreview";
import { GameLeaveAction } from "./game/GameLeaveAction";
import { GamePhaseLayout } from "./game/GamePhaseLayout";
import {
  GamePromptHeader,
  GamePromptValue,
} from "./game/GamePromptHeader";
import { GameStatusPanel } from "./game/GameStatusPanel";
import { ScaleGauge } from "./scale/ScaleGauge";

interface RevealScreenProps {
  game: PublicGameState;
  pendingAction: PendingRoomAction;
  errorMessage: string | null;
  onLeaveRoom: () => void;
}

export function RevealScreen({
  game,
  pendingAction,
  errorMessage,
  onLeaveRoom,
}: RevealScreenProps) {
  const reveal = game.reveal;
  const isPending = pendingAction !== null;

  return (
    <GamePhaseLayout
      ariaLabel="Révélation du tour"
      className="reveal-screen"
      prompt={
        <GamePromptHeader
          statement={game.prompt.statement}
          gauge={
            <ScaleGauge
              lowLabel={game.prompt.lowLabel}
              highLabel={game.prompt.highLabel}
              value={reveal?.secretLevel ?? null}
              valueTextLabel="Niveau secret révélé"
              size="full"
            />
          }
          valueText={
            reveal === null ? undefined : (
              <GamePromptValue
                label="Le niveau secret était"
                value={reveal.secretLevel}
                separator=""
              />
            )
          }
        />
      }
      isBusy={isPending}
    >
      <div className="game-phase-layout__main game-media-viewport">
        {game.submittedDrawing === null ? (
          <p className="form-message form-message--error" role="alert">
            Le dessin soumis est indisponible.
          </p>
        ) : (
          <DrawingPreview
            drawing={game.submittedDrawing.document}
            description={`Dessin révélé de ${game.currentDrawer.nickname} pour la consigne « ${game.prompt.statement} ».`}
          />
        )}
      </div>

      <aside className="game-phase-layout__sidebar reveal-sidebar">
        <GameStatusPanel game={game} />

        {errorMessage !== null && (
          <p
            className="form-message form-message--error game-sidebar-message"
            role="alert"
          >
            {errorMessage}
          </p>
        )}

        {reveal === null ? (
          <section className="game-sidebar-section">
            <p className="card-label">Révélation</p>
            <h2>Résultats indisponibles</h2>
            <p className="form-message form-message--error" role="alert">
              Attendez le prochain état du serveur.
            </p>
          </section>
        ) : (
          <section
            className="reveal-results"
            aria-labelledby="reveal-results-title"
          >
            <div className="reveal-results__heading">
              <p className="card-label">Estimations validées</p>
              <h2 id="reveal-results-title">Réponses du groupe</h2>
            </div>
            <ol
              className="reveal-result-list"
              aria-label="Estimations validées du groupe"
              tabIndex={0}
            >
              {reveal.guesses.map((guess) => (
                <li key={guess.player.id}>
                  <span className="reveal-player-name">
                    {guess.player.nickname}
                  </span>
                  <span className="reveal-guess-value">
                    {guess.value} / 10
                  </span>
                  <strong className="reveal-distance">
                    {guess.distance === 0
                      ? "Exact !"
                      : `Écart : ${guess.distance}`}
                  </strong>
                </li>
              ))}
            </ol>
          </section>
        )}

        <GameLeaveAction
          id="reveal-leave-warning"
          message="Cette version reste sur la révélation."
          pendingAction={pendingAction}
          disabled={isPending}
          onLeaveRoom={onLeaveRoom}
        />
      </aside>
    </GamePhaseLayout>
  );
}
