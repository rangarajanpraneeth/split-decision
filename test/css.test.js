/* Structural checks a browser enforces but jsdom will not: the cascade, the
   frame, and contrast. jsdom ignores media queries and treats the hidden
   attribute specially, so anything the cascade decides is checked by parsing. */
const path = require('path');
let csstree;
try { csstree = require('css-tree'); }
catch (e) { console.log('css-tree not installed - skipping (npm i css-tree)'); process.exit(0); }
const fs = require('fs');
const css = fs.readFileSync(path.join(__dirname, '..', 'css', 'app.css'), 'utf8');

let fails = 0;
const ok = (c, m) => { if (!c) { fails++; console.log('FAIL', m); } };

let errors = [];
const ast = csstree.parse(css, { onParseError(e) { errors.push(e.formattedMessage || e.message); } });
ok(errors.length === 0, 'stylesheet parses: ' + errors.slice(0, 3).join(' | '));

/* every custom property used is defined */
const defined = new Set(), used = new Set();
csstree.walk(ast, node => {
   if (node.type === 'Declaration' && node.property.startsWith('--')) defined.add(node.property);
   if (node.type === 'Function' && node.name === 'var') {
      const first = node.children.first;
      if (first && first.name) used.add(first.name);
   }
});
const missing = [...used].filter(v => !defined.has(v));
ok(missing.length === 0, 'undefined custom properties: ' + missing.join(', '));

/* author display rules outrank the UA stylesheet, so hidden needs help */
ok(/\[hidden\] \{ display: none !important; \}/.test(css), 'hidden elements stay hidden');
ok(css.indexOf('[hidden]') < css.indexOf('.dashboard {'), 'the hidden guard comes first');

/* the frame: one screen, columns scroll, page does not */
ok(/\.container \{[^}]*height: 100vh/.test(css), 'the frame is the height of the window');
ok(/body \{[^}]*overflow: hidden/.test(css), 'the page itself does not scroll');
ok(/\.dashboard \{[^}]*grid-template-columns: 1fr 1\.7fr 1\.25fr 2\.4fr/.test(css),
   'four columns: overview, table, coach, reference');
ok(/\.dashboard__column \{[^}]*overflow-y: auto/.test(css), 'each column scrolls on its own');

/* terminal styling: no radius, mono everywhere, flat surfaces */
ok(!/border-radius/.test(css), 'nothing is rounded');
ok(!/box-shadow:\s*0 \d/.test(css), 'no drop shadows (inset rules are fine)');
ok(/font-family: var\(--mono\)/.test(css), 'one typeface, and it is mono');
ok(/line-height: 1;/.test(css), 'chrome sits on a single-line rhythm');
ok(/\.dashboard__column \{[^}]*background: var\(--panel\)/.test(css), 'columns are flat panels');

/* headings belong to their section, not to the top of the scroll container */
ok(!/position: sticky/.test(css), 'nothing inside a scrolling column is pinned');

/* the five decisions each keep their own colour */
['--hit', '--stand', '--double', '--split', '--surrender'].forEach(v => {
   ok(defined.has(v), v + ' is defined');
   ok(new RegExp('color: var\\(' + v + '\\)').test(css), v + ' is actually used');
});

/* small text has to clear 4.5:1 on its surface, in both themes */
function lum(hex) {
   const v = [1, 3, 5].map(i => parseInt(hex.substr(i, 2), 16) / 255)
      .map(c => (c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4)));
   return 0.2126 * v[0] + 0.7152 * v[1] + 0.0722 * v[2];
}
function ratio(a, b) {
   const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p);
   return (x + 0.05) / (y + 0.05);
}
const blocks = css.split(':root[data-theme="light"]');
function vars(block) {
   const out = {};
   [...block.matchAll(/--(\w[\w-]*):\s*(#[0-9a-fA-F]{6})/g)].forEach(m => { if (!(m[1] in out)) out[m[1]] = m[2]; });
   return out;
}
const dark = vars(blocks[0]);
const light = vars(blocks[1] || '');
[['dark', dark], ['light', light]].forEach(([name, v]) => {
   if (!v.panel) return;
   ['text', 'muted', 'dim'].forEach(key => {
      if (!v[key]) return;
      const r = ratio(v[key], v.panel);
      ok(r >= 4.5, name + ' ' + key + ' clears 4.5:1 on a panel (got ' + r.toFixed(2) + ')');
   });
   ['hit', 'stand', 'double', 'split', 'surrender'].forEach(key => {
      if (!v[key] || !v.cell) return;
      const r = ratio(v[key], v.cell);
      ok(r >= 3, name + ' ' + key + ' is legible on a chart cell (got ' + r.toFixed(2) + ')');
   });
});

console.log(fails ? fails + ' structural problems' : 'stylesheet structure OK');
process.exit(fails ? 1 : 0);
