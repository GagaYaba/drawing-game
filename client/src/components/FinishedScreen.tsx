import type { PublicFinishedState } from "@drawing-game/shared";

import type { PendingRoomAction } from "../hooks/useRoomSession";
import { GameLeaderboard } from "./game/GameLeaderboard";
import { GameLeaveAction } from "./game/GameLeaveAction";
import { GamePhaseLayout } from "./game/GamePhaseLayout";

interface FinishedScreenProps {
  finished: PublicFinishedState | null;
  currentPlayerId: string | null;
  isHost: boolean;
  pendingAction: PendingRoomAction;
  errorMessage: string | null;
  onRequestRematch: () => boolean;
  onLeaveRoom: () => void;
}

function formatPoints(score: number) {
  return `${score} point${score === 1 ? "" : "s"}`;
}

function formatWinnerHeading(finished: PublicFinishedState) {
  if (finished.winners.length === 1) {
    return `Victoire de ${finished.winners[0]?.nickname ?? "la partie"}`;
  }

  return "Victoire partagée";
}

function formatResultAnnouncement(finished: PublicFinishedState) {
  const winningScore = finished.winners[0]?.score ?? 0;

  if (finished.winners.length === 0) {
    return "La partie est terminée sans gagnant annoncé.";
  }

  if (finished.winners.length === 1) {
    return `${finished.winners[0]?.nickname ?? "Le gagnant"} remporte la partie avec ${formatPoints(winningScore)}.`;
  }

  if (finished.winners.length === 2) {
    return `${finished.winners[0]?.nickname ?? "Le premier gagnant"} et ${finished.winners[1]?.nickname ?? "le second gagnant"} remportent la partie avec ${formatPoints(winningScore)}.`;
  }

  return `${finished.winners.length} joueurs terminent à égalité avec ${formatPoints(winningScore)}.`;
}

export function FinishedScreen({
  finished,
  currentPlayerId,
  isHost,
  pendingAction,
  errorMessage,
  onRequestRematch,
  onLeaveRoom,
}: FinishedScreenProps) {
  const isPending = pendingAction !== null;
  const isRequestingRematch = pendingAction === "rematch";

  return (
    <GamePhaseLayout
      ariaLabel="Partie terminée"
      className="finished-screen"
      isBusy={isPending}
      prompt={
        <header className="finished-header">
          <p className="card-label">Partie terminée</p>
          <h1>
            {finished === null
              ? "Résultats en attente"
              : formatWinnerHeading(finished)}
          </h1>
          {finished !== null && (
            <>
              <p
                className="finished-announcement"
                role="status"
                aria-live="polite"
                aria-atomic="true"
              >
                {formatResultAnnouncement(finished)}
              </p>
              <p className="finished-completion">
                {finished.completedRounds} manche
                {finished.completedRounds === 1 ? "" : "s"} ·{" "}
                {finished.completedTurns} tour
                {finished.completedTurns === 1 ? "" : "s"} joué
                {finished.completedTurns === 1 ? "" : "s"}
              </p>
            </>
          )}
        </header>
      }
    >
      <div className="game-phase-layout__main finished-stage">
        {finished === null ? (
          <p className="form-message form-message--error" role="alert">
            Les résultats finaux sont indisponibles. Attendez le prochain état
            du serveur.
          </p>
        ) : (
          <section
            className="finished-winners"
            aria-labelledby="finished-winners-title"
          >
            <p className="card-label">
              Gagnant{finished.winners.length > 1 ? "s" : ""}
            </p>
            <h2 id="finished-winners-title">
              {finished.winners.length === 1
                ? "La meilleure interprétation"
                : "Une première place partagée"}
            </h2>
            <div className="finished-winners__list">
              {finished.winners.map((winner) => (
                <article
                  key={winner.id}
                  className={
                    winner.id === currentPlayerId
                      ? "finished-winner-card finished-winner-card--current"
                      : "finished-winner-card"
                  }
                >
                  <span aria-hidden="true">★</span>
                  <strong>{winner.nickname}</strong>
                  <p>{formatPoints(winner.score)}</p>
                  {winner.id === currentPlayerId && <small>Vous</small>}
                </article>
              ))}
            </div>
          </section>
        )}
      </div>

      <aside className="game-phase-layout__sidebar finished-sidebar">
        {finished !== null && (
          <GameLeaderboard
            entries={finished.leaderboard}
            currentPlayerId={currentPlayerId}
            title="Classement final"
            ariaLabel="Classement final de la partie"
          />
        )}

        {errorMessage !== null && (
          <p
            className="form-message form-message--error game-sidebar-message"
            role="alert"
          >
            {errorMessage}
          </p>
        )}

        <section
          className="game-sidebar-section finished-rematch"
          aria-labelledby="finished-rematch-title"
        >
          <p className="card-label">Rejouer</p>
          <h2 id="finished-rematch-title">Une nouvelle partie ?</h2>
          {isHost ? (
            <>
              <p id="finished-rematch-description">
                Retrouvez le même groupe dans le lobby et préparez une nouvelle
                partie.
              </p>
              <button
                className="button button--primary finished-rematch-button"
                type="button"
                onClick={onRequestRematch}
                disabled={isPending}
                aria-describedby="finished-rematch-description"
              >
                {isRequestingRematch
                  ? "Préparation…"
                  : "Proposer une revanche"}
              </button>
              {isRequestingRematch && (
                <p
                  className="visually-hidden"
                  role="status"
                  aria-live="polite"
                >
                  Préparation de la revanche en cours.
                </p>
              )}
            </>
          ) : (
            <p
              className="form-message form-message--info"
              role="status"
              aria-live="polite"
            >
              L’hôte peut proposer une revanche.
            </p>
          )}
        </section>

        <GameLeaveAction
          id="finished-leave-note"
          message="La partie est terminée. Vous pouvez quitter le salon."
          pendingAction={pendingAction}
          disabled={isPending}
          onLeaveRoom={onLeaveRoom}
        />
      </aside>
    </GamePhaseLayout>
  );
}
