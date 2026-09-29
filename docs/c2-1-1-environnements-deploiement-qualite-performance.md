# C.2.1.1 — Environnements, déploiement continu, qualité et performance

Ce document constitue le protocole de référence du projet **Drawing Scale Game** pour la compétence C.2.1.1. Il décrit uniquement les environnements prouvés par le dépôt. Aucun environnement de recette ou de staging n'est actuellement configuré.

## Outils et composants identifiés

- **Éditeur** : Visual Studio Code est recommandé pour travailler sur le dépôt, mais il n'est ni imposé ni requis par les scripts.
- **Runtime** : Node.js `22.12.0`, fixé par [`.node-version`](../.node-version) et encadré par `engines.node` dans [`package.json`](../package.json).
- **Gestion du projet et des dépendances** : npm `>=10` et ses workspaces `client`, `server` et `shared`. Une installation reproductible utilise `npm ci` et `package-lock.json`.
- **Compilateur et analyse statique** : TypeScript/`tsc` `7.0.2`.
- **Frontend** : React `19.2.7`; Vite `8.1.4` fournit le serveur de développement et le build de production.
- **Tests** : Vitest `4.1.10`, complété par les smoke tests Node du dépôt.
- **Serveur applicatif** : Express `5.2.1`; Socket.IO et `socket.io-client` `4.8.3` assurent le temps réel et ses contrôles.
- **Gestion des sources** : Git et GitHub. Le dépôt ne fixe pas leur version et ne contient pas de preuve d'une règle de protection de branche active.
- **Intégration continue** : GitHub Actions, dans [`.github/workflows/ci.yml`](../.github/workflows/ci.yml).
- **Production** : un Web Service Node.js Render, décrit par [`render.yaml`](../render.yaml).

Les numéros de bibliothèques ci-dessus sont les versions résolues par le lockfile au moment de l'établissement de la référence. Le lockfile fait autorité pour l'installation CI; `.node-version` fait autorité pour Node.

## Environnements

| Environnement | Objectif | Outils, versions et définition | Commandes | Variables d'environnement | Ports ou URL | Données et limites |
| --- | --- | --- | --- | --- | --- | --- |
| Développement local | Modifier le monorepo avec rechargement rapide, vérifier types et tests. | VS Code recommandé et facultatif; Git; Node `22.12.0`; npm workspaces; TypeScript; Vite; Vitest; Express; Socket.IO. Définitions : `.node-version`, `package.json`, `package-lock.json`, `client/vite.config.ts`, `tsconfig*.json`. | `npm ci`, `npm run dev`, `npm run typecheck`, `npm test`, puis `npm run quality:check` avant PR. | `.env` local facultatif sur le modèle de `.env.example`; `PORT` vaut `3000` par défaut; `NODE_ENV`; `PLAYER_RECONNECT_GRACE_MS` facultatif. | Vite : `http://localhost:5173`; API et Socket.IO : `http://localhost:3000`, avec proxy Vite. | Les salons et parties ne vivent qu'en mémoire : arrêt du serveur = perte. Les stockages navigateur restent locaux au profil. La machine locale peut influer sur les temps mesurés. |
| Tests et intégration continue GitHub Actions | Rejouer automatiquement et bloquer la livraison si une exigence échoue. | Runner `ubuntu-latest`; `actions/checkout@v4`; `actions/setup-node@v4` lisant `.node-version`; npm; porte unique `quality:check`; `actions/upload-artifact@v7`. Définition : `.github/workflows/ci.yml`. | `npm ci`, puis `npm run quality:check`. Déclenchement sur PR, push vers `main` ou manuel. | Variables standard du runner GitHub; aucune variable applicative secrète n'est requise. La mesure démarre le serveur compilé avec `NODE_ENV=production` et `PORT=0`. | Ports éphémères en boucle locale, aucune URL publique. | Environnement jetable, aucun état conservé. Le rapport JSON est conservé 14 jours comme artefact autant que possible, même en cas d'échec. |
| Production simulée locale | Tester les artefacts compilés et leur arrêt comme en production, puis mesurer les non-régressions. | Node; build TypeScript/Vite; Express; Socket.IO; scripts `production-smoke.mjs`, `quality-performance-check.mjs` et modules partagés sous `scripts/lib`. | `npm run build`, `npm run smoke:production`, `npm run quality:performance`; la porte complète reste `npm run quality:check`. | Les scripts imposent `NODE_ENV=production` et `PORT=0` au processus enfant. | URL en boucle locale avec port éphémère détecté dans la sortie serveur. | Aucun trafic externe et aucune persistance. Les valeurs sont des critères locaux/CI, pas des SLA de production. |
| Production Render | Servir le frontend compilé, l'API Express et Socket.IO sur un domaine unique. | Render Web Service Node.js, région Frankfurt, offre Free, une instance; Node défini par `.node-version`/`engines`; Blueprint `render.yaml`; branche `main`. | Build : `npm ci --include=dev && npm run build`; démarrage : `npm start`; contrôle séparé : `npm run postdeploy:check -- --url https://…`. | `NODE_ENV=production`; `PLAYER_RECONNECT_GRACE_MS=60000`; `PORT` est fourni par Render. Aucun secret ni base de données. | URL publique Render; health check `/api/health`. | État uniquement en mémoire. Redémarrage, redéploiement ou mise en veille peuvent interrompre et supprimer toutes les parties actives. Une seule instance est requise sans stockage partagé. L'offre gratuite ne garantit ni disponibilité ni latence. |

## Protocole de déploiement continu

La séquence attendue est la suivante :

1. Créer une branche de travail depuis un `main` à jour, sans développer directement sur `main`.
2. Développer localement avec `npm run dev` et les contrôles ciblés utiles.
3. Exécuter localement la porte complète `npm run quality:check` avec Node `22.12.0`.
4. Publier la branche et ouvrir une pull request vers `main`.
5. Laisser GitHub Actions effectuer l'installation propre `npm ci` avec la version de `.node-version`.
6. Laisser la même commande `npm run quality:check` exécuter le typecheck, tous les tests, le build, le smoke test et les budgets qualité/performance; consulter son résumé et son artefact JSON.
7. Fusionner dans `main` uniquement si la CI et la revue sont validées. Cette règle relève du protocole : une protection de branche correspondante doit être vérifiée/configurée dans GitHub, car son existence n'est pas démontrable depuis ce dépôt.
8. Après le push fusionné sur `main`, laisser Render démarrer uniquement lorsque les checks sont réussis grâce à `autoDeployTrigger: checksPass`.
9. Laisser Render exécuter `npm ci --include=dev && npm run build`, puis `npm start` sur l'unique instance.
10. Vérifier que le health check Render `/api/health` devient sain.
11. Lancer la validation reproductible `npm run postdeploy:check -- --url <URL_RENDER>` afin de contrôler health, frontend, connexion Socket.IO et ping/pong sans créer de salon.
12. Conserver la version si tous les contrôles passent; sinon ouvrir immédiatement une branche de retour arrière et appliquer la procédure ci-dessous.

Ni ce protocole ni le dépôt ne prétendent fournir un environnement de staging. Un déploiement Render réel et ses réglages de compte restent des dépendances externes à vérifier dans l'interface de la plateforme.

## Retour arrière sûr

1. Identifier le dernier commit fonctionnel et le ou les commits fautifs avec `git log --oneline` et les résultats de CI/déploiement.
2. Créer une branche de correction depuis `main`.
3. Annuler les changements défectueux avec `git revert <commit>` — ou plusieurs `git revert` ordonnés — sans `git reset --hard` et sans force-push.
4. Exécuter `npm run quality:check`, ouvrir une PR et attendre la réussite de la CI.
5. Fusionner le revert dans `main`; `checksPass` autorise alors un nouveau déploiement automatique Render.
6. Relancer `npm run postdeploy:check -- --url <URL_RENDER>` et conserver les preuves.

Cette procédure ne dépend d'aucune fonction de rollback propre à Render non vérifiée. Tout redémarrage ou redéploiement détruit les salons et parties actifs, car ils résident dans la mémoire du processus; il faut prévenir les utilisateurs avant l'opération lorsque c'est possible.

## Porte de qualité unique

Depuis la racine :

```bash
npm ci
npm run quality:check
```

L'orchestrateur multiplateforme [`scripts/quality-check.mjs`](../scripts/quality-check.mjs) exécute successivement :

1. le contrôle du runtime : affichage de la version détectée, lecture de la version exacte dans `.node-version` et de la plage informative `engines.node`, puis arrêt immédiat si la version détectée diffère;
2. `npm run typecheck` sur les trois workspaces;
3. `npm test`, donc toute la suite Vitest serveur après build de `shared`;
4. `npm run build` pour `shared`, `server` et `client`;
5. `npm run smoke:production` sur le serveur compilé : health, frontend, Socket.IO, `SIGTERM` et `SIGINT`;
6. les mesures de démarrage, HTTP, Socket.IO et taille statique.

Le contrôle de runtime ne contient aucune copie de `22.12.0` : `.node-version` reste la source de vérité et `package.json` expose la plage supportée. Il utilise uniquement les API standard Node et fonctionne sous Windows, macOS et Linux. En cas d'incompatibilité, aucun accès Git, typecheck, test, build, smoke test ou benchmark n'est lancé; un rapport d'échec indique la version détectée et la version attendue.

Toute étape obligatoire échouée ou sautée rend le résultat global non nul. Le smoke test et la mesure partagent les sondes applicatives et le gestionnaire de serveur sous `scripts/lib`, ce qui limite les divergences entre les contrôles.

### Critères bloquants

| Domaine | Exigence versionnée |
| --- | --- |
| Runtime | Version Node exactement égale à `.node-version`; plage `engines.node` affichée dans le contrôle et le rapport. |
| TypeScript | 0 erreur `tsc` sur `shared`, `server` et `client`. |
| Tests | 0 test Vitest en échec. |
| Build | Build de production complet réussi. |
| Smoke | Health, document HTML Vite, connexion/ping Socket.IO et arrêts gracieux réussis. |
| Démarrage | Serveur compilé à l'écoute en `≤ 15 000 ms`. |
| HTTP après chauffe | 5 appels de chauffe, puis au moins 30 mesures; 100 % de succès; p95 `≤ 250 ms`. |
| Socket.IO après chauffe | 3 ping/pong de chauffe, puis au moins 20 mesures; 100 % de succès; p95 `≤ 500 ms`. |
| Frontend construit | Somme récursive de tous les fichiers de `client/dist` `≤ 2 150 000 octets`. |

Le percentile utilise la méthode déterministe du rang supérieur sur la série triée. Les appels en échec ne deviennent pas des latences artificielles : ils font échouer séparément le taux de succès de 100 %. Les tests unitaires couvrent le percentile, les comparaisons exactes et dépassées, le nombre minimal de mesures et le budget de fichiers.

### Référence du budget frontend

La mesure de référence établie sur le build existant est de **1 796 460 octets** pour 27 fichiers : 328 547 octets de JavaScript, 81 853 octets de CSS et 1 385 383 octets d'images. Le seuil statique versionné est **2 150 000 octets**, soit environ **19,68 %** au-dessus de la référence, donc sous la marge maximale demandée de 20 %.

Ce seuil laisse une marge limitée aux évolutions normales tout en détectant une hausse importante des ressources. Il n'est jamais recalculé automatiquement. Toute modification volontaire de la référence ou du seuil doit être expliquée et revue dans le code. Les seuils de temps et de taille sont des critères de non-régression en local/CI, pas des SLA Render.

## Rapport exploitable

Chaque exécution de `quality:check` affiche un résumé et remplace :

`reports/c2-1-1/quality-performance-report.json`

Le rapport contient les dates ISO de début et de fin, la durée globale, Node détecté, Node attendu, plage `engines.node`, compatibilité du runtime, système et architecture, commit Git si disponible, statut/durée/sortie utile de chaque étape, seuils, mesures, contrôles détaillés, résultat global et erreurs. `reports/` est ignoré par Git. GitHub Actions téléverse ce fichier comme artefact `c2-1-1-quality-performance-report` avec `if: always()` et une rétention de 14 jours; si le runtime est incompatible ou si l'orchestrateur échoue avant ses étapes normales, il écrit un rapport minimal d'échec.

## Validation post-déploiement

Sur une URL déjà accessible :

```bash
npm run postdeploy:check -- --url https://exemple.onrender.com
```

La variable `POST_DEPLOY_CHECK_URL` peut remplacer `--url`. Les options disponibles sont `--timeout <ms>`, `--attempts <1..5>` et `--retry-delay <ms>`. Par défaut, chaque sonde dispose de 20 secondes. Seul `/api/health` est retenté au plus trois fois, avec 2 puis 4 secondes d'attente, afin de borner un éventuel réveil Render. Une fois le service sain, le frontend, la connexion WebSocket Socket.IO et un unique échange `client:ping`/`server:pong` sont contrôlés sans retry et sans émission d'événement de salon ou de partie.

Le script retourne un code non nul et un message contextualisé sur timeout, HTTP inattendu, HTML invalide, connexion ou pong absent. Il s'agit du contrôle à exécuter après chaque déploiement et chaque rollback.

## Contrôle navigateur optionnel

Le parcours navigateur existant est exposé par :

```bash
npm run check:browser -- --url http://127.0.0.1:3000
```

Prérequis : build et serveur de production déjà démarré à l'URL fournie, ainsi qu'une installation Chrome, Chromium ou Edge détectable; `--chrome <chemin>` ou `CHROME_PATH` permet de préciser l'exécutable. Le script crée des salons et parcourt le jeu : contrairement au post-déploiement non mutatif, il ne doit pas viser une production utilisée sans accord. Il reste volontairement hors de la CI obligatoire afin de ne pas rendre la porte dépendante d'une installation Chromium fragile.

## Responsabilités et limites

- Le développeur produit une branche ciblée, exécute la porte locale et analyse les échecs.
- La revue et la CI GitHub valident la fusion; une protection de `main` est recommandée mais doit être confirmée dans les réglages GitHub.
- Render construit et démarre seulement après les checks configurés, puis son health check et le CLI post-déploiement valident le service.
- Les artefacts GitHub, journaux Render et rapports locaux fournissent les preuves; le dossier `reports/` local n'est pas versionné.
- Une mesure locale dépend du runner et ne prédit pas les performances réseau ou le réveil de l'offre gratuite Render.
- Il n'existe ni base de données, ni stockage partagé, ni haute disponibilité : une seule instance est une contrainte fonctionnelle actuelle.
