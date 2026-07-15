# Drawing Scale Game

Application multijoueur en temps réel destinée à devenir un jeu de dessin. Cette version permet de créer et rejoindre des salons, de préparer les joueurs dans un lobby et de synchroniser leur état entre plusieurs navigateurs. Elle s'arrête volontairement avant le lancement et le déroulement d'une partie.

## Fonctionnalités actuelles

- création d'un salon avec un pseudonyme et un code d'invitation unique de 5 caractères ;
- connexion à un salon existant par son code ou par un lien d'invitation ;
- liste des joueurs synchronisée en temps réel, avec identification de l'hôte et du joueur courant ;
- statut `Prêt` ou `Pas prêt` modifiable par chaque joueur ;
- indicateur `canStart`, actif à partir de 3 joueurs lorsque tout le monde est prêt, sans lancer de partie ;
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
| `client` | Écrans d'accueil et de lobby React, session locale, connexion Socket.IO et proxy Vite en développement. |
| `server` | API Express, gestion des salons en mémoire, serveur HTTP/Socket.IO, tests et hébergement du frontend construit en production. |
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

## Essayer le lobby depuis plusieurs navigateurs

1. Lancez l'application avec `npm run dev`, puis ouvrez <http://localhost:5173> dans un premier navigateur.
2. Saisissez un pseudonyme et cliquez sur **Créer une partie**.
3. Dans le lobby, copiez le code à 5 caractères ou le lien d'invitation.
4. Ouvrez l'application dans un autre navigateur ou une fenêtre privée. Pour un autre appareil, ouvrez d'abord l'application via l'adresse réseau locale de la machine qui héberge le serveur afin que le lien copié utilise cette adresse plutôt que `localhost`.
5. Saisissez un pseudonyme différent et le code, puis cliquez sur **Rejoindre la partie**. Avec le lien d'invitation, le code est prérempli mais la connexion n'est pas automatique.
6. Répétez l'opération pour ajouter jusqu'à 8 joueurs. Les arrivées, départs et changements de statut sont visibles immédiatement par tous les membres du salon.

Chaque joueur peut basculer entre **Prêt** et **Pas prêt**. L'interface indique qu'une future partie pourrait démarrer uniquement lorsque le salon contient au moins 3 joueurs et qu'ils sont tous prêts. Aucun bouton ni événement de lancement de partie n'est encore implémenté.

## Stockage et durée de vie des salons

Les salons et les joueurs sont stockés **uniquement dans la mémoire du serveur**. Ils disparaissent donc lorsque le serveur redémarre, et un salon est supprimé dès que son dernier joueur le quitte.

La session du navigateur n'est pas persistée. Une actualisation de page ou une déconnexion Socket.IO retire immédiatement le joueur du salon et lui fait perdre sa session locale. Il doit rejoindre manuellement le salon s'il existe encore. Si l'hôte part, le rôle est transféré automatiquement au joueur restant le plus ancien.

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

Cette commande lance les tests Vitest du serveur : tests unitaires du gestionnaire de salons et tests d'intégration avec un serveur sur un port éphémère et de vrais clients Socket.IO. Ils couvrent notamment la capacité maximale, la validation, le statut prêt, le transfert d'hôte, les déconnexions et l'isolation entre salons.

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

Les actions du lobby utilisent également des événements typés : `room:create`, `room:join`, `room:leave` et `player:set-ready`. Le serveur diffuse ensuite l'état public à jour avec `room:state`, sans exposer les identifiants Socket.IO internes.

## Limites de cette version

Cette version ne comprend pas encore :

- le lancement ou le déroulement d'une partie ;
- les manches, consignes de dessin, canvas, votes, scores ou chronomètres ;
- la reconnexion ou la restauration d'une session après actualisation ;
- l'authentification et les comptes utilisateurs ;
- une base de données ou toute autre persistance des salons.
