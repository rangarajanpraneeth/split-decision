/* ==========================================================================
   round.js — a full round of blackjack, played the way a table plays it.

   Deal order, the hole card, the peek, insurance and even money, splitting and
   resplitting, double after split, surrender, the dealer drawing out, and
   settlement including 3:2 or 6:5 naturals.

   The hole card leaves the shoe but does not touch the running count until it
   is turned over — otherwise the count shown could never be kept by a player.
   ========================================================================== */
(function (BJ) {
   'use strict';

   /* ---------- bet sizing ---------- */

   var RAMPS = {
      2: [1, 1, 1, 2, 2],
      4: [1, 1, 2, 3, 4],
      8: [1, 2, 4, 6, 8],
      12: [1, 2, 4, 8, 12],
      20: [1, 2, 6, 12, 20]
   };

   function ramp(spread) { return RAMPS[spread] || RAMPS[8]; }

   /** Units to put out at this true count. */
   function recommendUnits(trueCount, spread) {
      var r = ramp(spread);
      if (trueCount === null || trueCount === undefined) return r[0];
      var i = Math.floor(trueCount);
      if (i <= 1) return r[0];
      return r[Math.min(i - 1, r.length - 1)];
   }

   function betAdvice(trueCount, table, countable) {
      var units = countable ? recommendUnits(trueCount, table.spread) : 1;
      var amount = Math.min(table.max, Math.max(table.min, units * table.unit));
      return {
         units: units,
         amount: amount,
         countable: countable,
         ramp: ramp(table.spread)
      };
   }

   /** A bet is right if it is close enough that the ramp still holds. */
   function gradeBet(amount, advice, table) {
      var tolerance = Math.max(table.unit * 0.5, advice.amount * 0.24);
      return Math.abs(amount - advice.amount) <= tolerance;
   }

   function betReason(amount, advice, trueCount, countable, table) {
      if (!countable) {
         return {
            short: 'With no count to work from, every bet is the same bet. Flat betting is the only honest option.',
            lines: ['Spreading your bets without a count is noise: it changes the size of the swings and nothing else.']
         };
      }
      var lines = [
         'The ramp for a 1 to ' + advice.ramp[advice.ramp.length - 1] + ' spread: true 1 or less pays ' + advice.ramp[0] +
         ' unit, true 2 pays ' + advice.ramp[1] + ', true 3 pays ' + advice.ramp[2] + ', true 4 pays ' + advice.ramp[3] +
         ', true 5 and up pays ' + advice.ramp[4] + '.',
         'Your edge comes almost entirely from having more money out when the shoe is rich. Playing perfectly at a flat bet is close to break-even.'
      ];
      var over = amount > advice.amount;
      var short;
      if (Math.abs(amount - advice.amount) <= table.unit * 0.5) {
         short = 'Right size for a true count of ' + BJ.signed(trueCount, 0) + ': ' + advice.units +
            (advice.units === 1 ? ' unit' : ' units') + '.';
      } else if (over) {
         short = 'Too much at a true count of ' + BJ.signed(trueCount, 0) + '. The ramp calls for ' + advice.units +
            (advice.units === 1 ? ' unit' : ' units') + ' here; overbetting a small edge is how bankrolls die.';
      } else {
         short = 'Too little at a true count of ' + BJ.signed(trueCount, 0) + '. The ramp calls for ' + advice.units +
            (advice.units === 1 ? ' unit' : ' units') + ' — this is the shoe you were waiting for.';
      }
      return { short: short, lines: lines };
   }

   /* ---------- the round ---------- */

   function Round(shoe, rules, table) {
      this.shoe = shoe;
      this.rules = rules;
      this.table = table;
      this.reset();
   }

   Round.prototype.reset = function () {
      this.phase = 'bet';
      this.hands = [];
      this.dealer = { cards: [], hole: null, revealed: false, blackjack: false };
      this.active = 0;
      this.splitCount = 0;
      this.insuranceBet = 0;
      this.insuranceOffered = false;
      this.insuranceResult = null;
      this.bet = 0;
      this.settled = null;
      this.evLost = 0;
   };

   function newHand(bet, fromSplit) {
      return {
         cards: [], bet: bet, done: false, doubled: false, surrendered: false,
         fromSplit: !!fromSplit, splitAces: false, result: null, delta: 0
      };
   }

   /**
    * @param bet    amount wagered
    * @param forced optional { cards:[slot,slot], up:slot } so the trainer can
    *               steer the opening hand while everything after it is natural
    */
   Round.prototype.deal = function (bet, forced) {
      this.reset();
      this.bet = bet;
      var hand = newHand(bet, false);
      this.hands = [hand];

      var pull = function (slot) {
         return slot ? this.shoe.drawSlot(slot) : this.shoe.draw();
      }.bind(this);

      // table deal order: player, dealer up, player, dealer hole
      hand.cards.push(pull(forced && forced.cards ? forced.cards[0] : 0));
      this.dealer.cards.push(pull(forced && forced.up ? forced.up : 0));
      hand.cards.push(pull(forced && forced.cards ? forced.cards[1] : 0));
      this.dealer.hole = this.shoe.drawHidden(forced && forced.hole ? forced.hole : 0);

      var upSlot = BJ.rankSlot(this.dealer.cards[0].rank);
      var holeSlot = BJ.rankSlot(this.dealer.hole.rank);
      this.dealerHasBJ = (upSlot === 1 && holeSlot === 10) || (upSlot === 10 && holeSlot === 1);

      var playerHV = BJ.handValue(hand.cards);

      if (upSlot === 1 && this.rules.peek) {
         this.insuranceOffered = true;
         this.evenMoney = playerHV.blackjack;
         this.phase = 'insurance';
         return this;
      }

      return this.afterInsurance();
   };

   Round.prototype.takeInsurance = function (take) {
      if (this.phase !== 'insurance') return this;
      this.insuranceBet = take ? this.bet / 2 : 0;
      return this.afterInsurance();
   };

   Round.prototype.afterInsurance = function () {
      var upSlot = BJ.rankSlot(this.dealer.cards[0].rank);
      var peeks = this.rules.peek && (upSlot === 1 || upSlot === 10);

      if (peeks && this.dealerHasBJ) {
         this.revealHole();
         this.phase = 'settle';
         return this;
      }
      if (BJ.handValue(this.hands[0].cards).blackjack) {
         this.hands[0].done = true;
         // A natural is already decided. The only reason to play on is a game
         // where the dealer has not looked and could still turn one over.
         var couldStillHaveBJ = (upSlot === 1 || upSlot === 10) && !this.rules.peek;
         this.phase = couldStillHaveBJ ? 'dealer' : 'settle';
         return this;
      }
      this.phase = 'player';
      return this;
   };

   Round.prototype.revealHole = function () {
      if (this.dealer.revealed || !this.dealer.hole) return;
      this.dealer.revealed = true;
      this.dealer.cards.push(this.dealer.hole);
      this.shoe.reveal(this.dealer.hole);
      this.dealer.blackjack = BJ.handValue(this.dealer.cards).blackjack;
   };

   Round.prototype.hand = function () { return this.hands[this.active]; };

   Round.prototype.ctx = function () {
      var h = this.hand();
      return {
         afterSplit: h ? h.fromSplit : false,
         splitCount: this.splitCount,
         splitAces: h ? h.splitAces : false
      };
   };

   Round.prototype.available = function () {
      var h = this.hand();
      if (!h) return {};
      return BJ.strategy.available(h.cards, this.rules, this.ctx());
   };

   Round.prototype.upSlot = function () { return BJ.rankSlot(this.dealer.cards[0].rank); };

   /** Apply a player decision. Returns a short description of what happened. */
   Round.prototype.act = function (action) {
      var h = this.hand();
      if (!h || this.phase !== 'player') return null;
      var drew = null;

      if (action === 'hit') {
         drew = this.shoe.draw();
         h.cards.push(drew);
         var hv = BJ.handValue(h.cards);
         if (hv.total >= 21) h.done = true;
      } else if (action === 'stand') {
         h.done = true;
      } else if (action === 'double') {
         h.bet *= 2;
         h.doubled = true;
         drew = this.shoe.draw();
         h.cards.push(drew);
         h.done = true;
      } else if (action === 'surrender') {
         h.surrendered = true;
         h.done = true;
      } else if (action === 'split') {
         this.splitCount++;
         var moved = h.cards.pop();
         var extra = newHand(this.bet, true);
         extra.cards.push(moved);
         var aces = BJ.rankSlot(moved.rank) === 1;
         h.fromSplit = true;
         h.splitAces = aces;
         extra.splitAces = aces;
         this.hands.splice(this.active + 1, 0, extra);
         drew = this.shoe.draw();
         h.cards.push(drew);
         if (aces && !this.rules.hitSplitAces) h.done = true;
         else if (BJ.handValue(h.cards).total >= 21) h.done = true;
      }

      this.advance();
      return { action: action, card: drew, handDone: h.done };
   };

   /** Move to the next hand that still needs playing, then on to the dealer. */
   Round.prototype.advance = function () {
      while (this.active < this.hands.length && this.hands[this.active].done) {
         this.active++;
         var next = this.hands[this.active];
         if (next && next.cards.length === 1) {
            next.cards.push(this.shoe.draw());
            if (next.splitAces && !this.rules.hitSplitAces) next.done = true;
            else if (BJ.handValue(next.cards).total >= 21) next.done = true;
         }
      }
      if (this.active >= this.hands.length) {
         this.active = this.hands.length - 1;
         this.phase = 'dealer';
      }
   };

   /** Is there a hand the dealer still has to play against? */
   Round.prototype.anyLive = function () {
      for (var i = 0; i < this.hands.length; i++) {
         var h = this.hands[i];
         if (h.surrendered) continue;
         var hv = BJ.handValue(h.cards);
         if (hv.total > 21) continue;
         // a natural is paid regardless of what the dealer would have drawn
         if (hv.blackjack && !h.fromSplit) continue;
         return true;
      }
      return false;
   };

   /** Dealer turns over and draws. Returns the cards drawn, in order. */
   Round.prototype.dealerPlay = function () {
      this.revealHole();
      var drawn = [];
      if (this.anyLive() && !this.dealer.blackjack) {
         var guard = 0;
         while (guard++ < 12) {
            var hv = BJ.handValue(this.dealer.cards);
            var stands = hv.total > 17 || (hv.total === 17 && !(hv.soft && this.rules.hitSoft17));
            if (hv.total >= 21 || stands) break;
            var c = this.shoe.draw();
            this.dealer.cards.push(c);
            drawn.push(c);
         }
      }
      this.phase = 'settle';
      return drawn;
   };

   Round.prototype.settle = function () {
      if (this.settled) return this.settled;
      if (!this.hands.length || !this.dealer.cards.length) return null;
      if (!this.dealer.revealed) this.revealHole();

      var dealerHV = BJ.handValue(this.dealer.cards);
      var dealerBJ = this.dealer.blackjack;
      var rules = this.rules;
      var total = 0;

      for (var i = 0; i < this.hands.length; i++) {
         var h = this.hands[i];
         var hv = BJ.handValue(h.cards);
         var natural = h.cards.length === 2 && hv.total === 21 && !h.fromSplit;

         if (h.surrendered) { h.result = 'surrender'; h.delta = -h.bet / 2; }
         else if (hv.total > 21) { h.result = 'bust'; h.delta = -h.bet; }
         else if (natural && !dealerBJ) { h.result = 'blackjack'; h.delta = h.bet * rules.blackjackPayout; }
         else if (dealerBJ) {
            if (natural) { h.result = 'push'; h.delta = 0; }
            else { h.result = 'lose'; h.delta = -h.bet; }
         }
         else if (dealerHV.total > 21) { h.result = 'win'; h.delta = h.bet; }
         else if (hv.total > dealerHV.total) { h.result = 'win'; h.delta = h.bet; }
         else if (hv.total < dealerHV.total) { h.result = 'lose'; h.delta = -h.bet; }
         else { h.result = 'push'; h.delta = 0; }
         total += h.delta;
      }

      if (this.insuranceBet > 0) {
         this.insuranceResult = dealerBJ ? this.insuranceBet * 2 : -this.insuranceBet;
         total += this.insuranceResult;
      }

      this.phase = 'done';
      this.settled = {
         total: total,
         dealerTotal: dealerHV.total,
         dealerBust: dealerHV.total > 21,
         dealerBlackjack: dealerBJ,
         insurance: this.insuranceResult,
         hands: this.hands.map(function (h) {
            return { result: h.result, delta: h.delta, bet: h.bet, total: BJ.handValue(h.cards).total };
         })
      };
      return this.settled;
   };

   Round.prototype.wagered = function () {
      var w = 0;
      for (var i = 0; i < this.hands.length; i++) w += this.hands[i].bet;
      return w + this.insuranceBet;
   };

   var RESULT_LABEL = {
      blackjack: 'Blackjack', win: 'Won', lose: 'Lost', push: 'Push',
      bust: 'Bust', surrender: 'Surrendered'
   };

   BJ.Round = Round;
   BJ.betting = {
      recommendUnits: recommendUnits,
      betAdvice: betAdvice,
      gradeBet: gradeBet,
      betReason: betReason,
      ramp: ramp,
      RAMPS: RAMPS
   };
   BJ.RESULT_LABEL = RESULT_LABEL;

})(window.BJ = window.BJ || {});
