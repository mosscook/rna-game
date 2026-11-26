# rna.game

A classroom multiplayer game about the RNA world. Each player is an early RNA strand in a primordial
tide pool: collect nucleotides, fold them into working structures, and finish the round with the most
complex strand. Built for Chromebooks, with no accounts and no tracking.

| Link | What it does |
|---|---|
| `rna.game/` | Play alone against bots. The home page also has a box for joining a room. |
| `rna.game/<room>` | A shared room. Everyone who opens the same name plays together, e.g. `rna.game/period3`. |
| `rna.game/r/<room>` | Older form of a room link. It redirects to `rna.game/<room>`. |
| `rna.game/version` | Which version is live. Open pages check it so they can offer a refresh after a deploy. |

Room names can use letters, numbers and dashes, up to 32 characters. They aren't case sensitive.

## Steering

A mouse steers toward the pointer. On touch screens, wherever a finger lands becomes a joystick: drag away from that spot to steer (a short drag swims slowly, about 70 px is full speed), and lift to stop. A faint ring shows while a finger is down. On small screens the lines of science about each place are skipped, since they cover too much of the soup.

## Lobby

A room opens in a lobby: a small walled pool with clumps of letters that keep refilling, and no bots, hazards, fragments, cuts or clock. Players can practise collecting and folding while everyone arrives. The host, whoever has been in the room longest (a "Just watch" tab counts, so a teacher at the projector can host), sees **Start game**; everyone else sees who they are waiting for. Start moves everyone to a fresh map with fresh strands, and bots fill the empty seats. After the results screen the room goes back to the lobby for the host to start the next round. If the host leaves, whoever has been there next longest takes over.

## Watching

Press **Watch** (or V) to follow other strands: ◀ ▶ (or the arrow keys) move between them, **Tour** moves on every 15 seconds, and × (or Esc) goes back to your own strand. While you watch, your strand waits where it is and can still be hit. The bar shows each strand's score, its place, and what a bot is thinking.

- **Single-player:** "Or just watch the bots" on the start screen starts a round and tours the bots.
- **Rooms:** "Just watch" on the join screen connects with no strand. Watchers aren't counted as players and don't take a seat from a bot, so it suits a projector at the front of the class. Up to 6 watchers per room. The server sends each watcher what is around the strand they follow.

## How it works

- **`public/`**: the game page. It's the same code as the RNA Strand Soup prototype.
  - `segments.js` lists every segment type (Mover, Cleaver and the rest): recipe, shape, what it does, its recipe card, and how bots weigh it.
  - `biomes.js` lists the ground types, the named places, and the regions that build the map.
  - `sim.js` runs the game itself.
  - `rna-strand.js` handles strand physics and SVG drawing.
  - `map.js` builds the map from the regions and runs its moving hazards. `bots.js` runs the bot players, and `net.js` is the multiplayer client.
- **`src/worker.js`**: serves the page and sends each room's WebSocket (`/ws/<room>`) to that room's Durable Object.
- **`src/room.js`**: one Durable Object per room name. It runs `sim.js` for everyone in the room at 30 steps a second and sends each player only what is near them. A room starts in the lobby; the host starts each round (5 minutes of play, then 15 seconds of results, then back to the lobby). Bots keep at least 10 strands in a room, and each room holds up to 12 players. If a player drops out, their strand waits 30 seconds so a refreshed tab gets it back. Once a room is empty for 30 seconds it stops and costs nothing.
- **`src/game.js` and `src/dom-shim.js`**: let the browser files run on the server, where nothing is drawn.

You can change the room settings in the constants at the top of `src/room.js`.

## Mistakes in recipes

A recipe with one wrong letter still folds, at a different strength:

- **In the stem** (the two pairs at either end), a G·U "wobble" pair holds nearly as well as a real pair (90%). Any other mismatch weakens the stem (70%).
- **In the core**, each wrong letter at each position has its own fixed effect: about half are harmful (50%), a third mild (85%), and about one in six lucky (125% strength, +1 score). The effects are the same in every game, so a class can discover the lucky ones. `?dev` lists them as an answer key, written as letter, position in the recipe, new letter (`U3A` = the U at position 3 changed to A).
- **Strength scales the ability**: Mover speed and turning, Cleaver reach, how reliably a Membrane takes a hit and how well it resists magnesium, Detector warning time, Joiner reach.
- **The recipe card** marks the wrong letter. It predicts a stem mistake (pairing rules decide it) and shows a core mutation as "?" until it is folded.
- **On the strand**, a lucky segment sparkles and a weak one has a faint dotted ring. The panel lists each segment's strength.
- **A Repairer's helpers** correct harmful mistakes as they pass and leave lucky ones alone.
- **Bots fold only exact recipes.** `npm test` checks the mistake rules (`test/mutations.mjs`).

## Adding a segment type

Add one entry to the list in `public/segments.js`. The comment at the top of that file explains every field. In short:

- `fn`, `core`: the name and the recipe's middle letters. Cores must all differ.
- `body`: which shape it folds into. Reuse one of the seven (blades, spikes, chamber, circle, jaws, ring, helpers). A new shape needs drawing code in `rna-strand.js`.
- `does`, `tag`, `sci`: the recipe card.
- What it does in play, if it fits an existing ability: `swim` (speed and turning), `tips` (strikes rivals), `shield`, `saltBreaks`, `warnEarly`, `findsFragments`. A new kind of ability needs code in `sim.js`.
- `likedBy` and `plan(c)`: which bot personalities like it, and how a bot weighs building it.

The page's recipe list, the server, multiplayer and the bots all pick it up from there. `npm test` checks the entry.

## Adding a biome

In `public/biomes.js`:

1. Add any new ground types to the end of `CELLS`: speed, letters, colour, drawing layer, and optional effects (`shelter`, `reach`, `mends`).
2. Add the place to `ZONES`: the name shown on screen, and the line of science the first time a player arrives.
3. Add a region to `REGIONS` that paints it onto the map. Regions run in order, and later ones can place themselves around the lagoon. Give it `cells` and `botHome` if bots should treat it as home.

Moving hazards (the tide, geysers, shifting ice, meteorites, UV flashes, rafts) still live in `map.js`.

## Dev mode

Add `?dev` to any link (`rna.game/?dev`, `rna.game/period3?dev`). A panel shows the frame rate and how long each step and frame take, the counts of strands, letters and fragments, the seed and tide, and the ground type, zone, speed and letter richness under the pointer. **Ground map** (or B) tints every cell by its ground type, with a key.

In single-player the panel also has test buttons: add any segment to your strand; make a fragment, meteorite or UV flash where the pointer is; damage your strand; run time 4× faster; skip a minute; end the round; clear the bots. In rooms it only shows information, so nobody can cheat in a shared game.

## Balance

`npm run balance` plays 12 bot-only rounds of 5 minutes (in parallel, one per CPU core) and reports:

- scores: the winner, the median strand, last place, ties
- each personality: how often it wins, its average place and score, cuts made and taken, deaths
- skill: whether better bots score more
- each segment type: how many strands have one at the end, how many copies, how often winners have one, how long it is held
- deaths by cause, where bots spend their time, and how each home region does
- a short "worth a look" list of anything out of line, such as a personality winning far more than its share, or a segment almost nobody builds

Options: `--rounds 40` (more rounds, less noise), `--seconds 120`, `--seed 7` (repeat a run exactly), `--json out.json` (every round's numbers). Run it before and after a balance change and compare.

## Checking a change

- `npm test` runs before every deploy. It checks that the page scripts parse, checks the registries, and plays a round.
- `npm run fingerprint` plays three rounds with fixed random numbers and compares them with `test/fingerprint.json`. A cleanup that's not meant to change the game must match exactly. A change that is meant to change the game (new rules, new numbers, a new segment or biome) will differ. Play it to check, then record it with `npm run fingerprint -- --save`.

## Deploying

Every push to `main` deploys to Cloudflare once the repo is connected. To connect it, one time:

1. In the Cloudflare dashboard, go to **Workers & Pages → Create application → Import a repository**.
2. Connect GitHub and choose `mosscook/rna-game`.
3. Keep the project name `rna-game`, leave the build command empty, and keep the deploy command `npx wrangler deploy`.
4. Select **Save and Deploy**.

`wrangler.toml` attaches `rna.game` as the Worker's custom domain, so the first deploy also creates its DNS record and certificate.

**The tests run before every deploy.** `wrangler.toml` sets `npm test` as the build step, so if the page doesn't parse or a headless round fails, the deploy stops and the live game stays as it was. The failure shows in the build log under Workers & Pages → rna-game → Deployments.

**Open pages offer a refresh after a deploy.** Cloudflare gives the Worker its version id (`CF_VERSION_METADATA`). A page asks `/version` once it loads, checks again every 5 minutes and whenever the tab comes back into view, and shows a "New version ready. Refresh" button when the id changes. In a room the server also sends its version when a player joins. A deploy restarts every room, so players reconnect and see the button straight away. The game keeps working until they press it.

## Working on it locally

```sh
npm install
npm test                                   # page scripts parse, registries are sound, a full round plays with no page
npm run fingerprint                        # did this change how the game plays? (see above)
npx wrangler dev --var ROUND_SECONDS:20 --var RESULTS_SECONDS:4
npm run test:room                          # with wrangler dev running: fake players join, steer, reconnect, fill the room, finish a round
```

Then open `http://localhost:8787/` for single-player, or `http://localhost:8787/test` for a room.

## Privacy

The server keeps only what a round needs while the room is running: three-letter codon names, strand state and scores. Nothing is written to storage. There are no accounts, analytics or ads, and Worker logs are off. A random token in the tab's session storage lets a refreshed tab take its strand back, and it disappears when the tab closes. The page uses the device's own fonts and loads nothing from other sites.
