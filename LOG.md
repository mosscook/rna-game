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
