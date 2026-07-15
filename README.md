# Drawing Scale Game

Application multijoueur de dessin en temps réel. Cette version permet de créer et rejoindre des salons, de préparer les joueurs dans un lobby, de lancer une partie, de réaliser le premier dessin vectoriel puis de le révéler à tous les joueurs.

## Fonctionnalités actuelles

- création d'un salon avec un pseudonyme et un code d'invitation unique de 5 caractères ;
- connexion à un salon existant par son code ou par un lien d'invitation ;
- liste des joueurs synchronisée en temps réel, avec identification de l'hôte et du joueur courant ;
- statut `Prêt` ou `Pas prêt` modifiable par chaque joueur ;
- lancement réservé à l'hôte à partir de 3 joueurs lorsque tout le monde est prêt ;
- phases de partie `LOBBY`, `ROUND_INTRO`, `DRAWING` et `VOTING`, pilotées par le serveur ;
- affichage de la consigne publique et envoi d'un niveau secret uniquement au dessinateur courant ;
- structure de partie prévue pour 2 manches, avec uniquement le premier tour exécuté dans cette version ;
- canvas vectoriel 4:3 compatible souris, tactile et stylet, avec crayon, gomme, palette, épaisseurs, annulation et effacement ;
- soumission autorisée uniquement au dessinateur courant et aperçu synchronisé du dessin en phase `VOTING` ;
- fermeture du salon aux nouveaux joueurs dès le lancement ;
- annulation de la partie et retour au lobby si un joueur quitte ou se déconnecte ;
- départ volontaire ou retrait automatique à la déconnexion, avec transfert du rôle d'hôte au joueur présent depuis le plus longtemps ;
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
| `server` | API Express, gestion en mémoire des salons et du premier tour, serveur HTTP/Socket.IO, tests et hébergement du frontend construit en production. |
| `shared` | Noms des événements, payloads et états publics typés échangés entre le client et le serveur. |

Les commandes décrites ci-dessous s'exécutent toutes depuis la racine du dépôt.

## Prérequis

- Node.js 22.12 ou version ultérieure ;
- npm 10 ou version ultérieure.

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

Le serveur utilise le port défini par la variable d'environnement `PORT`, avec `3000` comme valeur par défaut. Les valeurs attendues sont documentées dans `.env.example` ; aucun secret n'est nécessaire à ce stade.

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

## Essayer une partie depuis plusieurs navigateurs

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

Le bouton **Lancer la partie** n'est affiché qu'à l'hôte et reste désactivé tant que `canStart` vaut `false`. Les autres joueurs voient un message leur indiquant que l'hôte lancera la partie. Avant le lancement, si l'hôte quitte le salon ou se déconnecte, son rôle est transféré au joueur restant présent depuis le plus longtemps.

Une fois la partie lancée, le salon est fermé : toute nouvelle tentative de connexion avec son code est refusée. Les statuts prêt et un second lancement ne peuvent plus modifier la partie en cours.

### Déroulement actuellement implémenté

Le serveur reste la source d'autorité pour les phases et leurs transitions :

1. `LOBBY` : les joueurs rejoignent le salon, se déclarent prêts et l'hôte lance la partie.
2. `ROUND_INTRO` : tous voient la manche, le numéro du tour, le dessinateur et la consigne publique. Cette introduction dure environ 3 secondes ; l'interface affiche un compte à rebours dérivé de l'heure de fin envoyée par le serveur, sans changer elle-même de phase.
3. `DRAWING` : la transition est diffusée par le serveur. Le dessinateur voit la consigne, son niveau secret sur 10 et l'éditeur vectoriel. Les autres joueurs voient la consigne, l'identité du dessinateur et un écran d'attente, mais jamais son niveau secret.
4. `VOTING` : après confirmation et validation de la soumission, le serveur stocke le dessin, horodate la soumission et diffuse le même aperçu à tout le salon. Aucun vote n'est encore proposé dans cette version.

La partie est structurée pour **2 manches**, mais cette version s'arrête à la révélation du premier dessin du premier tour. La rotation du dessinateur, les tours suivants et la fin de partie ne sont pas encore implémentés.

Le niveau secret est transmis avec l'événement privé `turn:secret` au seul socket du dessinateur. Il ne fait pas partie de l'état public du salon ni des diffusions destinées aux autres joueurs.

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
6. Vérifiez aussi `/api/health`, le bouton de ping Socket.IO, puis le build et le lancement de production décrits plus bas.

## Stockage et durée de vie des salons

Les salons, les joueurs et l'état de partie sont stockés **uniquement dans la mémoire du serveur**. Ils disparaissent donc lorsque le serveur redémarre, et un salon est supprimé dès que son dernier joueur le quitte.

La session du navigateur n'est pas persistée. Une actualisation de page ou une déconnexion Socket.IO retire immédiatement le joueur du salon et lui fait perdre sa session locale ; aucune reconnexion automatique n'est mise en place.

Dans le lobby, le joueur doit rejoindre manuellement le salon s'il existe encore et le rôle d'hôte est transféré si nécessaire. Pendant `ROUND_INTRO`, `DRAWING` ou `VOTING`, le départ volontaire, la déconnexion ou l'actualisation de n'importe quel joueur annule la partie pour tout le groupe. Les joueurs restants reviennent au lobby avec un message explicatif et doivent de nouveau préparer le salon avant un prochain lancement.

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

Cette commande lance les tests Vitest : tests unitaires de la logique des salons, de la partie, du document vectoriel et de sa géométrie, ainsi que des tests d'intégration avec un serveur sur un port éphémère et de vrais clients Socket.IO. Ils couvrent notamment la capacité maximale, la validation stricte du dessin, les autorisations de soumission, les transitions de phase, la confidentialité du niveau secret, l'annulation sur départ ou déconnexion et l'isolation entre salons.

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

Les actions utilisent également des événements typés : `room:create`, `room:join`, `room:leave`, `player:set-ready`, `game:start` et `drawing:submit`. Le serveur diffuse ensuite l'état public à jour avec `room:state`, sans exposer les identifiants Socket.IO internes ni le niveau secret.

Pendant la partie, `turn:secret` est envoyé uniquement au dessinateur et `game:cancelled` informe les joueurs restants qu'un départ ou une déconnexion a interrompu la partie.

## Limites de cette version

Cette version ne comprend pas encore :

- la rotation des dessinateurs, le passage au deuxième tour ou à la deuxième manche et la fin de partie ;
- les votes, estimations, scores ou résultats ;
- une durée de dessin et un chronomètre de fin de tour ;
- la reconnexion ou la restauration d'une session après actualisation ;
- l'authentification et les comptes utilisateurs ;
- une base de données ou toute autre persistance des salons.
