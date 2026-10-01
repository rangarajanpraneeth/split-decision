/* ==========================================================================
   ev.js — expected value model.

   These numbers are computed, not typed in from a table. The model:
     * draw probabilities come from the exact remaining shoe composition
       (so the count genuinely moves the numbers),
     * probabilities are held fixed for the rest of the hand rather than being
       re-derived after every card leaves the shoe,
     * split EV assumes one split with no resplitting.

   That makes the values accurate to roughly a thousandth of a bet for shoe
   games and slightly coarser for single deck. Everything shown in the UI is
   labelled as a model estimate for that reason.
   ========================================================================== */
(function (BJ) {
   'use strict';

   var MODEL_NOTE = 'Model estimate: exact shoe composition, probabilities held fixed during the hand; split EV assumes a single split.';

   function fullComposition(decks) {
      var c = {};
      for (var s = 1; s <= 10; s++) c[s] = (s === 10 ? 16 : 4) * decks;
      return c;
   }

   function removeCards(comp, cards) {
      var c = {}, s;
      for (s = 1; s <= 10; s++) c[s] = comp[s];
      for (var i = 0; i < cards.length; i++) {
         var slot = BJ.rankSlot(cards[i].rank);
         if (c[slot] > 0) c[slot]--;
      }
      return c;
   }

   function probs(comp) {
      var total = 0, s;
      for (s = 1; s <= 10; s++) total += comp[s];
      var p = {};
      for (s = 1; s <= 10; s++) p[s] = total > 0 ? comp[s] / total : 0;
      return p;
   }

   function without(p, slot) {
      var q = {}, sum = 0, s;
      for (s = 1; s <= 10; s++) { q[s] = (s === slot ? 0 : p[s]); sum += q[s]; }
      if (sum > 0) for (s = 1; s <= 10; s++) q[s] /= sum;
      return q;
   }

   function addCard(total, soft, slot) {
      var v = slot === 1 ? 11 : slot;
      var t = total + v;
      var sf = soft || slot === 1;
      if (t > 21 && sf) { t -= 10; sf = false; }
      return { total: t, soft: sf };
   }

   /* ---------- dealer ---------- */

   function dealerDistribution(up, p, rules) {
      var memo = {};

      function rec(total, soft) {
         if (total > 21) return { bust: 1 };
         var stands = total > 17 || (total === 17 && !(soft && rules.hitSoft17));
         if (stands) { var r = {}; r[total] = 1; return r; }
         var key = total + (soft ? 's' : 'h');
         if (memo[key]) return memo[key];
         var out = {};
         for (var s = 1; s <= 10; s++) {
            if (p[s] <= 0) continue;
            var n = addCard(total, soft, s);
            var sub = rec(n.total, n.soft);
            for (var k in sub) if (sub.hasOwnProperty(k)) out[k] = (out[k] || 0) + p[s] * sub[k];
         }
         memo[key] = out;
         return out;
      }

      var start = up === 1 ? { total: 11, soft: true } : { total: up, soft: false };
      var firstP = p;
      if (rules.peek && up === 1) firstP = without(p, 10);
      else if (rules.peek && up === 10) firstP = without(p, 1);

      var dist = {};
      for (var s = 1; s <= 10; s++) {
         if (firstP[s] <= 0) continue;
         var n = addCard(start.total, start.soft, s);
         var sub = rec(n.total, n.soft);
         for (var k in sub) if (sub.hasOwnProperty(k)) dist[k] = (dist[k] || 0) + firstP[s] * sub[k];
      }
      dist.bust = dist.bust || 0;
      return dist;
   }

   /* ---------- player ---------- */

   function build(comp, up, rules) {
      var p = probs(comp);
      var dealer = dealerDistribution(up, p, rules);

      function standEV(total) {
         if (total > 21) return -1;
         var ev = dealer.bust || 0;
         for (var d = 17; d <= 21; d++) {
            var pd = dealer[d] || 0;
            if (!pd) continue;
            if (total > d) ev += pd;
            else if (total < d) ev -= pd;
         }
         return ev;
      }

      var hitMemo = {};
      function hitEV(total, soft) {
         var key = total + (soft ? 's' : 'h');
         if (hitMemo.hasOwnProperty(key)) return hitMemo[key];
         var ev = 0;
         for (var s = 1; s <= 10; s++) {
            if (p[s] <= 0) continue;
            var n = addCard(total, soft, s);
            if (n.total > 21) ev += p[s] * -1;
            else ev += p[s] * Math.max(standEV(n.total), hitEV(n.total, n.soft));
         }
         hitMemo[key] = ev;
         return ev;
      }

      function doubleEV(total, soft) {
         var ev = 0;
         for (var s = 1; s <= 10; s++) {
            if (p[s] <= 0) continue;
            var n = addCard(total, soft, s);
            ev += p[s] * (n.total > 21 ? -2 : 2 * standEV(n.total));
         }
         return ev;
      }

      function bestEV(total, soft, canDouble) {
         var best = Math.max(standEV(total), hitEV(total, soft));
         if (canDouble) best = Math.max(best, doubleEV(total, soft));
         return best;
      }

      function splitEV(rank) {
         var aces = rank === 1;
         var ev = 0;
         for (var s = 1; s <= 10; s++) {
            if (p[s] <= 0) continue;
            var n = addCard(aces ? 11 : rank, aces, s);
            if (n.total > 21) { n = { total: n.total - 10, soft: false }; }
            var handEV;
            if (aces && !rules.hitSplitAces) handEV = standEV(n.total);
            else handEV = bestEV(n.total, n.soft, rules.das && BJ.canDoubleTotal(n.total, rules));
            ev += p[s] * handEV;
         }
         return 2 * ev;
      }

      return {
         dealer: dealer,
         standEV: standEV,
         hitEV: hitEV,
         doubleEV: doubleEV,
         splitEV: splitEV,
         probs: p
      };
   }

   /**
    * @param q { cards, up, rules, comp?, available? }
    * @returns { values:{action:ev}, best, gap, dealer:{bust,probs}, note }
    */
   function evaluate(q) {
      var rules = q.rules;
      var comp = q.comp || removeCards(fullComposition(rules.decks), q.cards.concat([{ rank: q.up === 1 ? 'A' : String(q.up) }]));
      var m = build(comp, q.up, rules);
      var hv = BJ.handValue(q.cards);
      var avail = q.available || BJ.strategy.available(q.cards, rules, q.ctx || {});

      var values = {};
      values.stand = m.standEV(hv.total);
      values.hit = hv.total >= 21 ? -1 : m.hitEV(hv.total, hv.soft);
      if (avail.double) values.double = m.doubleEV(hv.total, hv.soft);
      if (avail.split) values.split = m.splitEV(BJ.rankSlot(q.cards[0].rank));
      if (avail.surrender) values.surrender = -0.5;

      var order = Object.keys(values).sort(function (a, b) { return values[b] - values[a]; });
      var best = order[0];
      var gap = order.length > 1 ? values[order[0]] - values[order[1]] : 1;

      return {
         values: values,
         order: order,
         best: best,
         gap: gap,
         dealer: {
            bust: m.dealer.bust || 0,
            probs: m.dealer
         },
         note: MODEL_NOTE
      };
   }

   function fmt(v) {
      if (v === undefined || v === null) return '\u2014';
      var s = (v >= 0 ? '+' : '\u2212') + Math.abs(v).toFixed(3);
      return s;
   }

   BJ.ev = {
      evaluate: evaluate,
      build: build,
      probs: probs,
      fullComposition: fullComposition,
      removeCards: removeCards,
      dealerDistribution: dealerDistribution,
      fmt: fmt,
      MODEL_NOTE: MODEL_NOTE
   };

})(window.BJ = window.BJ || {});
