/* ==========================================================================
   catalog.js — the universe of trainable situations.

   Every hand/up-card pair is enumerated with:
     freq  how often it actually turns up at a table (exact two-card maths),
     cost  what a wrong answer costs in expectation (from the EV model),
   and importance = freq x cost. That is what drives the adaptive selector:
   practice concentrates on situations that are both common and expensive,
   not on whatever is rare and exotic.
   ========================================================================== */
(function (BJ) {
   'use strict';

   var SLOT_COUNT = { 1: 4, 2: 4, 3: 4, 4: 4, 5: 4, 6: 4, 7: 4, 8: 4, 9: 4, 10: 16 };
   var TOTAL_TWO = 1326; // C(52,2)

   var cache = { key: null, list: null, map: null };
   var costCache = {};

   function slotCard(slot) {
      return { rank: slot === 1 ? 'A' : (slot === 10 ? '10' : String(slot)), suit: 'S' };
   }

   function comboKey(a, b, up) {
      return BJ.situationKey([slotCard(a), slotCard(b)], slotCard(up));
   }

   function comboWeight(a, b) {
      if (a === b) return SLOT_COUNT[a] * (SLOT_COUNT[a] - 1) / 2;
      return SLOT_COUNT[a] * SLOT_COUNT[b];
   }

   function build() {
      var map = {}, a, b, up;
      for (a = 1; a <= 10; a++) {
         for (b = a; b <= 10; b++) {
            var w = comboWeight(a, b) / TOTAL_TWO;
            for (up = 1; up <= 10; up++) {
               var upW = SLOT_COUNT[up] / 52;
               var proto0 = [slotCard(a), slotCard(b)];
               if (BJ.handValue(proto0).blackjack) continue; // a natural is not a decision
               var key = comboKey(a, b, up);
               if (!map[key]) {
                  var proto = proto0;
                  var hv = BJ.handValue(proto);
                  map[key] = {
                     key: key,
                     kind: hv.pair ? 'pair' : (hv.soft ? 'soft' : 'hard'),
                     spec: hv.pair ? a : hv.total,
                     total: hv.total,
                     soft: hv.soft,
                     up: up,
                     combos: [],
                     freq: 0,
                     label: BJ.prettyKey(key)
                  };
               }
               map[key].combos.push({ a: a, b: b, w: w });
               map[key].freq += w * upW;
            }
         }
      }
      var list = Object.keys(map).map(function (k) { return map[k]; });
      return { list: list, map: map };
   }

   function all() {
      if (!cache.list) {
         var built = build();
         cache.list = built.list;
         cache.map = built.map;
      }
      return cache.list;
   }

   function get(key) { all(); return cache.map[key] || null; }

   function rulesSig(rules) {
      return [rules.decks, rules.hitSoft17 ? 1 : 0, rules.das ? 1 : 0,
      rules.lateSurrender ? 1 : 0, rules.doubleOn, rules.maxSplits].join('.');
   }

   /** Cost of the second-best action, in units of the initial bet. */
   function cost(key, rules) {
      var sig = rulesSig(rules) + '|' + key;
      if (costCache[sig] !== undefined) return costCache[sig];
      var s = get(key);
      if (!s) return 0;
      var combo = s.combos[0];
      var cards = [slotCard(combo.a), slotCard(combo.b)];
      var res = BJ.ev.evaluate({ cards: cards, up: s.up, rules: rules, ctx: {} });
      var gap = res.gap;
      costCache[sig] = gap;
      return gap;
   }

   /**
    * Cognitive difficulty, 1 (obvious) to 5 (genuinely hard).
    * Close decisions are hard; pairs and soft hands are harder than hard
    * totals; anything with an index attached is harder again.
    */
   function difficulty(key, rules, opts) {
      opts = opts || {};
      var s = get(key);
      if (!s) return 3;
      var gap = cost(key, rules);
      var d;
      if (gap < 0.02) d = 5;
      else if (gap < 0.05) d = 4;
      else if (gap < 0.12) d = 3;
      else if (gap < 0.30) d = 2;
      else d = 1;

      if (s.kind === 'soft') d += 0.5;
      if (s.kind === 'pair') d += 0.4;
      if (opts.multiCard) d += 0.6;
      if (opts.deviation) d += 1;
      if (opts.counting) d += 0.6;
      if (opts.timed) d += 0.4;
      return BJ.clamp(Math.round(d), 1, 5);
   }

   /**
    * Importance = how often it comes up  x  what an error costs  x  how likely
    * an error actually is. The last term matters: standing on 20 against a ten
    * has a huge EV gap, which is exactly why nobody gets it wrong. Drilling
    * time belongs to the close decisions that occur often.
    */
   var impCache = {};
   function importanceTable(rules) {
      var sig = rulesSig(rules);
      if (impCache[sig]) return impCache[sig];
      var list = all(), t = {}, max = 0;
      for (var i = 0; i < list.length; i++) {
         var s = list[i];
         var gap = Math.min(cost(s.key, rules), 0.8);
         var plausible = Math.exp(-gap / 0.08);
         var v = s.freq * gap * plausible;
         t[s.key] = v;
         if (v > max) max = v;
      }
      if (max > 0) for (var k in t) if (t.hasOwnProperty(k)) t[k] = t[k] / max;
      impCache[sig] = t;
      return t;
   }

   function importance(key, rules) {
      var t = importanceTable(rules);
      return t[key] !== undefined ? t[key] : 0.15;
   }

   /** Situations that carry a Hi-Lo index. */
   function deviationKeys(rules, sysId) {
      var out = {};
      var devs = BJ.strategy.deviationsFor(rules, sysId || 'hilo');
      for (var i = 0; i < devs.length; i++) {
         var d = devs[i];
         if (d.kind === 'insurance') { out['insurance'] = d; continue; }
         var up = d.up === 1 ? 'A' : String(d.up);
         var key = d.kind === 'pair' ? 'pair' + (d.spec === 1 ? 'A' : d.spec) + 'v' + up
            : d.kind + d.spec + 'v' + up;
         out[key] = d;
      }
      return out;
   }

   BJ.catalog = {
      all: all,
      get: get,
      cost: cost,
      difficulty: difficulty,
      importance: importance,
      importanceTable: importanceTable,
      deviationKeys: deviationKeys,
      slotCard: slotCard,
      rulesSig: rulesSig
   };

})(window.BJ = window.BJ || {});
