# Drawing Scale Game

Socle technique d'un futur jeu de dessin multijoueur en ligne. Cette première version valide la communication temps réel entre un frontend React et un serveur Node.js, sans encore inclure de salons, de canvas, de scores ni de logique de partie.

## Stack technique

- monorepo TypeScript géré avec npm workspaces ;
- frontend React, Vite, Socket.IO Client et CSS ;
- serveur Node.js, Express et Socket.IO ;
- `tsx` et `concurrently` pour le développement ;
- contrats Socket.IO partagés et typés.

## Workspaces

| Workspace | Rôle |
| --- | --- |
| `client` | Interface React, connexion Socket.IO et proxy Vite en développement. |
| `server` | API Express, serveur HTTP/Socket.IO et hébergement du frontend construit en production. |
| `shared` | Noms des événements et types échangés entre le client et le serveur. |

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

## Vérification des types

Vérifiez les types des trois workspaces sans produire de fichiers de compilation :

```bash
npm run typecheck
```

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
