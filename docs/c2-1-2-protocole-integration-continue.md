# C2.1.2 — Protocole d'intégration continue

Ce document définit le protocole d'intégration continue applicable au projet **Drawing Scale Game**. Il complète le document [C2.1.1 — Environnements, déploiement, qualité et performance](c2-1-1-environnements-deploiement-qualite-performance.md) sans reproduire son protocole de déploiement.

## Objectif du protocole

Le protocole organise l'intégration fréquente de modifications petites et cohérentes. Chaque proposition est vérifiée automatiquement avant son entrée dans `main` afin de détecter tôt les erreurs de types, tests, compilation, exécution et performance. Cette discipline limite les régressions et vise à conserver `main` dans un état vérifié.

L'intégration continue s'arrête à la fusion du code et à sa nouvelle validation sur `main`. Le déploiement est une étape distincte, déclenchée ensuite selon la configuration Render décrite dans le document C2.1.1. Une CI verte prouve que le code satisfait la porte configurée; elle ne prouve pas à elle seule qu'un déploiement a eu lieu ou fonctionne.

## Périmètre et sources de vérité

| Élément | Source de vérité | Rôle |
| --- | --- | --- |
| Workflow CI | [`.github/workflows/ci.yml`](../.github/workflows/ci.yml) | Déclencheurs, concurrence, job `Verify` et étapes automatisées. |
| Runtime | [`.node-version`](../.node-version) et `engines.node` de [`package.json`](../package.json) | Version exacte exécutée par la CI et plage déclarée par le projet. |
| Dépendances | [`package.json`](../package.json) et [`package-lock.json`](../package-lock.json) | Scripts du projet et graphe reproductible installé par `npm ci`. |
| Porte de non-régression | `npm run quality:check` | Point d'entrée unique utilisé localement et dans GitHub Actions. |
| Rapport | `reports/c2-1-1/quality-performance-report.json` | Preuve générée de l'environnement, des étapes et des mesures; fichier local ignoré par Git puis publié comme artefact CI. |
| Préparation d'une proposition | [`.github/pull_request_template.md`](../.github/pull_request_template.md) | Informations, checklist et preuves à fournir dans une pull request. |
| Environnements et seuils | [Document C2.1.1](c2-1-1-environnements-deploiement-qualite-performance.md) | Détail de la porte qualité/performance et du déploiement, hors périmètre de duplication de ce protocole. |

## Acteurs et responsabilités

| Acteur | Responsabilités |
| --- | --- |
| Développeur | Créer une branche dédiée, produire une modification limitée, adapter les tests et la documentation, tenter les contrôles locaux avec le bon runtime, analyser puis corriger les échecs. |
| GitHub | Héberger les branches, commits, pull requests, échanges de revue et preuves associées. |
| GitHub Actions | Déclencher le workflow, préparer Node, installer les dépendances, exécuter la porte et publier le rapport. |
| Personne validant la fusion | Vérifier le contenu de la proposition et le résultat entièrement vert du job `Verify` avant de fusionner. |

Le dépôt prouve le workflow et son job, mais ne permet pas de prouver qu'une protection de branche ou une approbation humaine obligatoire est active dans les paramètres GitHub. Le protocole impose de vérifier la CI avant fusion; les protections recommandées sont distinguées plus bas des mécanismes déjà versionnés.

## Séquence complète d'intégration

### Conditions d'entrée

- La branche locale `main` correspond au point de départ voulu et peut être mise à jour sans écraser de travail non commité.
- La modification à réaliser possède un objectif limité et compréhensible.
- Le développeur connaît la version Node déclarée dans `.node-version` ou sait que la validation complète sera assurée par GitHub Actions.

### Étapes

1. Mettre à jour la branche locale `main` à partir du dépôt distant.
2. Créer depuis `main` une branche de travail dédiée et nommée selon son objectif.
3. Réaliser une modification limitée et cohérente, sans mélanger des sujets indépendants.
4. Ajouter ou adapter les tests dès que le comportement du logiciel change.
5. Lancer les contrôles locaux compatibles avec l'environnement; utiliser `npm run quality:check` lorsque la version Node correspond exactement à `.node-version`.
6. Créer un commit atomique décrivant un seul changement logique.
7. Pousser la branche vers GitHub.
8. Ouvrir une pull request dont la base est `main` et compléter le modèle fourni.
9. Laisser l'événement `pull_request` déclencher automatiquement GitHub Actions.
10. Laisser le runner effectuer l'installation propre et reproductible avec `npm ci`.
11. Laisser `npm run quality:check` exécuter tous les contrôles de qualité et de non-régression.
12. Si la CI échoue, lire l'étape défaillante, reproduire le problème et corriger sur la même branche.
13. Pousser les corrections jusqu'à obtenir une exécution entièrement verte du job `Verify`.
14. Fusionner la pull request dans `main`. Une fusion **Squash and merge** est recommandée pour produire un historique lisible, mais le dépôt ne prouve pas que cette méthode est imposée techniquement.
15. Laisser le push résultant sur `main` déclencher une nouvelle exécution complète de la CI et vérifier sa réussite.
16. Conserver la pull request, le commit intégré, les journaux des deux exécutions et l'artefact du rapport comme preuves de l'intégration.

### Conditions de sortie

- Une pull request n'est pas prête à être fusionnée tant que `Verify` échoue ou n'est pas terminé.
- La séquence d'intégration est terminée lorsque la pull request est fusionnée **et** que la CI déclenchée sur `main` réussit.
- Un déploiement éventuellement déclenché après cette réussite appartient au protocole C2.1.1 et doit être prouvé séparément.

## Fréquence des contrôles

« Tester régulièrement » signifie ici :

- à chaque création et à chaque mise à jour d'une pull request ciblant `main`;
- après chaque push sur `main`, notamment celui produit par une fusion;
- à la demande grâce à `workflow_dispatch`, par exemple pour confirmer un état sans modifier le code.

La concurrence `ci-${{ github.workflow }}-${{ github.ref }}` avec `cancel-in-progress: true` annule une exécution devenue obsolète lorsqu'une exécution plus récente existe pour la même référence. Aucun déclenchement planifié n'est nécessaire pour ce cycle événementiel.

## Contrôles contre les régressions

La porte `npm run quality:check` exécute uniquement des contrôles réellement présents dans le dépôt :

1. vérification de la compatibilité Node à partir de `.node-version` et affichage de `engines.node`;
2. vérification statique TypeScript des workspaces;
3. suite complète de tests automatisés;
4. compilation de production des workspaces partagé, serveur et client;
5. smoke test du serveur compilé, du frontend, de Socket.IO et des arrêts gracieux;
6. mesures et budgets de non-régression concernant le démarrage, HTTP, Socket.IO et la taille du frontend;
7. production de `reports/c2-1-1/quality-performance-report.json` avec les statuts, durées, seuils, mesures et erreurs.

Dans GitHub Actions, la chaîne réellement configurée est :

1. checkout du dépôt avec `actions/checkout@v4`;
2. installation de Node depuis `.node-version` et cache npm avec `actions/setup-node@v4`;
3. installation propre avec `npm ci`;
4. exécution de `npm run quality:check` dans le job `Verify`;
5. publication du rapport avec `actions/upload-artifact@v7`, `if: always()`, y compris autant que possible lorsqu'une étape précédente échoue.

Tout code de sortie non nul de la porte fait échouer le job. Le rapport ne remplace pas les journaux : les deux doivent être consultés pour établir la cause d'un échec.

## Gestion des échecs et des conflits

- Ne jamais fusionner une pull request dont `Verify` échoue.
- Ouvrir le journal GitHub Actions, identifier la première étape défaillante et consulter le rapport lorsqu'il est disponible.
- Reproduire le problème localement avec la version Node attendue, puis corriger sur la branche de la pull request.
- Ajouter un test de non-régression lorsqu'un défaut fonctionnel est corrigé.
- Pousser la correction sur la même branche : la mise à jour de la pull request déclenche une nouvelle exécution.
- Si la branche entre en conflit avec `main`, mettre à jour la branche, résoudre explicitement les conflits et relancer toute la séquence de contrôle.
- Après résolution, attendre une nouvelle exécution entièrement verte avant toute fusion.
- Si une régression est découverte après fusion, créer une branche corrective et utiliser `git revert` sur le ou les commits concernés; faire passer le revert par le même cycle pull request et CI. Ne pas réécrire l'historique partagé par un force-push.

## Tableau des preuves

| Élément du protocole | Preuve vérifiable | État |
| --- | --- | --- |
| Déclencheurs et job CI | [`.github/workflows/ci.yml`](../.github/workflows/ci.yml) | Présent dans le dépôt. |
| Version d'exécution | [`.node-version`](../.node-version) et `engines.node` de [`package.json`](../package.json) | Présent dans le dépôt. |
| Installation reproductible | `npm ci` dans le workflow et [`package-lock.json`](../package-lock.json) | Présent dans le dépôt. |
| Porte de contrôle | Script `quality:check` de [`package.json`](../package.json) et [`scripts/quality-check.mjs`](../scripts/quality-check.mjs) | Présent dans le dépôt. |
| Première exécution verte connue | [GitHub Actions — run 36559191291](https://github.com/GagaYaba/drawing-game/actions/runs/36559191291) | URL fournie et à conserver comme preuve distante. |
| Préparation des pull requests | [`.github/pull_request_template.md`](../.github/pull_request_template.md) | Présent dans le dépôt. |
| Pull request C2.1.2 | URL de la future pull request | À obtenir après un futur push; aucune PR n'est créée par cette intervention. |
| Validation après fusion | URL de l'exécution déclenchée par le futur push de fusion sur `main` | À obtenir après fusion. |
| Rapport détaillé | Artefact `c2-1-1-quality-performance-report` de GitHub Actions | Configuré; présence à vérifier dans chaque exécution utilisée comme preuve. |

## Configuration GitHub recommandée

Les éléments précédents sont versionnés dans le dépôt. Les règles suivantes ne le sont pas : elles sont **à vérifier ou à activer dans les paramètres GitHub** pour la branche `main` :

- obliger les changements à passer par une pull request;
- exiger la réussite du contrôle `Verify` avant fusion;
- interdire les force-pushes;
- interdire la suppression de la branche principale.

Ces recommandations ne sont pas présentées comme déjà actives. Après configuration, une capture ou un export des règles peut compléter les preuves du protocole.

## Correspondance avec les critères C2.1.2

| Critère | Réponse du protocole |
| --- | --- |
| Le protocole d'intégration continue est explicité clairement. | Objectif, périmètre, sources de vérité, acteurs, fréquence, contrôles, gestion des échecs et preuves sont définis dans ce document. |
| Il permet de définir les séquences d'intégration. | Les 16 étapes ordonnées, leurs conditions d'entrée et de sortie, ainsi que les boucles de correction et de résolution des conflits rendent la séquence directement applicable. |
