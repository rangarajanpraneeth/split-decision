/* ==========================================================================
   train.js — the training floor.

   Two flows share one console:
     rounds  a full hand of blackjack, bet to payout, every decision graded
             the moment you make it and the hand played out to the end
     drills  single decisions or counting exercises, for speed work
   ========================================================================== */
(function (BJ) {
   'use strict';

   var d = BJ.dom;
   var el = d.el;

   /* ---------- modes ---------- */

   var MODES = {
      basic: {
         id: 'basic', name: 'Basic strategy',
         blurb: 'Full hands under your rules. Flat bets, no count — the chart, played out to the payout.',
         playOut: true, gradeBets: false, useCount: false, useDeviations: false,
         composition: false, naturalChance: 0.72, rounds: 20
      },
      perfect: {
         id: 'perfect', name: 'Perfect theory',
         blurb: 'The real thing: size the bet, keep the count in your head, play the hand out. Nothing is shown to you.',
         playOut: true, gradeBets: true, useCount: true, useDeviations: true,
         composition: true, naturalChance: 0.78, rounds: 20
      },
      counting: {
         id: 'counting', name: 'Card counting',
         blurb: 'Running count against a shrinking clock, true-count conversion and deck estimation.',
         drill: true, counting: true, questions: 20
      },
      deviations: {
         id: 'deviations', name: 'Deviations',
         blurb: 'Index plays, with the count on screen so you can concentrate on where the line falls.',
         playOut: true, gradeBets: true, useCount: true, useDeviations: true, showCount: true,
         composition: false, naturalChance: 0.4, rounds: 20
      },
      speed: {
         id: 'speed', name: 'Speed drill',
         blurb: 'One decision at a time against a shrinking clock. Wrong answers cost far more than slow ones.',
         drill: true, timed: true, baseMs: 6500, minMs: 2200, questions: 30
      },
      weakness: {
         id: 'weakness', name: 'Weakness training',
         blurb: 'Rapid decisions built from the hands you actually get wrong, weighted by what each error costs.',
         drill: true, useCount: true, useDeviations: true, composition: true, greedy: true, questions: 20
      },
      custom: {
         id: 'custom', name: 'Custom training',
         blurb: 'Choose hand types, up-cards, difficulty, clock, and whether hands are played out for money.',
         rounds: 20, questions: 25
      }
   };

   /* ---------- session state ---------- */

   var DEALER_MS = 100;        // one beat per dealer card, so you can count them

   var S = null;
   var shoe = null;
   var round = null;
   var lastKey = null;
   var lastSummary = null;
   var timers = [];
   var tickTimer = null;

   /**
    * The only thing in the trainer that has any business waiting is the card
    * sequence in the counting drill, where the interval is the exercise. Every
    * other transition runs the moment it is asked for: a hand should answer a
    * keystroke, not a timer.
    */
   function later(fn, ms) {
      var t = setTimeout(fn, ms || 0);
      timers.push(t);
      return t;
   }

   function clearTimers() {
      timers.forEach(clearTimeout);
      timers = [];
      if (tickTimer) { clearInterval(tickTimer); tickTimer = null; }
   }

   function cfgOf(modeId, overrides) {
      var base = MODES[modeId] || MODES.basic;
      var cfg = {};
      for (var k in base) if (base.hasOwnProperty(k)) cfg[k] = base[k];
      if (overrides) for (var j in overrides) if (overrides.hasOwnProperty(j)) cfg[j] = overrides[j];
      return cfg;
   }

   function start(modeId, overrides) {
      clearTimers();
      var rules = BJ.store.rules();
      var settings = BJ.store.settings();
      var cfg = cfgOf(modeId, overrides);
      if (modeId === 'perfect' && settings.showCount) cfg.showCount = true;
      if (cfg.playOut && settings.table.playOut === false) { cfg.playOut = false; cfg.drill = true; }

      shoe = new BJ.Shoe(rules.decks, settings.system);
      shoe.shuffles = 1;
      lastKey = null;

      S = {
         mode: modeId, cfg: cfg, rules: rules, system: settings.system,
         playOut: !!cfg.playOut,
         total: cfg.playOut ? (cfg.rounds || 20) : (cfg.questions || 25),
         index: 0, decisions: 0, correct: 0, times: [],
         streak: 0, bestStreak: 0, score: 0,
         startedAt: Date.now(),
         current: null, answered: false, phase: 'idle',
         log: [], coach: null, waitingFor: null,
         money: { net: 0, wagered: 0, evLost: 0, won: 0, lost: 0, pushed: 0, blackjacks: 0, hands: 0 },
         bet: BJ.clamp(settings.table.unit, settings.table.min, settings.table.max)
      };

      if (S.playOut) round = new BJ.Round(shoe, rules, settings.table);

      renderAll();
      if (S.playOut) beginRound();
      else nextQuestion();
      BJ.bus.emit('session-start', S);
      return S;
   }

   function quit() {
      clearTimers();
      if (S && (S.index > 0 || S.decisions > 0)) finish(true);
      else { S = null; BJ.bus.emit('session-end', null); }
   }

   /* ======================================================================
      Shoe
      ====================================================================== */

   function checkShuffle() {
      var rules = BJ.store.rules();
      if (!shoe || shoe.decks !== rules.decks || shoe.sysId !== BJ.store.settings().system) {
         shoe = new BJ.Shoe(rules.decks, BJ.store.settings().system);
         if (round) round.shoe = shoe;
         return true;
      }
      if (shoe.remaining() < 26 || shoe.needsShuffle(rules.penetration)) {
         shoe.reset();
         shoe.drawHidden(); // burn card
         BJ.store.countShoe();
         if (round) round.shoe = shoe;
         return true;
      }
      return false;
   }

   function lowSlot() { return 2 + Math.floor(Math.random() * 5); }
   function highSlot() { return Math.random() < 0.75 ? 10 : 1; }

   function nudgeCount(target, maxCards) {
      var removed = [], guard = 0;
      var cap = Math.min(maxCards || 70, 70);
      while (guard++ < cap) {
         var tc = shoe.trueCount('exact');
         if (tc === null) return removed;
         if (Math.abs(tc - target) <= 0.4) return removed;
         if (shoe.remaining() < 80) return removed;
         var directed = Math.random() < 0.72;
         var slot = directed ? (tc < target ? lowSlot() : highSlot()) : (1 + Math.floor(Math.random() * 10));
         removed.push(shoe.drawSlot(slot));
      }
      return removed;
   }

   function targetCountFor(key) {
      var rules = BJ.store.rules();
      var dev = BJ.catalog.deviationKeys(rules, S.system)[key];
      if (dev) {
         var idx = BJ.strategy.devIndex(dev, rules);
         var offset = [-1.5, -0.6, -0.2, 0.2, 0.6, 1.5][Math.floor(Math.random() * 6)];
         return idx + offset;
      }
      var r = Math.random();
      if (r < 0.45) return Math.random() * 2 - 1;
      if (r < 0.8) return Math.random() * 4 - 2;
      return Math.random() * 8 - 4;
   }

   function trueCount() { return shoe.trueCount(BJ.store.settings().tcRounding); }
   function countable() { return BJ.system(S.system).balanced; }

   /* ---------- which hand to deal ---------- */

   function allKeys() { return BJ.catalog.all().map(function (s) { return s.key; }); }

   function poolFor(cfg) {
      var rules = BJ.store.rules();
      if (cfg.pool && cfg.pool.length) return cfg.pool;

      if (S.mode === 'deviations') {
         var devKeys = BJ.catalog.deviationKeys(rules, S.system);
         var keys = Object.keys(devKeys).filter(function (k) { return k !== 'insurance'; });
         var extras = ['hard16v7', 'hard13v4', 'hard12v10', 'hard10v9', 'hard9v3', 'hard14v2'];
         return keys.concat(extras).filter(function (k) { return !!BJ.catalog.get(k); });
      }
      if (S.mode === 'weakness') {
         var weak = BJ.store.weaknesses(14, rules).map(function (w) { return w.key; });
         var missed = BJ.store.state.mistakes.slice(0, 40).map(function (m) { return m.key; });
         var merged = weak.concat(missed).filter(function (k, i, arr) {
            return k && BJ.catalog.get(k) && arr.indexOf(k) === i;
         });
         if (merged.length >= 5) return merged;
         return allKeys();
      }
      if (cfg.filter) {
         var f = cfg.filter;
         var list = BJ.catalog.all().filter(function (s) {
            if (f.kinds && f.kinds.length && f.kinds.indexOf(s.kind) === -1) return false;
            if (f.ups && f.ups.length && f.ups.indexOf(s.up) === -1) return false;
            if (f.difficulty && f.difficulty !== 'any') {
               if (String(BJ.catalog.difficulty(s.key, rules)) !== String(f.difficulty)) return false;
            }
            return true;
         }).map(function (s) { return s.key; });
         return list.length ? list : allKeys();
      }
      return allKeys();
   }

   function pickCombo(sit) {
      var total = 0, i;
      for (i = 0; i < sit.combos.length; i++) total += sit.combos[i].w;
      var pick = Math.random() * total, acc = 0;
      for (i = 0; i < sit.combos.length; i++) {
         acc += sit.combos[i].w;
         if (pick <= acc) return sit.combos[i];
      }
      return sit.combos[0];
   }

   function chooseKey(cfg) {
      var pool = poolFor(cfg).filter(function (k) { return !!BJ.catalog.get(k); });
      if (!pool.length) pool = allKeys();
      var key = BJ.store.selectKey({
         pool: pool, rules: BJ.store.rules(), exclude: lastKey, greedy: !!cfg.greedy
      });
      return BJ.catalog.get(key) ? key : pool[0];
   }

   /** Draw an up-card slot from what is actually left in the shoe. */
   function sampleUpSlot() {
      var probs = BJ.ev.probs(shoe.composition());
      var pick = Math.random(), acc = 0;
      for (var slot = 1; slot <= 10; slot++) {
         acc += probs[slot];
         if (pick <= acc) return slot;
      }
      return 10;
   }

   /**
    * The opening hand the trainer wants to see, or null to let the shoe decide.
    *
    * The dealer's up-card is always sampled from the real shoe — a ten shows a
    * third of the time and nothing changes that. Only the player's own two cards
    * are steered, and only towards situations that share that up-card, so the
    * bankroll stays honest while the practice stays targeted.
    */
   function forcedHand() {
      if (Math.random() < (S.cfg.naturalChance || 0)) return null;
      // Naturals are not decisions, so they are not in the catalogue. Deal them
      // at their true rate anyway, or the bankroll quietly loses its best hand.
      if (Math.random() < 0.0475) return { cards: [1, 10], up: 0, key: null };

      var upSlot = sampleUpSlot();
      var pool = poolFor(S.cfg).filter(function (k) {
         var sit = BJ.catalog.get(k);
         return sit && sit.up === upSlot;
      });
      if (!pool.length) return null;

      var key = BJ.store.selectKey({
         pool: pool, rules: BJ.store.rules(), exclude: lastKey, greedy: !!S.cfg.greedy
      });
      var sit = BJ.catalog.get(key);
      if (!sit) return null;
      lastKey = key;
      var combo = pickCombo(sit);
      return { cards: [combo.a, combo.b], up: sit.up, key: key };
   }

   /* ======================================================================
      Round flow
      ====================================================================== */

   function beginRound() {
      if (!S) return;
      clearTimers();               // nothing from the previous hand may still fire
      if (S.index >= S.total) return finish(false);

      var shuffled = checkShuffle();
      if (shuffled) d.toast('Shuffle \u00b7 the count starts again at zero');
      if (S.cfg.showCount && countable()) nudgeCount(targetCountFor(lastKey || ''), 70);

      round.reset();
      S.phase = 'bet';
      S.current = null;
      S.waitingFor = null;
      S.betAskedAt = performance.now();
      S.roundForced = forcedHand();

      var t = BJ.store.tableConfig();
      var bankroll = BJ.store.table().bankroll;
      if (bankroll < t.min) { S.phase = 'broke'; renderAll(); return; }

      S.bet = BJ.clamp(S.bet, t.min, Math.min(t.max, bankroll));
      renderAll();
      focusPrimary();
   }

   function placeBet(amount) {
      if (!S || S.phase !== 'bet') return;
      var t = BJ.store.tableConfig();
      var bankroll = BJ.store.table().bankroll;
      S.bet = BJ.clamp(Math.round(amount), t.min, Math.min(t.max, bankroll));

      if (S.cfg.gradeBets && countable()) {
         var tc = trueCount();
         var advice = BJ.betting.betAdvice(tc, t, true);
         var ok = BJ.betting.gradeBet(S.bet, advice, t);
         var timeMs = Math.round(performance.now() - S.betAskedAt);
         var why = BJ.betting.betReason(S.bet, advice, tc, true, t);

         grade({
            key: 'bet-ramp', label: 'Bet sizing', kind: 'bet',
            correct: ok, timeMs: timeMs,
            action: money$(S.bet), correctAction: money$(advice.amount),
            rc: shoe.rc, tc: tc, difficulty: 3, why: why,
            answerText: money$(advice.amount) + '  \u00b7  ' + advice.units + (advice.units === 1 ? ' unit' : ' units'),
            title: ok ? 'Bet sized correctly' : 'Bet off the ramp',
            logText: 'Bet ' + money$(S.bet)
         });
      }
      dealRound();
   }

   function dealRound() {
      S.phase = 'deal';
      round.deal(S.bet, S.roundForced);
      S.index++;

      if (round.phase === 'insurance') {
         S.phase = 'insurance';
         S.askedAt = performance.now();
         renderAll();
         return focusPrimary();
      }
      if (round.phase === 'player') {
         askDecision();
         renderAll();
         return focusPrimary();
      }
      S.phase = 'dealer';
      renderAll();
      if (round.phase === 'dealer') return dealerTurn();
      if (round.phase === 'settle') return finishRound();
   }

   function answerInsurance(take) {
      if (!S || S.phase !== 'insurance') return;
      var tc = trueCount();
      var shouldTake = countable() && tc !== null && tc >= 3;
      var chosen = take ? 'insurance' : 'noinsurance';
      var correctAction = shouldTake ? 'insurance' : 'noinsurance';
      var ok = chosen === correctAction;

      grade({
         key: 'insurance', label: round.evenMoney ? 'Even money' : 'Insurance', kind: 'insurance',
         correct: ok, timeMs: Math.round(performance.now() - S.askedAt),
         action: chosen, correctAction: correctAction, rc: shoe.rc, tc: tc, difficulty: 3,
         why: insuranceReason(tc, shouldTake),
         answerText: BJ.strategy.ACTION_LABEL[correctAction],
         logText: (round.evenMoney ? 'Even money' : 'Insurance') + ' \u00b7 ' + (take ? 'taken' : 'declined')
      });

      round.takeInsurance(take);
      if (round.phase === 'settle' || round.phase === 'dealer') {
         S.phase = 'dealer';
         renderAll();
         return round.phase === 'settle' ? finishRound() : dealerTurn();
      }
      S.phase = 'player';
      renderAll();
      askDecision();
      renderAll();
      focusPrimary();
   }

   function askDecision() {
      S.phase = 'player';
      var h = round.hand();
      var rules = BJ.store.rules();
      var cfg = S.cfg;
      var tc = cfg.useCount ? trueCount() : null;

      var rec = BJ.strategy.recommend({
         cards: h.cards, up: round.upSlot(), rules: rules, ctx: round.ctx(),
         trueCount: tc, system: S.system,
         useDeviations: !!cfg.useDeviations, composition: cfg.composition !== false
      });

      var key = BJ.situationKey(h.cards, round.dealer.cards[0]);
      S.current = {
         type: 'play',
         cards: h.cards, up: round.dealer.cards[0], upSlot: round.upSlot(),
         rules: rules, key: key, label: BJ.prettyKey(key),
         rc: shoe.rc, tc: tc, tcExact: shoe.trueCount('exact'),
         decksRemaining: shoe.decksRemaining(),
         rec: rec, available: rec.available,
         difficulty: BJ.catalog.difficulty(key, rules, {
            multiCard: h.cards.length > 2, deviation: rec.deviationActive,
            counting: cfg.useCount, timed: cfg.timed
         }),
         askedAt: performance.now()
      };
   }

   function onAction(action) {
      if (!S || S.phase !== 'player' || !S.current) return;
      var q = S.current;
      if (!q.available[action]) return;

      var h = round.hand();
      var ok = action === q.rec.action;
      var evaluation = evaluateHand(q, round.ctx());
      var cost = 0;
      if (!ok && evaluation && evaluation.values[action] !== undefined && evaluation.values[q.rec.action] !== undefined) {
         cost = Math.max(0, (evaluation.values[q.rec.action] - evaluation.values[action]) * h.bet);
      }

      grade({
         key: q.key, label: q.label, kind: q.rec.deviationActive ? 'deviation' : q.rec.kind,
         correct: ok, timeMs: Math.round(performance.now() - q.askedAt),
         action: action, correctAction: q.rec.action, basicAction: q.rec.basic,
         cards: q.cards.map(function (c) { return c.rank; }), up: q.upSlot,
         rc: q.rc, tc: q.tc, difficulty: q.difficulty,
         deviation: q.rec.deviation ? q.rec.deviation.id : null,
         why: reason(q, evaluation), evaluation: evaluation, costMoney: cost,
         answerText: BJ.strategy.ACTION_LABEL[q.rec.action],
         deviationActive: q.rec.deviationActive,
         question: q,
         basicNote: q.rec.basic !== q.rec.action
            ? 'Basic strategy on its own would ' + BJ.strategy.ACTION_LABEL[q.rec.basic].toLowerCase() + '.' : null,
         logText: q.label + ' \u00b7 ' + BJ.strategy.ACTION_LABEL[action].toLowerCase()
      });

      round.act(action);
      S.current = null;

      // Right or wrong, carry on immediately. The verdict stays in the coach
      // column until the next decision replaces it, so nothing is lost by not
      // pausing, and a wrong answer should not cost you a click. Each branch
      // ends in exactly one render.
      if (round.phase === 'dealer') dealerTurn();
      else if (round.phase === 'player') continuePlay();
      else renderAll();
   }

   function continuePlay() {
      if (!S || !round || round.phase !== 'player') return;
      S.waitingFor = null;
      askDecision();
      renderAll();
      focusPrimary();
   }

   function dealerTurn() {
      if (!S) return;
      S.waitingFor = null;
      S.phase = 'dealer';
      round.revealHole();
      renderAll();                       // the hole card turns over at once

      if (!round.anyLive() || round.dealer.blackjack) {
         round.phase = 'settle';
         return finishRound();
      }

      // One card per beat. This is the only pacing in the round: the dealer's
      // draw is information you have to see to keep the count.
      var step = function () {
         if (!S || S.phase !== 'dealer' || round.phase === 'done') return;
         var hv = BJ.handValue(round.dealer.cards);
         var stands = hv.total > 17 || (hv.total === 17 && !(hv.soft && round.rules.hitSoft17));
         if (hv.total >= 21 || stands) {
            round.phase = 'settle';
            return finishRound();
         }
         round.dealer.cards.push(shoe.draw());
         renderAll();
         later(step, DEALER_MS);
      };
      later(step, DEALER_MS);
   }

   function finishRound() {
      if (!S || !round || !round.hands.length || round.phase === 'done') return;
      var res = round.settle();
      var summary = { hands: round.hands.length, won: 0, lost: 0, pushed: 0, blackjacks: 0, busts: 0, wagered: round.wagered(), delta: res.total };
      round.hands.forEach(function (h) {
         if (h.result === 'blackjack') { summary.won++; summary.blackjacks++; }
         else if (h.result === 'win') summary.won++;
         else if (h.result === 'push') summary.pushed++;
         else { summary.lost++; if (h.result === 'bust') summary.busts++; }
      });

      BJ.store.applyRound(summary);
      S.money.net += res.total;
      S.money.wagered += summary.wagered;
      S.money.won += summary.won;
      S.money.lost += summary.lost;
      S.money.pushed += summary.pushed;
      S.money.blackjacks += summary.blackjacks;
      S.money.hands += summary.hands;

      S.phase = 'settled';
      if (res.total > 0) d.beep('ok');
      else if (res.total < 0) d.beep('bad');
      renderAll();
      BJ.bus.emit('round-end', res);

      // The round stops here on purpose. The cards, the totals and the payout
      // stay on the table until you press Next hand — clearing them for you
      // means never seeing what you were paid for.
   }

   function evaluateHand(q, ctx) {
      try {
         return BJ.ev.evaluate({
            cards: q.cards, up: q.upSlot, rules: q.rules,
            comp: shoe.composition(), available: q.available, ctx: ctx || {}
         });
      } catch (e) { return null; }
   }

   /* ======================================================================
      Drill flow
      ====================================================================== */

   function nextQuestion() {
      clearTimers();
      if (!S) return;
      if (S.index >= S.total) return finish(false);
      var q = generate();
      q.askedAt = performance.now();
      S.current = q;
      S.answered = false;
      S.phase = 'drill';
      renderAll();
      if (q.type === 'count-rc') runSequence(q);
      else if (S.cfg.timed) startClock(q);
      focusPrimary();
   }

   function generate() {
      var cfg = S.cfg;
      if (cfg.counting) return generateCountDrill();

      var rules = BJ.store.rules();
      var shuffled = checkShuffle();
      var key = chooseKey(cfg);
      var sit = BJ.catalog.get(key);
      lastKey = key;

      var burn = cfg.useCount ? nudgeCount(targetCountFor(key), cfg.showCount ? 70 : 12) : [];
      var combo = pickCombo(sit);
      var cards = [shoe.drawSlot(combo.a), shoe.drawSlot(combo.b)];
      var up = shoe.drawSlot(sit.up);
      var tc = cfg.useCount ? trueCount() : null;

      var rec = BJ.strategy.recommend({
         cards: cards, up: BJ.rankSlot(up.rank), rules: rules, ctx: {},
         trueCount: tc, system: S.system,
         useDeviations: !!cfg.useDeviations, composition: cfg.composition !== false
      });

      var qkey = BJ.situationKey(cards, up);
      return {
         type: 'play', drill: true,
         cards: cards, up: up, upSlot: BJ.rankSlot(up.rank),
         rules: rules, key: qkey, label: BJ.prettyKey(qkey),
         rc: shoe.rc, tc: tc, tcExact: shoe.trueCount('exact'),
         decksRemaining: shoe.decksRemaining(),
         rec: rec, available: rec.available, burn: burn, shuffled: shuffled,
         difficulty: BJ.catalog.difficulty(qkey, rules, {
            deviation: rec.deviationActive, counting: cfg.useCount, timed: cfg.timed
         })
      };
   }

   function generateCountDrill() {
      if (!BJ.system(BJ.store.settings().system).balanced) return runningCountDrill();
      var r = Math.random();
      if (r < 0.5) return runningCountDrill();
      if (r < 0.8) return trueCountDrill();
      return deckEstimateDrill();
   }

   function runningCountDrill() {
      checkShuffle();
      var sys = BJ.system(BJ.store.settings().system);
      var boost = Math.min(6, Math.floor(S.streak / 3));
      var count = Math.min(26, 6 + Math.floor(S.index / 4) + boost);
      var interval = Math.max(260, 900 - S.index * 22 - boost * 40);
      var cards = [], delta = 0;
      for (var i = 0; i < count; i++) {
         var c = shoe.draw();
         cards.push(c);
         delta += sys.tags[BJ.rankSlot(c.rank)];
      }
      return {
         type: 'count-rc', sequence: cards, interval: interval, answer: delta,
         key: 'count-running', label: 'Running count',
         difficulty: BJ.clamp(2 + Math.floor(count / 8) + (interval < 400 ? 1 : 0), 1, 5)
      };
   }

   function trueCountDrill() {
      var rc = Math.round(Math.random() * 24 - 12) || 3;
      var decks = [0.5, 1, 1.5, 2, 2.5, 3, 4, 5, 6][Math.floor(Math.random() * 9)];
      var exact = rc / decks;
      return {
         type: 'count-tc', rcGiven: rc, decksGiven: decks, exact: exact,
         answer: Math.floor(exact + 1e-9), key: 'count-true',
         label: 'True-count conversion', difficulty: decks % 1 === 0 ? 3 : 4
      };
   }

   function deckEstimateDrill() {
      var decks = BJ.store.rules().decks;
      var dealt = Math.floor(Math.random() * (decks * 52 * 0.8));
      var remaining = (decks * 52 - dealt) / 52;
      return {
         type: 'count-decks', dealt: dealt, decks: decks, remaining: remaining,
         answer: Math.round(remaining * 2) / 2, key: 'count-decks',
         label: 'Deck estimation', difficulty: 3
      };
   }

   function answerDrill(value, timedOut) {
      if (!S || !S.current || S.answered) return;
      var q = S.current;
      if (q.type === 'count-rc' && !q.ready) return;
      S.answered = true;
      if (tickTimer) { clearInterval(tickTimer); tickTimer = null; }

      var timeMs = Math.round(performance.now() - q.askedAt);
      var correctAction, ok, why, evaluation = null, cost = 0;

      if (q.type === 'play') {
         correctAction = q.rec.action;
         ok = !timedOut && value === correctAction;
         evaluation = evaluateHand(q, {});
         if (!ok && !timedOut && evaluation && evaluation.values[value] !== undefined) {
            cost = Math.max(0, (evaluation.values[correctAction] - evaluation.values[value]) * BJ.store.tableConfig().unit);
         }
         why = reason(q, evaluation);
      } else {
         correctAction = q.answer;
         ok = !timedOut && Number(value) === Number(q.answer);
         why = drillReason(q);
      }

      S.index++;
      grade({
         key: q.key, label: q.label,
         kind: q.type === 'play' ? (q.rec.deviationActive ? 'deviation' : q.rec.kind) : 'counting',
         correct: ok, timeMs: timeMs,
         action: timedOut ? 'timeout' : value, correctAction: correctAction,
         basicAction: q.type === 'play' ? q.rec.basic : null,
         cards: q.cards ? q.cards.map(function (c) { return c.rank; }) : null,
         up: q.upSlot || null, rc: q.rc, tc: q.tc, difficulty: q.difficulty,
         deviation: q.rec && q.rec.deviation ? q.rec.deviation.id : null,
         why: why, evaluation: evaluation, costMoney: cost, question: q,
         answerText: q.type === 'play' ? BJ.strategy.ACTION_LABEL[correctAction]
            : (q.type === 'count-decks' ? q.answer.toFixed(1) + ' decks' : BJ.signed(q.answer, 0)),
         deviationActive: q.rec && q.rec.deviationActive,
         basicNote: q.type === 'play' && q.rec.basic !== q.rec.action
            ? 'Basic strategy on its own would ' + BJ.strategy.ACTION_LABEL[q.rec.basic].toLowerCase() + '.' : null,
         logText: q.label + ' \u00b7 ' + (timedOut ? 'out of time' : String(BJ.strategy.ACTION_LABEL[value] || value).toLowerCase()),
         title: ok ? 'Correct' : timedOut ? 'Out of time' : 'Not this one'
      });

      renderAll();
      if (ok && BJ.store.settings().autoAdvance) later(nextQuestion, 0);
   }

   function startClock(q) {
      var cfg = S.cfg;
      var limit = cfg.timePerQuestion || Math.max(cfg.minMs || 2200,
         (cfg.baseMs || 6500) - S.streak * 160 - S.index * 40);
      q.limit = limit;
      tickTimer = setInterval(function () {
         if (!S || S.answered) { clearInterval(tickTimer); tickTimer = null; return; }
         var left = Math.max(0, 1 - (performance.now() - q.askedAt) / limit);
         var bar = d.qs('#clock-bar');
         if (bar) {
            bar.style.transform = 'scaleX(' + left.toFixed(3) + ')';
            bar.dataset.state = left < 0.25 ? 'urgent' : left < 0.55 ? 'warn' : 'ok';
         }
         if (left <= 0) { clearInterval(tickTimer); tickTimer = null; answerDrill(null, true); }
      }, 60);
   }

   function runSequence(q) {
      var i = 0;
      var step = function () {
         var host = d.qs('#seq-card');
         var counter = d.qs('#seq-progress');
         if (!S || S.current !== q || !host) return;
         if (i >= q.sequence.length) {
            d.clear(host).appendChild(el('div', { class: 'seq__done', text: 'Count?' }));
            if (counter) counter.textContent = q.sequence.length + ' cards shown';
            q.ready = true;
            q.askedAt = performance.now();
            renderActionsArea();
            focusPrimary();
            return;
         }
         d.clear(host).appendChild(d.cardTile(q.sequence[i], {}));
         if (counter) counter.textContent = (i + 1) + ' / ' + q.sequence.length;
         i++;
         later(step, q.interval);
      };
      step();
   }

   /* ======================================================================
      Grading and coaching
      ====================================================================== */

   function grade(a) {
      S.decisions++;
      S.times.push(a.timeMs);
      if (a.correct) {
         S.correct++;
         S.streak++;
         if (S.streak > S.bestStreak) S.bestStreak = S.streak;
         S.score += scoreFor(a);
      } else {
         S.streak = 0;
         S.score = Math.max(0, S.score - 40);
      }
      if (a.costMoney) S.money.evLost += a.costMoney;

      BJ.store.record({
         key: a.key, label: a.label, mode: S.mode, kind: a.kind,
         correct: a.correct, timeMs: a.timeMs,
         action: a.action, correctAction: a.correctAction, basicAction: a.basicAction,
         cards: a.cards || null, up: a.up || null, rc: a.rc, tc: a.tc,
         difficulty: a.difficulty, deviation: a.deviation, costMoney: a.costMoney || 0,
         why: (a.why && a.why.short) || '',
         rulesSummary: BJ.ruleSummary(BJ.store.rules())
      });

      S.log.unshift({ text: a.logText || a.label, ok: a.correct });
      if (S.log.length > 12) S.log.length = 12;

      S.coach = {
         ok: a.correct,
         title: a.title || (a.correct ? 'Correct' : 'Not this one'),
         answer: a.answerText, why: a.why, timeMs: a.timeMs,
         evaluation: a.evaluation, chosen: a.action, correctAction: a.correctAction,
         basicNote: a.basicNote, deviationActive: a.deviationActive,
         question: a.question, costMoney: a.costMoney
      };
      d.beep(a.correct ? 'ok' : 'bad');
   }

   function scoreFor(a) {
      var target = BJ.store.settings().decisionTarget;
      var speed = BJ.clamp(2 - a.timeMs / target, 0.4, 2);
      return Math.round(60 * speed * (0.7 + (a.difficulty || 3) * 0.12));
   }

   /* ======================================================================
      Explanations
      ====================================================================== */

   function upName(slot) { return slot === 1 ? 'an ace' : 'a ' + slot; }

   function playerBustChance(q) {
      var hv = BJ.handValue(q.cards);
      if (hv.soft) return 0;
      var probs = BJ.ev.probs(shoe.composition());
      var bust = 0;
      for (var s = 1; s <= 10; s++) {
         if (hv.total + (s === 1 ? 1 : s) > 21) bust += probs[s];
      }
      return bust;
   }

   function reason(q, evaluation) {
      var rec = q.rec;
      var hv = BJ.handValue(q.cards);
      var a = rec.action;
      var up = q.upSlot;
      var bust = evaluation ? evaluation.dealer.bust : null;
      var pb = playerBustChance(q);
      var lines = [];
      var short;
      var bustWord = bust === null ? '' : (bust >= 0.28 ? 'busts about ' : 'only busts about ');

      if (rec.deviationActive && rec.deviation) {
         var reached = q.tc === rec.index ? 'has reached the index of ' : 'is past the index of ';
         short = 'True count ' + BJ.signed(q.tc, 0) + ' ' + reached + BJ.signed(rec.index, 0) + ', so ' +
            BJ.strategy.ACTION_LABEL[a].toLowerCase() + ' overtakes the book play of ' +
            BJ.strategy.ACTION_LABEL[rec.basic].toLowerCase() + '.';
         lines.push(rec.deviation.note);
      } else if (a === 'surrender') {
         short = 'Every way of playing this loses more than half a bet, so giving up half is the cheapest exit.';
      } else if (a === 'split') {
         var r = BJ.rankSlot(q.cards[0].rank);
         if (r === 1) short = 'Split aces. Two hands starting on 11 are worth far more than one soft 12.';
         else if (r === 8) short = '16 is the worst total in the game. Two hands starting on 8 beat one hand of 16 against ' + upName(up) + '.';
         else short = 'Splitting turns one poor total into two hands against ' + upName(up) + ', which is weak enough to attack.';
      } else if (a === 'double') {
         short = hv.soft
            ? 'A soft ' + hv.total + ' cannot bust on the next card, and ' + upName(up) + ' is weak enough to pay for the extra bet.'
            : hv.total + ' takes a ten more often than anything else, and ' + upName(up) + ' is not strong enough to punish the one-card limit.';
      } else if (a === 'stand') {
         if (hv.total >= 17) short = hv.total + ' is a made hand. Drawing throws it away.';
         else if (bust !== null) short = 'Dealer shows ' + upName(up) + ' and ' + bustWord + d.pctOrDash(bust) +
            ' of the time' + (pb ? ', while your draw breaks ' + d.pctOrDash(pb) + ' of the time' : '') + '. Let them go first.';
         else short = 'Standing loses less than drawing here, even though the dealer is strong.';
      } else {
         if (hv.total <= 11 && !hv.soft) short = 'You cannot break with one card, so there is nothing to weigh \u2014 take it.';
         else if (hv.soft) short = 'Soft ' + hv.total + ' is not a made hand against ' + upName(up) + ' \u2014 the free card is worth more than the total.';
         else if (bust !== null) short = 'Dealer shows ' + upName(up) + ' and ' + bustWord + d.pctOrDash(bust) +
            ', so standing on ' + hv.total + ' mostly waits to lose. Take the card.';
         else short = 'Take the card: the dealer is too strong to stand on ' + hv.total + '.';
      }

      if (rec.notes && rec.notes.length) lines = lines.concat(rec.notes);

      var rules = q.rules;
      if (hv.total === 11 && up === 1) lines.push(rules.hitSoft17
         ? 'Because the dealer hits soft 17, 11 doubles against an ace.'
         : 'Because the dealer stands on soft 17, 11 only hits against an ace.');
      if (hv.pair && BJ.rankSlot(q.cards[0].rank) === 4 && !rules.das) lines.push('Without double after split, 4,4 is played as a hard 8.');
      if (rec.deviation && !rec.deviationActive) lines.push('This hand carries an index of ' + BJ.signed(rec.index, 0) + '. The count has not reached it, so basic strategy still applies.');
      if (q.cards.length > 2) lines.push('Three-card totals are worth a second look: the cards already out change what is left to draw.');

      return { short: short, lines: lines };
   }

   function insuranceReason(tc, shouldTake) {
      var probs = BJ.ev.probs(shoe.composition());
      var pTen = probs[10];
      var edge = pTen * 2 - (1 - pTen);
      return {
         short: shouldTake
            ? 'True count ' + BJ.signed(tc, 0) + ' is at or past +3, so tens are dense enough for the side bet to pay.'
            : (countable() ? 'True count ' + BJ.signed(tc, 0) + ' is short of +3, so insurance is the losing bet it usually is.'
               : 'With no count there is no way to know the shoe is ten-rich, so insurance is simply the losing bet.'),
         lines: [
            'Insurance pays 2 to 1 and wins only when the hole card is a ten, so it breaks even at exactly one third tens. This shoe is holding ' +
            d.pctOrDash(pTen) + ' tens, an expectation of ' + BJ.ev.fmt(edge) + ' per unit of insurance.',
            'It has nothing to do with your own hand. Even money on a blackjack is the same bet with better marketing.'
         ]
      };
   }

   function drillReason(q) {
      if (q.type === 'count-rc') {
         return {
            short: 'The sequence carried ' + BJ.signed(q.answer, 0) + ' under ' + BJ.system(BJ.store.settings().system).name + '.',
            lines: ['Cancel high and low cards in pairs as they appear rather than adding one at a time \u2014 it is faster and far less error-prone.']
         };
      }
      if (q.type === 'count-tc') {
         return {
            short: BJ.signed(q.rcGiven, 0) + ' \u00f7 ' + q.decksGiven + ' decks = ' + q.exact.toFixed(2) + ', which floors to ' + BJ.signed(q.answer, 0) + '.',
            lines: ['Rounding down keeps you from overbetting and overplaying marginal indexes.']
         };
      }
      return {
         short: q.dealt + ' cards dealt from ' + q.decks + ' decks leaves about ' + q.remaining.toFixed(2) + ' decks.',
         lines: ['At the table you read this off the discard tray. Half-deck accuracy is enough for true-count work.']
      };
   }

   /* ======================================================================
      Rendering
      ====================================================================== */

   function money$(v, signed) {
      var n = Math.round(v);
      var s = '$' + Math.abs(n).toLocaleString();
      return signed ? (n > 0 ? '+' : n < 0 ? '\u2212' : '') + s : s;
   }

   var GAME = '#col-game';
   var RAIL = '#train-rail';

   function renderAll() {
      renderRail();
      renderGame();
      if (BJ.app && BJ.app.refreshStatus) BJ.app.refreshStatus();
   }

   /* ---------- right column: shoe, money, coach, or the drill list ---------- */

   function renderRail() {
      var host = d.qs(RAIL);
      if (!host) return;
      d.clear(host);
      if (!S) return renderPicker(host);
      var t = BJ.store.tableConfig();
      var money = BJ.store.table();
      var rules = BJ.store.rules();
      var pen = shoe.penetrationUsed();
      var showCount = S.cfg.showCount && countable();

      host.appendChild(panel('Shoe', [
         el('div', { class: 'kv' }, [
            kvItem('Shoe', String(shoe.shuffles || 1)),
            kvItem('Decks left', shoe.decksRemaining().toFixed(2)),
            kvItem('Cards seen', String(shoe.seen)),
            kvItem('Cut card', Math.round(rules.penetration * 100) + '%')
         ]),
         el('div', { class: 'penbar' }, [
            el('div', { class: 'penbar__fill', style: 'width:' + Math.min(100, pen * 100).toFixed(1) + '%' }),
            el('div', { class: 'penbar__cut', style: 'left:' + (rules.penetration * 100).toFixed(1) + '%' })
         ]),
         el('p', { class: 'note', text: Math.round(pen * 100) + '% dealt' })
      ]));

      if (showCount) {
         host.appendChild(panel('Count', [
            el('div', { class: 'countpair' }, [
               bigNum(BJ.signed(shoe.rc, 0), 'Running'),
               bigNum(BJ.signed(trueCount(), 0), 'True')
            ]),
            el('p', { class: 'note', text: 'Exact ' + (shoe.trueCount('exact') || 0).toFixed(2) + ' \u00b7 ' + BJ.system(S.system).name })
         ]));
      } else if (S.cfg.useCount) {
         host.appendChild(panel('Count', [
            el('p', { class: 'muted', text: 'Hidden on purpose. Every card except the hole card is dealt face up, so the count is yours to keep.' })
         ]));
      }

      if (S.playOut) {
         host.appendChild(panel('Money', [
            el('div', { class: 'kv' }, [
               kvItem('Bankroll', money$(money.bankroll)),
               kvItem('This session', money$(S.money.net, true)),
               kvItem('Lifetime', money$(money.net, true)),
               kvItem('Errors cost', money$(-S.money.evLost, true))
            ]),
            el('p', { class: 'note', text: 'Table ' + money$(t.min) + ' to ' + money$(t.max) + ' \u00b7 unit ' + money$(t.unit) })
         ]));

         if (S.cfg.gradeBets && countable()) {
            var r = BJ.betting.ramp(t.spread);
            host.appendChild(panel('Bet ramp', [
               el('table', { class: 'ramp' }, [
                  el('tbody', {}, [
                     el('tr', {}, [el('th', { scope: 'row', text: 'True' })].concat(
                        ['\u22641', '2', '3', '4', '5+'].map(function (x) { return el('td', { text: x }); }))),
                     el('tr', {}, [el('th', { scope: 'row', text: 'Units' })].concat(
                        r.map(function (u) { return el('td', { text: String(u) }); })))
                  ])
               ]),
               el('p', { class: 'note', text: '1 to ' + r[r.length - 1] + ' spread at ' + money$(t.unit) + ' a unit.' })
            ]));
         }
      }

      host.appendChild(panel('Session', [
         el('div', { class: 'kv' }, [
            kvItem(S.playOut ? 'Hand' : 'Question', S.index + ' / ' + S.total),
            kvItem('Decisions', String(S.decisions)),
            kvItem('Accuracy', d.pctOrDash(S.decisions ? S.correct / S.decisions : null)),
            kvItem('Avg time', d.ms(avgTime()))
         ]),
         el('button', { class: 'btn btn--quiet btn--full', type: 'button', text: 'END SESSION', onclick: quit })
      ]));

      renderCoach(host);
   }

   function panel(title, children) {
      return el('section', { class: 'sidepanel' }, [el('h3', { text: title })].concat(children));
   }

   function kvItem(k, v) {
      return el('div', { class: 'kv__item' }, [
         el('span', { class: 'kv__k', text: k }),
         el('span', { class: 'kv__v', text: v })
      ]);
   }

   function bigNum(value, label) {
      return el('div', { class: 'bignum' }, [
         el('span', { class: 'bignum__v', text: value }),
         el('span', { class: 'bignum__l', text: label })
      ]);
   }

   function avgTime() {
      if (!S.times.length) return null;
      return S.times.reduce(function (a, b) { return a + b; }, 0) / S.times.length;
   }

   /* ---------- middle column ---------- */

   function renderGame() {
      var host = d.qs(GAME);
      if (!host) return;
      d.clear(host);
      if (!S) return renderIdleGame(host);
      var money = BJ.store.table();

      var items = S.playOut ? [
         stripItem('Bankroll', money$(money.bankroll)),
         stripItem('Bet', money$(S.bet)),
         stripItem('Session', money$(S.money.net, true), S.money.net > 0 ? 'up' : S.money.net < 0 ? 'down' : ''),
         stripItem('Accuracy', d.pctOrDash(S.decisions ? S.correct / S.decisions : null))
      ] : [
         stripItem(S.cfg.counting ? 'Drill' : 'Hand', S.index + ' / ' + S.total),
         stripItem('Accuracy', d.pctOrDash(S.decisions ? S.correct / S.decisions : null)),
         stripItem('Streak', String(S.streak)),
         stripItem('Avg time', d.ms(avgTime()))
      ];
      host.appendChild(el('div', { class: 'tablestrip' }, items));

      host.appendChild(el('div', {
         class: 'progress', role: 'progressbar', 'aria-label': 'Session progress',
         'aria-valuemin': '0', 'aria-valuemax': String(S.total), 'aria-valuenow': String(S.index)
      }, [el('div', { class: 'progress__bar', style: 'transform:scaleX(' + (S.index / S.total).toFixed(3) + ')' })]));

      if (S.cfg.timed) {
         host.appendChild(el('div', { class: 'clock' }, [el('div', { class: 'clock__bar', id: 'clock-bar' })]));
      }

      host.appendChild(el('div', { class: 'felt', id: 'stage' }));
      host.appendChild(el('div', { class: 'actionzone', id: 'actionzone' }));

      renderStage();
      renderActionsArea();
   }

   function renderIdleGame(host) {
      if (lastSummary) return renderSummary(lastSummary, host);
      host.appendChild(el('div', { class: 'idle' }, [
         el('p', { class: 'idle__title', text: 'NO SESSION' }),
         el('p', { class: 'muted', text: 'Pick a drill on the right. Full-hand modes deal a real round \u2014 bet, play it out, get paid. Rapid modes drill one decision at a time.' }),
         el('div', { class: 'idle__keys' }, [
            el('span', { text: 'H hit' }), el('span', { text: 'S stand' }), el('span', { text: 'D double' }),
            el('span', { text: 'P split' }), el('span', { text: 'R surrender' }), el('span', { text: 'ENTER deal' })
         ])
      ]));
   }

   function stripItem(label, value, tone) {
      return el('div', { class: 'tablestrip__item' + (tone ? ' is-' + tone : '') }, [
         el('span', { class: 'tablestrip__l', text: label }),
         el('span', { class: 'tablestrip__v', text: value })
      ]);
   }

   function renderStage() {
      var stage = d.qs('#stage');
      if (!stage) return;
      d.clear(stage);
      if (!S.playOut) return renderDrillStage(stage);
      if (S.phase === 'broke') return renderBrokeStage(stage);

      if (S.phase === 'bet' || S.phase === 'idle' || !round.dealer.cards.length) {
         stage.appendChild(el('div', { class: 'waiting' }, [
            el('p', { class: 'waiting__title', text: 'Place your bet' }),
            el('p', {
               class: 'muted', text: S.cfg.gradeBets && countable()
                  ? 'Bet the count, not the last result.'
                  : 'Flat betting in this mode: the size is not graded.'
            })
         ]));
         return;
      }

      stage.appendChild(el('div', { class: 'seat seat--dealer' }, [
         el('div', { class: 'seat__label', text: 'Dealer' }),
         el('div', { class: 'seat__cards' },
            round.dealer.cards.map(function (c) { return d.cardTile(c, {}); })
               .concat(round.dealer.revealed ? [] : [d.cardTile(null, { facedown: true })])),
         el('div', { class: 'seat__total', text: dealerTotalText() })
      ]));

      var handsWrap = el('div', { class: 'hands' + (round.hands.length > 1 ? ' hands--split' : '') });
      round.hands.forEach(function (h, i) {
         var hv = BJ.handValue(h.cards);
         var active = S.phase === 'player' && i === round.active && !h.done;
         handsWrap.appendChild(el('div', {
            class: 'seat seat--player' + (active ? ' is-active' : '') + (h.result ? ' is-' + h.result : '')
         }, [
            el('div', { class: 'seat__label' }, [
               round.hands.length > 1 ? 'Hand ' + (i + 1) : 'You',
               el('span', { class: 'seat__bet', text: money$(h.bet) })
            ]),
            el('div', { class: 'seat__cards' }, h.cards.map(function (c) { return d.cardTile(c, {}); })),
            el('div', { class: 'seat__total', text: handTotalText(h, hv) }),
            h.result ? el('div', { class: 'seat__result', text: BJ.RESULT_LABEL[h.result] + ' ' + money$(h.delta, true) }) : null
         ]));
      });
      stage.appendChild(handsWrap);

      if (round.insuranceBet > 0 && round.insuranceResult !== null) {
         stage.appendChild(el('p', { class: 'note', text: 'Insurance ' + money$(round.insuranceResult, true) }));
      }

      if (S.phase === 'settled' && round.settled) {
         var total = round.settled.total;
         stage.appendChild(el('div', {
            class: 'roundresult ' + (total > 0 ? 'is-up' : total < 0 ? 'is-down' : 'is-flat')
         }, [
            el('span', { class: 'roundresult__v', text: money$(total, true) }),
            el('span', { class: 'roundresult__l', text: roundResultText() })
         ]));
      }
   }

   function dealerTotalText() {
      var hv = BJ.handValue(round.dealer.cards);
      if (!round.dealer.revealed) return 'shows ' + (round.upSlot() === 1 ? 'ace' : String(round.upSlot()));
      if (round.dealer.blackjack) return 'blackjack';
      if (hv.total > 21) return hv.total + ' \u00b7 bust';
      return (hv.soft ? 'soft ' : '') + hv.total;
   }

   function handTotalText(h, hv) {
      if (h.surrendered) return 'surrendered';
      if (hv.blackjack && !h.fromSplit) return 'blackjack';
      if (hv.total > 21) return hv.total + ' \u00b7 bust';
      return (hv.soft ? 'soft ' : '') + hv.total + (h.doubled ? ' \u00b7 doubled' : '');
   }

   function roundResultText() {
      var s = round.settled;
      if (s.dealerBlackjack) return 'Dealer blackjack';
      if (s.dealerBust) return 'Dealer busts with ' + s.dealerTotal;
      // with nothing left to beat the dealer turns over and stops, which can
      // leave a total no dealer would ever stand on
      if (!round.anyLive()) return 'Dealer does not draw \u00b7 ' + s.dealerTotal;
      return 'Dealer ' + s.dealerTotal;
   }

   function renderBrokeStage(stage) {
      var t = BJ.store.tableConfig();
      stage.appendChild(el('div', { class: 'waiting' }, [
         el('p', { class: 'waiting__title', text: 'Below the table minimum' }),
         el('p', { class: 'muted', text: 'Your bankroll is under ' + money$(t.min) + '. This is what risk of ruin looks like: a real edge still goes broke when the bet is too big for the roll.' }),
         el('p', { class: 'note', text: 'Buy in again below to keep training.' })
      ]));
   }

   function renderDrillStage(stage) {
      var q = S.current;
      if (!q) return;

      if (q.type === 'play') {
         if (q.shuffled && S.cfg.useCount) {
            stage.appendChild(el('div', { class: 'shuffle', text: 'New shoe \u00b7 the count starts again at zero' }));
         }
         if (q.burn && q.burn.length && !S.cfg.showCount) {
            stage.appendChild(el('div', { class: 'burn' }, [
               el('span', { class: 'burn__label', text: 'Played since your last decision' }),
               el('div', { class: 'burn__cards' }, q.burn.map(function (c) {
                  return el('span', { class: 'minicard', text: c.rank });
               }))
            ]));
         }
         var hv = BJ.handValue(q.cards);
         stage.appendChild(el('div', { class: 'seat seat--dealer' }, [
            el('div', { class: 'seat__label', text: 'Dealer' }),
            el('div', { class: 'seat__cards' }, [d.cardTile(q.up, {}), d.cardTile(null, { facedown: true })]),
            el('div', { class: 'seat__total', text: 'shows ' + (q.upSlot === 1 ? 'ace' : q.upSlot) })
         ]));
         stage.appendChild(el('div', { class: 'seat seat--player is-active' }, [
            el('div', { class: 'seat__label', text: 'You' }),
            el('div', { class: 'seat__cards' }, q.cards.map(function (c) { return d.cardTile(c, {}); })),
            el('div', { class: 'seat__total', text: (hv.soft ? 'soft ' : '') + hv.total + (hv.pair ? ' \u00b7 pair' : '') })
         ]));
         if (S.cfg.showCount && countable()) {
            stage.appendChild(el('div', { class: 'countstrip' }, [
               el('span', {}, ['Running ', el('b', { text: BJ.signed(q.rc, 0) })]),
               el('span', {}, ['True ', el('b', { text: BJ.signed(q.tc, 0) })]),
               el('span', { class: 'muted', text: q.decksRemaining.toFixed(1) + ' decks left' })
            ]));
         }
         return;
      }

      if (q.type === 'count-rc') {
         stage.appendChild(el('div', { class: 'seq' }, [
            el('div', { class: 'seq__label', text: 'Keep the running count' }),
            el('div', { class: 'seq__card', id: 'seq-card' }),
            el('div', { class: 'seq__progress', id: 'seq-progress' })
         ]));
         return;
      }

      var prompt, sub;
      if (q.type === 'count-tc') {
         prompt = 'Running count ' + BJ.signed(q.rcGiven, 0);
         sub = q.decksGiven + ' decks remaining. True count?';
      } else {
         prompt = q.dealt + ' cards in the discard tray';
         sub = q.decks + '-deck shoe. Decks remaining?';
      }
      stage.appendChild(el('div', { class: 'drill' }, [
         el('div', { class: 'drill__figure', text: prompt }),
         el('div', { class: 'drill__prompt', text: sub })
      ]));
   }

   /* ---------- action zone ---------- */

   /**
    * The action zone keeps the same three rows in every phase — bet, actions,
    * primary — so the table above it never changes size between turns. Controls
    * that do not apply right now are disabled rather than removed.
    */
   /**
    * The action zone never changes shape. Every control that exists in any
    * phase is rendered in every phase — chips, all five decisions, one primary
    * button — and the ones that do not apply are disabled rather than removed.
    * Anything that appears and disappears resizes the felt above it.
    */
   function renderActionsArea() {
      var host = d.qs('#actionzone');
      if (!host) return;
      d.clear(host);
      if (!S.playOut) return renderDrillActions(host);

      // decisions sit directly under the cards; the bet sits with the Deal button
      var phase = S.phase;
      host.appendChild(decisionRow(phase));
      renderBetControls(host, phase === 'bet');
      host.appendChild(el('div', { class: 'actions actions--single' }, [primaryButton(phase)]));
      host.appendChild(el('p', { class: 'hint', text: hintFor(phase) }));
   }

   /** The five decisions, always present, live only on the player's turn. */
   function decisionRow(phase) {
      var keys = { hit: 'H', stand: 'S', double: 'D', split: 'P', surrender: 'R' };

      if (phase === 'insurance') {
         return el('div', { class: 'actions' }, [
            actionButton(round.evenMoney ? 'Even money' : 'Insure ' + money$(round.bet / 2), 'insurance', 'Y',
               function () { answerInsurance(true); }),
            actionButton(round.evenMoney ? 'Decline' : 'No insurance', 'noinsurance', 'N',
               function () { answerInsurance(false); })
         ]);
      }

      var q = phase === 'player' ? S.current : null;
      return el('div', { class: 'actions' }, ['hit', 'stand', 'double', 'split', 'surrender'].map(function (a) {
         var live = !!(q && q.available[a]);
         var btn = actionButton(BJ.strategy.ACTION_LABEL[a], a, keys[a], function () { onAction(a); });
         if (!live) btn.disabled = true;
         return btn;
      }));
   }

   /** One primary button in one place; it keeps its slot even with nothing to do. */
   function primaryButton(phase) {
      var label = '', fn = null;

      if (phase === 'bet') {
         label = 'Deal';
         fn = function () { placeBet(S.bet); };
      } else if (S.waitingFor) {
         label = 'Continue';
         fn = function () { var f = S.waitingFor; S.waitingFor = null; f(); };
      } else if (phase === 'settled') {
         label = S.index >= S.total ? 'Session summary' : 'Next hand';
         fn = function () { if (S.index >= S.total) finish(false); else beginRound(); };
      }

      var btn = el('button', {
         class: 'btn btn--primary btn--wide', type: 'button', text: label || 'Deal',
         onclick: fn || function () { }
      });
      if (!fn) {
         btn.disabled = true;
         btn.classList.add('is-placeholder');
         btn.setAttribute('aria-hidden', 'true');
         btn.tabIndex = -1;
      }
      return btn;
   }

   function hintFor(phase) {
      var t = BJ.store.tableConfig();
      if (phase === 'bet') {
         return 'Table ' + money$(t.min) + ' to ' + money$(Math.min(t.max, BJ.store.table().bankroll)) + ' \u00b7 Enter to deal';
      }
      if (phase === 'insurance') {
         return round.evenMoney
            ? 'You have a blackjack and the dealer shows an ace. Take even money?'
            : 'Dealer shows an ace. Insurance costs half your bet and pays 2 to 1.';
      }
      if (phase === 'player') {
         return round.hands.length > 1 ? 'Hand ' + (round.active + 1) + ' of ' + round.hands.length : 'Your move';
      }
      if (phase === 'dealer') return 'Dealer plays';
      if (phase === 'settled') return 'Enter for the next hand';
      if (phase === 'broke') return 'Bankroll below the table minimum';
      return '\u00a0';
   }

   /** Chips stay on screen through the hand; they simply stop responding. */
   function renderBetControls(host, live) {
      var t = BJ.store.tableConfig();
      var max = Math.min(t.max, BJ.store.table().bankroll);
      var chips = [5, 25, 100, 500];

      host.appendChild(el('div', { class: 'betbar' + (live ? '' : ' betbar--idle') }, [
         el('div', { class: 'betbar__amount' }, [
            el('div', { class: 'betbar__meta' }, [
               el('span', { class: 'betbar__label', text: live ? 'Your bet' : 'In play' }),
               el('span', { class: 'betbar__risk', id: 'bet-risk' })
            ]),
            el('span', { class: 'betbar__value', id: 'bet-value', text: money$(S.bet) })
         ]),
         el('div', { class: 'chips chips--money' }, chips.map(function (c, i) {
            var btn = el('button', {
               class: 'chip chip--money chip--c' + c, type: 'button', dataset: { idx: String(i + 1) },
               text: '+' + c, 'aria-label': 'Add ' + money$(c),
               onclick: function () { adjustBet(S.bet + c); }
            });
            if (!live || c > max) btn.disabled = true;
            return btn;
         }).concat([
            (function () {
               var btn = el('button', { class: 'chip chip--reset', type: 'button', text: 'Min', onclick: function () { adjustBet(t.min); } });
               if (!live) btn.disabled = true;
               return btn;
            })()
         ]))
      ]));
      renderBetRisk();
   }

   function adjustBet(amount) {
      var t = BJ.store.tableConfig();
      var max = Math.min(t.max, BJ.store.table().bankroll);
      S.bet = BJ.clamp(Math.round(amount), t.min, max);
      var node = d.qs('#bet-value');
      if (node) node.textContent = money$(S.bet);
      var strip = d.qsa('.tablestrip__item')[1];
      if (strip) strip.querySelector('.tablestrip__v').textContent = money$(S.bet);
      renderBetRisk();
   }

   /**
    * Bet size against bankroll. Even where the ramp is not being graded, a
    * player quietly putting half their roll on one hand should be told: that
    * is the fastest way to go broke holding a winning strategy.
    */
   function renderBetRisk() {
      var node = d.qs('#bet-risk');
      if (!node) return;
      var bankroll = BJ.store.table().bankroll;
      if (!bankroll) return;
      var share = S.bet / bankroll;
      var pct = Math.round(share * 100);
      d.clear(node);
      node.className = 'betbar__risk' + (share >= 0.2 ? ' is-danger' : share >= 0.08 ? ' is-warn' : '');
      var live = S.phase === 'bet';
      node.textContent = (share < 0.01 ? 'under 1%' : pct + '%') + ' of your bankroll' +
         (live && share >= 0.08 ? ' \u00b7 a bad hand costs real ground' : '');
   }

   /** Drills hold their shape too: the answer row and one primary slot. */
   function renderDrillActions(host) {
      var q = S.current;
      if (!q) return;
      var keys = { hit: 'H', stand: 'S', double: 'D', split: 'P', surrender: 'R' };

      if (q.type === 'play') {
         host.appendChild(el('div', { class: 'actions' },
            ['hit', 'stand', 'double', 'split', 'surrender'].map(function (a) {
               var live = !!q.available[a];
               var b = actionButton(BJ.strategy.ACTION_LABEL[a], a, keys[a], function () { answerDrill(a); });
               if (!live) b.disabled = true;
               if (S.answered) markAnswer(b, a, q.rec.action);
               return b;
            })));
      } else {
         var waiting = q.type === 'count-rc' && !q.ready;
         host.appendChild(el('div', { class: 'actions actions--num' }, optionsFor(q).map(function (v, i) {
            var b = el('button', {
               class: 'act act--num', type: 'button', dataset: { value: String(v), idx: String(i + 1) },
               onclick: function () { answerDrill(v); }
            }, [
               el('span', { class: 'act__label', text: waiting ? '\u00b7' : (q.type === 'count-decks' ? v.toFixed(1) : BJ.signed(v, 0)) }),
               el('kbd', { class: 'act__key', text: String(i + 1) })
            ]);
            if (waiting) b.disabled = true;
            else if (S.answered) markAnswer(b, String(v), String(q.answer));
            return b;
         })));
      }

      var btn = el('button', {
         class: 'btn btn--primary btn--wide', type: 'button',
         text: S.index >= S.total ? 'Session summary' : 'Next',
         onclick: nextQuestion
      });
      if (!S.answered) {
         btn.disabled = true;
         btn.classList.add('is-placeholder');
         btn.setAttribute('aria-hidden', 'true');
         btn.tabIndex = -1;
      }
      host.appendChild(el('div', { class: 'actions actions--single' }, [btn]));
      host.appendChild(el('p', {
         class: 'hint', text: S.answered ? 'Enter for the next one'
            : q.type === 'count-rc' && !q.ready ? 'Watch the cards\u2026' : '\u00a0'
      }));
   }

   function markAnswer(b, value, correct) {
      b.disabled = true;
      if (String(value) === String(correct)) b.classList.add('act--correct');
      else if (S.coach && String(value) === String(S.coach.chosen)) b.classList.add('act--wrong');
   }

   function optionsFor(q) {
      var correct = q.answer;
      var set = [correct];
      var step = q.type === 'count-decks' ? 0.5 : 1;
      var offsets = q.type === 'count-decks' ? [0.5, 1, 1.5, -0.5, -1] : [1, -1, 2, -2, 3, -3];
      var guard = 0;
      while (set.length < 4 && guard++ < 60) {
         var o = offsets[Math.floor(Math.random() * offsets.length)];
         var v = Math.round((correct + o * step) * 2) / 2;
         if (q.type === 'count-decks' && v <= 0) continue;
         if (set.indexOf(v) === -1) set.push(v);
      }
      return set.sort(function (a, b) { return a - b; });
   }

   function actionButton(label, action, key, fn) {
      return el('button', {
         class: 'act act--' + action, type: 'button', dataset: { action: action }, onclick: fn
      }, [
         el('span', { class: 'act__label', text: label }),
         key ? el('kbd', { class: 'act__key', text: key }) : null
      ]);
   }

   /* ---------- right column ---------- */

   function renderCoach(host) {
      var c = S.coach;

      if (!c) {
         host.appendChild(panel('Coach', [
            el('p', { class: 'muted', text: 'Every decision is checked the moment you make it, with the reasoning and the expected values behind it.' })
         ]));
      } else {
         host.appendChild(panel('Coach', [
            el('div', { class: 'verdict' + (c.ok ? ' verdict--ok' : ' verdict--bad') }, [
               el('div', { class: 'verdict__head' }, [
                  el('span', { class: 'verdict__mark', text: c.ok ? '\u2713' : '\u2715' }),
                  el('span', { class: 'verdict__title', text: c.title }),
                  el('span', { class: 'verdict__time', text: d.ms(c.timeMs) })
               ]),
               el('p', { class: 'verdict__answer' }, [
                  el('b', { text: c.answer }),
                  !c.ok && c.chosen ? el('span', { class: 'muted', text: 'you chose ' + (BJ.strategy.ACTION_LABEL[c.chosen] || c.chosen) }) : null,
                  c.deviationActive ? el('span', { class: 'tag tag--dev', text: 'index play' }) : null
               ]),
               el('p', { class: 'why', text: c.why.short }),
               c.basicNote ? el('p', { class: 'why why--sub', text: c.basicNote }) : null,
               c.costMoney > 0.005 ? el('p', { class: 'why why--cost', text: 'That gave up ' + money$(c.costMoney) + ' in expectation.' }) : null,
               detailBlock(c)
            ])
         ]));
      }

      if (S.log.length) {
         host.appendChild(panel('Decisions', [
            el('ul', { class: 'log' }, S.log.map(function (l) {
               return el('li', { class: l.ok ? 'is-ok' : 'is-bad' }, [
                  el('span', { class: 'log__mark', text: l.ok ? '\u2713' : '\u2715' }),
                  el('span', { class: 'log__text', text: l.text })
               ]);
            }))
         ]));
      }
   }

   function detailBlock(c) {
      var body = el('div', { class: 'detail__body', hidden: true });
      var q = c.question;

      if (q && q.tc !== null && q.tc !== undefined && S.cfg.useCount) {
         body.appendChild(el('div', { class: 'kv' }, [
            kvItem('Running count', BJ.signed(q.rc, 0)),
            kvItem('True count', BJ.signed(q.tc, 0)),
            kvItem('Decks left', q.decksRemaining ? q.decksRemaining.toFixed(2) : '\u2014'),
            q.rec && q.rec.deviation ? kvItem('Index', BJ.signed(q.rec.index, 0)) : null
         ]));
      }
      if (c.evaluation) {
         body.appendChild(evTable(c.evaluation));
         body.appendChild(el('p', { class: 'note', text: c.evaluation.note }));
      }
      (c.why.lines || []).forEach(function (line) {
         body.appendChild(el('p', { class: 'detail__line', text: line }));
      });

      var open = false;
      var toggle = el('button', {
         class: 'detail__toggle', type: 'button', 'aria-expanded': 'false',
         text: 'Show the full breakdown',
         onclick: function (e) {
            open = !open;
            body.hidden = !open;
            e.currentTarget.setAttribute('aria-expanded', String(open));
            e.currentTarget.textContent = open ? 'Hide the full breakdown' : 'Show the full breakdown';
         }
      });
      return el('div', { class: 'detail' }, [toggle, body]);
   }

   function evTable(evaluation) {
      return el('div', { class: 'evtable' }, [
         el('table', {}, [
            el('caption', { text: 'Expected value per unit bet \u00b7 dealer busts ' + d.pctOrDash(evaluation.dealer.bust) }),
            el('tbody', {}, evaluation.order.map(function (a) {
               var isBest = a === evaluation.best;
               return el('tr', { class: isBest ? 'is-best' : '' }, [
                  el('th', { scope: 'row', text: BJ.strategy.ACTION_LABEL[a] }),
                  el('td', { class: 'num', text: BJ.ev.fmt(evaluation.values[a]) }),
                  el('td', { class: 'num muted', text: isBest ? 'best' : BJ.ev.fmt(evaluation.values[a] - evaluation.values[evaluation.best]) })
               ]);
            }))
         ])
      ]);
   }

   function focusPrimary() {
      if (!BJ.store.settings().keyboard) return;
      var btn = d.qs('#actionzone .act') || d.qs('#actionzone .btn--primary');
      if (btn && btn.focus) { try { btn.focus({ preventScroll: true }); } catch (e) { btn.focus(); } }
   }

   /* ======================================================================
      Summary and picker
      ====================================================================== */

   function finish(early) {
      clearTimers();
      if (!S) return;
      var summary = {
         id: BJ.uid(), ts: Date.now(), mode: S.mode, modeName: MODES[S.mode].name,
         total: S.decisions, correct: S.correct,
         accuracy: S.decisions ? S.correct / S.decisions : 0,
         avgMs: avgTime() || 0, bestStreak: S.bestStreak, score: S.score,
         rounds: S.playOut ? S.index : 0,
         net: S.money.net, wagered: S.money.wagered, evLost: S.money.evLost,
         playOut: S.playOut, early: !!early, rules: BJ.ruleSummary(BJ.store.rules())
      };
      if (S.decisions > 0) BJ.store.addSession(summary);
      S = null;
      lastSummary = summary;
      renderRail();
      renderSummary(summary);
      if (BJ.app && BJ.app.refreshStatus) BJ.app.refreshStatus();
      BJ.bus.emit('session-end', summary);
   }

   function renderSummary(summary, host) {
      host = host || d.qs(GAME);
      if (!host) return;
      d.clear(host);
      var money = BJ.store.table();

      host.appendChild(el('div', { class: 'summary' }, [
         el('div', { class: 'summary__head' }, [
            el('h2', { text: summary.early ? 'SESSION ENDED' : 'SESSION COMPLETE' }),
            el('span', { class: 'summary__mode', text: summary.modeName })
         ]),
         el('div', { class: 'summary__grid' }, [
            bigStat(d.pctOrDash(summary.accuracy), 'ACCURACY'),
            bigStat(summary.correct + '/' + summary.total, 'CORRECT'),
            bigStat(d.ms(summary.avgMs), 'AVG'),
            bigStat(String(summary.bestStreak), 'STREAK')
         ]),
         summary.playOut ? el('div', { class: 'summary__grid' }, [
            bigStat(money$(summary.net, true), 'RESULT'),
            bigStat(money$(summary.wagered), 'WAGERED'),
            bigStat(money$(-summary.evLost, true), 'ERROR COST'),
            bigStat(String(summary.rounds), 'HANDS')
         ]) : null,
         summary.playOut ? el('p', { class: 'note', text: 'Result and expectation are not the same thing. Over a session this short the money says very little about how well you played \u2014 the accuracy and the cost of errors say almost everything.' }) : null,
         el('div', { class: 'row-actions' }, [
            el('button', { class: 'btn btn--primary', type: 'button', text: 'RUN IT AGAIN', onclick: function () { lastSummary = null; start(summary.mode, {}); } }),
            el('button', { class: 'btn', type: 'button', text: 'WEAK SPOTS', onclick: function () { lastSummary = null; start('weakness', {}); } }),
            el('button', { class: 'btn btn--quiet', type: 'button', text: 'CLOSE', onclick: backToPicker })
         ]),
         el('p', { class: 'note', text: 'Bankroll now ' + money$(money.bankroll) + '.' })
      ]));
   }

   function backToPicker() {
      lastSummary = null;
      renderAll();
   }

   function bigStat(value, label) {
      return el('div', { class: 'bigstat' }, [
         el('span', { class: 'bigstat__value', text: value }),
         el('span', { class: 'bigstat__label', text: label })
      ]);
   }

   function renderPicker(host) {
      var list = ['basic', 'perfect', 'counting', 'deviations', 'speed', 'weakness'];
      var money = BJ.store.table();
      var t = BJ.store.tableConfig();

      host.appendChild(panel('Drill', [
         el('div', { class: 'modelist' }, list.map(function (id) {
            var m = MODES[id];
            var stats = BJ.store.state.stats.byMode[id];
            return el('button', {
               class: 'modelist__item', type: 'button', dataset: { mode: id },
               title: m.blurb, onclick: function () { onPick(id); }
            }, [
               el('span', { class: 'modelist__name', text: m.name }),
               el('span', { class: 'modelist__tag', text: m.playOut ? 'HANDS' : m.counting ? 'COUNT' : 'RAPID' }),
               el('span', { class: 'modelist__stat', text: stats ? d.pctOrDash(stats.c / stats.n) : '\u2014' })
            ]);
         })),
         el('label', { class: 'field field--row' }, [
            el('span', { class: 'field__label', text: 'LENGTH' }),
            el('select', { id: 'quick-count' }, [10, 20, 30, 50, 100].map(function (n) {
               return el('option', { value: String(n), text: String(n), selected: n === 20 });
            }))
         ]),
         el('button', { class: 'btn btn--full', type: 'button', text: 'CUSTOM SESSION', onclick: function () { onPick('custom'); } })
      ]));

      host.appendChild(panel('Table', [
         el('div', { class: 'kv' }, [
            kvItem('Bankroll', money$(money.bankroll)),
            kvItem('Unit', money$(t.unit)),
            kvItem('Limits', money$(t.min) + '-' + money$(t.max)),
            kvItem('Spread', '1-' + BJ.betting.ramp(t.spread)[4])
         ]),
         el('p', { class: 'note', text: BJ.ruleSummary(BJ.store.rules()) })
      ]));

      var last = BJ.store.state.sessions[0];
      if (last) {
         host.appendChild(panel('Last session', [
            el('div', { class: 'kv' }, [
               kvItem('Mode', last.modeName),
               kvItem('When', d.ago(last.ts)),
               kvItem('Accuracy', d.pctOrDash(last.accuracy)),
               kvItem('Decisions', String(last.total))
            ]),
            el('button', {
               class: 'btn btn--full', type: 'button', text: 'RUN IT AGAIN',
               onclick: function () { start(last.mode, {}); }
            })
         ]));
      }
   }

   function onPick(id) {
      var sel = d.qs('#quick-count');
      var count = Number(sel ? sel.value : 0) || 20;
      if (id === 'custom') {
         var host = d.qs(GAME);
         d.clear(host);
         host.appendChild(customPanel());
         return;
      }
      lastSummary = null;
      start(id, MODES[id].playOut ? { rounds: count } : { questions: count });
   }

   function customPanel() {
      var saved = BJ.store.state.custom || {};
      return el('section', { class: 'custom', id: 'custom-panel' }, [
         el('h3', { class: 'block__title', text: 'CUSTOM SESSION' }),
         el('div', { class: 'field' }, [
            el('span', { class: 'field__label', text: 'Hand types' }),
            el('div', { class: 'chips', id: 'custom-kinds' }, ['hard', 'soft', 'pair'].map(function (k) {
               var on = !saved.kinds || saved.kinds.indexOf(k) > -1;
               return el('button', {
                  type: 'button', class: 'chip' + (on ? ' chip--on' : ''), dataset: { value: k },
                  text: k === 'pair' ? 'Pairs' : k === 'soft' ? 'Soft' : 'Hard',
                  onclick: function (e) { e.currentTarget.classList.toggle('chip--on'); }
               });
            }))
         ]),
         el('div', { class: 'field' }, [
            el('span', { class: 'field__label', text: 'Dealer up-cards' }),
            el('div', { class: 'chips', id: 'custom-ups' }, [2, 3, 4, 5, 6, 7, 8, 9, 10, 1].map(function (u) {
               var on = !saved.ups || saved.ups.indexOf(u) > -1;
               return el('button', {
                  type: 'button', class: 'chip chip--sq' + (on ? ' chip--on' : ''), dataset: { value: u },
                  text: u === 1 ? 'A' : String(u),
                  onclick: function (e) { e.currentTarget.classList.toggle('chip--on'); }
               });
            }))
         ]),
         el('div', { class: 'field-row' }, [
            el('label', { class: 'field' }, [
               el('span', { class: 'field__label', text: 'Hands' }),
               el('input', { type: 'number', id: 'custom-count', min: '5', max: '200', value: String(saved.questions || 20) })
            ]),
            el('label', { class: 'field' }, [
               el('span', { class: 'field__label', text: 'Difficulty' }),
               selectEl('custom-difficulty', [['any', 'Any'], ['1', '1 \u00b7 obvious'], ['2', '2'], ['3', '3'], ['4', '4'], ['5', '5 \u00b7 razor thin']], String(saved.difficulty || 'any'))
            ]),
            el('label', { class: 'field' }, [
               el('span', { class: 'field__label', text: 'Seconds per decision' }),
               selectEl('custom-clock', [['0', 'No clock'], ['10000', '10'], ['7000', '7'], ['5000', '5'], ['3000', '3']], String(saved.timePerQuestion || 0))
            ])
         ]),
         el('div', { class: 'field-row' }, [
            toggleField('custom-playout', 'Play hands out for money', saved.playOut !== false),
            toggleField('custom-count-on', 'Track the count', saved.useCount !== false),
            toggleField('custom-dev-on', 'Include deviations', !!saved.useDeviations),
            toggleField('custom-weak-on', 'Weight to weak spots', !!saved.greedy)
         ]),
         el('div', { class: 'row-actions' }, [
            el('button', { class: 'btn btn--primary', type: 'button', text: 'Start custom session', onclick: startCustom }),
            el('button', { class: 'btn btn--quiet', type: 'button', text: 'CANCEL', onclick: backToPicker })
         ])
      ]);
   }

   function selectEl(id, options, value) {
      return el('select', { id: id }, options.map(function (o) {
         return el('option', { value: o[0], text: o[1], selected: String(o[0]) === String(value) });
      }));
   }

   function toggleField(id, label, on) {
      return el('label', { class: 'switch' }, [
         el('input', { type: 'checkbox', id: id, checked: !!on }),
         el('span', { class: 'switch__track' }),
         el('span', { class: 'switch__label', text: label })
      ]);
   }

   function startCustom() {
      var kinds = d.qsa('#custom-kinds .chip--on').map(function (b) { return b.dataset.value; });
      var ups = d.qsa('#custom-ups .chip--on').map(function (b) { return Number(b.dataset.value); });
      var count = BJ.clamp(Number(d.qs('#custom-count').value) || 20, 5, 200);
      var playOut = d.qs('#custom-playout').checked;
      var useCount = d.qs('#custom-count-on').checked;
      var useDev = d.qs('#custom-dev-on').checked;

      var cfg = {
         rounds: count, questions: count,
         playOut: playOut, drill: !playOut,
         gradeBets: playOut && useCount,
         naturalChance: 0.25,
         filter: {
            kinds: kinds.length ? kinds : ['hard', 'soft', 'pair'],
            ups: ups.length ? ups : null,
            difficulty: d.qs('#custom-difficulty').value
         },
         timePerQuestion: Number(d.qs('#custom-clock').value) || 0,
         useCount: useCount, useDeviations: useDev,
         greedy: d.qs('#custom-weak-on').checked,
         composition: true
      };
      cfg.timed = !playOut && cfg.timePerQuestion > 0;
      cfg.showCount = useCount && useDev;

      BJ.store.state.custom = {
         kinds: cfg.filter.kinds, ups: cfg.filter.ups, questions: count,
         difficulty: cfg.filter.difficulty, timePerQuestion: cfg.timePerQuestion,
         useCount: useCount, useDeviations: useDev, greedy: cfg.greedy, playOut: playOut
      };
      BJ.store.save();
      lastSummary = null;
      start('custom', cfg);
   }

   /* ======================================================================
      Keyboard
      ====================================================================== */

   function handleKey(e) {
      if (!S || !BJ.store.settings().keyboard) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      var tag = document.activeElement && document.activeElement.tagName;
      if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') return;
      var k = e.key.toLowerCase();
      var map = { h: 'hit', s: 'stand', d: 'double', p: 'split', r: 'surrender' };

      if (S.playOut) {
         if (S.phase === 'bet') {
            if (k === 'enter' || k === ' ') { e.preventDefault(); placeBet(S.bet); return; }
            if (/^[1-5]$/.test(k)) {
               var chip = d.qs('#actionzone .chip[data-idx="' + k + '"]');
               if (chip && !chip.disabled) { e.preventDefault(); chip.click(); }
            }
            return;
         }
         if (S.phase === 'insurance') {
            if (k === 'y') { e.preventDefault(); answerInsurance(true); }
            else if (k === 'n') { e.preventDefault(); answerInsurance(false); }
            return;
         }
         if (S.phase === 'player' && S.current) {
            if (map[k] && S.current.available[map[k]]) { e.preventDefault(); onAction(map[k]); }
            return;
         }
         if (k === ' ' || k === 'enter') {
            var btn = d.qs('#actionzone .btn--primary');
            if (btn && !btn.disabled) { e.preventDefault(); btn.click(); }
         }
         return;
      }

      if (S.answered) {
         if (k === ' ' || k === 'enter' || k === 'n') { e.preventDefault(); nextQuestion(); }
         return;
      }
      var q = S.current;
      if (!q) return;
      if (q.type === 'play' && map[k] && q.available[map[k]]) { e.preventDefault(); answerDrill(map[k]); return; }
      if (/^[1-4]$/.test(k)) {
         var b = d.qs('#actionzone .act[data-idx="' + k + '"]');
         if (b) { e.preventDefault(); b.click(); }
      }
   }

   /* ---------- public ---------- */

   BJ.trainer = {
      MODES: MODES,
      render: renderAll,
      state: function () { return S; },
      shoeState: function () { return shoe; },
      countVisible: function () { return !!(S && S.cfg.showCount && countable()); },
      start: start,
      quit: quit,
      renderPicker: renderPicker,
      handleKey: handleKey,
      isRunning: function () { return !!S; },
      session: function () { return S; },
      round: function () { return round; },
      shoe: function () { return shoe; },
      placeBet: placeBet,
      act: onAction,
      insurance: answerInsurance,
      answerDrill: answerDrill,
      nextQuestion: nextQuestion,
      beginRound: beginRound,
      drillKey: function (key, opts) {
         if (BJ.catalog.get(key)) {
            return start('weakness', {
               questions: (opts && opts.questions) || 15, pool: [key],
               useCount: true, useDeviations: true, composition: true,
               showCount: !!(opts && opts.showCount), drill: true, playOut: false
            });
         }
         if (String(key).indexOf('count') === 0) return start('counting', { questions: 15 });
         if (key === 'bet-ramp') return start('perfect', { rounds: 15 });
         return start('deviations', { rounds: 15 });
      },
      startFromKey: function (key, opts) { return BJ.trainer.drillKey(key, opts); }
   };

})(window.BJ = window.BJ || {});
