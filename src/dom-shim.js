/* Just enough of a page for the game's browser files to run on the server.
   rna-strand.js builds SVG elements as it goes; on the server nothing is drawn, so every element is a
   do-nothing stand-in that remembers its attributes. Import this before the game files. */
const store = new WeakMap();

function makeEl(tag){
  const attrs = new Map();
  const style = new Proxy({setProperty(){}, removeProperty(){}, getPropertyValue(){ return ''; }}, {
    get:(t, k) => (k in t ? t[k] : ''),
    set:() => true
  });
  const target = {
    tagName:String(tag || 'g').toUpperCase(), style, dataset:{}, textContent:'', children:[], childNodes:[], parentNode:null,
    setAttribute(k, v){ attrs.set(k, String(v)); },
    setAttributeNS(ns, k, v){ attrs.set(k, String(v)); },
    getAttribute(k){ return attrs.has(k) ? attrs.get(k) : null; },
    removeAttribute(k){ attrs.delete(k); },
    hasAttribute(k){ return attrs.has(k); },
    appendChild(c){ if (c && typeof c === 'object'){ c.parentNode = target; } return c; },
    insertBefore(c){ return c; },
    removeChild(c){ return c; },
    remove(){},
    replaceChildren(){},
    addEventListener(){}, removeEventListener(){},
    querySelector(){ return null; }, querySelectorAll(){ return []; },
    getContext(){ return null; },
    getBBox(){ return {x:0, y:0, width:0, height:0}; },
    getTotalLength(){ return 0; },
    getBoundingClientRect(){ return {x:0, y:0, left:0, top:0, width:0, height:0, right:0, bottom:0}; },
    classList:{add(){}, remove(){}, toggle(){}, contains(){ return false; }}
  };
  /* anything else the drawing code reaches for is a harmless no-op */
  const el = new Proxy(target, {
    get(t, k){
      if (k in t) return t[k];
      if (typeof k === 'symbol') return undefined;
      return undefined;
    },
    set(t, k, v){ t[k] = v; return true; }
  });
  store.set(el, attrs);
  return el;
}

if (typeof globalThis.window === 'undefined') globalThis.window = globalThis;
if (typeof globalThis.document === 'undefined'){
  globalThis.document = {
    createElementNS:(ns, tag) => makeEl(tag),
    createElement:tag => makeEl(tag),
    documentElement:makeEl('html'),
    body:makeEl('body'),
    getElementById(){ return null; },
    querySelector(){ return null; },
    addEventListener(){}
  };
}
if (typeof globalThis.getComputedStyle === 'undefined') globalThis.getComputedStyle = () => ({getPropertyValue:() => ''});
if (typeof globalThis.matchMedia === 'undefined') globalThis.matchMedia = () => ({matches:false, addEventListener(){}});

export const svgStub = () => makeEl('svg');
