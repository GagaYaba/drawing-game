# Drawing Scale Game

SERVEUR EN LIGNE : https://drawing-scale-game.onrender.com/

[![CI](https://github.com/GagaYaba/drawing-game/actions/workflows/ci.yml/badge.svg)](https://github.com/GagaYaba/drawing-game/actions/workflows/ci.yml)

Application multijoueur de dessin en temps réel. Les joueurs créent ou rejoignent un salon, se préparent dans le lobby, puis enchaînent deux manches complètes de dessin, d'estimation et de score avant de découvrir le classement final.

## Fonctionnalités actuelles

- création d'un salon avec un pseudonyme et un code d'invitation unique de 5 caractères ;
- connexion à un salon existant par son code ou par un lien d'invitation ;
- liste des joueurs synchronisée en temps réel, avec identification de l'hôte et du joueur courant ;
- statut `Prêt` ou `Pas prêt` modifiable par chaque joueur ;
- lancement réservé à l'hôte à partir de 3 joueurs lorsque tout le monde est prêt ;
- phases de partie `LOBBY`, `ROUND_INTRO`, `DRAWING`, `VOTING`, `REVEAL` et `FINISHED`, pilotées par le serveur ;
- affichage d’une consigne publique structurée et de sa jauge de 1 à 10, avec repère privé uniquement pour le dessinateur avant la révélation ;
- partie complète de 2 manches, avec un passage de chaque joueur comme dessinateur par manche selon un ordre fixé au démarrage ;
- canvas vectoriel 4:3 compatible souris, tactile et stylet, avec crayon, gomme, palette, épaisseurs, annulation et effacement ;
- soumission autorisée uniquement au dessinateur courant et aperçu synchronisé du dessin en phase `VOTING` ;
- sélection locale d’une estimation de 1 à 10 par chaque non-dessinateur, puis confirmation définitive validée par le serveur ;
- confidentialité des valeurs pendant `VOTING` : seul le compteur d’estimations reçues est public ;
- passage automatique à `REVEAL` après le dernier vote requis, avec attribution atomique des points, publication du détail des résultats et classement cumulatif ;
- continuation réservée à l'hôte après chaque révélation, jusqu'à l'écran `FINISHED` qui annonce tous les gagnants ex æquo ;
- identifiant `gameId` unique généré par le serveur pour chaque partie lancée dans un salon ;
- revanche autoritaire proposée uniquement par l'hôte depuis `FINISHED`, avec retour de tout le groupe au lobby, scores remis à zéro et nouveaux statuts prêts requis ;
- jeton de session privé de 256 bits généré à la création ou à la connexion, dont seul le hash SHA-256 est conservé côté serveur ;
- restauration automatique du même joueur et du même salon après actualisation, fermeture d'onglet ou courte coupure réseau ;
- délai de grâce de reconnexion de 60 secondes par défaut, avec présence `Reconnexion…` visible par les autres joueurs ;
- restauration privée du niveau secret du dessinateur et de sa propre estimation déjà validée, sans exposer les données d'un autre joueur ;
- conservation locale du brouillon vectoriel du dessinateur et de la sélection de vote non envoyée, protégées par `roomCode`, `gameId`, `turnId` et `playerId` ;
- fermeture du salon aux nouveaux joueurs dès le lancement ;
- annulation immédiate de la partie si un joueur la quitte volontairement pendant une phase active ;
- annulation et retour au lobby uniquement à l'expiration du délai de reconnexion d'un joueur pendant une phase active ;
- conservation du résultat historique si un joueur quitte ou expire pendant `FINISHED`, avec transfert de l'hôte permettant au groupe restant de proposer une revanche ;
- départ volontaire immédiat, invalidation de la session et transfert du rôle d'hôte au joueur présent depuis le plus longtemps ;
- suppression automatique d'un salon devenu vide ;
- messages d'erreur pour les codes invalides, salons inexistants ou pleins et pseudonymes invalides ou déjà utilisés ;
- outils de diagnostic pour l'API et la connexion Socket.IO.

Un salon peut être créé par un joueur seul, en attendant les autres, et accepte au maximum **8 joueurs**. Les pseudonymes contiennent entre 2 et 20 caractères et doivent être uniques dans un même salon sans tenir compte de la casse.

## Stack technique

- monorepo TypeScript géré avec npm workspaces ;
- frontend React, Vite, Socket.IO Client et CSS ;
- serveur Node.js, Express et Socket.IO ;
- `tsx` et `concurrently` pour le développement ;
- contrats Socket.IO partagés et typés.

## Workspaces

| Workspace | Rôle |
| --- | --- |
| `client` | Écrans React, éditeur vectoriel sur canvas, aperçu réutilisable, session locale, connexion Socket.IO et proxy Vite en développement. |
| `server` | API Express, gestion en mémoire des salons et des parties complètes, serveur HTTP/Socket.IO, tests et hébergement du frontend construit en production. |
| `shared` | Noms des événements, payloads et états publics typés échangés entre le client et le serveur. |

Les commandes décrites ci-dessous s'exécutent toutes depuis la racine du dépôt.

## Prérequis

- Node.js : version indiquée dans `.node-version` ;
- npm : version 10 ou ultérieure.

Vous pouvez vérifier les versions installées avec :

```bash
node --version
npm --version
```

## Installation

Installez les dépendances de la racine et des trois workspaces :

```bash
npm install
```

Le serveur utilise le port défini par la variable d'environnement `PORT`, avec `3000` comme valeur par défaut. `PLAYER_RECONNECT_GRACE_MS` configure le délai de grâce de reconnexion en millisecondes et vaut `60000` par défaut. Les valeurs attendues sont documentées dans `.env.example` ; aucun secret statique n'est nécessaire.

## Développement

Lancez simultanément le serveur Express et le frontend Vite :

```bash
npm run dev
```

Les services sont alors accessibles aux adresses suivantes :

- frontend Vite : <http://localhost:5173> ;
- serveur Express : <http://localhost:3000> ;
- endpoint de santé : <http://localhost:3000/api/health>.

Vite redirige `/api` et `/socket.io` vers Express, y compris les connexions WebSocket. Le frontend peut donc appeler l'API et Socket.IO sans URL de serveur codée en dur.

## Essayer une partie à plusieurs joueurs

1. Lancez l'application avec `npm run dev`, puis ouvrez <http://localhost:5173> dans un premier navigateur.
2. Saisissez un pseudonyme et cliquez sur **Créer une partie**.
3. Dans le lobby, copiez le code à 5 caractères ou le lien d'invitation.
4. Ouvrez l'application dans un autre navigateur ou une fenêtre privée. Pour un autre appareil, ouvrez d'abord l'application via l'adresse réseau locale de la machine qui héberge le serveur afin que le lien copié utilise cette adresse plutôt que `localhost`.
5. Saisissez un pseudonyme différent et le code, puis cliquez sur **Rejoindre la partie**. Avec le lien d'invitation, le code est prérempli mais la connexion n'est pas automatique.
6. Répétez l'opération pour réunir au moins 3 joueurs, avec un maximum de 8. Les arrivées, départs et changements de statut sont visibles immédiatement par tous les membres du salon.
7. Chaque joueur clique sur **Je suis prêt**.
8. L'hôte clique sur **Lancer la partie**. Les autres joueurs voient que le lancement lui est réservé.

### Conditions de démarrage et rôle de l'hôte

Le serveur autorise le lancement uniquement lorsque toutes les conditions suivantes sont réunies :

- le salon est encore dans la phase `LOBBY` ;
- il contient au moins 3 joueurs ;
- tous les joueurs sont prêts ;
- la demande provient de l'hôte.

Le bouton **Lancer la partie** n'est affiché qu'à l'hôte et reste désactivé tant que `canStart` vaut `false`. Les autres joueurs voient un message leur indiquant que l'hôte lancera la partie. Une déconnexion temporaire conserve le rôle de l'hôte et bloque le lancement tant que le groupe n'est pas de nouveau connecté. Si l'hôte quitte volontairement ou ne revient pas avant l'expiration de son délai, son rôle est transféré au joueur restant présent depuis le plus longtemps.

Une fois la partie lancée, le salon est fermé : toute nouvelle tentative de connexion avec son code est refusée. Les statuts prêt et un second lancement ne peuvent plus modifier la partie en cours.

### Déroulement d'une partie

Le serveur reste la source d'autorité pour les phases et leurs transitions :

1. `LOBBY` : les joueurs rejoignent le salon, se déclarent prêts et l'hôte lance la partie.
2. `ROUND_INTRO` : tous voient la manche, le numéro du tour, le dessinateur et la consigne publique. Cette introduction dure environ 3 secondes ; l'interface affiche un compte à rebours dérivé de l'heure de fin envoyée par le serveur, sans changer elle-même de phase.
3. `DRAWING` : la transition est diffusée par le serveur. Le dessinateur voit la consigne, son niveau secret sur 10 et l'éditeur vectoriel. Les autres joueurs voient la consigne, l'identité du dessinateur et un écran d'attente, mais jamais son niveau secret.
4. `VOTING` : après validation du dessin, chaque joueur autre que le dessinateur choisit localement une valeur de 1 à 10, peut la modifier puis la confirme définitivement. Le serveur identifie le votant grâce à son socket, refuse le dessinateur et les doubles votes, et ne publie que la progression globale.
5. `REVEAL` : le dernier vote valide déclenche cette phase dans la même opération serveur. Les points sont appliqués une seule fois, puis le niveau secret, les estimations, leurs distances, les points gagnés, les scores totaux, le classement et le prochain dessinateur deviennent publics.
6. `FINISHED` : après le dernier tour de la deuxième manche, l'hôte continue une dernière fois depuis `REVEAL`. Le serveur publie alors le classement final, le nombre de manches et de tours terminés ainsi que tous les gagnants au meilleur score. L'hôte peut ensuite proposer une revanche dans le même salon.

L'ordre des joueurs est mélangé une seule fois au lancement, puis reste fixe pendant les deux manches. Chaque joueur dessine exactement une fois par manche, soit `nombre de joueurs × 2` tours. Depuis chaque `REVEAL`, seul l'hôte peut envoyer `game:continue` pour démarrer le tour suivant ou terminer la partie. Depuis `FINISHED`, seul l'hôte peut envoyer `game:request-rematch`.

Chaque partie possède un `gameId` généré avec `crypto.randomUUID()` au moment de son lancement. Le code du salon reste stable, mais une nouvelle partie lancée après une revanche reçoit toujours un nouveau `gameId`. Chaque tour possède en plus son propre `turnId`. Le niveau secret est transmis avec `gameId` et `turnId` dans l'événement privé `turn:secret`, au seul socket du dessinateur. Il ne fait pas partie de l'état public avant `REVEAL`. Le client n'accepte un secret que si le salon, la partie, le tour et le dessinateur correspondent encore à son état public actif ; les acknowledgements retardés sont également neutralisés par les jetons locaux d'action et les changements d'identifiants.

### Revanche dans le même salon

La revanche ne démarre pas automatiquement une nouvelle partie et ne fait l'objet d'aucun vote collectif. Sur l'écran final, l'hôte voit le bouton **Proposer une revanche** ; les autres joueurs voient que cette action lui est réservée. Le serveur vérifie le socket, le joueur, son rôle d'hôte et la phase `FINISHED` avant d'accepter `game:request-rematch`.

Une demande acceptée :

- conserve le code du salon, les joueurs encore présents, leurs identifiants publics, leur ordre d'arrivée et l'hôte courant ;
- conserve les mêmes jetons privés de session pour les joueurs toujours présents ;
- supprime entièrement l'état de la partie terminée ;
- remet chaque score à `0` et chaque statut `isReady` à `false` ;
- efface les dessins, estimations, secrets, résultats, classements temporaires, identifiants de tour et consignes utilisées avec l'ancien état de partie ;
- diffuse un nouvel état public avec `game: null`, `allPlayersReady: false` et `canStart: false`.

Le lobby réapparaît sans rechargement et annonce que la revanche est prête. Chaque joueur doit cliquer de nouveau sur **Je suis prêt**. Lorsque les conditions ordinaires sont réunies, l'hôte utilise le bouton existant **Lancer la partie**. Ce lancement recrée une partie indépendante avec un nouveau `gameId`, un nouvel ordre mélangé, un nouveau premier `turnId`, un nouveau secret et une liste de consignes utilisées vide. Les consignes de la partie précédente peuvent donc être sélectionnées à nouveau.

Deux demandes de revanche successives ne peuvent pas réinitialiser le salon deux fois : après la première, `game` vaut déjà `null` et la seconde est refusée. Une demande provenant d'un non-hôte, d'un socket extérieur ou d'une phase autre que `FINISHED` est également refusée côté serveur.

### Interface plein écran pendant la partie

Pendant `ROUND_INTRO`, `DRAWING`, `VOTING`, `REVEAL` et `FINISHED`, l'interface utilise l'espace disponible comme un écran de jeu dédié et masque le header de marque global. Dans les quatre phases liées à la consigne, celle-ci reste compacte et une grande jauge occupe toute la largeur utile juste sous son énoncé. Sur ordinateur, le reste du contenu s'organise autour d'une zone principale et d'une sidebar afin de garder les informations et actions utiles visibles sans disperser l'attention.

En phase `VOTING`, `GuessScale` reste dans ce header de phase, directement sous la consigne, tandis que la sidebar conserve la progression du vote, l'action de validation puis le message d'attente après confirmation. Sur mobile, la mise en page repasse en une colonne et autorise le défilement vertical lorsque le contenu dépasse la hauteur du viewport. Le canvas conserve son ratio **4:3** tout en ajustant sa taille à l'espace disponible, et l'interface de vote reste compacte pour préserver la place du dessin et de la jauge.

## Direction artistique

L'interface adopte un fond rose poudré et une identité ludique portée par deux mascottes déclinées en plusieurs expressions. Elles accompagnent les formulaires, les états de connexion et les différentes phases de la partie sans remplacer les libellés textuels nécessaires à l'accessibilité.

Sur les jauges, le caca représente l'extrémité **1** et le cochon l'extrémité **10**. Les graduations numériques et les libellés de niveau restent toujours visibles afin que les mascottes renforcent le repère visuel sans devenir l'unique moyen de comprendre l'échelle.

## Consignes structurées et jauges de niveau

Chaque consigne est désormais un objet structuré contenant :

```ts
interface DrawingPrompt {
  id: string;
  statement: string;
  lowLabel: string;
  highLabel: string;
  category: string;
}
```

La banque contient 52 consignes dotées d'identifiants uniques : les 36 sujets historiques ont été reformulés et 16 nouvelles situations ont été ajoutées. Le serveur mémorise les identifiants déjà utilisés et choisit chaque nouveau tour parmi les consignes restantes : une consigne ne peut donc pas être rejouée au cours de la même partie.

Chaque phrase associe une courte mise en situation, une mission dessinable et une échelle allant de l’extrême **1** à l’extrême **10**. Par exemple : `Une fée passe l’examen final de magie devant un jury sévère. Imaginez son sort, de l’étincelle qui s’éteint à la tempête magique qui remplit la salle.` Les formulations vagues telles que « plus ou moins » ne sont pas admises. Les libellés `lowLabel` et `highLabel` sont transmis séparément dans l’état public afin que le frontend n’ait jamais à analyser la phrase.

Dans `ROUND_INTRO`, `DRAWING`, `VOTING` et `REVEAL`, la jauge horizontale s'étend sur toute la largeur disponible directement sous la consigne. Elle comprend dix segments colorés, des graduations de 1 à 10 et les deux libellés d’extrémité. Le composant React `ScaleGauge` reste un composant de présentation réutilisable, responsive et accessible. Il affiche le niveau privé du dessinateur pendant les phases autorisées, la propre estimation verrouillée d'un votant ou le secret public pendant `REVEAL`.

`GuessScale` ajoute l'interaction sans connaître Socket.IO, le salon ou le joueur. En phase `VOTING`, il prend la place de la jauge dans le header, hors de la sidebar, et réutilise les dix couleurs ainsi que le calcul de position de `ScaleGauge`. Il rend dix vrais boutons accessibles intitulés `Choisir X sur 10`. La sélection fonctionne à la souris, au toucher et au clavier, expose aussi la valeur en texte et reste entièrement locale tant que le joueur n'a pas confirmé.

Le repère triangulaire et le texte du niveau secret ne sont rendus avant `REVEAL` que lorsque le client du dessinateur fournit sa valeur privée. Les autres joueurs voient la même échelle sans secret. Les tests automatisés parcourent toute la banque de consignes, vérifient sa projection publique et la confidentialité du secret, puis couvrent les jauges informatives et interactives, leurs positions 1, 5 et 10, leur état désactivé et leur balisage accessible.

## Estimations autoritaires et révélation

Pendant `VOTING`, tous les joueurs présents sauf le dessinateur sont calculés comme votants autorisés par le moteur. Le client envoie uniquement :

```ts
guess:submit
{ turnId: string, value: number }
```

L'identifiant du joueur, le code du salon, le secret et le nombre de votes attendus ne font jamais partie du payload. Le serveur retrouve le salon et le joueur à partir de `socket.id`, exige exactement les clés `turnId` et `value`, puis vérifie que le tour annoncé est toujours actif avant d'accepter un nombre fini, entier et compris entre 1 et 10. Une estimation retardée d'un ancien tour est refusée sans modifier le vote ou les scores. Une estimation acceptée est horodatée et son acknowledgement privé contient seulement la propre valeur du votant et `submittedAt`.

Avant confirmation, le joueur peut changer librement de segment et aucune donnée n'est envoyée. Le bouton **Valider mon estimation** reste désactivé sans choix et demande une confirmation définitive. Après un acknowledgement réussi, la jauge devient non interactive et le joueur attend les autres. Une erreur conserve son choix local afin qu'il puisse réessayer.

L'état public de vote se limite à :

```ts
interface PublicVotingState {
  eligibleVoterCount: number;
  submittedGuessCount: number;
}
```

Il ne contient ni valeur, ni secret, ni nom des joueurs ayant déjà répondu, ni distance, moyenne ou distribution. Tous les clients peuvent donc afficher `2 estimations reçues sur 3` sans apprendre qui a voté ou quelle valeur a été choisie.

Le dernier vote attendu fait passer atomiquement le moteur à `REVEAL`. L'état public contient alors le secret et, pour chaque non-dessinateur, son estimation et :

```ts
distance = Math.abs(guess.value - secretLevel)
```

Les points du votant diminuent avec cette distance :

| Distance au secret | Points gagnés |
| ---: | ---: |
| `0` | `5` |
| `1` | `4` |
| `2` | `3` |
| `3` | `2` |
| `4` | `1` |
| `5` ou plus | `0` |

Le dessinateur gagne `1` point pour chaque estimation exacte ou située à une unité du secret, dans la limite de `5` points par tour. Le nombre total d'estimations proches reste visible même s'il dépasse ce plafond. Tous les points du tour sont ajoutés aux scores cumulatifs dans la même transition vers `REVEAL` et ne peuvent pas être appliqués une seconde fois.

L'écran de révélation affiche `Exact !` pour une distance nulle ou `Écart : N` dans les autres cas, les points gagnés par chaque votant, le résultat du dessinateur, les scores totaux, le classement et le prochain dessinateur. Le classement est trié par score décroissant. Les joueurs à égalité partagent le même rang selon un classement de compétition, par exemple `1, 2, 2, 4`, tandis que leur ordre d'affichage reste stable selon l'ordre de rotation.

Un bouton de continuation est proposé uniquement à l'hôte. Il démarre le tour suivant avec un nouveau `turnId`, une nouvelle consigne encore inutilisée et le prochain dessinateur de la rotation. Après le dernier tour, il ouvre `FINISHED`, qui affiche le classement final et tous les gagnants ex æquo. Cet écran propose ensuite la revanche uniquement à l'hôte.

## Dessin vectoriel

Le client conserve le dessin en mémoire sous forme de traits vectoriels plutôt que d'image bitmap. Les coordonnées sont normalisées entre `0` et `1`, indépendamment de la taille d'affichage et de la densité de pixels de l'écran. Le canvas logique est au format **4:3** (`1200 × 900`) et adapte son buffer au `devicePixelRatio`.

Un document échangé entre le client et le serveur suit ce format :

```ts
interface DrawingDocument {
  version: 1;
  aspectRatio: "4:3";
  backgroundColor: "#FFFFFF";
  strokes: Array<{
    tool: "pen" | "eraser";
    color: string;
    width: 4 | 8 | 14;
    points: Array<{ x: number; y: number }>;
  }>;
}
```

La palette autorisée contient `#111111`, `#E53935`, `#1E88E5`, `#43A047`, `#FB8C00` et `#8E24AA`. Une gomme est canonisée avec la couleur de fond blanche. Le rendu partagé gère les extrémités et jointures arrondies ainsi que les traits constitués d'un seul point.

Les constantes de format et de complexité vivent dans le workspace `shared`. Le serveur reconstruit un document sûr à partir du payload reçu et refuse notamment :

- les objets qui ont des clés absentes ou supplémentaires, les types inattendus, les nombres non finis et les coordonnées hors de `[0, 1]` ;
- une couleur, une épaisseur ou un outil non autorisé ;
- un dessin vide ;
- plus de 250 traits, plus de 300 points par trait ou plus de 30 000 points au total.

La limite de message Socket.IO est fixée à 2,5 Mo afin qu'un document valide de 30 000 points, même sérialisé avec des coordonnées longues, atteigne bien le validateur applicatif au lieu d'être coupé par la limite Engine.IO par défaut.

La soumission utilise l'événement `drawing:submit` avec le payload `{ drawing }`. Le serveur vérifie l'appartenance au salon, l'existence de la partie, la phase, le joueur et le rôle de dessinateur avant de valider le contenu. Une soumission acceptée est atomique : le dessin et son horodatage sont enregistrés, la phase passe à `VOTING`, `phaseEndsAt` devient `null`, puis le nouvel état public est diffusé. Le niveau secret ne rejoint jamais cet état public.

### Essai manuel du canvas

1. Démarrez trois clients, préparez le salon et attendez la phase `DRAWING`.
2. Sur le client dessinateur, essayez le tracé à la souris puis, sur un appareil compatible, au doigt et au stylet. Un clic ou toucher sans déplacement doit produire un point.
3. Vérifiez les six couleurs, les trois épaisseurs, la gomme, **Annuler** et **Tout effacer**. Cette dernière action demande confirmation.
4. Redimensionnez la fenêtre jusque 320 px de large : le canvas doit conserver son ratio sans débordement et le dessin doit rester identique.
5. Confirmez la soumission. Les trois clients doivent passer en `VOTING` et afficher exactement le même aperçu ; aucun client non dessinateur ne doit voir les outils ni le niveau secret.
6. Sur un premier votant, choisissez plusieurs valeurs avant de confirmer la dernière. Vérifiez que sa réponse se verrouille et que seul le compteur public passe à `1 sur 2`.
7. Vérifiez que le dessinateur ne possède aucun contrôle de vote, puis soumettez la dernière estimation depuis le second votant. Tous les clients doivent passer directement à `REVEAL` et afficher le secret, les réponses, leurs écarts, les points du tour, les scores totaux et le classement.
8. Depuis le client hôte, lancez le tour suivant. Vérifiez le changement de dessinateur, de `turnId` et de consigne, ainsi que la remise à zéro du dessin, du secret privé et de l'estimation locale. Les autres clients ne doivent jamais recevoir le nouveau secret.
9. Continuez jusqu'au terme des deux manches. Vérifiez que chaque joueur a dessiné deux fois dans le même ordre, qu'aucune consigne n'a été répétée et que `FINISHED` affiche le classement final ainsi que tous les gagnants ex æquo.
10. Vérifiez que seul l'hôte voit **Proposer une revanche**, puis utilisez ce bouton. Les trois clients doivent revenir au même lobby avec les mêmes identifiants, des scores à zéro et tous les statuts prêts désactivés.
11. Remettez les trois joueurs prêts et relancez. Vérifiez que le nouveau `gameId` et le nouveau `turnId` diffèrent de ceux de la partie terminée, que l'ordre a été mélangé à nouveau et qu'aucun dessin, secret, vote ou classement précédent n'est visible.
12. Contrôlez aussi le refus d'un non-hôte, le transfert de l'hôte après son départ depuis `FINISHED`, `/api/health`, le bouton de ping Socket.IO, le responsive à 320 px et le lancement de production décrits plus bas.

### Essai manuel de la restauration de session

Utilisez au moins trois navigateurs, profils ou contextes isolés. Pour accélérer le scénario d'expiration, vous pouvez lancer temporairement le serveur avec une petite valeur de `PLAYER_RECONNECT_GRACE_MS`.

1. Actualisez successivement un joueur avec F5 dans le lobby, `ROUND_INTRO`, `DRAWING`, `VOTING` avant et après validation, `REVEAL` puis `FINISHED`. La restauration doit réussir même si le nouveau socket arrive avant le `disconnect` de l'ancien. Vérifiez que le même joueur, le même rôle, le même score, le même `gameId` et le même `turnId` reviennent, sans doublon ni timer de reconnexion tardif.
2. Pendant `DRAWING`, tracez plusieurs traits, changez d'outil, actualisez le dessinateur puis vérifiez le retour du dessin local et du niveau secret avant de soumettre.
3. Pendant `VOTING`, actualisez une sélection non envoyée puis une estimation déjà validée. La première doit rester modifiable ; la seconde doit revenir verrouillée et un second envoi doit être refusé.
4. Coupez brièvement le réseau d'un client. Son écran doit rester visible sous la superposition `Connexion interrompue`, et les autres joueurs doivent voir son statut `Reconnexion…`. Rétablissez le réseau et vérifiez la disparition des deux états.
5. Laissez expirer un joueur pendant une phase active. Les autres doivent recevoir `RECONNECT_TIMEOUT` et revenir au lobby avec scores et statuts prêts remis à zéro. Vérifiez qu'une restauration ultérieure est refusée.
6. Cliquez sur **Quitter la partie** et vérifiez le retrait immédiat, le nettoyage du stockage local et l'impossibilité de restaurer cette session.
7. Ouvrez la même origine dans un second onglet pendant que le premier reste actif. Le second doit afficher `Cette session est déjà ouverte dans un autre onglet` sans prendre le contrôle, et le premier doit pouvoir continuer à agir. Fermez ensuite réellement le premier onglet et utilisez **Réessayer la restauration** dans le second pendant la grâce.
8. Après une restauration dans `FINISHED`, proposez une revanche puis relancez la partie. Les credentials doivent rester valides tandis que les anciens brouillons, secrets et votes doivent être absents.
9. Contrôlez la superposition en 320 × 568, 375 × 667, 390 × 844, 1366 × 768, 1440 × 900 et 1920 × 1080. La mascotte doit rester centrée et entièrement contenue dans sa tuile jaune, sans débordement ni perte du contenu sous-jacent.

## Stockage et durée de vie des salons

Les salons, les joueurs et l'état de partie sont stockés **uniquement dans la mémoire du serveur**. Ils disparaissent donc lorsque le serveur redémarre, et un salon est supprimé dès que son dernier joueur le quitte.

À la création ou à la connexion, le serveur génère un jeton aléatoire avec `crypto.randomBytes(32).toString("base64url")`. Le jeton brut est renvoyé uniquement dans l'acknowledgement privé du joueur et enregistré dans `localStorage` sous la clé `drawing-scale-game-session`. Le serveur ne conserve que son hash SHA-256 dans le joueur interne et utilise une comparaison sûre lors de `session:restore`.

Le client génère aussi un UUID non secret sous la clé `drawing-scale-game-client-instance`. Cet identifiant vit uniquement dans `sessionStorage` : il survit à l'actualisation du même onglet, tandis qu'un nouvel onglet normal reçoit un autre UUID. Il est envoyé par `room:create`, `room:join` et `session:restore`, mais ne remplace jamais le jeton. Aucun token supplémentaire n'est placé dans `sessionStorage`. Le jeton, son hash, `socketId`, `activeClientInstanceId` et `disconnectedAt` ne font jamais partie de `PublicPlayer`, de `PublicRoomState`, des logs ou du DOM.

Lors d'une déconnexion involontaire, le joueur reste dans le salon avec `isConnected: false` et un `reconnectDeadline`. Le délai par défaut est de 60 secondes et peut être configuré avec `PLAYER_RECONNECT_GRACE_MS`. La phase en cours n'est pas mise en pause : `ROUND_INTRO` peut continuer vers `DRAWING`, tandis que le jeu attend naturellement un dessinateur, un votant ou un hôte absent. Les autres clients affichent textuellement `Reconnexion…`.

Au prochain événement Socket.IO `connect`, le client relit ses credentials et envoie :

```ts
session:restore
{
  roomCode: string;
  playerId: string;
  token: string;
  clientInstanceId: string;
}
```

Une restauration valide annule le timer, rattache le nouveau `socket.id` au même joueur, rejoint de nouveau la room Socket.IO et conserve le rôle d'hôte, le score, l'ordre de passage et l'état de partie. Si l'ancien socket du même `clientInstanceId` est encore présent pendant un F5, le serveur transfère d'abord atomiquement l'autorité au nouveau socket, retire l'ancien mapping, puis ferme l'ancien socket. Sa déconnexion tardive est ainsi sans effet et ne démarre aucun délai de grâce. L'acknowledgement privé contient l'état public courant ainsi que, pour le seul joueur restauré :

- les `gameId` et `turnId` courants ;
- le niveau secret uniquement s'il est le dessinateur du tour ;
- sa propre estimation déjà validée et son horodatage ;
- l'indication qu'il est ou non le dessinateur courant.

Une session encore active avec un `clientInstanceId` différent est refusée avec `SESSION_ALREADY_ACTIVE` : le véritable second onglet ne prend pas le contrôle et le premier reste propriétaire. Après la déconnexion réelle du premier, le second peut restaurer avec le jeton valide pendant le délai de grâce et devient alors l'instance active. Le client réserve ses nouvelles tentatives automatiques bornées aux erreurs transitoires de transport ou internes ; `SESSION_ALREADY_ACTIVE` attend une action manuelle. Le bouton de nouvelle tentative conserve les credentials, réarme une tentative complète et empêche les doubles clics pendant son chargement.

Le brouillon de dessin est stocké séparément sous `drawing-scale-game-draft` après la fin d'un trait ou une modification d'outil. Il contient le document vectoriel, l'outil, la couleur, l'épaisseur et les identifiants du salon, de la partie, du tour et du joueur. Il n'est restauré que pour le dessinateur courant, pendant le même tour `DRAWING`, avant toute soumission officielle. Une sélection de vote non envoyée utilise `drawing-scale-game-guess-draft` avec les mêmes protections d'identifiants. Une estimation déjà validée reste, elle, autoritaire côté serveur et revient verrouillée dans l'état privé restauré.

Les brouillons sont supprimés à la soumission, au changement de phase, de tour ou de partie, à la revanche, à l'annulation, au départ, à l'expiration ou dès qu'un identifiant ne correspond plus. Aucun dessin non soumis n'est stocké sur le serveur ni synchronisé entre appareils.

Si le délai expire dans le lobby, le joueur est retiré, le rôle d'hôte est transféré si nécessaire et le salon vide est supprimé. Pendant `ROUND_INTRO`, `DRAWING`, `VOTING` ou `REVEAL`, l'expiration applique le comportement historique : retrait, annulation avec `RECONNECT_TIMEOUT`, retour au lobby, scores à zéro et statuts non prêts. Pendant `FINISHED`, le joueur est retiré mais le classement historique reste inchangé.

Le départ volontaire `room:leave` demeure immédiat : il invalide la session, nettoie son timer et ses données locales, puis applique sans délai les règles de départ de la phase courante. Il ne déclenche jamais de période de grâce.

`localStorage` est une limite de sécurité assumée de cette V0 sans authentification : un script exécuté dans la même origine pourrait lire le jeton. La restauration ne survit pas à un redémarrage du serveur, ne fonctionne pas entre appareils et ne constitue pas un système de compte utilisateur.

## Vérification des types

Vérifiez les types des trois workspaces sans produire de fichiers de compilation :

```bash
npm run typecheck
```

## Tests automatisés

Exécutez les tests depuis la racine :

```bash
npm test
```

Cette commande lance les tests Vitest : tests unitaires de la logique des salons, de la partie, du score, des estimations, du document vectoriel et de sa géométrie, ainsi que des tests d'intégration avec un serveur sur un port éphémère et de vrais clients Socket.IO.

La suite couvre notamment :

- les validations strictes des salons, dessins, votes, `game:start`, `game:continue` et `game:request-rematch`, ainsi que les autorisations de l'hôte et du dessinateur ;
- la table de points des votants, le plafond de 5 points du dessinateur et l'application atomique et unique des scores ;
- les scores cumulatifs, le classement, les rangs partagés et les gagnants ex æquo ;
- la rotation fixe de tous les joueurs pendant deux manches, la continuité des numéros de tour et la transition finale vers `FINISHED` ;
- l'utilisation unique des consignes pendant une partie ;
- l'unicité des `gameId` et `turnId`, la remise à zéro des états privés et locaux et le filtrage des événements `turn:secret` retardés ;
- la génération, le hash et la vérification des jetons privés, ainsi que leur absence de l'état public ;
- la grâce de reconnexion, la restauration du même joueur dans chaque phase, l'expiration et le refus multi-onglets ;
- la restauration privée du secret du dessinateur et du vote validé, sans fuite vers les autres joueurs ;
- la validation et le nettoyage des credentials, brouillons de dessin et sélections de vote conservés dans le navigateur ;
- la confidentialité pendant `DRAWING` et `VOTING`, l'isolation entre salons et les événements Socket.IO ;
- l'annulation et le retour au lobby après un départ pendant une phase active, ainsi que la conservation historique et le transfert d'hôte pendant `FINISHED` ;
- la revanche complète dans le même salon, le reset des scores et statuts prêts, la nouvelle partie indépendante et l'isolation entre salons ;
- les jauges accessibles, les écrans de dessin et de vote, le détail de `REVEAL`, le bouton de continuation et la revanche réservés à l'hôte.

## Intégration continue

Le protocole détaillé des quatre environnements, de la livraison, du rollback et des seuils mesurables est documenté dans [C.2.1.1 — Environnements, déploiement continu, qualité et performance](docs/c2-1-1-environnements-deploiement-qualite-performance.md).

Le cycle de contribution et les responsabilités sont définis dans [C2.1.2 — Protocole d'intégration continue](docs/c2-1-2-protocole-integration-continue.md) : branche dédiée → pull request vers `main` → contrôle GitHub Actions `Verify` → fusion → nouveau contrôle sur `main`. Une pull request ne doit pas être fusionnée tant que `Verify` échoue ou n'est pas terminé.

La porte unique locale et CI exécute le typecheck, tous les tests, le build, le smoke test compilé, puis les budgets de performance et de taille :

```bash
npm run quality:check
```

Avant tout autre contrôle, l'orchestrateur affiche la version Node détectée, lit la version exacte attendue dans `.node-version` et la plage déclarée dans `engines.node`, puis refuse immédiatement un runtime différent. Cela garantit que les mesures locales et CI utilisent la version de `.node-version` sans la dupliquer dans le script.

Elle produit `reports/c2-1-1/quality-performance-report.json`; ce dossier généré est ignoré par Git. Le workflow GitHub Actions [`ci.yml`](.github/workflows/ci.yml) s'exécute sur les pull requests, les pushes vers `main` et manuellement. Après `npm ci`, il appelle exactement cette même commande et conserve le rapport comme artefact, y compris autant que possible en cas d'échec.

La configuration Render cible `main` et utilise `autoDeployTrigger: checksPass` : les checks réussis autorisent son déploiement automatique; un échec de la porte bloque ce chemin de livraison.

## Build et lancement en production

Construisez le code partagé, le serveur TypeScript et le frontend Vite :

```bash
npm run build
```

Lancez ensuite le serveur compilé :

```bash
npm run start
```

En production, Express sert l'API, Socket.IO et les fichiers générés du frontend depuis un même service. L'application complète est accessible sur <http://localhost:3000> avec le port par défaut.

Après le build, le smoke test de production démarre le serveur compilé sur un port éphémère, vérifie l'API, le frontend, le ping/pong Socket.IO et les arrêts `SIGTERM` et `SIGINT` :

```bash
npm run smoke:production
```

Après un déploiement, contrôlez sans créer de salon la santé, le frontend et un échange Socket.IO. L'URL peut aussi être fournie avec `POST_DEPLOY_CHECK_URL` :

```bash
npm run postdeploy:check -- --url https://drawing-scale-game.onrender.com
```

Le parcours navigateur plus large est optionnel, requiert un serveur compilé déjà lancé ainsi que Chrome, Chromium ou Edge, et crée réellement des salons :

```bash
npm run check:browser -- --url http://127.0.0.1:3000
```

Il n'est pas inclus dans la porte CI afin de ne pas la rendre dépendante d'une installation Chromium.

## Déploiement sur Render

Dans Render, créez un Blueprint à partir du dépôt contenant `render.yaml`; le service y cible explicitement la branche `main`. Le dépôt fournit toute la configuration du service ; aucune valeur `PORT`, base de données, ressource persistante ou secret supplémentaire n'est nécessaire.

### Architecture

Le déploiement défini dans `render.yaml` utilise un seul **Web Service Node.js**. Le frontend construit, l'API Express et Socket.IO sont servis par le même processus et le même domaine. Socket.IO ne nécessite donc ni service séparé ni URL distincte.

Le service doit conserver exactement une instance tant que les salons et les parties restent en mémoire. Plusieurs instances sans stockage partagé ni routage de session pourraient exposer des états différents aux joueurs d'un même salon.

### Configuration

| Paramètre | Valeur |
| --- | --- |
| Région | Frankfurt |
| Offre | Free |
| Instances | `1` |
| Branche | `main` |
| Build | `npm ci --include=dev && npm run build` |
| Démarrage | `npm start` |
| Contrôle de santé | `/api/health` |
| Version de Node.js | `.node-version` |
| Environnement | `NODE_ENV=production` |
| Délai de reconnexion | `PLAYER_RECONNECT_GRACE_MS=60000` |

Render fournit automatiquement la variable `PORT` en production ; elle ne doit pas être fixée dans `render.yaml`.

### Limites du déploiement

- les salons, joueurs et parties sont conservés uniquement dans la mémoire du processus ;
- un redémarrage ou un redéploiement supprime les parties actives ;
- la mise en veille possible d'une instance gratuite peut également interrompre et faire perdre une partie ;
- la restauration de session ne fonctionne pas après un redémarrage du serveur ;
- le service doit rester limité à une seule instance tant qu'aucun état partagé n'est disponible ;
- l'offre gratuite convient à une démonstration ou à un prototype, pas à un service persistant ;
- aucune base de données ni aucun autre mécanisme de persistance n'est configuré.

### Arrêt gracieux

Le point d'entrée du serveur intercepte `SIGTERM`, utilisé par Render pendant les redéploiements, ainsi que `SIGINT`. La procédure empêche les fermetures concurrentes, ferme Socket.IO puis le serveur HTTP et nettoie les timers de partie et de reconnexion.

Un watchdog de sécurité force la fin du processus après 25 secondes si une ressource empêche l'arrêt normal, soit avant le délai maximal de 30 secondes configuré sur Render.

## Vérifier l'API

Une fois le serveur lancé en développement ou en production, ouvrez <http://localhost:3000/api/health> ou exécutez :

```bash
curl http://localhost:3000/api/health
```

La réponse attendue est :

```json
{
  "status": "ok",
  "service": "drawing-game-server"
}
```

En développement, le même endpoint est également disponible via le proxy du frontend à l'adresse <http://localhost:5173/api/health>. L'interface propose un lien ou bouton pour effectuer cette vérification.

## Tester Socket.IO

1. Lancez le projet avec `npm run dev`.
2. Ouvrez <http://localhost:5173>.
3. Attendez que l'état de connexion affiche **Connecté**.
4. Cliquez sur **Tester la connexion**.
5. Vérifiez qu'un message indique la réception de la réponse et le temps aller-retour approximatif, par exemple `Serveur connecté — réponse reçue en 18 ms`.

Le bouton envoie l'événement `client:ping`. Le serveur répond uniquement au client concerné avec `server:pong` ; les noms d'événements et leurs payloads sont déclarés dans le workspace `shared`.

Les actions utilisent également des événements typés : `room:create`, `room:join`, `session:restore`, `room:leave`, `player:set-ready`, `game:start`, `game:continue`, `game:request-rematch`, `drawing:submit` et `guess:submit`. Le serveur diffuse ensuite l'état public à jour avec `room:state`.

- pendant `VOTING`, cet état expose uniquement les compteurs du vote ;
- pendant `REVEAL`, il expose le secret, les résultats détaillés, les scores, le classement et le prochain dessinateur ;
- pendant `FINISHED`, il expose le classement final, les gagnants et le nombre de manches et de tours terminés.

À chaque nouveau tour, `turn:secret` transmet uniquement au dessinateur les champs `roomCode`, `gameId`, `turnId`, `drawerPlayerId` et `secretLevel`. Après `game:continue`, le nouvel état public est diffusé à toute la room, puis ce secret est adressé au seul socket concerné s'il est connecté ; sinon il le récupère dans l'état privé de `session:restore`. Aucun nouveau secret n'est envoyé lors du passage à `FINISHED`. `game:request-rematch` ne reçoit aucun payload métier et répond par un acknowledgement typé contenant le nouvel état public du lobby. `game:cancelled` informe les joueurs restants qu'un départ volontaire ou l'expiration d'une reconnexion pendant une phase active a interrompu et réinitialisé la partie.

## Limites de cette version

Cette version ne comprend pas encore :

- une base de données ou toute autre persistance des salons ;
- la restauration après redémarrage du serveur ;
- la synchronisation d'une session ou d'un brouillon entre plusieurs appareils ;
- l'utilisation simultanée d'une même session dans plusieurs onglets ;
- un vote collectif de revanche, un historique des parties ou une conservation des scores entre deux parties.
