# The improvement loop

Every run of the loop is a fresh agent session that follows this page. It works on the generated world only (`public/worldgen.js`, played at size 0.7). The classic map is being retired: don't test it or change it.

Each run tries one or two ideas for making the game more **balanced**. It tests each idea with bot games against an unchanged baseline, and opens a pull request for each idea that measurably helps. Nothing reaches rna.game until Moss merges a pull request.

## What "better" means

Better means more balanced, measured by `evolve/score.mjs`. It checks four things:

- No personality wins more often than the others: the spread of average rank between bot traits.
- No home area wins more often than the others: the same spread between home areas.
- The four core segments (Joiner, Cleaver, Membrane, Detector) end up on strands about equally often.
- Bots actually use the one-use segments (Repairer, Self-cutter). The goal is at least 15% of strands each.

The script combines these into a balance index (higher is better). Comparing a change with its baseline gives the change in index and a 95% interval. An idea counts as better only if the whole interval is above zero.

Keep the game itself in mind as well. Students should still be able to build segments, and rounds should still be winnable. Read the full reports, not just the index. Don't buy balance by making the game dull. For example, nobody building anything is perfectly balanced. If median score drops more than 20% or winner score drops more than 25%, treat the change as worse.

## Rules

- Never push to `main`, never merge, never force-push, and never delete branches you didn't create in this run.
- Work on a new branch named `evolve/<yyyy-mm-dd>-<short-idea>`. Make one idea per branch and keep the diff small.
- Allowed changes:
  - numbers and rules in `public/sim.js`, `public/segments.js`, `public/biomes.js` and `public/bots.js`
  - the strand engine, `public/rna-strand.js`, where a segment mechanic or a recipe's length needs it. Keep both pairing modes working ('recipes' and 'parts'), and keep `test/mutations.mjs` passing
  - how the generated world plays in `public/map.js` (its ground types, hazards and currents, in `generateWorld`)
  - the world generator's settings and landforms in `public/worldgen.js`
  - letters (how many there are, their mix, how they spawn and how they break down)
  - segment mechanics
- Don't touch:
  - the network code: `src/room.js`, `public/net.js`, `src/worker.js`
  - privacy, reports, deploy settings, tests' pass conditions, or this folder's scoring
  - `worldgen.js`'s determinism rule (basic arithmetic only)
- `npm test` must pass on your branch. Your change is meant to change the game, so re-record the fingerprint with `npm run fingerprint -- --save` and say so in the pull request.
- If 5 or more `evolve/` pull requests are already open and unreviewed, don't open more. Run the analysis only and log it.
- At most 2 pull requests per run.

## A run, step by step

1. **Set up.**
   - Attach the repo with push access, clone it, `npm ci`.
   - Read `evolve/IDEAS.md`.
   - Read the log: `git fetch origin evolve-log && git show origin/evolve-log:LOG.md` (it may not exist yet).
   - List open and recent `evolve/` pull requests with `gh api repos/mosscook/rna-game/pulls?state=all`, and read any review comments Moss left. They are guidance for this run.
2. **Baseline.** On `main`, run `evolve/run.sh base` (80 rounds on the world, seeds 1000–1079, about 10–12 minutes). Read the report in `evolve-out/base-world.txt`.
3. **Pick ideas.** Choose 1–2. Prefer untried ideas from the log and `IDEAS.md`, plus anything new the baseline reports suggest. Don't repeat an idea the log shows failing unless you're trying it a clearly different way.

   An idea can also be a stack: an idea built on top of an open `evolve/` pull request, or on a pushed branch the log names. Examples are two changes that cover the same situation, or a near miss that might clear the rule on top of another change. See **Stacked ideas** below.
4. **For each idea:**
   - Branch from `main` and make the change.
   - Run `npm test`.
   - Run `evolve/run.sh cand`. You can screen an idea first with `evolve/run.sh cand 40` against the first 40 baseline rounds. Verdicts and pull requests always use the full 80.
   - Compare: `node evolve/score.mjs evolve-out/base-world.json evolve-out/cand-world.json`.
   - Read the reports for side effects.
5. **If an idea is better** by the rule above:
   - Re-record the fingerprint and commit.
   - Push the branch, then open a pull request with `gh api repos/mosscook/rna-game/pulls -f title='evolve: <idea>' -f head='<branch>' -f base='main' -f body='<body>'`.
   - The body covers:
     - the idea and why
     - the change, in a sentence or two
     - the balance index before → after, with its interval
     - the key numbers that moved (scores, segment shares, wins by trait and by home)
     - side effects
     - how to try it (a preview isn't automatic; Moss can check out the branch)
6. **Log the run** whatever happened. Append a dated entry to `LOG.md` on the `evolve-log` branch and push it (create the branch from `main` the first time, with only `LOG.md` changed). The entry has:
   - the baseline index and the standout numbers
   - each idea tried, its result (better, worse, no clear change) and the pull request link
   - new ideas for later runs

   Keep the log readable. Every 10 runs, fold old entries into a short summary at the top.

## Stacked ideas

1. Branch from the parent branch (the open pull request's head, or the logged branch), not from `main`, and add your change.
2. Compare the stack with `main`'s baseline, as usual. Then also compare it with the parent alone: run the parent branch as `evolve/run.sh parent`, then run `node evolve/score.mjs evolve-out/parent-world.json evolve-out/cand-world.json`.
3. Open a pull request only if the stack is better than `main` by the usual rule and isn't worse than the parent.
   - If the parent is an open pull request, set the new pull request's `base` to the parent's branch, so its diff shows only the new change.
   - Say "stacked on #N" in the title and the body, and say what to do if #N is rejected.
4. A logged branch that was never opened can be opened together with its stacked change, in one pull request against `main`. Describe both changes in the body.

## Testing tips

- Rounds are 3 minutes with 10 bots. At 80 rounds, changes of about ±4 index points show up. The trait and home parts are the noisiest: they swing by about ±0.15 between 40-round halves.
- Every round uses a seed, and `score.mjs` pairs rounds by seed. Runs with the same seeds compare fairly even if they were played at different times.
- Every `evolve/` branch gets a red **Workers Builds** check. That's Cloudflare's branch preview, which fails for this Worker. It isn't a test of your change. `npm test` is the check that matters. Don't comment asking Moss for the build log.
- `test/balance.mjs` reports personalities, skill, segments, growth, deaths, places, movement and depth bands. Read them for why an idea worked or didn't.
- Bots are part of the game. A change that only helps because bots play badly, such as tuning around a bot bug, isn't a balance change. Report the bug in the log instead.
