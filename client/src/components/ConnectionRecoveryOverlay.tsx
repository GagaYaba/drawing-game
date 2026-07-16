import type { ClientConnectionStatus } from "../hooks/useRoomSession";
import { Mascot } from "./Mascot";

interface ConnectionRecoveryOverlayProps {
  status: ClientConnectionStatus;
  announcement: string | null;
  hasStoredSession: boolean;
  onRetry: () => void;
}

export function ConnectionRecoveryOverlay({
  status,
  announcement,
  hasStoredSession,
  onRetry,
}: ConnectionRecoveryOverlayProps) {
  const isDisconnected = status === "disconnected";
  const isRestoring = status === "restoring";
  const restoreFailed = status === "restore-failed";
  const isVisible =
    hasStoredSession && (isDisconnected || isRestoring || restoreFailed);
  const recoveryMascot = restoreFailed
    ? {
        character: "poop",
        expression: "sad",
        state: "failed",
      } as const
    : isDisconnected
      ? {
          character: "poop",
          expression: "confused",
          state: "disconnected",
        } as const
      : {
          character: "pig",
          expression: "fly",
          state: "restoring",
        } as const;

  return (
    <>
      <p
        className="visually-hidden"
        role="status"
        aria-live="assertive"
        aria-atomic="true"
      >
        {isVisible ? "" : (announcement ?? "")}
      </p>

      {isVisible && (
        <div className="connection-recovery-overlay">
          <section
            className="connection-recovery-card"
            role={restoreFailed ? "alert" : "status"}
            aria-live="assertive"
            aria-atomic="true"
            aria-labelledby="connection-recovery-title"
          >
            <span
              className={`connection-recovery-icon connection-recovery-icon--${recoveryMascot.state}`}
              aria-hidden="true"
            >
              <Mascot
                character={recoveryMascot.character}
                expression={recoveryMascot.expression}
                size="sm"
                decorative
                className={`connection-recovery-mascot connection-recovery-mascot--${recoveryMascot.state}`}
              />
            </span>
            <div>
              <p className="card-label">Connexion au salon</p>
              <h2 id="connection-recovery-title">
                {restoreFailed
                  ? "Restauration interrompue"
                  : isDisconnected
                  ? "Connexion interrompue"
                  : "Restauration de votre session…"}
              </h2>
              <p>
                {restoreFailed
                  ? (announcement ??
                    "Impossible de restaurer la session pour le moment.")
                  : isDisconnected
                  ? "Tentative de reconnexion…"
                  : "Votre place et votre progression sont en cours de récupération."}
              </p>
              <p className="connection-recovery-hint">
                Votre place est conservée pendant le délai de grâce accordé
                par le serveur.
              </p>
              {restoreFailed && (
                <button
                  className="button button--primary connection-recovery-retry"
                  type="button"
                  onClick={onRetry}
                >
                  Réessayer la restauration
                </button>
              )}
            </div>
          </section>
        </div>
      )}
    </>
  );
}
