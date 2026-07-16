import type {
  DrawingDocument,
  PublicGameState,
} from "@drawing-game/shared";

import type { PendingRoomAction } from "../hooks/useRoomSession";
import { DrawingEditor } from "./drawing/DrawingEditor";
import { GameLeaveAction } from "./game/GameLeaveAction";
import { GamePhaseLayout } from "./game/GamePhaseLayout";
import {
  GamePromptHeader,
  GamePromptValue,
} from "./game/GamePromptHeader";
import { GameStatusPanel } from "./game/GameStatusPanel";
import { ScaleGauge } from "./scale/ScaleGauge";

interface DrawingScreenProps {
  game: PublicGameState;
  currentPlayerId: string | null;
  secretLevel: number | null;
  pendingAction: PendingRoomAction;
  errorMessage: string | null;
  onSubmitDrawing: (drawing: DrawingDocument) => boolean;
  onLeaveRoom: () => void;
}

export function DrawingScreen({
  game,
  currentPlayerId,
  secretLevel,
  pendingAction,
  errorMessage,
  onSubmitDrawing,
  onLeaveRoom,
}: DrawingScreenProps) {
  const isDrawer = currentPlayerId === game.currentDrawer.id;
  const isPending = pendingAction !== null;
  const isSubmitting = pendingAction === "submitDrawing";
  const promptHeader = (
    <GamePromptHeader
      statement={game.prompt.statement}
      gauge={
        <ScaleGauge
          lowLabel={game.prompt.lowLabel}
          highLabel={game.prompt.highLabel}
          value={isDrawer ? secretLevel : null}
          valueTextLabel="Niveau à représenter"
          size="full"
        />
      }
      valueText={
        isDrawer && secretLevel !== null ? (
          <GamePromptValue
            label="Niveau à représenter"
            value={secretLevel}
          />
        ) : undefined
      }
    />
  );
  const leaveAction = (
    <GameLeaveAction
      id="drawing-leave-warning"
      message="Quitter annule la partie pour le groupe."
      pendingAction={pendingAction}
      disabled={isPending}
      onLeaveRoom={onLeaveRoom}
    />
  );

  return (
    <GamePhaseLayout
      ariaLabel="Phase de dessin"
      className="drawing-screen"
      prompt={promptHeader}
      isBusy={isPending}
    >
      {isDrawer ? (
        <DrawingEditor
          disabled={isPending || secretLevel === null}
          isSubmitting={isSubmitting}
          onSubmit={onSubmitDrawing}
          sidebarHeader={
            <>
              <GameStatusPanel game={game} />
              {errorMessage !== null && (
                <p
                  className="form-message form-message--error game-sidebar-message"
                  role="alert"
                >
                  {errorMessage}
                </p>
              )}
              {secretLevel === null && (
                <p
                  className="private-level-loading game-sidebar-message"
                  role="status"
                  aria-live="polite"
                >
                  Réception de votre niveau secret…
                </p>
              )}
            </>
          }
          sidebarFooter={leaveAction}
        />
      ) : (
        <>
          <div className="game-phase-layout__main drawing-observer-stage">
            <span className="drawing-observer-stage__icon" aria-hidden="true">
              ✎
            </span>
            <p>Le dessin apparaîtra ici après sa validation.</p>
          </div>

          <aside className="game-phase-layout__sidebar">
            <GameStatusPanel game={game} />

            {errorMessage !== null && (
              <p
                className="form-message form-message--error game-sidebar-message"
                role="alert"
              >
                {errorMessage}
              </p>
            )}

            <section
              className="game-sidebar-card game-sidebar-card--waiting"
              aria-labelledby="drawing-wait-title"
            >
              <p className="card-label">Dessin en cours</p>
              <h2 id="drawing-wait-title">
                {game.currentDrawer.nickname} dessine actuellement.
              </h2>
              <p>
                Son niveau reste secret. Le dessin apparaîtra seulement après
                sa validation.
              </p>
            </section>

            {leaveAction}

            {pendingAction !== null && (
              <p className="visually-hidden" role="status" aria-live="polite">
                {pendingAction === "leave"
                  ? "Départ de la partie en cours."
                  : "Action en cours."}
              </p>
            )}
          </aside>
        </>
      )}
    </GamePhaseLayout>
  );
}
