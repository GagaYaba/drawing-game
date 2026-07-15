import { useEffect, useState } from "react";

import type { PublicGameState } from "@drawing-game/shared";

import type { PendingRoomAction } from "../hooks/useRoomSession";

interface RoundIntroScreenProps {
  game: PublicGameState;
  currentPlayerId: string | null;
  secretLevel: number | null;
  pendingAction: PendingRoomAction;
  errorMessage: string | null;
  onLeaveRoom: () => void;
}

function getSecondsRemaining(phaseEndsAt: number | null) {
  if (phaseEndsAt === null) {
    return null;
  }

  return Math.max(0, Math.ceil((phaseEndsAt - Date.now()) / 1_000));
}

export function RoundIntroScreen({
  game,
  currentPlayerId,
  secretLevel,
  pendingAction,
  errorMessage,
  onLeaveRoom,
}: RoundIntroScreenProps) {
  const [secondsRemaining, setSecondsRemaining] = useState(() =>
    getSecondsRemaining(game.phaseEndsAt),
  );
  const isDrawer = currentPlayerId === game.currentDrawer.id;
  const isPending = pendingAction !== null;

  useEffect(() => {
    const updateCountdown = () => {
      setSecondsRemaining(getSecondsRemaining(game.phaseEndsAt));
    };

    updateCountdown();

    if (game.phaseEndsAt === null) {
      return undefined;
    }

    const countdownTimer = window.setInterval(updateCountdown, 250);

    return () => {
      window.clearInterval(countdownTimer);
    };
  }, [game.phaseEndsAt]);

  const countdownMessage =
    secondsRemaining === null
      ? "Le dessin commencera dès que le serveur sera prêt."
      : secondsRemaining > 0
        ? `Le dessin commence dans ${secondsRemaining} seconde${secondsRemaining > 1 ? "s" : ""}…`
        : "Le serveur prépare la zone de dessin…";

  return (
    <section
      className="game-card game-phase round-intro"
      aria-labelledby="round-intro-title"
      aria-busy={isPending}
    >
      <header className="phase-heading">
        <div>
          <p className="eyebrow">Présentation du tour</p>
          <h2 id="round-intro-title">
            {isDrawer
              ? "C’est à vous de dessiner"
              : `${game.currentDrawer.nickname} va dessiner`}
          </h2>
        </div>
        <p
          className="countdown"
          role="status"
          aria-live="polite"
          aria-atomic="true"
        >
          {countdownMessage}
        </p>
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

      <div className="phase-content">
        <section className="prompt-card" aria-labelledby="intro-prompt-title">
          <p className="card-label">Consigne publique</p>
          <h3 id="intro-prompt-title">Consigne</h3>
          <p className="prompt-text">{game.prompt.text}</p>
        </section>

        {isDrawer ? (
          <aside className="secret-card" aria-labelledby="secret-level-title">
            <p className="card-label">Information privée</p>
            <h3 id="secret-level-title">Votre niveau secret</h3>
            {secretLevel === null ? (
              <p role="status" aria-live="polite">
                Réception de votre niveau secret…
              </p>
            ) : (
              <p
                className="secret-level"
                aria-label={`Votre niveau secret : ${secretLevel} sur 10`}
              >
                <strong>{secretLevel}</strong>
                <span>/ 10</span>
              </p>
            )}
            <p>Gardez ce nombre pour vous et représentez-le dans votre dessin.</p>
          </aside>
        ) : (
          <aside className="waiting-card" aria-labelledby="observer-role-title">
            <p className="card-label">Votre rôle</p>
            <h3 id="observer-role-title">Observez bien</h3>
            <p>
              Essayez ensuite de deviner le niveau secret représenté par le
              dessin.
            </p>
          </aside>
        )}
      </div>

      <div className="game-actions">
        <p id="round-leave-warning">
          Quitter maintenant annulera la partie pour le groupe.
        </p>
        <button
          className="button button--danger-ghost"
          type="button"
          onClick={onLeaveRoom}
          disabled={isPending}
          aria-describedby="round-leave-warning"
        >
          {pendingAction === "leave" ? "Départ…" : "Quitter la partie"}
        </button>
      </div>

      {pendingAction !== null && (
        <p className="visually-hidden" role="status" aria-live="polite">
          {pendingAction === "leave"
            ? "Départ de la partie en cours."
            : "Lancement de la partie en cours."}
        </p>
      )}
    </section>
  );
}
