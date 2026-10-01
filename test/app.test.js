/* Drives the real terminal in jsdom: real clicks, real rounds, real money. */
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('/home/claude/node_modules/jsdom');

const root = path.join(__dirname, '..');
const dom = new JSDOM(fs.readFileSync(path.join(root, 'index.html'), 'utf8'), {
   runScripts: 'outside-only', pretendToBeVisual: true, url: 'https://example.com/'
});
const { window } = dom;
const doc = window.document;

if (!window.localStorage) {
   const mem = {};
   window.localStorage = {
      getItem: k => (k in mem ? mem[k] : null),
      setItem: (k, v) => { mem[k] = String(v); },
      removeItem: k => { delete mem[k]; }
   };
}
window.performance = window.performance || { now: () => Date.now() };
window.matchMedia = window.matchMedia || (() => ({ matches: false, addListener() { }, removeListener() { } }));
window.scrollTo = () => { };

let fails = 0, checks = 0;
const ok = (c, label) => { checks++; if (!c) { fails++; console.log('FAIL', label); } };
const eq = (a, b, label) => { checks++; if (a !== b) { fails++; console.log('FAIL', label, '=>', a, 'expected', b); } };

['core.js', 'strategy.js', 'ev.js', 'round.js', 'catalog.js', 'cards.js', 'deck.js', 'dom.js', 'store.js', 'train.js', 'views.js', 'app.js']
   .forEach(f => {
      try { window.eval(fs.readFileSync(path.join(root, 'js', f), 'utf8')); }
      catch (e) { fails++; console.log('LOAD ERROR in', f, e.message); }
   });

const BJ = window.BJ;
if (!doc.querySelector('.tabstrip__item')) BJ.app.boot();   // jsdom never fires DOMContentLoaded here

const wait = ms => new Promise(r => window.setTimeout(r, ms));
const click = n => n.dispatchEvent(new window.MouseEvent('click', { bubbles: true, cancelable: true }));
const tab = id => Array.from(doc.querySelectorAll('.tabstrip__item')).find(t => t.dataset.panel === id);

(async function run() {
   BJ.store.settings().autoAdvance = false;

   // My own actions are synchronous; the only thing this loop has to wait for
   // is the dealer's paced draw. The block further down measures that my
   // actions really do run without waiting.


   /* ---------- the frame ---------- */
   ok(!!BJ.app, 'app booted');
   eq(doc.querySelectorAll('.dashboard__column').length, 4, 'four columns');
   ok(!!doc.getElementById('col-left'), 'overview rail exists');
   ok(!!doc.getElementById('col-game'), 'table column exists');
   ok(!!doc.getElementById('col-main'), 'panel column exists');
   ok(!!doc.getElementById('train-rail'), 'training rail exists');
   eq(doc.querySelectorAll('.tabstrip__item').length, 4, 'four panel tabs');

   const order = Array.from(doc.querySelectorAll('.dashboard > .dashboard__column'))
      .map(c => c.id || (c.classList.contains('dashboard__column--panel') ? 'panel' : '?'));
   eq(order.join(' '), 'col-left col-game col-right panel',
      'columns run overview, table, coach, reference');
   ok(doc.getElementById('status-left').textContent.indexOf('6D') > -1, 'status bar states the game');
   ok(/H#/.test(doc.getElementById('status-left').textContent), 'status bar counts hands');

   /* ---------- panels swap the wide column and the rails ---------- */
   for (const id of ['analytics', 'journal', 'settings', 'matrix']) {
      click(tab(id));
      eq(BJ.app.panel(), id, 'clicking ' + id + ' selects that panel');
      ok(tab(id).classList.contains('tabstrip__item--active'), id + ' tab shows as active');
      ok(doc.getElementById('col-main').children.length > 0, id + ' filled the wide column');
      ok(doc.getElementById('col-left').children.length > 0, id + ' filled the left rail');
   }

   click(tab('matrix'));
   ok(/Theory score|theory/i.test(doc.getElementById('col-left').textContent), 'matrix panel keeps the overview on the left');
   eq(doc.querySelectorAll('#matrix-table .cell').length, 130, 'hard chart is 13 x 10');
   ok(!!doc.querySelector('.matrix__options'), 'chart options sit above the chart');
   const optionsNode = doc.querySelector('.matrix__options');
   const tableNode = doc.querySelector('#matrix-table');
   const legendNode = doc.querySelector('.legendbar');
   ok(optionsNode.compareDocumentPosition(tableNode) & window.Node.DOCUMENT_POSITION_FOLLOWING,
      'options come before the chart');
   ok(tableNode.compareDocumentPosition(legendNode) & window.Node.DOCUMENT_POSITION_FOLLOWING,
      'the legend comes after the chart');

   /* ---------- legend filtering ---------- */
   const standLegend = Array.from(doc.querySelectorAll('.legend__item')).find(b => /Stand/.test(b.textContent));
   click(standLegend);
   ok(doc.querySelectorAll('#matrix-table .cell--dim').length > 0, 'filtering dims the rest');
   ok(Array.from(doc.querySelectorAll('#matrix-table .cell:not(.cell--dim)')).every(c => c.dataset.code === 'S'),
      'only stand cells stay lit');
   click(Array.from(doc.querySelectorAll('.legend__item')).find(b => /Stand/.test(b.textContent)));
   eq(doc.querySelectorAll('#matrix-table .cell--dim').length, 0, 'clicking again clears it');

   /* ---------- a session, driven from the drill list ---------- */
   const startBankroll = BJ.store.table().bankroll;
   const modeBtn = doc.querySelector('.modelist__item[data-mode="basic"]');
   ok(!!modeBtn, 'the drill list is in the right rail');
   click(modeBtn);
   ok(BJ.trainer.isRunning(), 'clicking a drill starts it');
   ok(!!doc.querySelector('#col-game .betbar'), 'the bet bar is on the table');
   ok(!doc.querySelector('#col-game .betbar--idle'), 'and its chips are live while betting');
   ok(/SHOE/i.test(doc.getElementById('train-rail').textContent), 'the rail shows the shoe');

   // The table must not resize between turns, so the action zone keeps the same
   // rows and the same number of controls in every phase.
   const shapes = new Set();
   const zoneOrders = new Set();
   const readZoneOrder = () => {
      const z = doc.getElementById('actionzone');
      if (!z) return;
      zoneOrders.add(Array.from(z.children).map(n => {
         if (n.classList.contains('betbar')) return 'bet';
         if (n.classList.contains('actions--single')) return 'primary';
         if (n.classList.contains('actions')) return 'decisions';
         return 'hint';
      }).join(' '));
   };
   const zoneShape = () => {
      const z = doc.getElementById('actionzone');
      return z.children.length + 'rows/' + z.querySelectorAll('.chip').length + 'chips/' +
         z.querySelectorAll('.btn--primary').length + 'primary';
   };

   let guard = 0, sawDecision = false, sawSettled = false, sawMultiCard = false, maxCards = 0;
   while (BJ.trainer.isRunning() && guard++ < 900) {
      const S = BJ.trainer.state();
      if (!S) break;
      shapes.add(zoneShape());
      readZoneOrder();
      if (S.phase === 'bet') {
         click(doc.querySelector('#col-game .btn--primary'));
      } else if (S.phase === 'insurance') {
         click(doc.querySelector('.act--noinsurance'));
      } else if (S.phase === 'player' && S.current) {
         sawDecision = true;
         if (S.current.cards.length > 2) sawMultiCard = true;
         maxCards = Math.max(maxCards, doc.querySelectorAll('#col-game .card').length);
         const btn = doc.querySelector('.act--' + S.current.rec.action);
         ok(!!btn, 'the recommended action has a button');
         if (!btn) break;
         click(btn);
      } else if (S.phase === 'settled' || S.waitingFor) {
         sawSettled = true;
         const b = doc.querySelector('#col-game .btn--primary');
         if (b) click(b);
      }
      await wait(15);        // let the dealer's 100ms draw land
   }

   ok(sawDecision, 'the player was asked to act');
   ok(shapes.size === 1, 'the action zone kept one shape all session: ' + [...shapes].join(' / '));
   eq([...zoneOrders].join(' + '), 'decisions bet primary hint',
      'decisions sit under the cards, the bet sits with the deal button');

   ok(sawSettled, 'rounds settled');
   ok(sawMultiCard, 'hands played out past two cards');
   ok(maxCards >= 3, 'cards were drawn on the table');
   ok(!!doc.querySelector('#col-game .summary'), 'the summary lands in the table column');
   ok(!!doc.querySelector('.modelist__item'), 'the rail returns to the drill list');

   const table = BJ.store.table();
   ok(table.rounds >= 12, 'rounds recorded, got ' + table.rounds);
   eq(table.bankroll, startBankroll + table.net, 'bankroll equals the starting roll plus the net');
   eq(table.won + table.lost + table.pushed, table.hands, 'every hand landed in one bucket');

   /* ---------- controls stay put, they just go quiet ---------- */
   BJ.trainer.start('basic', { rounds: 4 });
   eq(doc.querySelectorAll('#actionzone .act').length, 5, 'all five decisions are on screen while betting');
   eq(Array.from(doc.querySelectorAll('#actionzone .act')).filter(b => !b.disabled).length, 0,
      'none of them are live before the deal');
   eq(Array.from(doc.querySelectorAll('#actionzone .chip')).filter(b => !b.disabled).length, 5,
      'the chips are live while betting');
   BJ.trainer.placeBet(20);
   const dealt = BJ.trainer.state();
   if (dealt && dealt.phase === 'player') {
      eq(doc.querySelectorAll('#actionzone .act').length, 5, 'still five decisions after the deal');
      ok(Array.from(doc.querySelectorAll('#actionzone .act')).filter(b => !b.disabled).length >= 2,
         'hit and stand come alive');
   } else {
      // dealer ace or a natural: the row is still there, just nothing to press
      eq(doc.querySelectorAll('#actionzone .act').length >= 2, true, 'the decision row survives an early settle');
      checks++;
   }
   eq(Array.from(doc.querySelectorAll('#actionzone .chip')).filter(b => !b.disabled).length, 0,
      'the chips go quiet once the hand is live');
   const beforeHit = doc.querySelectorAll('#actionzone .act').length;
   BJ.trainer.act('hit');
   eq(doc.querySelectorAll('#actionzone .act').length, beforeHit,
      'hitting does not remove the double and split buttons, it only disables them');
   BJ.trainer.quit();

   /* ---------- pacing: instant for me, watchable for the dealer ---------- */
   BJ.trainer.start('basic', { rounds: 4 });
   const t0 = Date.now();
   BJ.trainer.placeBet(20);
   let myActions = 0;
   while (BJ.trainer.state() && BJ.trainer.state().phase === 'player' && myActions < 4) {
      BJ.trainer.act('hit');
      myActions++;
   }
   ok(myActions > 0, 'the player could act');
   ok(Date.now() - t0 < 900, 'my own actions run without waiting (' + (Date.now() - t0) + 'ms)');

   // wherever that left us, the round must come to rest and stay there
   await wait(900);
   const resting = BJ.trainer.state();
   eq(resting && resting.phase, 'settled', 'the round comes to rest on the settled hand');
   ok(doc.querySelectorAll('#col-game .card').length > 0, 'the cards are still on the table');
   ok(!!doc.querySelector('#col-game .roundresult'), 'the payout is still on screen');
   await wait(1200);
   eq(BJ.trainer.state().phase, 'settled', 'and it is still there a second later, unprompted');

   const nextBtn = doc.querySelector('#actionzone .btn--primary');
   eq(nextBtn.textContent, 'Next hand', 'the primary button offers the next hand');
   ok(!nextBtn.disabled, 'and it is live');
   click(nextBtn);
   eq(BJ.trainer.state().phase, 'bet', 'clicking it clears the table at once');
   eq(doc.querySelectorAll('#col-game .card').length, 0, 'no cards left over');
   BJ.trainer.quit();

   /* ---------- card artwork ---------- */
   eq(BJ.deck.bundledCount(), 53, 'the bundled pack carries 52 faces and a back');
   eq(BJ.deck.missing().length, 0, 'no face is missing artwork');
   ok(!!BJ.deck.art('AS') && BJ.deck.art('AS').indexOf('<svg') === 0, 'a face is vector markup');
   ok(BJ.deck.art('AS').indexOf('class="card"') === -1, 'bundled art cannot collide with our own card class');
   eq(BJ.deck.keyFromFilename('AS.svg'), 'AS', 'AS.svg maps to the ace of spades');
   eq(BJ.deck.keyFromFilename('10h.svg'), 'TH', '10h.svg maps to the ten of hearts');
   eq(BJ.deck.keyFromFilename('ace_of_spades.svg'), 'AS', 'word names map too');
   eq(BJ.deck.keyFromFilename('king-of-hearts.svg'), 'KH', 'hyphenated word names map too');
   eq(BJ.deck.keyFromFilename('back.svg'), 'BACK', 'the back maps');
   eq(BJ.deck.keyFromFilename('notacard.svg'), null, 'anything else is refused');
   ok(BJ.deck.clean('<?xml version="1.0"?><svg width="2.5in" height="3.5in" class="card"><script>x()</script><g/></svg>')
      .indexOf('<script') === -1, 'uploaded markup is stripped of scripts');
   ok(BJ.deck.clean('<svg width="2.5in" height="3.5in"><g/></svg>').indexOf('width="2.5in"') === -1,
      'uploaded faces lose their fixed dimensions');

   const artCard = BJ.dom.cardTile({ rank: 'A', suit: 'S' }, {});
   ok(artCard.className.indexOf('card--art') > -1, 'cards render with artwork by default');
   ok(artCard.querySelector('svg'), 'the tile contains the vector face');
   BJ.store.settings().cardArt = false;
   const plainCard = BJ.dom.cardTile({ rank: 'A', suit: 'S' }, {});
   ok(plainCard.className.indexOf('card--art') === -1, 'artwork can be switched off');
   ok(/A/.test(plainCard.textContent), 'the fallback tile still names the card');
   BJ.store.settings().cardArt = true;

   /* ---------- the status bar tracks the session ---------- */
   BJ.trainer.start('deviations', { rounds: 3 });
   BJ.app.refreshStatus();
   const status = doc.getElementById('status-left').textContent;
   ok(/RC/.test(status), 'the count is on the status bar when the mode shows it');
   BJ.trainer.quit();
   BJ.trainer.start('perfect', { rounds: 3 });
   BJ.app.refreshStatus();
   ok(/RC ··/.test(doc.getElementById('status-left').textContent),
      'the count is masked when the mode hides it');
   BJ.trainer.quit();

   /* ---------- persistence ---------- */
   const json = BJ.store.exportJSON();
   ok(JSON.parse(json).table.rounds > 0, 'the export carries table results');
   BJ.store.importJSON(json);
   ok(BJ.store.table().rounds > 0, 'the import restores them');

   /* ---------- mastery stays slow ---------- */
   BJ.store.reset('progress');
   for (let i = 0; i < 3; i++) {
      BJ.store.record({ key: 'hard16v10', mode: 'basic', kind: 'hard', correct: true, timeMs: 1200, correctAction: 'stand', up: 10 });
   }
   ok(BJ.store.mastery('hard16v10') < 45, 'three right answers are not mastery');
   for (let i = 0; i < 25; i++) {
      BJ.store.record({ key: 'hard16v10', mode: 'basic', kind: 'hard', correct: true, timeMs: 1200, correctAction: 'stand', up: 10 });
   }
   ok(BJ.store.mastery('hard16v10') > 80, 'sustained correct play earns it');

   console.log(fails ? `\n${fails} failures of ${checks} checks` : `\nAll ${checks} checks passed`);
   process.exit(fails ? 1 : 0);
})();
