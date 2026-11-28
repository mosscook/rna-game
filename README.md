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

A mouse steers toward the pointer. Arrow keys or WASD steer too (two at once go diagonally; letting go stops), and whichever was used last is in charge; while you are watching, the arrow keys switch strands instead. On touch screens, wherever a finger lands becomes a joystick: drag away from that spot to steer (a short drag swims slowly, about 70 px is full speed), and lift to stop. A faint ring shows while a finger is down. On small screens the lines of science about each place are skipped, since they cover too much of the soup.

## Start screen and Learn

The first screen offers **Play**, **Spectate** and **Learn**. On the home page Play starts a round against bots and Spectate tours the bots; in a room (`rna.game/period3`) Play picks a codon name and joins, and Spectate watches with no strand (for a projector). Until someone finishes the lesson on that device, Learn is marked "New? Start here".

**Learn** is a guided first round in the practice pool, about two minutes, with no bots. Each step finishes when you do it:

1. **Swim**: point, drag or use the arrow keys (the pool has no letters yet, so nothing gets in the way).
2. **Pick a recipe**: open Recipes and pick Cleaver. Letters start drifting in.
3. **Collect**: swim through the Cleaver's letters in order. The next letter needed is always kept within reach, and a letter that breaks your progress gets a tip to Drop it.
4. **Fold**: the Cleaver forms. If the recipe comes apart first, the lesson goes back to Collect.
5. **Cut**: a strand labelled Practice appears; hit it twice with the spikes. Its letters land beside you.

A last card covers what the lesson didn't show: scoring, the other segments, bots and places. Learn from a room opens `rna.game/?learn=<room>` and ends (or skips) back in that room. The lesson's sim uses the lobby map with `{lobby:true, cuts:true, nucs:0}`.

## Lobby

A room opens in a lobby: a mini version of the generated world (a small two-impact lagoon with three ring mounds, rosettes and a highland rim, 0.4 of the classic map across), drawn in the world's look, with clumps of letters that keep refilling, and no bots, hazards, fragments, cuts or clock. Players can practise collecting and folding while everyone arrives. The host, whoever has been in the room longest (a Spectate tab counts, so a teacher at the projector can host), sees **Start game**; everyone else sees who they are waiting for. Start moves everyone to a fresh map with fresh strands, and bots fill the empty seats. After the results screen the room goes back to the lobby for the host to start the next round, unless the host ticked **Auto-start next rounds**: then the lobby counts down 10 seconds and starts by itself (the host can still start sooner). The minimap shows the whole mini world while in the lobby, and humans start one per mound. If the host leaves, whoever has been there next longest takes over.

## The map

The map is a world grown from a seed by `public/worldgen.js`, and tuned in the terrain lab (`/lab/terrain.html`). Meteor impacts make a central lagoon, with ring mounds inside it and craggy highlands around it. Further out are deep channels, craters, volcanoes (big ones with deep calderas), lava channels, hydrothermal chimneys and streams. Depth sets swim speed: walls stop you, the shallows are slow, and the black depths are a little fast. The world is 0.7 of the classic map across, about half the area.

**Fallback:** the old painted map is still there. In a room, the host ticks **Classic map** in the lobby, or opens the room with `?map=classic`. Solo play takes `?map=classic` too. Use it if the world runs slowly on a device.

The world's places reuse the classic map's ground types:

| World place | Plays as |
|---|---|
| Lagoon | tide-pool lagoon; humans start one per ring mound |
| Highlands | tidal flats in the shallows (slow at low tide), ridge walls |
| Volcanic island | UV shallows near the top, clay lower down |
| Chimneys | nursery pockets and pores; each vent pit is a black smoker |
| Ice | brine (cold, slow, shelter) between ice walls |
| Big volcanoes | hot springs in the caldera, with a geyser |
| Bigger streams | currents toward deep water |

The world has two looks, **Filled** and **Lines**, switched with the ◯ button in the bottom bar, the O key, or `?look=lines` / `?look=filled`. Lines is the default: thin coloured band edges over a faint fill, so the strands stand out while depth (and so speed) stays readable. Both looks can be adjusted in the dev panel (`?dev`, **Map look**), and each browser remembers its own:

| Setting | What it does |
|---|---|
| Fill | How strongly each band is filled with its place's colour (0: the deep colour everywhere) |
| Depth steps | How much darker each deeper band gets |
| Outline, Line width | The line where each band starts, and its width |
| Line fade | How much the lines dim with depth |
| Wall tint | The least brightness walls keep, so they read as solid |
| Colours | The deep colour and each place's colour |

Presets (filled, lines + depth, lines, dim fill) load starting values into the look being edited. **Copy settings** puts the look on the clipboard as JSON, which can be pasted into `freshLooks()` in `public/index.html` to make it everyone's default.

The server and every browser build the same map from the seed: the generator uses only basic arithmetic. The room also sends a fingerprint of the map, and a browser that grew a different one says so in its console. `node test/world.mjs` plays a round on a world. `node test/room-world.mjs` checks a world room against `wrangler dev`. The reaction-diffusion textures are off in the game for now: they take 2-3 s to grow.

## Picking up letters

A strand's head picks up a letter within 19 px (more on clay). People's heads reach 45% further than that, about 28 px, without it showing: they steer with a finger or a mouse, and in a room their head is a few frames behind the server's. Bots keep the plain reach. Letters also push each other apart when they're closer than 34 px, so piles spread into a loose scatter you can swim through and pick from. That costs about 0.15 ms a step for 280 letters. The constants are `HUMAN_REACH`, `REPEL_R` and `REPEL_A` at the top of `public/sim.js`.

## Active volcanoes

About half the shield volcanoes and calderas are active, chosen from the seed so every screen agrees (there is always at least one shield with a lava flow). An active shield's vent pit holds a lava pool and lava runs down its channels, no more than 1400 px; an active caldera's floor is a lava lake and has no geyser. The lava swells and ebbs over 34 to 56 seconds: each flow's front creeps down its channel and back, glowing while it advances. Twice a second every structure touching lava is damaged, loose letters touching it burn off with everything behind them, and free letters and fragments that drift in burn away. Bots steer clear of it. It shows orange on the minimap at its fullest. The code is `lavas`, `lavaNear` and `lavaAt` in `map.js`.

## Membranes side by side

A Membrane takes hits meant for the function on either side of it. Two or more Membranes in a row stack: a Membrane is shielded by a working neighbour Membrane too, so a pair takes three hits to cut instead of two, and when shields stand on both sides of a struck function their strengths add up (two weak ones hold like one exact one). The strongest takes the hit. Their goo overlaps too: where two or three Membranes reach, it is drawn again on top, so it looks denser.

## Cut-off pieces

A Cleaver that has just cut something shrinks to a quarter of its size and strikes nothing while it grows back over 5 seconds (`CLEAVE_REST` in `segments.js`). Damaging a hit does not set it off, only a cut.

When a Cleaver cuts a strand, everything behind the cut floats free as a piece. For 3.5 seconds anyone's tail end that touches it takes it on, no Joiner needed: the strand that lost it (by turning back), the one that cut it, or anyone passing. It cannot be taken for the first 0.6 seconds, so it does not jump straight back onto the strand it came from. While it can be taken it pulses; then it fades for 0.8 seconds and breaks up into letters. A Joiner can also take it while it lasts. The times are `CUT_FRESH`, `CUT_ARM` and `CUT_FADE` in `segments.js`. Fragments that drift in on their own last until a Joiner takes them or a smoker breaks them up.

## Letters break down

Free letters don't last forever, as real nucleotides break down in water (hydrolysis). Each lasts 80–150 s, and fades out over its last 2.5 s. A letter with more than 12 others in the 300 px around it ages faster (20% faster for each extra letter), so piles in places nobody visits thin out. Cold brine in the ice veins slows breakdown to 40%. Letters in a fresh meteorite crater aren't hurried by crowding until it cools. The map holds about 280 letters (120 in the lobby). Constants are at the top of `public/sim.js`: `LIFE`, `CROWD_FREE`, `CROWD_RATE`, `COLD_RATE`, `NUC_FADE`.

## Microscope look

`public/lens.js` adds optional effects that make the soup look like a view down a microscope. On by default: `motes`, `eyepiece`, `grain` and `bokeh`. The Lo button turns off the two that cost every frame (`grain`, and `edge` if picked). choose others with `?lens=` (comma-separated; the list replaces the default), or toggled in `?dev` under "Microscope look". `?lens=off` turns them all off.

| Effect | What it does | Cost |
| --- | --- | --- |
| `motes` (on) | Floating grains, clay flakes and fatty-acid vesicles in four parallax layers: three below the strands (hidden behind rock and ice) sliding slower than the ground, one above them sliding faster | About 1 ms of drawing a frame on a slowed-down processor; half as many in low detail |
| `vignette` | Light falls off toward the corners | None measurable (a CSS gradient on a layer that never changes) |
| `eyepiece` (on) | A round field of view; corners go dark | None measurable, but it hides strands coming from the corners |
| `rim` | A faint blue and magenta fringe near the edge, like a cheap lens | None measurable |
| `bokeh` (on) | Out-of-focus specks drifting above and below the focal plane, with parallax | None measurable (27 soft discs a frame) |
| `soft` | The ground out of focus, so only strands and letters are sharp | Slightly cheaper than normal: ground tiles are drawn at lower resolution and blurred once |
| `scale` | A scale bar in nanometres above the minimap (letters are about 0.6 nm apart) | None measurable |
| `grain` (on; off in low detail) | Sensor noise | About 25% of frame rate in a slowed-down test |
| `edge` (off; off in low detail too) | Real blur around the edge of the view (CSS backdrop-filter), round with the eyepiece, so only the middle is sharp | Every frame, on the graphics chip |

Recommended set: `?lens=motes,vignette,rim,bokeh,soft,scale`.

## Watching

Press **Watch** (or V) to follow other strands: ◀ ▶ (or the arrow keys) move between them, **Tour** moves on every 15 seconds, and × (or Esc) goes back to your own strand. While you watch, your strand waits where it is and can still be hit. The bar shows each strand's score, its place, and what a bot is thinking.

- **Single-player:** Spectate on the start screen starts a round and tours the bots.
- **Rooms:** Spectate on the start screen connects with no strand. Watchers aren't counted as players and don't take a seat from a bot, so it suits a projector at the front of the class. Up to 6 watchers per room. The server sends each watcher what is around the strand they follow.

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

Add `?dev` to any link (`rna.game/?dev`, `rna.game/period3?dev`). The panel's sections fold open and closed (remembered per browser): **Map look**, **Microscope effects**, **Test tools** and **Reference**. At the top it shows the frame rate and how long each step and frame take, the counts of strands, letters and fragments, the seed and tide, and the ground type, zone, speed and letter richness under the pointer. **Ground map** (or B) tints every cell by its ground type, with a key.

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

## Health reports

So a playtest shows what broke or struggled on the classroom machines, pages send short anonymous notes. A note goes when a JavaScript error happens (at most 5 per page load) or when the game averages under 20 frames a second over a minute of play (once per page load). It holds the error and where it happened, frame rate, step and draw times, screen and canvas size, whether it is a Chromebook, low detail on or off, single-player, room or watching, and the version. It has no names, codons, room names or IP addresses. A small Durable Object (`src/reports.js`) keeps the latest 2,000 notes. Cloudflare's own logs stay off.

To read them, set a secret once: Cloudflare dashboard → Workers & Pages → rna-game → Settings → Variables and Secrets → Add, type **Secret**, name `REPORT_KEY`, value a long password of your choosing. Then open `rna.game/reports?key=<that password>`. The page shows the most common errors, slow sessions with their timings, and every error. Without the secret, the page doesn't exist.

## Privacy

The server keeps only what a round needs while the room is running: three-letter codon names, strand state and scores. Nothing about players is written to storage; the only thing stored is the anonymous health reports above. There are no accounts, analytics or ads, and Worker logs are off. A random token in the tab's session storage lets a refreshed tab take its strand back, and it disappears when the tab closes. The page uses the device's own fonts and loads nothing from other sites.
