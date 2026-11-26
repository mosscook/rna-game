# rna.game

A classroom multiplayer game about the RNA world. Each player is an early RNA strand in a primordial
tide pool: collect nucleotides, fold them into working structures, and finish the round with the most
complex strand. Built for Chromebooks, with no accounts and no tracking.

| Link | What it does |
|---|---|
| `rna.game/` | Play alone against bots. The home page also has a box for joining a room. |
| `rna.game/<room>` | A shared room. Everyone who opens the same name plays together, e.g. `rna.game/period3`. |
| `rna.game/r/<room>` | Older form of a room link. It redirects to `rna.game/<room>`. |

Room names can use letters, numbers and dashes, up to 32 characters. They aren't case sensitive.

## How it works

- **`public/`**: the game page. It's the same code as the RNA Strand Soup prototype.
  - `sim.js` runs the game itself.
  - `rna-strand.js` handles strand physics and SVG drawing.
  - `map.js` builds the map, `bots.js` runs the bot players, and `net.js` is the multiplayer client.
- **`src/worker.js`**: serves the page and sends each room's WebSocket (`/ws/<room>`) to that room's Durable Object.
- **`src/room.js`**: one Durable Object per room name. It runs `sim.js` for everyone in the room at 30 steps a second and sends each player only what is near them. Rounds run back to back: 5 minutes of play, 15 seconds of results, then a new map. Bots keep at least 10 strands in a room, and each room holds up to 12 players. If a player drops out, their strand waits 30 seconds so a refreshed tab gets it back. Once a room is empty for 30 seconds it stops and costs nothing.
- **`src/game.js` and `src/dom-shim.js`**: let the browser files run on the server, where nothing is drawn.

You can change the room settings in the constants at the top of `src/room.js`.

## Deploying

Every push to `main` deploys to Cloudflare once the repo is connected. To connect it, one time:

1. In the Cloudflare dashboard, go to **Workers & Pages → Create application → Import a repository**.
2. Connect GitHub and choose `mosscook/rna-game`.
3. Keep the project name `rna-game`, leave the build command empty, and keep the deploy command `npx wrangler deploy`.
4. Select **Save and Deploy**.

`wrangler.toml` attaches `rna.game` as the Worker's custom domain, so the first deploy also creates its DNS record and certificate.

## Working on it locally

```sh
npm install
npm test                                   # plays a full round with no page
npx wrangler dev --var ROUND_SECONDS:20 --var RESULTS_SECONDS:4
node test/room.mjs                         # fake players join, steer, reconnect, fill the room, finish a round
```

Then open `http://localhost:8787/` for single-player, or `http://localhost:8787/test` for a room.

## Privacy

The server keeps only what a round needs while the room is running: three-letter codon names, strand state and scores. Nothing is written to storage. There are no accounts, analytics or ads, and Worker logs are off. A random token in the tab's session storage lets a refreshed tab take its strand back, and it disappears when the tab closes. The page still loads its fonts from Google Fonts, so those should be self-hosted before wide use.
