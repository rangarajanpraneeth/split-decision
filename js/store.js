/* ==========================================================================
   store.js — everything the trainer remembers.

   Storage is localStorage only: no server, no account, no network. The state
   object is versioned so future releases can migrate it.
   ========================================================================== */
(function (BJ) {
   'use strict';

   var KEY = 'bjpt.state.v1';
   var MAX_MISTAKES = 250;
   var MAX_SESSIONS = 60;
   var MAX_RECENT = 16;
   var MAX_TIMELINE = 400;

   function today() {
      var d = new Date();
      return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
   }
   function pad(n) { return n < 10 ? '0' + n : '' + n; }

   function defaults() {
      return {
         version: 1,
         createdAt: Date.now(),
         updatedAt: Date.now(),
         settings: {
            rules: BJ.normaliseRules({}),
            system: 'hilo',
            theme: 'dark',
            sound: false,
            autoAdvance: true,
            showCount: false,
            tcRounding: 'floor',
            difficulty: 'adaptive',
            decisionTarget: 3500,
            keyboard: true,
            cardArt: true,
            table: {
               unit: 10,
               min: 10,
               max: 500,
               spread: 8,
               startingBankroll: 1000,
               playOut: true,
               gradeBets: true,
               autoDeal: false
            }
         },
         table: {
            bankroll: 1000, net: 0, wagered: 0, rounds: 0, hands: 0,
            won: 0, lost: 0, pushed: 0, blackjacks: 0, busts: 0,
            evLost: 0, peak: 1000, trough: 1000, shoes: 0, rebuys: 0
         },
         stats: {
            hands: 0, correct: 0, timeMs: 0,
            streak: 0, bestStreak: 0,
            byMode: {}, byUp: {}, byKind: {}, byAction: {}, byDifficulty: {},
            daily: {}
         },
         situations: {},
         mistakes: [],
         sessions: [],
         timeline: [],
         bests: { streak: 0, sessionAccuracy: 0, fastestCorrectMs: null, countRun: 0 },
         custom: null
      };
   }

   var state = defaults();
   var saveTimer = null;
   var available = true;

   function load() {
      try {
         var raw = localStorage.getItem(KEY);
         if (raw) {
            var parsed = JSON.parse(raw);
            state = merge(defaults(), parsed);
            state.settings.rules = BJ.normaliseRules(state.settings.rules);
         }
      } catch (e) {
         available = false;
         state = defaults();
      }
      return state;
   }

   function merge(base, over) {
      if (over === null || over === undefined) return base;
      if (typeof base !== 'object' || Array.isArray(base) || base === null) return over;
      var out = {};
      for (var k in base) if (base.hasOwnProperty(k)) {
         out[k] = over.hasOwnProperty(k) ? merge(base[k], over[k]) : base[k];
      }
      for (var j in over) if (over.hasOwnProperty(j) && !out.hasOwnProperty(j)) out[j] = over[j];
      return out;
   }

   function save(now) {
      if (!available) return;
      state.updatedAt = Date.now();
      if (now) return write();
      clearTimeout(saveTimer);
      saveTimer = setTimeout(write, 350);
   }

   function write() {
      try {
         localStorage.setItem(KEY, JSON.stringify(state));
      } catch (e) {
         available = false;
         BJ.bus && BJ.bus.emit('storage-error', e);
      }
   }

   function settings() { return state.settings; }
   function rules() { return state.settings.rules; }
   function tableConfig() { return state.settings.table; }
   function table() { return state.table; }

   /* ---------- money ---------- */

   function applyRound(summary) {
      var t = state.table;
      t.rounds++;
      t.hands += summary.hands;
      t.won += summary.won;
      t.lost += summary.lost;
      t.pushed += summary.pushed;
      t.blackjacks += summary.blackjacks || 0;
      t.busts += summary.busts || 0;
      t.wagered += summary.wagered;
      t.net += summary.delta;
      t.bankroll += summary.delta;
      if (t.bankroll > t.peak) t.peak = t.bankroll;
      if (t.bankroll < t.trough) t.trough = t.bankroll;
      save();
      return t;
   }

   function addEvLost(amount) {
      if (!amount || amount <= 0) return;
      state.table.evLost += amount;
   }

   function rebuy() {
      var t = state.table;
      t.bankroll = state.settings.table.startingBankroll;
      t.rebuys++;
      save(true);
      return t.bankroll;
   }

   function countShoe() { state.table.shoes++; save(); }

   /* ---------- per-situation records ---------- */

   function situation(key, create) {
      var s = state.situations[key];
      if (!s && create) {
         s = state.situations[key] = { n: 0, c: 0, t: 0, recent: '', last: 0, fast: null, first: Date.now() };
         // legacy-safe defaults
      }
      return s || null;
   }

   /** Wilson lower bound — a few lucky answers are not mastery. */
   function wilson(correct, n, z) {
      if (!n) return 0;
      z = z || 1.64;
      var p = correct / n;
      var denom = 1 + z * z / n;
      var centre = p + z * z / (2 * n);
      var margin = z * Math.sqrt((p * (1 - p) + z * z / (4 * n)) / n);
      return Math.max(0, (centre - margin) / denom);
   }

   function recentAccuracy(s) {
      if (!s || !s.recent.length) return null;
      var hits = 0;
      for (var i = 0; i < s.recent.length; i++) if (s.recent.charAt(i) === '1') hits++;
      return hits / s.recent.length;
   }

   /**
    * Mastery 0-100. Reliability x volume x speed x freshness.
    * Deliberately slow to reach the top: it needs repeated correct answers
    * across sessions, at a reasonable pace, that have not gone stale.
    */
   function mastery(key) {
      var s = situation(key);
      if (!s || !s.n) return 0;
      var reliability = wilson(s.c, s.n);
      // evidence needed scales with how hard the situation is
      var diff = 3;
      try { diff = BJ.catalog.difficulty(key, state.settings.rules); } catch (e) { }
      var needed = 4 + diff * 2;
      var volume = Math.min(1, s.n / needed);
      var avg = s.t / s.n;
      var target = state.settings.decisionTarget;
      var speed = BJ.clamp(1.25 - (avg / (target * 2)), 0.55, 1);
      var days = (Date.now() - s.last) / 86400000;
      var fresh = 0.55 + 0.45 * Math.exp(-days / 21);
      var recent = recentAccuracy(s);
      var recentPull = recent === null ? 1 : (0.7 + 0.3 * recent);
      return BJ.clamp(100 * reliability * Math.pow(volume, 0.7) * speed * fresh * recentPull, 0, 100);
   }

   function accuracy(key) {
      var s = situation(key);
      return s && s.n ? s.c / s.n : null;
   }

   function avgTime(key) {
      var s = situation(key);
      return s && s.n ? s.t / s.n : null;
   }

   /* ---------- recording ---------- */

   function bump(obj, k, correct, timeMs) {
      if (!obj[k]) obj[k] = { n: 0, c: 0, t: 0 };
      obj[k].n++;
      if (correct) obj[k].c++;
      obj[k].t += timeMs;
   }

   /**
    * attempt: {
    *   key, mode, kind, correct, timeMs, action, correctAction, basicAction,
    *   cards, up, rc, tc, difficulty, deviation, rulesSummary
    * }
    */
   function record(attempt) {
      var st = state.stats;
      var t = Math.max(0, Math.min(attempt.timeMs || 0, 120000));

      st.hands++;
      st.timeMs += t;
      if (attempt.correct) {
         st.correct++;
         st.streak++;
         if (st.streak > st.bestStreak) st.bestStreak = st.streak;
         if (st.streak > state.bests.streak) state.bests.streak = st.streak;
         if (state.bests.fastestCorrectMs === null || t < state.bests.fastestCorrectMs) {
            if (t > 250) state.bests.fastestCorrectMs = t;
         }
      } else {
         st.streak = 0;
      }

      bump(st.byMode, attempt.mode || 'basic', attempt.correct, t);
      bump(st.byKind, attempt.kind || 'hard', attempt.correct, t);
      if (attempt.up) bump(st.byUp, attempt.up === 1 ? 'A' : String(attempt.up), attempt.correct, t);
      if (attempt.correctAction) bump(st.byAction, attempt.correctAction, attempt.correct, t);
      if (attempt.difficulty) bump(st.byDifficulty, String(attempt.difficulty), attempt.correct, t);

      var d = today();
      if (!st.daily[d]) st.daily[d] = { n: 0, c: 0, t: 0 };
      st.daily[d].n++; st.daily[d].t += t;
      if (attempt.correct) st.daily[d].c++;

      if (attempt.key) {
         var s = situation(attempt.key, true);
         s.n++; s.t += t; s.last = Date.now();
         if (attempt.correct) {
            s.c++;
            if (s.fast === null || t < s.fast) s.fast = t;
         }
         s.recent = (s.recent + (attempt.correct ? '1' : '0')).slice(-MAX_RECENT);
      }

      state.timeline.push({
         ts: Date.now(), ok: attempt.correct ? 1 : 0, ms: t,
         m: attempt.mode || 'basic', k: attempt.key || ''
      });
      if (state.timeline.length > MAX_TIMELINE) state.timeline = state.timeline.slice(-MAX_TIMELINE);

      if (attempt.costMoney) addEvLost(attempt.costMoney);

      if (!attempt.correct) {
         state.mistakes.unshift({
            id: BJ.uid(),
            ts: Date.now(),
            mode: attempt.mode,
            key: attempt.key,
            label: attempt.label || (attempt.key ? BJ.prettyKey(attempt.key) : ''),
            cards: attempt.cards || null,
            up: attempt.up || null,
            rc: attempt.rc, tc: attempt.tc,
            action: attempt.action,
            correctAction: attempt.correctAction,
            basicAction: attempt.basicAction,
            timeMs: t,
            difficulty: attempt.difficulty,
            costMoney: attempt.costMoney || 0,
            deviation: attempt.deviation || null,
            rules: attempt.rulesSummary || BJ.ruleSummary(rules()),
            why: attempt.why || ''
         });
         if (state.mistakes.length > MAX_MISTAKES) state.mistakes.length = MAX_MISTAKES;
      }

      save();
      return st;
   }

   /* ---------- adaptive selection ---------- */

   /**
    * Weighted pick across a pool of situation keys.
    * weight = importance x (weakness) x (staleness) with a floor so that
    * unseen material still gets shown.
    */
   function selectKey(opts) {
      opts = opts || {};
      var pool = opts.pool || BJ.catalog.all().map(function (s) { return s.key; });
      var r = opts.rules || rules();
      var exclude = opts.exclude || null;
      var best = null, bestW = -1, totalW = 0, weights = [], i;

      for (i = 0; i < pool.length; i++) {
         var key = pool[i];
         var imp = 0.2 + BJ.catalog.importance(key, r);
         var m = mastery(key) / 100;
         var s = situation(key);
         var weakness = Math.pow(1 - m, 1.6);
         var seen = s ? s.n : 0;
         var explore = seen === 0 ? 1.35 : 1;
         var stale = 1;
         if (s && s.last) {
            var mins = (Date.now() - s.last) / 60000;
            stale = mins < 2 ? 0.25 : (mins < 10 ? 0.7 : 1);
         }
         var w = imp * (0.15 + weakness) * explore * stale;
         if (exclude && key === exclude) w *= 0.08;
         if (opts.boost && opts.boost[key]) w *= opts.boost[key];
         weights.push(w);
         totalW += w;
         if (w > bestW) { bestW = w; best = key; }
      }
      if (totalW <= 0) return pool[Math.floor(Math.random() * pool.length)];

      // temperature: 1 = proportional sampling, higher = greedier
      var temp = opts.greedy ? 2.2 : 1;
      if (temp !== 1) {
         totalW = 0;
         for (i = 0; i < weights.length; i++) { weights[i] = Math.pow(weights[i], temp); totalW += weights[i]; }
      }
      var pick = Math.random() * totalW, acc = 0;
      for (i = 0; i < pool.length; i++) {
         acc += weights[i];
         if (pick <= acc) return pool[i];
      }
      return best;
   }

   /** Ranked weak spots: seen at least a couple of times and still shaky. */
   function weaknesses(limit, r) {
      r = r || rules();
      var out = [];
      for (var key in state.situations) if (state.situations.hasOwnProperty(key)) {
         var s = state.situations[key];
         if (s.n < 2) continue;
         var m = mastery(key);
         var acc = s.c / s.n;
         var imp = BJ.catalog.importance(key, r);
         out.push({
            key: key, label: BJ.prettyKey(key), n: s.n, accuracy: acc,
            mastery: m, avgMs: s.t / s.n, importance: imp,
            // errors dominate, but a common situation you have barely met still
            // deserves a look — it just should not outrank one you keep missing
            score: (100 - m) * (0.35 + imp) * Math.min(1, s.n / 4) * (0.35 + (1 - acc) * 1.3)
         });
      }
      out.sort(function (a, b) { return b.score - a.score; });
      return out.slice(0, limit || 6);
   }

   function strengths(limit) {
      var out = [];
      for (var key in state.situations) if (state.situations.hasOwnProperty(key)) {
         var s = state.situations[key];
         if (s.n < 4) continue;
         out.push({
            key: key, label: BJ.prettyKey(key), n: s.n,
            accuracy: s.c / s.n, mastery: mastery(key), avgMs: s.t / s.n
         });
      }
      out.sort(function (a, b) { return b.mastery - a.mastery; });
      return out.slice(0, limit || 6);
   }

   function overallMastery(r) {
      r = r || rules();
      var list = BJ.catalog.all(), total = 0, weighted = 0;
      for (var i = 0; i < list.length; i++) {
         var imp = 0.15 + BJ.catalog.importance(list[i].key, r);
         total += imp;
         weighted += imp * mastery(list[i].key);
      }
      return total ? weighted / total : 0;
   }

   /** Situations standing at or above a mastery threshold. */
   function masteredCount(threshold) {
      threshold = threshold || 80;
      var n = 0;
      for (var key in state.situations) if (state.situations.hasOwnProperty(key)) {
         if (mastery(key) >= threshold) n++;
      }
      return n;
   }

   function coverage() {
      var list = BJ.catalog.all(), seen = 0;
      for (var i = 0; i < list.length; i++) if (state.situations[list[i].key]) seen++;
      return { seen: seen, total: list.length };
   }

   /** Accuracy over the most recent n attempts. */
   function recentForm(n) {
      n = n || 50;
      var tl = state.timeline.slice(-n);
      if (!tl.length) return null;
      var c = 0, t = 0;
      for (var i = 0; i < tl.length; i++) { c += tl[i].ok; t += tl[i].ms; }
      return { n: tl.length, accuracy: c / tl.length, avgMs: t / tl.length };
   }

   /** Change in accuracy: the older half of recent history vs the newer half. */
   function improvement(window) {
      window = window || 120;
      var tl = state.timeline.slice(-window);
      if (tl.length < 20) return null;
      var half = Math.floor(tl.length / 2);
      var a = tl.slice(0, half), b = tl.slice(half);
      function acc(arr) { var c = 0; for (var i = 0; i < arr.length; i++) c += arr[i].ok; return c / arr.length; }
      function ms(arr) { var t = 0; for (var i = 0; i < arr.length; i++) t += arr[i].ms; return t / arr.length; }
      return { accuracyDelta: acc(b) - acc(a), speedDelta: ms(a) - ms(b), n: tl.length };
   }

   function addSession(summary) {
      state.sessions.unshift(summary);
      if (state.sessions.length > MAX_SESSIONS) state.sessions.length = MAX_SESSIONS;
      if (summary.accuracy > state.bests.sessionAccuracy && summary.total >= 10) {
         state.bests.sessionAccuracy = summary.accuracy;
      }
      save(true);
   }

   function clearMistake(id) {
      state.mistakes = state.mistakes.filter(function (m) { return m.id !== id; });
      save();
   }

   function reset(scope) {
      var keep = state.settings;
      if (scope === 'all') {
         state = defaults();
         state.settings = keep;
      } else if (scope === 'bankroll') {
         state.table = defaults().table;
         state.table.bankroll = state.settings.table.startingBankroll;
         state.table.peak = state.table.bankroll;
         state.table.trough = state.table.bankroll;
      } else if (scope === 'progress') {
         var d = defaults();
         state.stats = d.stats;
         state.situations = {};
         state.timeline = [];
         state.bests = d.bests;
         state.table = d.table;
         state.table.bankroll = state.settings.table.startingBankroll;
         state.table.peak = state.table.bankroll;
         state.table.trough = state.table.bankroll;
      } else if (scope === 'mistakes') {
         state.mistakes = [];
      } else if (scope === 'sessions') {
         state.sessions = [];
      } else if (scope === 'settings') {
         state.settings = defaults().settings;
      }
      save(true);
   }

   function exportJSON() {
      return JSON.stringify(state, null, 2);
   }

   function importJSON(text) {
      var parsed = JSON.parse(text);
      if (!parsed || typeof parsed !== 'object') throw new Error('That file is not a trainer backup.');
      state = merge(defaults(), parsed);
      state.settings.rules = BJ.normaliseRules(state.settings.rules);
      save(true);
      return state;
   }

   BJ.store = {
      load: load,
      save: save,
      get state() { return state; },
      settings: settings,
      rules: rules,
      tableConfig: tableConfig,
      table: table,
      applyRound: applyRound,
      addEvLost: addEvLost,
      rebuy: rebuy,
      countShoe: countShoe,
      situation: situation,
      mastery: mastery,
      accuracy: accuracy,
      avgTime: avgTime,
      recentAccuracy: recentAccuracy,
      wilson: wilson,
      record: record,
      selectKey: selectKey,
      weaknesses: weaknesses,
      strengths: strengths,
      overallMastery: overallMastery,
      coverage: coverage,
      masteredCount: masteredCount,
      recentForm: recentForm,
      improvement: improvement,
      addSession: addSession,
      clearMistake: clearMistake,
      reset: reset,
      exportJSON: exportJSON,
      importJSON: importJSON,
      today: today,
      isAvailable: function () { return available; }
   };

})(window.BJ = window.BJ || {});
