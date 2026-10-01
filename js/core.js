/* ==========================================================================
   core.js — cards, hands, rule sets, shoe model, counting systems
   No dependencies. Attaches to window.BJ.
   ========================================================================== */
(function (BJ) {
   'use strict';

   /* ---------- cards ---------- */

   var RANKS = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];
   var SUITS = ['S', 'H', 'D', 'C'];
   var SUIT_GLYPH = { S: '\u2660', H: '\u2665', D: '\u2666', C: '\u2663' };

   function rankValue(rank) {
      if (rank === 'A') return 11;
      if (rank === '10' || rank === 'J' || rank === 'Q' || rank === 'K') return 10;
      return parseInt(rank, 10);
   }

   /** Ranks collapse to 1..10 for composition maths (1 = ace, 10 = any ten). */
   function rankSlot(rank) {
      if (rank === 'A') return 1;
      if (rank === '10' || rank === 'J' || rank === 'Q' || rank === 'K') return 10;
      return parseInt(rank, 10);
   }

   function card(rank, suit) {
      return { rank: rank, suit: suit || SUITS[Math.floor(Math.random() * 4)] };
   }

   function cardLabel(c) { return c.rank + SUIT_GLYPH[c.suit]; }
   function handLabel(cards) { return cards.map(function (c) { return c.rank; }).join('-'); }

   /** Total, softness, pair-ness, blackjack. */
   function handValue(cards) {
      var total = 0, aces = 0, i;
      for (i = 0; i < cards.length; i++) {
         var v = rankValue(cards[i].rank);
         total += v;
         if (cards[i].rank === 'A') aces++;
      }
      var softAces = aces;
      while (total > 21 && softAces > 0) { total -= 10; softAces--; }
      return {
         total: total,
         soft: softAces > 0,
         busted: total > 21,
         pair: cards.length === 2 && rankSlot(cards[0].rank) === rankSlot(cards[1].rank),
         blackjack: cards.length === 2 && total === 21,
         cards: cards.length
      };
   }

   /* ---------- rules ---------- */

   var DEFAULT_RULES = {
      decks: 6,
      hitSoft17: true,       // dealer hits soft 17
      blackjackPayout: 1.5,  // 1.5 = 3:2, 1.2 = 6:5, 1 = 1:1
      das: true,             // double after split
      doubleOn: 'any',       // 'any' | '9-11' | '10-11'
      lateSurrender: true,
      maxSplits: 3,          // 3 = up to 4 hands
      resplitAces: false,
      hitSplitAces: false,
      peek: true,            // dealer peeks for blackjack
      penetration: 0.75
   };

   var RULE_LABELS = {
      decks: 'Decks',
      hitSoft17: 'Soft 17',
      blackjackPayout: 'Blackjack pays',
      das: 'Double after split',
      doubleOn: 'Doubling',
      lateSurrender: 'Late surrender',
      maxSplits: 'Max splits',
      resplitAces: 'Resplit aces',
      hitSplitAces: 'Hit split aces',
      peek: 'Dealer peek'
   };

   function ruleSummary(rules) {
      var parts = [];
      parts.push(rules.decks + (rules.decks === 1 ? ' deck' : ' decks'));
      parts.push(rules.hitSoft17 ? 'H17' : 'S17');
      parts.push(rules.das ? 'DAS' : 'NDAS');
      parts.push(rules.lateSurrender ? 'LS' : 'no surrender');
      if (rules.doubleOn !== 'any') parts.push('double ' + rules.doubleOn);
      parts.push(payoutLabel(rules.blackjackPayout));
      return parts.join(' \u00b7 ');
   }

   function payoutLabel(p) {
      if (Math.abs(p - 1.5) < 1e-6) return '3:2';
      if (Math.abs(p - 1.2) < 1e-6) return '6:5';
      if (Math.abs(p - 1) < 1e-6) return '1:1';
      return p + 'x';
   }

   function normaliseRules(r) {
      var out = {};
      for (var k in DEFAULT_RULES) if (DEFAULT_RULES.hasOwnProperty(k)) {
         out[k] = (r && r[k] !== undefined) ? r[k] : DEFAULT_RULES[k];
      }
      out.decks = Math.max(1, Math.min(8, out.decks | 0));
      out.maxSplits = Math.max(0, Math.min(3, out.maxSplits | 0));
      return out;
   }

   /** Which totals may be doubled under the rule set. */
   function canDoubleTotal(total, rules) {
      if (rules.doubleOn === 'any') return true;
      if (rules.doubleOn === '9-11') return total >= 9 && total <= 11;
      if (rules.doubleOn === '10-11') return total >= 10 && total <= 11;
      return true;
   }

   /* ---------- counting systems ---------- */
   /* tags are indexed by rank slot 1..10 (1 = ace, 10 = ten/face) */

   var SYSTEMS = {
      hilo: {
         id: 'hilo', name: 'Hi-Lo', level: 1, balanced: true, aceSide: false,
         tags: { 1: -1, 2: 1, 3: 1, 4: 1, 5: 1, 6: 1, 7: 0, 8: 0, 9: 0, 10: -1 },
         indexes: true,
         note: 'Level 1, balanced. The reference system for published index numbers.'
      },
      ko: {
         id: 'ko', name: 'Knock-Out (KO)', level: 1, balanced: false, aceSide: false,
         tags: { 1: -1, 2: 1, 3: 1, 4: 1, 5: 1, 6: 1, 7: 1, 8: 0, 9: 0, 10: -1 },
         indexes: false,
         note: 'Unbalanced: play off the running count, no true-count conversion.'
      },
      hiopt1: {
         id: 'hiopt1', name: 'Hi-Opt I', level: 1, balanced: true, aceSide: true,
         tags: { 1: 0, 2: 0, 3: 1, 4: 1, 5: 1, 6: 1, 7: 0, 8: 0, 9: 0, 10: -1 },
         indexes: false,
         note: 'Ace-neutral, so aces are tracked separately for betting.'
      },
      zen: {
         id: 'zen', name: 'Zen Count', level: 2, balanced: true, aceSide: false,
         tags: { 1: -1, 2: 1, 3: 1, 4: 2, 5: 2, 6: 2, 7: 1, 8: 0, 9: 0, 10: -2 },
         indexes: false,
         note: 'Level 2, higher playing efficiency, harder to keep at speed.'
      },
      omega2: {
         id: 'omega2', name: 'Omega II', level: 2, balanced: true, aceSide: true,
         tags: { 1: 0, 2: 1, 3: 1, 4: 2, 5: 2, 6: 2, 7: 1, 8: 0, 9: -1, 10: -2 },
         indexes: false,
         note: 'Level 2, ace-neutral. Strong playing efficiency.'
      }
   };

   function system(id) { return SYSTEMS[id] || SYSTEMS.hilo; }
   function tagFor(rank, sysId) { return system(sysId).tags[rankSlot(rank)]; }

   /* ---------- shoe ---------- */

   /**
    * Composition-tracked shoe. Cards can be drawn at random or requested by
    * rank (used when the trainer needs a specific situation) — either way the
    * composition and the running count stay honest.
    */
   function Shoe(decks, sysId) {
      this.decks = decks;
      this.sysId = sysId || 'hilo';
      this.reset();
   }

   Shoe.prototype.reset = function () {
      this.shuffles = (this.shuffles || 0) + 1;
      this.counts = {};
      for (var s = 1; s <= 10; s++) {
         this.counts[s] = (s === 10 ? 16 : 4) * this.decks;
      }
      this.total = 52 * this.decks;
      this.seen = 0;
      this.rc = 0;
      this.acesSeen = 0;
   };

   Shoe.prototype.remaining = function () { return this.total; };

   Shoe.prototype.decksRemaining = function () {
      return Math.max(0.25, this.total / 52);
   };

   Shoe.prototype.penetrationUsed = function () {
      return this.seen / (52 * this.decks);
   };

   Shoe.prototype._take = function (slot) {
      if (this.counts[slot] <= 0) return false;
      this.counts[slot]--;
      this.total--;
      this.seen++;
      this.rc += system(this.sysId).tags[slot];
      if (slot === 1) this.acesSeen++;
      return true;
   };

   /** Draw a uniformly random card from what is left. */
   Shoe.prototype.draw = function () {
      if (this.total <= 0) this.reset();
      var pick = Math.floor(Math.random() * this.total) + 1;
      var acc = 0, slot;
      for (slot = 1; slot <= 10; slot++) {
         acc += this.counts[slot];
         if (pick <= acc) break;
      }
      this._take(slot);
      return slotToCard(slot);
   };

   /**
    * Draw a card that nobody has seen — the hole card, or the burn card after a
    * shuffle. It leaves the shoe but must not move the running count until it
    * is turned over, or the count on screen is not the count a player could keep.
    */
   Shoe.prototype.drawHidden = function (slot) {
      var c = slot ? this.drawSlot(slot) : this.draw();
      this.rc -= system(this.sysId).tags[rankSlot(c.rank)];
      this.hidden = (this.hidden || 0) + 1;
      return c;
   };

   /** Turn a hidden card face up: now it counts. */
   Shoe.prototype.reveal = function (card) {
      if (!card) return;
      this.rc += system(this.sysId).tags[rankSlot(card.rank)];
      this.hidden = Math.max(0, (this.hidden || 0) - 1);
   };

   /** Draw a specific rank slot (1..10). Falls back to a random draw. */
   Shoe.prototype.drawSlot = function (slot) {
      if (this.counts[slot] > 0) { this._take(slot); return slotToCard(slot); }
      return this.draw();
   };

   Shoe.prototype.trueCount = function (roundTo) {
      var sys = system(this.sysId);
      if (!sys.balanced) return null;
      var dr = this.decksRemaining();
      var tc = this.rc / dr;
      if (roundTo === 'floor') return Math.floor(tc);
      if (roundTo === 'half') return Math.round(tc * 2) / 2;
      return Math.round(tc * 10) / 10;
   };

   /** Composition as a plain object of slot -> count. */
   Shoe.prototype.composition = function () {
      var c = {};
      for (var s = 1; s <= 10; s++) c[s] = this.counts[s];
      return c;
   };

   Shoe.prototype.needsShuffle = function (pen) {
      return this.penetrationUsed() >= (pen || 0.75);
   };

   var FACE_BY_INDEX = ['10', 'J', 'Q', 'K'];
   function slotToCard(slot) {
      var rank;
      if (slot === 1) rank = 'A';
      else if (slot === 10) rank = FACE_BY_INDEX[Math.floor(Math.random() * 4)];
      else rank = String(slot);
      return card(rank);
   }

   /* ---------- helpers used across the app ---------- */

   function upSlot(dealerCard) { return rankSlot(dealerCard.rank); }
   function upKey(dealerCard) { var s = rankSlot(dealerCard.rank); return s === 1 ? 'A' : String(s); }

   /** Canonical key for a training situation, e.g. hard16v10, soft18v9, pair8vA. */
   function situationKey(playerCards, dealerCard) {
      var hv = handValue(playerCards);
      var up = upKey(dealerCard);
      if (hv.pair) {
         var r = rankSlot(playerCards[0].rank);
         return 'pair' + (r === 1 ? 'A' : r) + 'v' + up;
      }
      if (hv.soft && hv.cards === 2) {
         var other = rankSlot(playerCards[0].rank) === 1 ? rankSlot(playerCards[1].rank) : rankSlot(playerCards[0].rank);
         return 'softA' + other + 'v' + up;
      }
      if (hv.soft) return 'soft' + hv.total + 'v' + up;
      return 'hard' + hv.total + 'v' + up;
   }

   var SPECIAL_KEYS = {
      'bet-ramp': 'Bet sizing',
      'count-running': 'Running count',
      'count-true': 'True-count conversion',
      'count-decks': 'Deck estimation',
      'insurance': 'Insurance'
   };

   function prettyKey(key) {
      if (SPECIAL_KEYS[key]) return SPECIAL_KEYS[key];
      var m = key.match(/^(hard|soft|pair)(A?\d*)v(\d+|A)$/);
      if (!m) return key;
      if (m[1] === 'pair') return m[2] + ',' + m[2] + ' vs ' + m[3];
      if (m[1] === 'soft') {
         if (m[2].charAt(0) === 'A') return 'A' + m[2].slice(1) + ' vs ' + m[3];
         return 'soft ' + m[2] + ' vs ' + m[3];
      }
      return m[2] + ' vs ' + m[3];
   }

   function clamp(v, lo, hi) { return v < lo ? lo : (v > hi ? hi : v); }
   function round(v, dp) { var f = Math.pow(10, dp || 0); return Math.round(v * f) / f; }
   function pct(v, dp) { return (v * 100).toFixed(dp === undefined ? 1 : dp) + '%'; }
   function signed(v, dp) {
      var n = round(v, dp === undefined ? 0 : dp);
      return (n > 0 ? '+' : '') + n.toFixed(dp === undefined ? 0 : dp);
   }
   function uid() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 7); }

   BJ.RANKS = RANKS;
   BJ.SUITS = SUITS;
   BJ.SUIT_GLYPH = SUIT_GLYPH;
   BJ.DEFAULT_RULES = DEFAULT_RULES;
   BJ.RULE_LABELS = RULE_LABELS;
   BJ.SYSTEMS = SYSTEMS;
   BJ.Shoe = Shoe;
   BJ.card = card;
   BJ.cardLabel = cardLabel;
   BJ.handLabel = handLabel;
   BJ.rankValue = rankValue;
   BJ.rankSlot = rankSlot;
   BJ.slotToCard = slotToCard;
   BJ.handValue = handValue;
   BJ.ruleSummary = ruleSummary;
   BJ.payoutLabel = payoutLabel;
   BJ.normaliseRules = normaliseRules;
   BJ.canDoubleTotal = canDoubleTotal;
   BJ.system = system;
   BJ.tagFor = tagFor;
   BJ.upSlot = upSlot;
   BJ.upKey = upKey;
   BJ.situationKey = situationKey;
   BJ.prettyKey = prettyKey;
   BJ.clamp = clamp;
   BJ.round = round;
   BJ.pct = pct;
   BJ.signed = signed;
   BJ.uid = uid;

})(window.BJ = window.BJ || {});
