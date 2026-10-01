/* ==========================================================================
   app.js — the workspace.

   One screen, four columns. The table is always dealt in the middle; the wide
   column is a reference panel you switch between, and the two rails carry the
   context that belongs to whatever is on screen. A status bar along the bottom
   states the game, the shoe and the money at all times.
   ========================================================================== */
(function (BJ) {
   'use strict';

   var d = BJ.dom;
   var el = d.el;

   var PANELS = [
      { id: 'matrix', label: 'MATRIX' },
      { id: 'analytics', label: 'ANALYTICS' },
      { id: 'journal', label: 'JOURNAL' },
      { id: 'settings', label: 'SETTINGS' }
   ];

   var ALIAS = { dashboard: 'matrix', train: 'matrix', strategy: 'matrix', stats: 'analytics' };

   var panel = 'matrix';
   var booted = false;
   var sessionStart = null;

   function slots() {
      return {
         left: d.qs('#col-left'),
         main: d.qs('#col-main'),
         right: d.qs('#col-right-extra')
      };
   }

   /** Draw the active panel and the rails that belong to it. */
   function refreshPanel() {
      var s = slots();
      if (!s.main) return;
      d.clear(s.main);
      d.clear(s.right);

      try {
         if (panel === 'matrix') {
            BJ.views.dashboard(s.left);
            BJ.views.matrix(s);
         } else {
            BJ.views[panel](s);
         }
      } catch (err) {
         console.error('Failed to draw ' + panel, err);
         d.clear(s.main);
         s.main.appendChild(el('div', { class: 'block' }, [
            el('h3', { class: 'block__title', text: 'PANEL ERROR' }),
            el('p', { text: 'Something went wrong drawing this panel. Your saved progress is untouched.' }),
            el('p', { class: 'note', text: String(err && err.message ? err.message : err) }),
            el('button', { class: 'btn', type: 'button', text: 'RELOAD', onclick: function () { location.reload(); } })
         ]));
      }

      d.qsa('.tabstrip__item').forEach(function (b) {
         var on = b.dataset.panel === panel;
         b.classList.toggle('tabstrip__item--active', on);
         b.setAttribute('aria-selected', on ? 'true' : 'false');
      });

      setHash(panel);
      refreshStatus();
   }

   function go(id) {
      id = ALIAS[id] || id;
      if (!PANELS.some(function (p) { return p.id === id; })) id = 'matrix';
      panel = id;
      refreshPanel();
   }

   /** Cosmetic only: never let a blocked history API break a click. */
   function setHash(id) {
      try {
         if (location.hash === '#' + id) return;
         if (history && history.replaceState && location.protocol !== 'file:') {
            history.replaceState(null, '', '#' + id);
         } else {
            location.hash = id;
         }
      } catch (e) { }
   }

   function buildTabs() {
      var host = d.qs('#panel-tabs');
      d.clear(host);
      PANELS.forEach(function (p) {
         host.appendChild(el('button', {
            class: 'tabstrip__item', type: 'button', role: 'tab',
            dataset: { panel: p.id }, text: p.label,
            onclick: function () { go(p.id); }
         }));
      });
   }

   /* ---------- status bar ---------- */

   function item(text, tone) {
      return el('div', { class: 'status-bar__item' + (tone ? ' is-' + tone : ''), text: text });
   }

   function divider() { return el('span', { class: 'divider', text: '|' }); }

   function elapsed() {
      if (!sessionStart) return '00:00:00';
      var t = Math.floor((Date.now() - sessionStart) / 1000);
      var h = Math.floor(t / 3600), m = Math.floor((t % 3600) / 60), sec = t % 60;
      return [h, m, sec].map(function (n) { return n < 10 ? '0' + n : String(n); }).join(':');
   }

   function money(v, signed) {
      var n = Math.round(v);
      var str = '$' + Math.abs(n).toLocaleString();
      return signed ? (n > 0 ? '+' : n < 0 ? '\u2212' : '') + str : str;
   }

   function refreshStatus() {
      var left = d.qs('#status-left');
      var right = d.qs('#status-right');
      if (!left) return;

      var rules = BJ.store.rules();
      var t = BJ.store.table();
      var session = BJ.trainer.state();
      var shoe = BJ.trainer.shoeState();
      var sys = BJ.system(BJ.store.settings().system);

      var bits = [
         rules.decks + 'D',
         rules.hitSoft17 ? 'H17' : 'S17',
         rules.das ? 'DAS' : 'NDAS',
         rules.lateSurrender ? 'LS' : 'NS',
         rules.blackjackPayout === 1.5 ? '3:2' : rules.blackjackPayout === 1.2 ? '6:5' : '1:1',
         'PEN ' + Math.round(rules.penetration * 100) + '%',
         sys.name.toUpperCase()
      ];

      if (shoe) {
         if (BJ.trainer.countVisible()) {
            bits.push('RC ' + BJ.signed(shoe.rc, 0));
            var tc = shoe.trueCount(BJ.store.settings().tcRounding);
            bits.push('TC ' + BJ.signed(tc, 0));
         } else if (session && session.cfg.useCount) {
            bits.push('RC \u00b7\u00b7');
            bits.push('TC \u00b7\u00b7');
         }
         bits.push(shoe.decksRemaining().toFixed(1) + 'D LEFT');
      }

      if (session && session.playOut) bits.push('BET ' + money(session.bet));
      bits.push(money(t.bankroll));
      bits.push('H#' + t.hands);
      bits.push(elapsed());

      d.clear(left);
      bits.forEach(function (b, i) {
         if (i) left.appendChild(divider());
         left.appendChild(item(b));
      });

      d.clear(right);
      var st = BJ.store.state.stats;
      if (session) {
         right.appendChild(item(session.index + '/' + session.total));
         right.appendChild(divider());
         right.appendChild(item('ACC ' + d.pctOrDash(session.decisions ? session.correct / session.decisions : null)));
         right.appendChild(divider());
         right.appendChild(item('STREAK ' + session.streak));
      } else if (st.hands) {
         right.appendChild(item('LIFETIME ' + d.pctOrDash(st.correct / st.hands)));
         right.appendChild(divider());
         right.appendChild(item(st.hands + ' DECISIONS'));
      } else {
         right.appendChild(item('NO DATA'));
      }
      right.appendChild(divider());
      right.appendChild(item(t.net >= 0 ? money(t.net, true) : money(t.net, true), t.net > 0 ? 'up' : t.net < 0 ? 'down' : ''));
   }

   function refreshMenu() {
      var state = d.qs('#menu-state');
      var stats = d.qs('#menu-stats');
      if (!state) return;
      var session = BJ.trainer.state();
      state.textContent = session
         ? BJ.trainer.MODES[session.mode].name.toUpperCase() + ' \u00b7 ' + String(session.phase || '').toUpperCase()
         : 'IDLE';

      d.clear(stats);
      var m = BJ.store.table();
      var score = Math.round(BJ.store.overallMastery(BJ.store.rules()));
      stats.appendChild(el('div', { class: 'menu-bar__item', text: 'THEORY ' + score + '/100' }));
      stats.appendChild(el('div', { class: 'menu-bar__item', text: 'BANKROLL ' + money(m.bankroll) }));
      stats.appendChild(el('button', {
         class: 'menu-bar__item menu-bar__item--button', type: 'button',
         text: document.documentElement.dataset.theme === 'dark' ? 'DARK' : 'LIGHT',
         title: 'Switch theme',
         onclick: function () {
            var next = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
            document.documentElement.dataset.theme = next;
            BJ.store.settings().theme = next;
            BJ.store.save(true);
            refreshMenu();
         }
      }));
   }

   function refreshChrome() {
      refreshMenu();
      refreshStatus();
   }

   function warmCatalogue() {
      var run = function () { try { BJ.catalog.importanceTable(BJ.store.rules()); } catch (e) { } };
      if (window.requestIdleCallback) requestIdleCallback(run, { timeout: 2500 });
      else setTimeout(run, 400);
   }

   function boot() {
      if (booted) return;
      booted = true;

      BJ.store.load();
      var s = BJ.store.settings();
      document.documentElement.dataset.theme = s.theme || 'dark';

      buildTabs();
      warmCatalogue();
      BJ.trainer.render();
      go((location.hash || '').replace('#', '') || 'matrix');

      document.addEventListener('keydown', function (e) {
         BJ.trainer.handleKey(e);
         if (e.key === 'Escape' && BJ.trainer.isRunning()) BJ.trainer.quit();
      });

      BJ.bus.on('session-start', function () { sessionStart = Date.now(); refreshChrome(); });
      BJ.bus.on('session-end', function () { refreshChrome(); refreshPanel(); });
      BJ.bus.on('round-end', refreshChrome);
      BJ.bus.on('rules-changed', function () { warmCatalogue(); refreshChrome(); });
      BJ.bus.on('data-reset', function () { refreshChrome(); refreshPanel(); BJ.trainer.render(); });
      BJ.bus.on('storage-error', function () { d.toast('This browser will not let the trainer save progress.', 'bad'); });

      window.addEventListener('hashchange', function () {
         var id = (location.hash || '').replace('#', '') || 'matrix';
         if ((ALIAS[id] || id) !== panel) go(id);
      });

      setInterval(function () { if (BJ.trainer.isRunning()) refreshStatus(); }, 1000);
      refreshChrome();
   }

   BJ.app = {
      go: go,
      boot: boot,
      panel: function () { return panel; },
      panels: PANELS,
      slots: slots,
      refreshPanel: refreshPanel,
      refreshStatus: refreshStatus,
      refreshChrome: refreshChrome
   };

   if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
   else boot();

})(window.BJ = window.BJ || {});
