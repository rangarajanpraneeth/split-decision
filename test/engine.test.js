/* Node harness — loads the browser files and checks the maths. */
const fs = require('fs');
const path = require('path');
global.window = global;
['core.js', 'strategy.js', 'ev.js'].forEach(f => {
   eval(fs.readFileSync(path.join(__dirname, '..', 'js', f), 'utf8'));
});
const BJ = global.BJ;

let fails = 0, checks = 0;
function eq(actual, expected, label) {
   checks++;
   if (actual !== expected) { fails++; console.log('FAIL', label, '=>', actual, 'expected', expected); }
}
function near(actual, expected, tol, label) {
   checks++;
   if (Math.abs(actual - expected) > tol) { fails++; console.log('FAIL', label, '=>', actual.toFixed(4), 'expected ~', expected); }
}

const R = BJ.normaliseRules({ decks: 6, hitSoft17: true, das: true, lateSurrender: true });
const S17 = BJ.normaliseRules({ decks: 6, hitSoft17: false, das: true, lateSurrender: true });
const NODAS = BJ.normaliseRules({ decks: 6, hitSoft17: true, das: false, lateSurrender: true });
const NOSUR = BJ.normaliseRules({ decks: 6, hitSoft17: true, das: true, lateSurrender: false });

function code(view, total, up, rules) {
   const c = BJ.strategy.chart(rules, view, {});
   const row = c.rows.find(r => r.total === total);
   const cell = row.cells.find(x => x.up === up);
   return cell.code;
}

/* --- hard totals, 6D H17 DAS LS --- */
eq(code('hard', 8, 5, R), 'H', 'hard 8 v 5');
eq(code('hard', 9, 2, R), 'H', 'hard 9 v 2');
eq(code('hard', 9, 3, R), 'D', 'hard 9 v 3');
eq(code('hard', 9, 7, R), 'H', 'hard 9 v 7');
eq(code('hard', 10, 9, R), 'D', 'hard 10 v 9');
eq(code('hard', 10, 10, R), 'H', 'hard 10 v 10');
eq(code('hard', 11, 1, R), 'D', 'hard 11 v A (H17)');
eq(code('hard', 11, 1, S17), 'H', 'hard 11 v A (S17)');
eq(code('hard', 12, 3, R), 'H', 'hard 12 v 3');
eq(code('hard', 12, 4, R), 'S', 'hard 12 v 4');
eq(code('hard', 13, 6, R), 'S', 'hard 13 v 6');
eq(code('hard', 14, 7, R), 'H', 'hard 14 v 7');
eq(code('hard', 15, 10, R), 'Rh', 'hard 15 v 10');
eq(code('hard', 15, 1, R), 'Rh', 'hard 15 v A (H17)');
eq(code('hard', 15, 1, S17), 'H', 'hard 15 v A (S17)');
eq(code('hard', 15, 10, NOSUR), 'H', 'hard 15 v 10 no surrender');
eq(code('hard', 16, 9, R), 'Rh', 'hard 16 v 9');
eq(code('hard', 16, 6, R), 'S', 'hard 16 v 6');
eq(code('hard', 16, 8, R), 'H', 'hard 16 v 8');
eq(code('hard', 17, 1, R), 'Rs', 'hard 17 v A (H17)');
eq(code('hard', 17, 1, S17), 'S', 'hard 17 v A (S17)');

/* --- soft --- */
eq(code('soft', 13, 5, R), 'D', 'A2 v 5');
eq(code('soft', 13, 4, R), 'H', 'A2 v 4');
eq(code('soft', 15, 4, R), 'D', 'A4 v 4');
eq(code('soft', 17, 3, R), 'D', 'A6 v 3');
eq(code('soft', 17, 2, R), 'H', 'A6 v 2');
eq(code('soft', 18, 2, R), 'Ds', 'A7 v 2 (H17)');
eq(code('soft', 18, 2, S17), 'S', 'A7 v 2 (S17)');
eq(code('soft', 18, 6, R), 'Ds', 'A7 v 6');
eq(code('soft', 18, 7, R), 'S', 'A7 v 7');
eq(code('soft', 18, 9, R), 'H', 'A7 v 9');
eq(code('soft', 19, 6, R), 'Ds', 'A8 v 6 (H17)');
eq(code('soft', 19, 6, S17), 'S', 'A8 v 6 (S17)');
eq(code('soft', 20, 6, R), 'S', 'A9 v 6');

/* --- pairs --- */
eq(code('pairs', 1, 10, R), 'P', 'AA v 10');
eq(code('pairs', 10, 6, R), 'S', 'TT v 6');
eq(code('pairs', 9, 7, R), 'S', '99 v 7');
eq(code('pairs', 9, 9, R), 'P', '99 v 9');
eq(code('pairs', 9, 1, R), 'S', '99 v A');
eq(code('pairs', 8, 10, R), 'P', '88 v 10');
eq(code('pairs', 8, 1, R), 'Rp', '88 v A (H17 LS)');
eq(code('pairs', 8, 1, S17), 'P', '88 v A (S17)');
eq(code('pairs', 7, 8, R), 'H', '77 v 8');
eq(code('pairs', 6, 2, R), 'P', '66 v 2 (DAS)');
eq(code('pairs', 6, 2, NODAS), 'H', '66 v 2 (no DAS)');
eq(code('pairs', 5, 9, R), 'D', '55 v 9');
eq(code('pairs', 5, 10, R), 'H', '55 v 10');
eq(code('pairs', 4, 5, R), 'P', '44 v 5 (DAS)');
eq(code('pairs', 4, 5, NODAS), 'H', '44 v 5 (no DAS)');
eq(code('pairs', 3, 2, R), 'P', '33 v 2 (DAS)');
eq(code('pairs', 3, 2, NODAS), 'H', '33 v 2 (no DAS)');
eq(code('pairs', 2, 8, R), 'H', '22 v 8');

/* --- deck adjustments --- */
const DD = BJ.normaliseRules({ decks: 2, hitSoft17: false, das: true, lateSurrender: true });
eq(code('hard', 9, 2, DD), 'D', 'DD hard 9 v 2');
eq(code('hard', 11, 1, DD), 'D', 'DD hard 11 v A');
eq(code('soft', 17, 2, DD), 'D', 'DD A6 v 2');
const SD = BJ.normaliseRules({ decks: 1, hitSoft17: false, das: true, lateSurrender: true });
eq(code('hard', 8, 5, SD), 'D', 'SD hard 8 v 5');
eq(code('soft', 19, 6, SD), 'Ds', 'SD A8 v 6');

/* --- composition dependence --- */
const c1 = BJ.strategy.recommend({
   cards: [BJ.card('10'), BJ.card('4'), BJ.card('2')], up: 10, rules: R,
   ctx: {}, trueCount: 0, system: 'hilo', useDeviations: false
});
eq(c1.action, 'stand', 'multi-card 16 v 10 stands');
const c2 = BJ.strategy.recommend({
   cards: [BJ.card('10'), BJ.card('6')], up: 10, rules: R,
   ctx: {}, trueCount: 0, system: 'hilo', useDeviations: false
});
eq(c2.action, 'surrender', 'two-card 16 v 10 surrenders');

/* --- deviations --- */
function dev(cards, up, tc, rules) {
   return BJ.strategy.recommend({
      cards: cards, up: up, rules: rules || R, ctx: {}, trueCount: tc,
      system: 'hilo', useDeviations: true
   });
}
eq(dev([BJ.card('10'), BJ.card('6')], 10, 1).action, 'stand', '16v10 at +1 stands');
eq(dev([BJ.card('10'), BJ.card('6')], 10, -1).action, 'surrender', '16v10 at -1 surrenders (LS)');
eq(dev([BJ.card('10'), BJ.card('6')], 10, -1, NOSUR).action, 'hit', '16v10 at -1 hits (no LS)');
eq(dev([BJ.card('10'), BJ.card('2')], 3, 2).action, 'stand', '12v3 at +2 stands');
eq(dev([BJ.card('10'), BJ.card('2')], 3, 1).action, 'hit', '12v3 at +1 hits');
eq(dev([BJ.card('10'), BJ.card('2')], 4, -1).action, 'hit', '12v4 at -1 hits');
eq(dev([BJ.card('10'), BJ.card('2')], 4, 0).action, 'stand', '12v4 at 0 stands');
eq(dev([BJ.card('9'), BJ.card('4')], 2, -2).action, 'hit', '13v2 at -2 hits');
eq(dev([BJ.card('9'), BJ.card('4')], 2, 0).action, 'stand', '13v2 at 0 stands');
eq(dev([BJ.card('10'), BJ.card('10')], 6, 5).action, 'split', 'TT v 6 at +5 splits');
eq(dev([BJ.card('10'), BJ.card('10')], 6, 3).action, 'stand', 'TT v 6 at +3 stands');
eq(dev([BJ.card('6'), BJ.card('4')], 10, 4).action, 'double', '10 v 10 at +4 doubles');
eq(dev([BJ.card('9'), BJ.card('5')], 10, 3).action, 'surrender', '14 v 10 at +3 surrenders');
eq(dev([BJ.card('9'), BJ.card('5')], 10, 2).action, 'hit', '14 v 10 at +2 hits');
eq(dev([BJ.card('10'), BJ.card('5')], 10, 4).action, 'stand', '15 v 10 at +4 stands');
eq(dev([BJ.card('10'), BJ.card('5')], 10, 1).action, 'surrender', '15 v 10 at +1 surrenders');
eq(dev([BJ.card('10'), BJ.card('5')], 10, -1).action, 'hit', '15 v 10 at -1 hits');
eq(dev([BJ.card('7'), BJ.card('4')], 1, 1, S17).action, 'double', '11 v A at +1 doubles (S17)');

/* --- EV model --- */
function evOf(cards, up, rules) {
   return BJ.ev.evaluate({ cards: cards, up: up, rules: rules || R, ctx: {} });
}
const e16 = evOf([BJ.card('10'), BJ.card('6')], 10);
near(e16.values.stand, -0.540, 0.02, 'EV stand 16v10');
near(e16.values.hit, -0.540, 0.02, 'EV hit 16v10');
const e12 = evOf([BJ.card('10'), BJ.card('2')], 4);
near(e12.values.stand, -0.211, 0.02, 'EV stand 12v4');
near(e12.values.hit, -0.212, 0.02, 'EV hit 12v4');
const e11 = evOf([BJ.card('6'), BJ.card('5')], 6);
near(e11.values.double, 0.667, 0.03, 'EV double 11v6');
const eA8 = evOf([BJ.card('A'), BJ.card('8')], 6, S17);
near(eA8.values.stand, 0.4956, 0.01, 'EV stand A8v6 (S17)');
const eA8h = evOf([BJ.card('A'), BJ.card('8')], 6, R);
checks++; if (!(eA8h.values.double > eA8h.values.stand)) { fails++; console.log('FAIL A8v6 H17 double should beat stand'); }
const d10 = BJ.ev.evaluate({ cards: [BJ.card('10'), BJ.card('6')], up: 10, rules: R, ctx: {} });
near(d10.dealer.bust, 0.234, 0.02, 'dealer bust with 10 up (no BJ)');
const d6 = BJ.ev.evaluate({ cards: [BJ.card('10'), BJ.card('6')], up: 6, rules: R, ctx: {} });
near(d6.dealer.bust, 0.42, 0.02, 'dealer bust with 6 up');
eq(e16.best, 'surrender', 'best action 16v10 is surrender');

/* --- shoe + counting --- */
const shoe = new BJ.Shoe(6, 'hilo');
let rc = 0;
for (let i = 0; i < 60; i++) { const c = shoe.draw(); rc += BJ.tagFor(c.rank, 'hilo'); }
eq(shoe.rc, rc, 'shoe running count matches manual tally');
eq(shoe.remaining(), 312 - 60, 'shoe depletion');
near(shoe.decksRemaining(), (312 - 60) / 52, 0.001, 'decks remaining');

console.log(fails ? `\n${fails} failures of ${checks} checks` : `\nAll ${checks} checks passed`);
