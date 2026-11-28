# Ideas for the improvement loop

The loop works on the generated world only. The classic map is being retired, and ideas about it are kept for reference.

These come from the first comparison of the two maps on 27 November 2026: 20 bot rounds of 3 minutes on each. Later runs add new ideas to the log on the `evolve-log` branch.

## What the first runs showed

| | Classic map | Generated world |
|---|---|---|
| Balance index | 65.7 | 56.2 |
| Winner / median score | 16.8 / 8.7 | 19.2 / 10.6 |
| Core segment shares (Joiner, Cleaver, Membrane, Detector) | 44, 42, 39, 36% | 63, 41, 42, 42% |
| Repairer / Self-cutter used by | 2% / 1% of strands | 3% / 1% |
| Average-rank spread: personalities / home areas | 0.51 / 0.18 | 0.57 / 0.44 |
| Deaths per bot | 0 | 0 |
| Fragments joined per round | 2.9 | 6.0 |

## Ideas

1. **The one-use segments are almost never used.** Repairer and Self-cutter are used by 1–3% of strands. Look at what makes bots build and launch them: their cost (recipe length), their trigger conditions in `bots.js`, and their payoff. Then try making them cheaper or more rewarding.
2. **Joiner dominates on the generated world** (63% of strands against about 42% for the rest). The world is smaller and strands meet more often, so there are more fragments to join. Try:
   - fewer fragments on the world, or fragments that decay sooner
   - a longer Joiner cooldown
   - making the world's size a setting to test (0.7 now; try 0.8)
3. **Home areas are uneven on the world** (spread 0.44). Find which areas lose. Check the mound starts, which humans get first, while bots take what's left. Check too whether some outer places are too far or too slow (bands 1–2 take 31% of bots' time on the world).
4. **Hazards never kill.** There are no deaths on either map, so smokers, meteorites and UV don't matter. That's mostly a fun problem, but it also lets cautious and reckless play score the same. Try making smoker pits slightly bigger, or warnings shorter. Balance is the target, so only keep it if trait balance improves.
5. *(Classic map, retired: kept for reference.)* **Personalities on the classic map.** Grudge and opportunism bots win about twice as often as aggression and caution. Aggression makes the most cuts but scores the least. Try making cutting pay off more (or cost less) for the cutter.
6. *(Classic map, retired: kept for reference.)* **The island home area underperforms on the classic map** (4% wins against 10–14% for the others). Look at the letter mix and travel times from the island.
7. **20% of world rounds end in a tie for first**, against 5% on the classic map. Scoring may cap out on the smaller map. Check whether more of the winners hold every segment type.
