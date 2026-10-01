/* ==========================================================================
   strategy.js — rules-aware basic strategy, composition-dependent exceptions,
   index deviations, and chart generation.

   Everything is expressed as an ordered *preference list* (e.g. ["double",
   "hit"]) so that rule restrictions and hand state resolve automatically:
   the engine plays the first preference that is actually available.
   ========================================================================== */
(function (BJ) {
   'use strict';

   var ACTIONS = ['hit', 'stand', 'double', 'split', 'surrender'];

   var ACTION_LABEL = {
      hit: 'Hit', stand: 'Stand', double: 'Double', split: 'Split',
      surrender: 'Surrender', insurance: 'Take insurance', noinsurance: 'Decline insurance'
   };

   var ACTION_CODE = { hit: 'H', stand: 'S', double: 'D', split: 'P', surrender: 'R' };

   /* ---------- availability ---------- */

   /**
    * ctx: { afterSplit, splitCount, splitAces, dealerPeeked }
    */
   function available(cards, rules, ctx) {
      ctx = ctx || {};
      var hv = BJ.handValue(cards);
      var first = cards.length === 2;
      var out = { hit: true, stand: true, double: false, split: false, surrender: false };

      if (ctx.splitAces && !rules.hitSplitAces) { out.hit = false; out.double = false; }

      if (first && BJ.canDoubleTotal(hv.total, rules)) {
         out.double = !ctx.afterSplit || rules.das;
         if (ctx.splitAces && !rules.hitSplitAces) out.double = false;
      }
      if (first && hv.pair) {
         var isAces = BJ.rankSlot(cards[0].rank) === 1;
         var used = ctx.splitCount || 0;
         out.split = used < rules.maxSplits;
         if (isAces && used > 0 && !rules.resplitAces) out.split = false;
      }
      out.surrender = first && !ctx.afterSplit && rules.lateSurrender;
      return out;
   }

   function resolve(prefs, avail) {
      for (var i = 0; i < prefs.length; i++) {
         if (avail[prefs[i]]) return prefs[i];
      }
      return 'hit';
   }

   /* ---------- basic strategy ---------- */

   /** Hard totals. up is a rank slot: 2..10, or 1 for ace. */
   function hardPrefs(total, up, rules) {
      var a = up === 1 ? 11 : up; // 11 = ace, keeps the chart readable
      if (total >= 18) return ['stand'];
      if (total === 17) {
         if (rules.hitSoft17 && a === 11) return ['surrender', 'stand'];
         return ['stand'];
      }
      if (total === 16) {
         if (a <= 6) return ['stand'];
         if (a === 7 || a === 8) return ['hit'];
         return ['surrender', 'hit']; // 9, 10, A
      }
      if (total === 15) {
         if (a <= 6) return ['stand'];
         if (a === 10) return ['surrender', 'hit'];
         if (a === 11 && rules.hitSoft17) return ['surrender', 'hit'];
         return ['hit'];
      }
      if (total === 13 || total === 14) return a <= 6 ? ['stand'] : ['hit'];
      if (total === 12) return (a >= 4 && a <= 6) ? ['stand'] : ['hit'];
      if (total === 11) {
         if (a === 11) return rules.hitSoft17 ? ['double', 'hit'] : ['hit'];
         return ['double', 'hit'];
      }
      if (total === 10) return (a <= 9) ? ['double', 'hit'] : ['hit'];
      if (total === 9) return (a >= 3 && a <= 6) ? ['double', 'hit'] : ['hit'];
      return ['hit']; // 5-8
   }

   /** Soft totals 13..21 (ace counted as 11). */
   function softPrefs(total, up, rules) {
      var a = up === 1 ? 11 : up;
      if (total >= 20) return ['stand'];
      if (total === 19) {
         if (rules.hitSoft17 && a === 6) return ['double', 'stand'];
         return ['stand'];
      }
      if (total === 18) {
         if (a === 2) return rules.hitSoft17 ? ['double', 'stand'] : ['stand'];
         if (a >= 3 && a <= 6) return ['double', 'stand'];
         if (a === 7 || a === 8) return ['stand'];
         return ['hit']; // 9, 10, A
      }
      if (total === 17) return (a >= 3 && a <= 6) ? ['double', 'hit'] : ['hit'];
      if (total === 15 || total === 16) return (a >= 4 && a <= 6) ? ['double', 'hit'] : ['hit'];
      if (total === 13 || total === 14) return (a === 5 || a === 6) ? ['double', 'hit'] : ['hit'];
      return ['hit'];
   }

   /** Pairs. rank is a slot: 1 (aces) .. 10. */
   function pairPrefs(rank, up, rules) {
      var a = up === 1 ? 11 : up;
      if (rank === 1) return ['split'];
      if (rank === 10) return ['stand'];
      if (rank === 9) return ((a >= 2 && a <= 6) || a === 8 || a === 9) ? ['split'] : ['stand'];
      if (rank === 8) {
         if (a === 11 && rules.hitSoft17 && rules.lateSurrender) return ['surrender', 'split'];
         return ['split'];
      }
      if (rank === 7) return (a <= 7) ? ['split'] : [];
      if (rank === 6) {
         var lo = rules.das ? 2 : 3;
         return (a >= lo && a <= 6) ? ['split'] : [];
      }
      if (rank === 5) return [];                       // played as hard 10
      if (rank === 4) return (rules.das && (a === 5 || a === 6)) ? ['split'] : [];
      // 2s and 3s
      var low = rules.das ? 2 : 4;
      return (a >= low && a <= 7) ? ['split'] : [];
   }

   /* ---------- single / double deck adjustments ----------
      Multi-deck (4-8) is the engine's baseline. These are the well-established
      departures for 1 and 2 deck games; each one is surfaced to the learner as
      a rule-driven note rather than silently applied.                        */

   function deckAdjust(kind, spec, up, rules) {
      var a = up === 1 ? 11 : up;
      var d = rules.decks;
      if (d > 2) return null;

      if (kind === 'hard') {
         if (spec === 11 && a === 11) return { prefs: ['double', 'hit'], note: 'Hard 11 doubles against every up-card in single and double deck games.' };
         if (spec === 9 && a === 2) return { prefs: ['double', 'hit'], note: 'With one or two decks, 9 vs 2 becomes a double.' };
         if (d === 1 && spec === 8 && (a === 5 || a === 6)) return { prefs: ['double', 'hit'], note: 'Single deck only: 8 doubles against 5 and 6.' };
      }
      if (kind === 'soft') {
         if (spec === 17 && a === 2) return { prefs: ['double', 'hit'], note: 'A,6 vs 2 is a double in single and double deck games.' };
         if (spec === 14 && a === 4) return { prefs: ['double', 'hit'], note: 'A,3 vs 4 is a double in single and double deck games.' };
         if (d === 1 && spec === 13 && a === 4) return { prefs: ['double', 'hit'], note: 'Single deck: A,2 doubles against 4.' };
         if (d === 1 && (spec === 15 || spec === 16) && a === 4) return { prefs: ['double', 'hit'], note: 'Single deck: A,4 and A,5 double against 4.' };
         if (d === 1 && spec === 18 && a === 2) return { prefs: ['double', 'stand'], note: 'Single deck: A,7 doubles against 2.' };
         if (d === 1 && spec === 19 && a === 6) return { prefs: ['double', 'stand'], note: 'Single deck: A,8 doubles against 6.' };
      }
      if (kind === 'pair') {
         if (spec === 4 && rules.das && a === 4) return { prefs: ['split'], note: 'With one or two decks and DAS, 4,4 splits against 4 as well.' };
      }
      return null;
   }

   /* ---------- composition-dependent exceptions ----------
      Published exceptions where the identity of the cards, not just the total,
      changes the correct play.                                               */

   function compositionException(cards, up, rules) {
      var hv = BJ.handValue(cards);
      var a = up === 1 ? 11 : up;
      if (hv.soft || hv.pair) return null;

      if (hv.total === 16 && a === 10 && cards.length >= 3) {
         return {
            prefs: ['stand'],
            note: 'A three-or-more-card 16 has already used up small cards, so the draw is more likely to bust. Multi-card 16 vs 10 stands.'
         };
      }
      if (hv.total === 12 && a === 4 && rules.decks <= 2 && hasRanks(cards, [10, 2])) {
         return {
            prefs: ['hit'],
            note: 'Composition-dependent: 10,2 vs 4 hits in single and double deck, while 12 built from other cards stands.'
         };
      }
      if (hv.total === 16 && a === 10 && rules.decks === 1 && hasRanks(cards, [9, 7])) {
         return {
            prefs: ['surrender', 'hit'],
            note: 'Single deck: 9,7 keeps both of the cards you want to draw, so 16 vs 10 plays differently from 10,6.'
         };
      }
      return null;
   }

   function hasRanks(cards, slots) {
      if (cards.length !== slots.length) return false;
      var pool = cards.map(function (c) { return BJ.rankSlot(c.rank); }).sort();
      var want = slots.slice().sort();
      for (var i = 0; i < want.length; i++) if (pool[i] !== want[i]) return false;
      return true;
   }

   /* ---------- basic strategy entry point ---------- */

   /**
    * @returns {{prefs:Array, notes:Array, kind:string, spec:number}}
    */
   function basicPrefs(cards, up, rules, opts) {
      opts = opts || {};
      var hv = BJ.handValue(cards);
      var notes = [];
      var prefs, kind, spec, adj;

      if (hv.pair && cards.length === 2) {
         spec = BJ.rankSlot(cards[0].rank);
         kind = 'pair';
         prefs = pairPrefs(spec, up, rules);
         adj = deckAdjust('pair', spec, up, rules);
         if (adj) { prefs = adj.prefs; notes.push(adj.note); }
         if (!prefs.length || prefs[0] !== 'split') {
            // fall through to the total once splitting is not indicated
            var base = hv.soft ? softPrefs(hv.total, up, rules) : hardPrefs(hv.total, up, rules);
            prefs = prefs.concat(base);
         } else {
            var backup = hv.soft ? softPrefs(hv.total, up, rules) : hardPrefs(hv.total, up, rules);
            prefs = prefs.concat(backup.filter(function (p) { return p !== 'split'; }));
         }
         return { prefs: prefs, notes: notes, kind: kind, spec: spec };
      }

      if (hv.soft) {
         kind = 'soft'; spec = hv.total;
         prefs = softPrefs(hv.total, up, rules);
         adj = deckAdjust('soft', spec, up, rules);
         if (adj && cards.length === 2) { prefs = adj.prefs; notes.push(adj.note); }
      } else {
         kind = 'hard'; spec = hv.total;
         prefs = hardPrefs(hv.total, up, rules);
         adj = deckAdjust('hard', spec, up, rules);
         if (adj && cards.length === 2) { prefs = adj.prefs; notes.push(adj.note); }
      }

      if (opts.composition !== false) {
         var ce = compositionException(cards, up, rules);
         if (ce) { prefs = ce.prefs; notes.push(ce.note); }
      }
      return { prefs: prefs, notes: notes, kind: kind, spec: spec };
   }

   function basicAction(cards, up, rules, ctx, opts) {
      var p = basicPrefs(cards, up, rules, opts);
      return resolve(p.prefs, available(cards, rules, ctx));
   }

   /* ==========================================================================
      Deviations — Hi-Lo index numbers.
 
      Each entry is a set of true-count tiers, highest first. The first tier the
      true count reaches wins; "basic" means fall back to basic strategy, which
      keeps the data internally consistent with whatever rules are in force.
      ========================================================================== */

   var DEVIATIONS = [
      {
         id: 'ins', group: 'Insurance', label: 'Insurance', kind: 'insurance', up: 1, importance: 5,
         tiers: [{ min: 3, action: 'insurance' }, { min: -99, action: 'noinsurance' }],
         note: 'Insurance is a side bet on the hole card being a ten. It turns profitable once tens are rich enough, which Hi-Lo measures at a true count of +3.'
      },

      {
         id: '16v10', group: 'Illustrious 18', kind: 'hard', spec: 16, up: 10, importance: 5,
         tiers: [{ min: 0, action: 'stand' }, { min: -99, action: 'basic' }],
         note: 'The single most valuable playing index. At a neutral or positive count the extra tens make drawing worse than standing.'
      },
      {
         id: '15v10', group: 'Illustrious 18', kind: 'hard', spec: 15, up: 10, importance: 4,
         requires: { noLs: true },
         tiers: [{ min: 4, action: 'stand' }, { min: -99, action: 'basic' }],
         note: 'At +4 standing beats both hitting and surrendering.'
      },
      {
         id: 'p10v5', group: 'Illustrious 18', kind: 'pair', spec: 10, up: 5, importance: 3,
         tiers: [{ min: 5, action: 'split' }, { min: -99, action: 'basic' }],
         note: 'Breaking up 20 is only correct at a strongly positive count, and only against 5 and 6.'
      },
      {
         id: 'p10v6', group: 'Illustrious 18', kind: 'pair', spec: 10, up: 6, importance: 3,
         tiers: [{ min: 4, action: 'split' }, { min: -99, action: 'basic' }],
         note: 'Same idea as tens against 5, one point earlier because 6 is the weakest up-card.'
      },
      {
         id: '10v10', group: 'Illustrious 18', kind: 'hard', spec: 10, up: 10, importance: 4,
         tiers: [{ min: 4, action: 'double' }, { min: -99, action: 'basic' }],
         note: 'A ten-rich shoe improves your 20 more than it improves the dealer.'
      },
      {
         id: '12v3', group: 'Illustrious 18', kind: 'hard', spec: 12, up: 3, importance: 4,
         tiers: [{ min: 2, action: 'stand' }, { min: -99, action: 'basic' }],
         note: 'Stiff versus stiff. Extra tens raise the dealer bust rate and raise your own, so you stop drawing.'
      },
      {
         id: '12v2', group: 'Illustrious 18', kind: 'hard', spec: 12, up: 2, importance: 4,
         tiers: [{ min: 3, action: 'stand' }, { min: -99, action: 'basic' }],
         note: 'A 2 is the strongest of the dealer stiff cards, so the index sits one point above 12 vs 3.'
      },
      {
         id: '11vA', group: 'Illustrious 18', kind: 'hard', spec: 11, up: 1, importance: 3,
         requires: { s17: true },
         tiers: [{ min: 1, action: 'double' }, { min: -99, action: 'basic' }],
         note: 'Only relevant when the dealer stands on soft 17 — in an H17 game basic strategy already doubles.'
      },
      {
         id: '9v2', group: 'Illustrious 18', kind: 'hard', spec: 9, up: 2, importance: 3,
         tiers: [{ min: 1, action: 'double' }, { min: -99, action: 'basic' }],
         note: 'A small positive count is enough to make the extra bet worthwhile.'
      },
      {
         id: '10vA', group: 'Illustrious 18', kind: 'hard', spec: 10, up: 1, importance: 3,
         tiers: function (rules) {
            return [{ min: rules.hitSoft17 ? 3 : 4, action: 'double' }, { min: -99, action: 'basic' }];
         },
         note: 'The index is one point lower when the dealer hits soft 17.'
      },
      {
         id: '9v7', group: 'Illustrious 18', kind: 'hard', spec: 9, up: 7, importance: 2,
         tiers: [{ min: 3, action: 'double' }, { min: -99, action: 'basic' }],
         note: 'Doubling into a 7 needs a genuinely ten-rich shoe.'
      },
      {
         id: '16v9', group: 'Illustrious 18', kind: 'hard', spec: 16, up: 9, importance: 3,
         tiers: [{ min: 5, action: 'stand' }, { min: -99, action: 'basic' }],
         note: 'A high index — most of the time you still take the card (or surrender).'
      },
      {
         id: '13v2', group: 'Illustrious 18', kind: 'hard', spec: 13, up: 2, importance: 3,
         tiers: [{ min: -1, action: 'basic' }, { min: -99, action: 'hit' }],
         note: 'A negative-count departure: when small cards are rich, the dealer busts less and your draw is safer.'
      },
      {
         id: '12v4', group: 'Illustrious 18', kind: 'hard', spec: 12, up: 4, importance: 4,
         tiers: [{ min: 0, action: 'basic' }, { min: -99, action: 'hit' }],
         note: 'Below zero you take the card. This one comes up constantly.'
      },
      {
         id: '12v5', group: 'Illustrious 18', kind: 'hard', spec: 12, up: 5, importance: 3,
         tiers: [{ min: -2, action: 'basic' }, { min: -99, action: 'hit' }],
         note: 'Stand normally, hit once the count drops to -2 or lower.'
      },
      {
         id: '12v6', group: 'Illustrious 18', kind: 'hard', spec: 12, up: 6, importance: 3,
         tiers: [{ min: -1, action: 'basic' }, { min: -99, action: 'hit' }],
         note: 'Stand normally, hit at -1 or lower.'
      },
      {
         id: '13v3', group: 'Illustrious 18', kind: 'hard', spec: 13, up: 3, importance: 3,
         tiers: [{ min: -2, action: 'basic' }, { min: -99, action: 'hit' }],
         note: 'Stand normally, hit at -2 or lower.'
      },

      {
         id: '14v10', group: 'Fab 4 surrender', kind: 'hard', spec: 14, up: 10, importance: 3,
         requires: { ls: true },
         tiers: [{ min: 3, action: 'surrender' }, { min: -99, action: 'basic' }],
         note: 'Surrendering 14 vs 10 only becomes correct in a ten-rich shoe.'
      },
      {
         id: '15v9', group: 'Fab 4 surrender', kind: 'hard', spec: 15, up: 9, importance: 3,
         requires: { ls: true },
         tiers: [{ min: 2, action: 'surrender' }, { min: -99, action: 'basic' }],
         note: 'Basic strategy takes the card; at +2 giving up half the bet is better.'
      },
      {
         id: '15v10ls', group: 'Fab 4 surrender', kind: 'hard', spec: 15, up: 10, importance: 3,
         requires: { ls: true },
         tiers: [{ min: 4, action: 'stand' }, { min: 0, action: 'surrender' }, { min: -99, action: 'hit' }],
         note: 'Three-tier play: hit when the shoe is small-card rich, surrender around neutral, stand from +4.'
      }
   ];

   function devTiers(dev, rules) {
      return typeof dev.tiers === 'function' ? dev.tiers(rules) : dev.tiers;
   }

   function devApplies(dev, rules) {
      if (!dev.requires) return true;
      if (dev.requires.ls && !rules.lateSurrender) return false;
      if (dev.requires.noLs && rules.lateSurrender) return false;
      if (dev.requires.s17 && rules.hitSoft17) return false;
      if (dev.requires.h17 && !rules.hitSoft17) return false;
      return true;
   }

   /** Primary index used for display. */
   function devIndex(dev, rules) {
      var t = devTiers(dev, rules);
      for (var i = 0; i < t.length; i++) if (t[i].action !== 'basic' && t[i].min > -90) return t[i].min;
      return t[0].min;
   }

   function findDeviation(cards, up, rules, sysId) {
      if (!BJ.system(sysId).indexes) return null;
      var hv = BJ.handValue(cards);
      var kind = hv.pair && cards.length === 2 ? 'pair' : (hv.soft ? 'soft' : 'hard');
      var spec = kind === 'pair' ? BJ.rankSlot(cards[0].rank) : hv.total;
      for (var i = 0; i < DEVIATIONS.length; i++) {
         var d = DEVIATIONS[i];
         if (d.kind !== kind || d.spec !== spec || d.up !== up) continue;
         if (!devApplies(d, rules)) continue;
         if (cards.length !== 2 && d.kind !== 'hard') continue;
         return d;
      }
      return null;
   }

   function deviationsFor(rules, sysId) {
      if (!BJ.system(sysId).indexes) return [];
      return DEVIATIONS.filter(function (d) { return devApplies(d, rules); });
   }

   /* ---------- the full recommendation ---------- */

   /**
    * @param {Object} q  { cards, up (slot), rules, ctx, trueCount, system, useDeviations, composition }
    * @returns {Object}  { action, basic, prefs, deviation, deviationActive, index, notes, source }
    */
   function recommend(q) {
      var rules = q.rules, ctx = q.ctx || {};
      var avail = available(q.cards, rules, ctx);
      var basic = basicPrefs(q.cards, q.up, rules, { composition: q.composition !== false });
      var basicChoice = resolve(basic.prefs, avail);

      var out = {
         action: basicChoice,
         basic: basicChoice,
         basicPrefs: basic.prefs,
         prefs: basic.prefs,
         notes: basic.notes.slice(),
         kind: basic.kind,
         spec: basic.spec,
         deviation: null,
         deviationActive: false,
         index: null,
         source: 'basic',
         available: avail
      };

      if (!q.useDeviations || q.trueCount === null || q.trueCount === undefined) return out;

      var dev = findDeviation(q.cards, q.up, rules, q.system);
      if (!dev) return out;

      out.deviation = dev;
      out.index = devIndex(dev, rules);

      var tiers = devTiers(dev, rules), chosen = null;
      for (var i = 0; i < tiers.length; i++) {
         if (q.trueCount >= tiers[i].min) { chosen = tiers[i]; break; }
      }
      if (!chosen || chosen.action === 'basic') return out;

      var wanted = chosen.action;
      if (avail[wanted]) {
         out.action = wanted;
         out.prefs = [wanted].concat(basic.prefs);
         out.deviationActive = out.action !== basicChoice;
         out.source = out.deviationActive ? 'deviation' : 'basic';
      }
      return out;
   }

   /* ---------- chart generation ---------- */

   var UP_COLUMNS = [2, 3, 4, 5, 6, 7, 8, 9, 10, 1];

   function upLabel(slot) { return slot === 1 ? 'A' : String(slot); }

   function cellCode(prefs, avail) {
      var p = prefs.filter(function (x) { return avail[x]; });
      if (!p.length) return 'H';
      var first = p[0], second = p[1];
      if (first === 'double') return second === 'stand' ? 'Ds' : 'D';
      if (first === 'surrender') return 'R' + (second ? ACTION_CODE[second].toLowerCase() : 'h');
      return ACTION_CODE[first];
   }

   function sampleHard(total) {
      if (total <= 4) return [BJ.card('2'), BJ.card('2')];
      if (total <= 11) {
         var lo = Math.min(9, total - 2);
         return [BJ.card(String(lo)), BJ.card(String(total - lo))];
      }
      return [BJ.card('10'), BJ.card(String(total - 10))];
   }

   function sampleSoft(total) { return [BJ.card('A'), BJ.card(String(total - 11))]; }

   function samplePair(rank) {
      var r = rank === 1 ? 'A' : String(rank);
      return [BJ.card(r), BJ.card(r)];
   }

   /**
    * Builds a strategy table straight from the engine, so the chart can never
    * drift away from the rules in force.
    * view: 'hard' | 'soft' | 'pairs'
    */
   function chart(rules, view, opts) {
      opts = opts || {};
      var rows = [], i, totals;
      if (view === 'hard') totals = [5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17];
      else if (view === 'soft') totals = [13, 14, 15, 16, 17, 18, 19, 20];
      else totals = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];

      for (i = 0; i < totals.length; i++) {
         var t = totals[i];
         var cards = view === 'hard' ? sampleHard(t) : view === 'soft' ? sampleSoft(t) : samplePair(t);
         var label = view === 'hard' ? String(t)
            : view === 'soft' ? 'A,' + (t - 11)
               : (t === 1 ? 'A,A' : t + ',' + t);
         var cells = UP_COLUMNS.map(function (up) {
            var ctx = { afterSplit: false, splitCount: 0 };
            var avail = available(cards, rules, ctx);
            var b = basicPrefs(cards, up, rules, { composition: false });
            var code = cellCode(b.prefs, avail);
            var dev = opts.deviations ? findDeviation(cards, up, rules, opts.system || 'hilo') : null;
            return {
               code: code,
               up: up,
               index: dev ? devIndex(dev, rules) : null,
               dev: dev,
               prefs: b.prefs,
               notes: b.notes,
               cards: cards,
               label: label
            };
         });
         rows.push({ label: label, total: t, view: view, cells: cells });
      }
      return { columns: UP_COLUMNS.map(upLabel), rows: rows };
   }

   BJ.strategy = {
      ACTIONS: ACTIONS,
      ACTION_LABEL: ACTION_LABEL,
      ACTION_CODE: ACTION_CODE,
      UP_COLUMNS: UP_COLUMNS,
      upLabel: upLabel,
      available: available,
      resolve: resolve,
      basicPrefs: basicPrefs,
      basicAction: basicAction,
      recommend: recommend,
      findDeviation: findDeviation,
      deviationsFor: deviationsFor,
      devIndex: devIndex,
      devTiers: devTiers,
      DEVIATIONS: DEVIATIONS,
      chart: chart,
      sampleHard: sampleHard,
      sampleSoft: sampleSoft,
      samplePair: samplePair
   };

})(window.BJ = window.BJ || {});
