/* Checks that every script the page runs at least parses: the files in public/ and the script inside index.html.
   The headless round only covers the game code the server shares, so a typo in the page or net.js would otherwise deploy. */
import {readFileSync, readdirSync} from 'node:fs';
import vm from 'node:vm';

const dir = new URL('../public/', import.meta.url);
let bad = 0;
const parse = (code, name) => {
  try { new vm.Script(code, {filename:name}); }
  catch(e){ bad++; console.error(`${name}: ${e.message}`); }
};
for (const f of readdirSync(dir).filter(f => f.endsWith('.js'))) parse(readFileSync(new URL(f, dir), 'utf8'), f);
const html = readFileSync(new URL('index.html', dir), 'utf8');
const inline = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m => m[1]);
inline.forEach((code, i) => parse(code, `index.html script ${i + 1}`));
if (!inline.length){ bad++; console.error('index.html: no inline script found'); }
if (bad) process.exit(1);
console.log(`page scripts parse (${inline.length} inline)`);
