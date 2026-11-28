#!/usr/bin/env bash
# Plays the loop's standard test games for whatever code is checked out here, on both maps, with fixed seeds,
# so a baseline and a change play the same rounds:  evolve/run.sh <label> [rounds per map, default 80]
# (40 is fine for a quick first look at an idea; verdicts use 80: fewer swing on noise in the trait and home parts)
# Writes evolve-out/<label>-classic.json and evolve-out/<label>-world.json, and prints each one's balance score.
set -euo pipefail
cd "$(dirname "$0")/.."
label=${1:?label}; rounds=${2:-80}; mkdir -p evolve-out
node test/balance.mjs --rounds "$rounds" --seconds 180 --seed 1000 --json "evolve-out/$label-classic.json" > "evolve-out/$label-classic.txt"
node test/balance.mjs --rounds "$rounds" --seconds 180 --seed 1000 --world 0.7 --json "evolve-out/$label-world.json" > "evolve-out/$label-world.txt"
node evolve/score.mjs "evolve-out/$label-classic.json"; node evolve/score.mjs "evolve-out/$label-world.json"
