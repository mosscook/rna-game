# Improvement loop log

Each run of `evolve/PROGRAM.md` appends one entry here. Newest at the bottom.

## 2026-11-27 — run 1

**Baseline (main @ 84a1d1a, 40 rounds per map, seed 1000)**

| | classic | world 0.7 |
|---|---|---|
| Balance index | 60.4 | 61.3 |
| Winner / median score | 17.1 / 8.8 | 18.0 / 9.9 |
| Core shares (Joiner, Cleaver, Membrane, Detector) | 47, 37, 37, 42% | 61, 42, 41, 44% |
| Repairer / Self-cutter used by | 0.3% / 1.5% | 2.0% / 0.7% |
| Average-rank spread: traits / homes | 0.59 / 0.38 | 0.44 / 0.20 |

What stood out:

- 51% of bots take damage in a round and 31% end with a damaged structure on the classic map, but nobody builds a Repairer. A fresh copy of the damaged segment costs 10 letters and scores the same 3 points as mending it with the old 13-letter Repairer.
- Opportunism wins 2.2x its fair share on the world.
- Still no deaths on either map.
- With 80 rounds, the baseline index is 65.6 on the classic map and 63.9 on the world. The trait and home spreads swing ±0.15 between 40-round halves, so treat those parts as noisy.

**Ideas tried**

1. **Cheaper Repairer (13 → 11 letters, core GACAGAC), and bots value what damage puts at risk** (+0.5 for each working structure behind the first damaged one). Result: **better** on the world, no clear change on the classic map. PR: https://github.com/mosscook/rna-game/pull/1
   - World, 80 rounds: +3.9 (0.1 to 8.1). Classic, 80 rounds: −0.2 (−4.4 to 4.5).
   - Repairer use went from 1.9% to 6.8% on the world and from 0.6% to 2.9% on the classic map. Scores were unchanged.
   - The cheaper recipe alone (no bot change) gave +3.3 (−2.3 to 9.4) on the world and +0.7 on the classic map, with Repairer use at 5% and 1.8%.
   - 6-letter cores like GACGAC break `test/mutations.mjs`: one mutation turns them into a Membrane.
2. **Fragments topped up in proportion to map area** (the world keeps 2 instead of 4; the classic map is unchanged by construction). Result: **no clear change**, not opened. Branch `evolve/2026-11-27-fragments-by-area` was not pushed.
   - World, 80 rounds: −1.5 (−5.9 to 4.2).
   - Fragments joined per round fell from 5.9 to 3.6, but the Joiner share only went from 60% to 57%.
   - Joiner dominance comes from the cheap 7-letter recipe and bot taste, not from how many fragments there are.

**New ideas for later runs**

- The Joiner (61% on the world) is the cheapest recipe at 7 letters. Try a longer Joiner core, or lower the Joiner's base `want` and the +1.2 gain bonus in its `plan`. Fewer fragments didn't help.
- The Self-cutter is still at about 1%. Its only use is recycling a damaged last structure, and bots never fold junk. It needs a new reason to exist: for example, the cut structure's letters could land straight onto the tail, or it could be worth building to shed a damaged structure before a second hit cuts everything behind it.
- The Repairer could go further. Its classic-map use (2.9%) is half the world's, because the ice and its mending are close at hand there. Try weighing the trip to the ice more honestly, or give mended structures a short hardening against the next hit.
- To compare at 80 rounds cheaply, run only seeds 1040–1079 (`--seed 1040 --rounds 40`) and merge them with the standard 40. score.mjs pairs rounds by seed.

## 2026-11-27 — run 2 (manual fire, same day)

**Baseline:** main moved to 7867f9d ("Outline look for the generated world"), but `npm run fingerprint` matched exactly. Gameplay is unchanged, so run 1's baseline files were reused (80 rounds per map, seeds 1000–1079): classic 65.6, world 63.9.

Open PRs: #1 (cheaper Repairer), no review comments yet.

**Idea tried**

1. **Self-cutter cuts out the nearest damaged structure ahead** (else the one right ahead, as before). It takes only that structure and the loose run before it, so what follows stays on the strand. Bots now consider a Self-cutter whenever something is damaged, at +0.5 for each working structure behind the damaged one. Result: **no clear change**. Not opened; branch `evolve/2026-11-28-self-cutter-sheds-damage` was pushed for later runs.
   - World, 80 rounds: +3.3 (−0.0 to 7.2). Just short of the rule.
   - Classic, 80 rounds: +0.0 (−3.3 to 3.3).
   - Self-cutter use went from 1.4% to 5.0% on the classic map and from 0.6% to 5.5% on the world, so the one-use part improved on both maps.
   - That gain was cancelled by noise in the trait and segment parts on the classic map. Scores were unchanged (world winner −0.8, median +0.4).
   - A bug I caught along the way: the old cut range ran from the target up to the cutter. Pointed at a structure further up, it would have deleted everything in between.

**Ideas not tried**

- **A longer Joiner recipe.** The 7-letter Joiner is hard-coded in `rna-strand.js` (the 7-letter window in parts mode, and `unitSeq`), so changing its core in `segments.js` alone would quietly break parts mode. It needs a coordinated change there.

**New ideas for later runs**

- Combine the Self-cutter branch with PR #1. They cover the same damaged-structure situations, and together they might push the one-use part well under 0.7. Retest them together once #1 is merged or rejected.
- The trait spread on the classic map swings 0.37 ↔ 0.51 between 40-round halves. It's the noisiest part, and it masks real one-use gains. Consider 80 rounds as the standard.

## 2026-11-28 — run 3 (scheduled)

**Baseline (main @ d44b507, seeds 1000–1119).** Main gained a dev-panel change since run 2, but the baseline replayed run 1's numbers exactly, so gameplay is unchanged. Rounds 1080–1119 were added this run, so files now cover 120 rounds per map.

| | classic | world 0.7 |
|---|---|---|
| Balance index, 80 rounds / 120 rounds | 65.6 / 65.3 | 63.9 / 66.0 |
| Winner / median score (120 rounds) | 16.8 / 7.8 | 18.9 / 9.5 |
| Core shares, 120 rounds (Joiner, Cleaver, Membrane, Detector) | 48, 38, 35, 43% | 61, 44, 46, 46% |
| Repairer / Self-cutter used by | 0.8% / 1.1% | 2.0% / 0.7% |
| Ties for first | 12% | 14% |

What stood out:

- About half of Joiner holders never joined a fragment on the classic map (38% on the world). The 7-letter Joiner is the cheapest 3 points, and it gets a free +1 whenever the bot's next recipe folds right behind it. Bots don't count that +1 when they plan, so removing it would change scores but not what they build.
- Cut-off pieces carry the victim's tail, which is often an armed Joiner. Whoever joins the piece gets a fresh armed Joiner, so Joiners spread through fights. 16–23% of strands end with two or more Joiners.
- Letters are never scarce: about 285 are still on the map at the end of a round, close to the 280 target. Recycling letters (the Self-cutter's burst) is therefore worth almost nothing. A Self-cutter is only worth building to shed damage.

Open PRs: #1 (cheaper Repairer). No review comments from Moss yet, so this run left the Repairer and Self-cutter alone to avoid stacking on it.

**Ideas tried**

1. **Fragments carry core segments instead of mostly Movers** (`spawnFrag`: the first segment is a Cleaver, Membrane or Detector, not 50% Mover). The aim was to raise the low core shares through joins. Result: **worse** on the classic map. Not opened, not pushed.
   - Classic, 80 rounds: −7.5 (−12.5 to −1.8). World, 80 rounds: +3.0 (−2.7 to 6.8).
   - Richer fragments made Joiners more worth building. The Joiner share went from 47% to 54% on the classic map, while Membrane stayed at 36%.
   - Side effects on the world: winner 19.1 → 20.1, ties 15% → 8%, joins 5.7 → 6.3 per round.
   - Lesson: anything that makes fragments more valuable raises the Joiner share.
2. **Fragments break down after 60 s** (`FRAG_LIFE` Infinity → 60; they burst into letters like a smoker-broken fragment). This is the inverse of idea 1, and on both maps, unlike run 1's world-only cut. Result: **no clear change**. Not opened, not pushed (a one-line change in `public/sim.js`).
   - 80 rounds: classic +1.8 (−2.9 to 6.7), world +2.0 (−2.7 to 7.2).
   - 120 rounds: classic +3.2 (−1.9 to 7.4), world −1.6 (−5.1 to 3.2).
   - The segment part improved on both maps: classic 0.25 → 0.16 (Joiner 48 → 45%), world 0.28 → 0.25. On the world that gain was eaten by home-area noise (homes 0.06 → 0.24).
   - Joins per round fell 3.3 → 2.5 on the classic map and 5.6 → 4.7 on the world.
   - Classic winner fell 16.8 → 16.0 and ties for first rose 12% → 18%. The world winner was unchanged, with ties at 21%.

**New ideas for later runs**

- Fragment supply moves the Joiner share in the expected direction, but only by a few points. Fewer or shorter-lived fragments alone won't fix Joiner dominance. The levers left are the recipe (7 letters, hard-coded in `rna-strand.js`) and the free fusion +1 from self-folds (which only changes scores).
- Try stopping cut-off pieces from carrying an armed Joiner: the victim's Joiner bursts into letters when the piece floats free. That would slow Joiners spreading through fights without touching fragment supply.
- Fragment decay plus PR #1 might combine well: decay helps the segment part, #1 helps the one-use part, and they touch different code.
- The home spread on the world is now the noisiest part: 0.06 at baseline against 0.24 for a change that doesn't touch homes, at 120 rounds. Cutting its weight or using more rounds would make world comparisons fairer. That's a scoring change, so it's Moss's call, not the loop's.
- Aggression still ranks last on both maps (6.3–6.4 average rank). It makes the most cuts, but the fragments go to Joiner holders. IDEAS #5 (make cutting pay the cutter) is still untried.

## 2026-11-28 — run 4 (scheduled)

**Baseline (main @ 97acf46, world 0.7, seeds 1000–1079).** Main changed gameplay since run 3: Cleavers rest 10 s after a cut, freshly cut pieces can be taken back by anyone's tail for 3.5 s and then break up, neighbouring Membranes stack, active volcanoes, and only the higher ice mends. New baseline, world only (the classic map is retired).

| | world 0.7, 80 rounds |
|---|---|
| Balance index | 67.4 (traits 0.32, homes 0.04, segments 0.25, one-use 0.92) |
| Winner / median score | 20.2 / 11.3 |
| Core shares (Joiner, Cleaver, Membrane, Detector) | 61, 46, 51, 47% |
| Repairer / Self-cutter used by | 1.8% / 0.7% |
| Ties for first | 11% |

What stood out:

- **Caution is now the losing trait**: 2% wins, average rank 6.0, against curiosity's 5.0. Aggression (5.7) is no longer last. Cautious bots fold the fewest structures (4.6 against 5.3–6.0) and hold the fewest letters (42 against 45–50). They flee 6.6% of the time (others 1–3%), yet take as many hits as anyone (1.7 per bot), so fleeing buys them nothing.
- 43% of Joiner holders never joined a fragment. 24% of strands end with two or more Joiners.
- The home part was unusually low at baseline (0.04). All three changes this run, none of which touch homes, came in at 0.17–0.22. That alone costs a candidate about 2 index points. Expect it to regress in later baselines.
- **PR #1 on today's main is no clear change**: with main merged into it, −0.2 (−3.2 to 5.6). Repairer use went 1.8% → 4.9% as before, but the homes part swung 0.04 → 0.22. It cleared the rule on the older main (+3.9). Moss may want to re-check it before merging.

Open PRs: #1 (cheaper Repairer), 10 commits behind main. No review comments from Moss.

**Ideas tried**

1. **Self-cutter sheds damage, stacked on #1** (run 2's branch, cherry-picked onto #1 with main merged in). Result: **no clear change**. Not opened. Branch `evolve/2026-11-28-self-cutter-on-repairer` was pushed.
   - Against main: +2.7 (−0.6 to 8.4). Against #1 + main alone: +2.9 (−0.1 to 5.0).
   - One-use part 0.92 → 0.75. Repairer 1.8% → 4.5%, Self-cutter 0.7% → 3.1%.
   - Scores were unchanged: winner 19.9, median 11.0. Caution improved slightly (rank 6.0 → 5.8).
   - Homes 0.04 → 0.17 ate most of the gain.
2. **Bots value a Joiner's fragment more honestly** (`segments.js`, Joiner `plan`: the +1.2 gain bonus for a free fragment in sight → +0.3). Result: **no clear change**. Not opened. Branch `evolve/2026-11-28-joiner-honest-worth` was pushed.
   - +2.1 (−2.1 to 8.8).
   - Joiner share 61% → 56%, segment part 0.25 → 0.19, worth about +2.4 by itself.
   - Median score fell 11.3 → 10.5 (−7%), winner 20.2 → 19.5. That's within the limits.
   - Greed now ranks first (4.9) and curiosity fell back to 5.6. Homes 0.04 → 0.17 again.

**New ideas for later runs**

- **Combine the two branches above.** They touch different code (the Joiner's plan, and the Repairer and Self-cutter), and they move different parts: segments (about +2.4) and one-use (about +3.4). Together they might clear the rule. Branch from `evolve/2026-11-28-self-cutter-on-repairer` and cherry-pick 7a60863.
- **Caution needs a payoff, or less wasted time.** Cautious bots flee more but get hit just as often. Two things to try:
  - Bots read a resting Cleaver (a stub for 10 s after a cut) as harmless. Today it still counts in `_tips` for fear, flee, give-way and avoidance (`bots.js`, the tips loop). The effect is probably small, since cleavers rest about 5% of the time.
  - Soften caution's give-way and threat-letter costs in `bestLetter`.
- Bots ignore freshly cut pieces, which anyone's tail can take back for 3.5 s. A cutter swimming on, or a victim turning back, could grab them. That might be IDEAS #5's "make cutting pay" without new rules.
- The home part is noisy enough to hide 2–3 point gains at 80 rounds. That's a scoring question for Moss, not the loop.

## 2026-11-28 — run 5 (scheduled)

**Baseline (main @ 97acf46, world 0.7, seeds 1000–1079).** Main hasn't changed since run 4, and the baseline replayed it exactly: index 67.4 (traits 0.32, homes 0.04, segments 0.25, one-use 0.92). Winner / median 20.2 / 11.3. Caution still wins 2% (rank 6.0). Joiner on 61% of strands, Repairer 1.8%, Self-cutter 0.7%.

Open PRs at start: #1 (cheaper Repairer). No review comments from Moss.

**Ideas tried**

1. **Joiner valued honestly + Self-cutter sheds damage, stacked on #1** (run 4's suggestion: cherry-pick 7a60863 onto `evolve/2026-11-28-self-cutter-on-repairer`). Result: **better**. PR: https://github.com/mosscook/rna-game/pull/2 (base `main`, so its diff includes #1 until #1 merges).
   - Against main: +3.8 (0.4 to 10.5). Against the parent branch: +1.1 (−3.8 to 6.9). The parent against main, rerun: +2.7 (−0.6 to 8.4), as in run 4.
   - Segments 0.25 → 0.21, one-use 0.92 → 0.67 (Repairer 5.4%, Self-cutter 4.6%). Joiner only 61 → 59%: with the one-use changes in, the Joiner tweak moves it less than alone (56%).
   - Winner / median 19.4 / 10.9. Traits worsened 0.32 → 0.40 (aggression last at 6.0) and homes 0.04 → 0.18.
2. **Bots ignore resting Cleavers, and cautious bots hang back less near threats** (`bots.js`: no spike tips while a Cleaver rests; letter cost near a threat `1 + 1.5 × caution` → `1 + 0.6 × caution`).
   - On main alone: **no clear change**, +1.8 (−1.9 to 6.6). Caution rank 6.0 → 5.7, traits 0.32 → 0.20, median 11.3 → 10.7. Branch `evolve/2026-11-28-caution-reads-threats` was pushed.
   - Stacked on #2: **better** against main, +5.6 (1.2 to 11.7). Against #2: +1.7 (−3.8 to 5.4). PR: https://github.com/mosscook/rna-game/pull/3 (base = #2's branch).
   - Traits 0.40 → 0.21 against #2. Caution wins 5% → 10%. Homes 0.18 → 0.30 (ice-home bots 8.8). Ties for first 11% → 18%.

**Notes**

- Open evolve PRs are now a chain: #1 ← #2 ← #3. If Moss rejects #1, #2 and #3 need retesting without the Repairer.
- Each 80-round run takes about 12 minutes alone and about 15 with two running side by side on this 2-CPU box. Running the parent and the candidate in parallel works.
- No Workers Builds Preview URL so far (Preview URLs are disabled on the Cloudflare side).

**New ideas for later runs**

- **The homes part is now the biggest loser.** It was 0.04 at baseline, but every change since run 4 lands at 0.17–0.30. That's partly a lucky baseline, but in #3, ice-home and chimney bots average about 9, while island and lagoon average 10–10.4. Look at what ice-home bots do differently: the higher-ice-only mending moved their mending trips.
- Aggression ranks last on #2 (6.0). It makes the most cuts (1.5), but scores the least. IDEAS #5 (make cutting pay the cutter) and grabbing freshly cut pieces (run 4) are still untried.
- Ties for first rose to 18% on #3. Check whether the winners cap out by holding every kind.
- Cautious bots still never cut (0.1 cuts). Their Membrane/Detector taste is the other lever if caution falls behind again.
