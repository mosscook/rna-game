/* The same game files the browser loads, set up to run with no page.
   Each room makes its own map, bots and simulation with makeGame(). */
import {svgStub} from './dom-shim.js';
import '../public/segments.js';
import '../public/rna-strand.js';
import '../public/biomes.js';
import '../public/map.js';
import '../public/bots.js';
import '../public/sim.js';

export const RS = globalThis.RNAStrand;
export const FN = globalThis.SoupSegments.names;

export function makeGame({minStrands = 10, round = 300, hooks = {}} = {}){
  const MAP = globalThis.SoupMap.create();
  const BOTS = globalThis.SoupBots.create();
  const stage = RS.createStage(svgStub());
  const sim = globalThis.SoupSim.create({MAP, BOTS, stage, minStrands, round, hooks});
  return {sim, MAP, BOTS, stage};
}
