/* ==========================================================================
   views.js — dashboard, theory matrix, analytics, mistake journal, settings.
   ========================================================================== */
(function (BJ) {
   'use strict';

   var d = BJ.dom;
   var el = d.el;

   /**
    * The workspace owns the columns; a view is handed the slots it may fill.
    * A slot is just an element, already emptied.
    */
   function sideCard(title, children) {
      return el('section', { class: 'sidepanel' }, [el('h3', { text: title })].concat(children));
   }

   function block(title, children) {
      return el('section', { class: 'block' }, [el('h3', { class: 'block__title', text: title })].concat(children));
   }

   /* ======================================================================
      Dashboard
      ====================================================================== */

   function renderDashboard(host) {
      d.clear(host);
      var L = { left: host, main: host, right: host };   // one column: order is the order below
      var st = BJ.store.state.stats;
      var rules = BJ.store.rules();
      var mastery = BJ.store.overallMastery(rules);
      var form = BJ.store.recentForm(60);
      var imp = BJ.store.improvement(140);
      var cov = BJ.store.coverage();
      var acc = st.hands ? st.correct / st.hands : null;
      var avg = st.hands ? st.timeMs / st.hands : null;

      if (!st.hands) {
         host.appendChild(el('section', { class: 'empty' }, [
            el('h2', { text: 'Nothing measured yet' }),
            el('p', { text: 'Play a first set of hands and this becomes a read-out of exactly where your play differs from theory.' }),
            el('button', {
               class: 'btn btn--primary', type: 'button', text: 'Start with basic strategy',
               onclick: function () { BJ.app.go('train'); BJ.trainer.start('basic', {}); }
            })
         ]));
         L.left.appendChild(rulesFooter());
         return;
      }

      var scoreCard = el('section', { class: 'hero' }, [
         el('div', { class: 'hero__score' }, [
            el('div', { class: 'hero__number', text: Math.round(mastery) }),
            el('div', { class: 'hero__scale', text: '/ 100' })
         ]),
         el('div', { class: 'hero__body' }, [
            el('h2', { text: 'Theory score' }),
            el('p', { text: masteryNarrative(mastery, cov) }),
            el('div', { class: 'hero__spark', id: 'hero-spark' })
         ])
      ]);
      L.left.appendChild(scoreCard);

      var spark = d.qs('#hero-spark', scoreCard);
      var series = accuracySeries(12);
      if (series.length > 2) {
         spark.appendChild(d.sparkline(series, { min: 0, max: 1, label: 'Accuracy trend' }));
         spark.appendChild(el('span', { class: 'muted', text: 'accuracy over your last ' + (series.length * 20) + ' decisions' }));
      }

      host.appendChild(el('section', { class: 'statgrid' }, [
         stat(d.pctOrDash(acc), 'Overall accuracy', st.hands + ' decisions'),
         stat(d.ms(avg), 'Average decision', 'target ' + d.ms(BJ.store.settings().decisionTarget)),
         stat(String(st.streak), 'Current streak', 'best ' + st.bestStreak),
         stat(form ? d.pctOrDash(form.accuracy) : '\u2014', 'Recent form', form ? 'last ' + form.n : ''),
         stat(imp ? (imp.accuracyDelta >= 0 ? '+' : '') + Math.round(imp.accuracyDelta * 100) + 'pts' : '\u2014', 'Change in accuracy', imp ? 'over ' + imp.n + ' decisions' : 'needs more data'),
         stat(BJ.store.masteredCount(80) + '', 'Situations mastered', cov.seen + ' of ' + cov.total + ' seen')
      ]));

      host.appendChild(recommendation(rules));
      L.right.appendChild(moneyPanel());

      var weak = BJ.store.weaknesses(6, rules);
      var strong = BJ.store.strengths(5);

      host.appendChild(el('section', { class: 'twocol twocol--single' }, [
         el('div', { class: 'panel' }, [
            el('h3', { text: 'Where to work next' }),
            el('p', { class: 'note', text: 'Ranked by what an error costs times how often it comes up. A hand you have answered correctly can still appear here if you have barely met it.' }),
            weak.length ? el('ul', { class: 'ranked' }, weak.map(function (w) {
               return el('li', {}, [
                  el('div', { class: 'ranked__main' }, [
                     el('span', { class: 'ranked__label', text: w.label }),
                     el('span', { class: 'ranked__meta', text: weakReason(w) })
                  ]),
                  el('div', { class: 'meter', title: 'Mastery ' + Math.round(w.mastery) + ' of 100' }, [
                     el('div', { class: 'meter__fill', style: 'width:' + Math.round(w.mastery) + '%' })
                  ]),
                  el('button', {
                     class: 'btn btn--sm', type: 'button', text: 'Drill',
                     onclick: function () { BJ.app.go('train'); BJ.trainer.drillKey(w.key, { questions: 12, showCount: true }); }
                  })
               ]);
            })) : el('p', { class: 'muted', text: 'Answer a few more hands and the weak spots will surface here.' })
         ])
      ]));

      L.right.appendChild(el('section', { class: 'panel' }, [
         el('div', {}, [
            el('h3', { text: 'Strongest situations' }),
            strong.length ? el('ul', { class: 'ranked' }, strong.map(function (w) {
               return el('li', {}, [
                  el('div', { class: 'ranked__main' }, [
                     el('span', { class: 'ranked__label', text: w.label }),
                     el('span', { class: 'ranked__meta', text: Math.round(w.mastery) + ' mastery \u00b7 ' + d.pctOrDash(w.accuracy) + ' \u00b7 ' + d.ms(w.avgMs) })
                  ]),
                  el('div', { class: 'meter meter--good' }, [
                     el('div', { class: 'meter__fill', style: 'width:' + Math.round(w.mastery) + '%' })
                  ])
               ]);
            })) : el('p', { class: 'muted', text: 'Mastery needs repeated correct answers across sessions, so this fills in slowly by design.' })
         ])
      ]));

      var sessions = BJ.store.state.sessions.slice(0, 5);
      if (sessions.length) {
         host.appendChild(el('section', { class: 'panel' }, [
            el('h3', { text: 'Recent sessions' }),
            el('table', { class: 'table' }, [
               el('thead', {}, el('tr', {}, [
                  el('th', { text: 'When' }), el('th', { text: 'Mode' }),
                  el('th', { class: 'num', text: 'Decisions' }), el('th', { class: 'num', text: 'Accuracy' }),
                  el('th', { class: 'num', text: 'Avg' }), el('th', { class: 'num', text: 'Result' })
               ])),
               el('tbody', {}, sessions.map(function (s) {
                  return el('tr', {}, [
                     el('td', { text: d.ago(s.ts) }),
                     el('td', { text: s.modeName }),
                     el('td', { class: 'num', text: String(s.total) }),
                     el('td', { class: 'num', text: d.pctOrDash(s.accuracy) }),
                     el('td', { class: 'num', text: d.ms(s.avgMs) }),
                     el('td', { class: 'num', text: s.playOut ? fmt$(s.net, true) : '\u2014' })
                  ]);
               }))
            ])
         ]));
      }

      L.left.appendChild(rulesFooter());
   }

   /** Why a situation is on the work-next list, in plain words. */
   function weakReason(w) {
      var wrong = Math.round(w.n * (1 - w.accuracy));
      var base = wrong > 0
         ? wrong + (wrong === 1 ? ' error' : ' errors') + ' in ' + w.n
         : 'right ' + w.n + (w.n === 1 ? ' time' : ' times') + ', not often enough to be sure';
      return base + ' \u00b7 mastery ' + Math.round(w.mastery) + ' \u00b7 ' + d.ms(w.avgMs);
   }

   /** Results at the table, kept firmly separate from how well you played. */
   function moneyPanel() {
      var t = BJ.store.table();
      var cfg = BJ.store.tableConfig();
      var st = BJ.store.state.stats;
      var bet = st.byKind && st.byKind.bet;
      if (!t.rounds) {
         return el('section', { class: 'panel' }, [
            el('h3', { text: 'At the table' }),
            el('p', { class: 'muted', text: 'Bankroll ' + fmt$(t.bankroll) + '. Play a few hands out and the results, the wagering and the cost of your mistakes show up here.' })
         ]);
      }
      var decided = t.won + t.lost + t.pushed;
      return el('section', { class: 'panel' }, [
         el('h3', { text: 'At the table' }),
         el('div', { class: 'statrow' }, [
            miniStat(fmt$(t.bankroll), 'Bankroll'),
            miniStat(fmt$(t.net, true), 'Lifetime result'),
            miniStat(fmt$(-t.evLost, true), 'Given up to errors'),
            miniStat(String(t.hands), 'Hands played'),
            miniStat(d.pctOrDash(decided ? t.won / decided : null), 'Hands won'),
            bet ? miniStat(d.pctOrDash(bet.c / bet.n), 'Bet sizing') : miniStat('\u2014', 'Bet sizing')
         ]),
         el('div', { class: 'splitbar', title: t.won + ' won, ' + t.pushed + ' pushed, ' + t.lost + ' lost' }, [
            el('span', { class: 'splitbar__w', style: 'width:' + (decided ? (t.won / decided) * 100 : 0) + '%' }),
            el('span', { class: 'splitbar__p', style: 'width:' + (decided ? (t.pushed / decided) * 100 : 0) + '%' }),
            el('span', { class: 'splitbar__l', style: 'width:' + (decided ? (t.lost / decided) * 100 : 0) + '%' })
         ]),
         el('p', {
            class: 'note', text: 'Won ' + t.won + ' \u00b7 pushed ' + t.pushed + ' \u00b7 lost ' + t.lost +
               ' \u00b7 ' + t.blackjacks + ' blackjacks \u00b7 ' + fmt$(t.wagered) + ' wagered across ' + t.shoes + ' shoes. Swing from ' +
               fmt$(t.trough) + ' to ' + fmt$(t.peak) + '. Unit ' + fmt$(cfg.unit) + '.'
         }),
         el('p', { class: 'muted', text: 'Short-run results are almost entirely variance. The number that measures you is the cost of your mistakes, and it should fall towards zero.' })
      ]);
   }

   function fmt$(v, signed) {
      var n = Math.round(v);
      var str = '$' + Math.abs(n).toLocaleString();
      return signed ? (n > 0 ? '+' : n < 0 ? '\u2212' : '') + str : str;
   }

   function miniStat(value, label) {
      return el('div', { class: 'ministat' }, [
         el('span', { class: 'ministat__v', text: value }),
         el('span', { class: 'ministat__l', text: label })
      ]);
   }

   function masteryNarrative(m, cov) {
      var seen = cov.seen / cov.total;
      if (m < 15) return 'Early days. The score climbs as you answer the same situations correctly across separate sessions, not from one good run.';
      if (m < 40) return 'The common hands are starting to hold. Reliability across sessions is what moves this number next.';
      if (m < 65) return 'Solid basic play. Depth is what is missing — index plays, soft hands and the awkward pairs.';
      if (m < 85) return 'Strong. What is left is speed and the situations you see least often' + (seen < 0.8 ? ', plus the parts of the catalogue you have not met yet.' : '.');
      return 'Close to complete. Keep the count work fresh and the score will hold.';
   }

   function accuracySeries(buckets) {
      var tl = BJ.store.state.timeline;
      if (tl.length < 40) return [];
      var size = 20;
      var out = [];
      for (var i = Math.max(0, tl.length - buckets * size); i + size <= tl.length; i += size) {
         var slice = tl.slice(i, i + size), c = 0;
         for (var j = 0; j < slice.length; j++) c += slice[j].ok;
         out.push(c / slice.length);
      }
      return out;
   }

   function stat(value, label, sub) {
      return el('div', { class: 'stat' }, [
         el('span', { class: 'stat__value', text: value }),
         el('span', { class: 'stat__label', text: label }),
         sub ? el('span', { class: 'stat__sub', text: sub }) : null
      ]);
   }

   /** What to practise next, and why. */
   function recommendation(rules) {
      var st = BJ.store.state.stats;
      var byMode = st.byMode;
      var rec = null;

      function accOf(m) { return byMode[m] && byMode[m].n >= 10 ? byMode[m].c / byMode[m].n : null; }
      var basicAcc = accOf('basic');
      var devAcc = accOf('deviations');
      var countAcc = accOf('counting');
      var weak = BJ.store.weaknesses(1, rules)[0];

      if (basicAcc === null) {
         rec = { mode: 'basic', title: 'Lock down basic strategy', why: 'Everything else is a correction to this. Twenty-five hands is enough for a first reading.' };
      } else if (basicAcc < 0.9) {
         rec = { mode: 'basic', title: 'More basic strategy', why: 'You are at ' + d.pctOrDash(basicAcc) + ' on the plain chart. Index plays cannot recover what the base costs you.' };
      } else if (countAcc === null) {
         rec = { mode: 'counting', title: 'Start counting', why: 'The chart is in place. Running count and true-count conversion are the next lever.' };
      } else if (countAcc < 0.85) {
         rec = { mode: 'counting', title: 'Sharpen the count', why: 'Counting accuracy is ' + d.pctOrDash(countAcc) + '. A wrong count makes every deviation wrong too.' };
      } else if (devAcc === null || devAcc < 0.85) {
         rec = { mode: 'deviations', title: 'Work the index plays', why: 'This is where the count turns into money, and it is the part most players skip.' };
      } else if (weak && weak.mastery < 55) {
         rec = { mode: 'weakness', title: 'Attack your weak spots', why: 'Starting with ' + weak.label + ', where you are at ' + d.pctOrDash(weak.accuracy) + '.' };
      } else {
         rec = { mode: 'speed', title: 'Play it faster', why: 'Accuracy is there. Decision speed is what is left to train.' };
      }

      return el('section', { class: 'panel panel--rec' }, [
         el('div', {}, [
            el('h3', { text: rec.title }),
            el('p', { text: rec.why })
         ]),
         el('button', {
            class: 'btn btn--primary', type: 'button', text: 'Start',
            onclick: function () { BJ.app.go('train'); BJ.trainer.start(rec.mode, {}); }
         })
      ]);
   }

   function rulesFooter() {
      return el('p', { class: 'rules-footer' }, [
         'Everything above is calculated for ',
         el('b', { text: BJ.ruleSummary(BJ.store.rules()) }),
         ' with the ',
         el('b', { text: BJ.system(BJ.store.settings().system).name }),
         ' count. ',
         el('button', { class: 'linkbtn', type: 'button', text: 'Change the rules', onclick: function () { BJ.app.go('settings'); } })
      ]);
   }

   /* ======================================================================
      Theory matrix
      ====================================================================== */

   var matrixState = { view: 'hard', overlay: 'basic', filter: null };

   /** Chart codes: the letter shown, the colour class, and the plain reading. */
   var CODE_CLASS = { H: 'h', S: 's', D: 'd', Ds: 'd', P: 'p', R: 'r', Rh: 'r', Rs: 'r', Rp: 'r', '\u00b7': 'none' };
   var CODE_TEXT = {
      H: 'Hit', S: 'Stand', D: 'Double, otherwise hit', Ds: 'Double, otherwise stand',
      P: 'Split', R: 'Surrender', Rh: 'Surrender, otherwise hit',
      Rs: 'Surrender, otherwise stand', Rp: 'Surrender, otherwise split'
   };

   function setView(v) { matrixState.view = v; matrixState.filter = null; BJ.app.refreshPanel(); }
   function setOverlay(v) { matrixState.overlay = v; BJ.app.refreshPanel(); }

   /** Legend clicks isolate one decision across the whole chart. */
   var FILTER_FAMILY = {
      H: ['H'], S: ['S'], D: ['D', 'Ds'], P: ['P'], R: ['R', 'Rh', 'Rs', 'Rp'], dev: ['dev']
   };
   function setFilter(code) {
      matrixState.filter = matrixState.filter === code ? null : code;
      drawMatrix();
   }
   function cellMatchesFilter(cell) {
      if (!matrixState.filter) return true;
      if (matrixState.filter === 'dev') return !!cell.dev;
      var fam = FILTER_FAMILY[matrixState.filter] || [matrixState.filter];
      return fam.indexOf(cell.code) > -1;
   }

   function segBtn(value, label, on, fn) {
      return el('button', {
         class: 'seg' + (on ? ' seg--on' : ''), type: 'button', role: 'tab',
         'aria-selected': on ? 'true' : 'false', text: label,
         onclick: function () { fn(value); }
      });
   }

   function renderMatrix(slots) {
      var host = slots.main;
      d.clear(host);
      var rules = BJ.store.rules();
      var sysId = BJ.store.settings().system;
      var hasIndexes = BJ.system(sysId).indexes;

      // options above the chart
      host.appendChild(el('div', { class: 'matrix__options' }, [
         el('div', { class: 'optgroup' }, [
            el('span', { class: 'optgroup__label', text: 'CHART' }),
            el('div', { class: 'segmented', role: 'tablist' }, [
               segBtn('hard', 'HARD', matrixState.view === 'hard', setView),
               segBtn('soft', 'SOFT', matrixState.view === 'soft', setView),
               segBtn('pairs', 'PAIRS', matrixState.view === 'pairs', setView),
               segBtn('surrender', 'SURR', matrixState.view === 'surrender', setView)
            ])
         ]),
         el('div', { class: 'optgroup' }, [
            el('span', { class: 'optgroup__label', text: 'OVERLAY' }),
            el('div', { class: 'segmented', role: 'tablist' }, [
               segBtn('basic', 'BASIC', matrixState.overlay === 'basic', setOverlay),
               segBtn('dev', hasIndexes ? 'HI-LO INDEX' : 'INDEX', matrixState.overlay === 'dev', setOverlay)
            ])
         ]),
         el('div', { class: 'optgroup optgroup--end' }, [
            el('span', { class: 'optgroup__label', text: 'RULES' }),
            el('span', { class: 'optgroup__value', text: BJ.ruleSummary(rules) })
         ])
      ]));

      if (matrixState.overlay === 'dev' && !hasIndexes) {
         host.appendChild(el('p', {
            class: 'callout', text: 'Published indexes are supplied for Hi-Lo only. ' +
               BJ.system(sysId).name + ' runs the counting drills, but its indexes are not bundled, so deviations stay off rather than being guessed at.'
         }));
      }

      // the chart
      host.appendChild(el('div', { class: 'matrix', id: 'matrix-table' }));

      // legend under the chart
      host.appendChild(el('div', { class: 'legendbar' }, [
         el('span', { class: 'legendbar__label', text: 'FILTER' }),
         el('div', { class: 'legend', id: 'matrix-legend' })
      ]));

      host.appendChild(el('div', { class: 'matrix__detail', id: 'matrix-detail' }, [
         el('p', { class: 'muted', text: 'Pick any cell for the reasoning behind it, the expected values, and any index attached to it.' })
      ]));

      drawMatrix();
   }

   function drawMatrix() {
      var host = d.qs('#matrix-table');
      d.clear(host);
      var rules = BJ.store.rules();
      var sysId = BJ.store.settings().system;
      var showDev = matrixState.overlay === 'dev' && BJ.system(sysId).indexes;
      var view = matrixState.view === 'surrender' ? 'hard' : matrixState.view;
      var data = BJ.strategy.chart(rules, view, { deviations: showDev, system: sysId });

      var table = el('table', { class: 'grid' + (matrixState.view === 'surrender' ? ' grid--surrender' : '') });
      var head = el('tr', {}, [el('th', { class: 'grid__corner', text: matrixState.view === 'pairs' ? 'Pair' : 'You' })]);
      data.columns.forEach(function (c) { head.appendChild(el('th', { scope: 'col', text: c })); });
      table.appendChild(el('thead', {}, head));

      var body = el('tbody', {});
      data.rows.forEach(function (row) {
         if (matrixState.view === 'surrender' && (row.total < 14 || row.total > 17)) return;
         var tr = el('tr', {}, [el('th', { scope: 'row', text: row.label })]);
         row.cells.forEach(function (cell) {
            var isSurr = cell.code.charAt(0) === 'R';
            var text, cls;
            if (matrixState.view === 'surrender') {
               text = isSurr ? 'R' : '\u00b7';
               cls = 'cell cell--' + (isSurr ? 'r' : 'none');
            } else {
               text = cell.code;
               cls = 'cell cell--' + (CODE_CLASS[cell.code] || 'h');
            }
            if (showDev && cell.dev) cls += ' cell--dev';
            var dim = !cellMatchesFilter(cell);
            if (dim) cls += ' cell--dim';
            var td = el('td', {}, [
               el('button', {
                  type: 'button', class: cls, dataset: { code: cell.code },
                  'aria-label': row.label + ' versus ' + BJ.strategy.upLabel(cell.up) + ': ' + (CODE_TEXT[cell.code] || cell.code),
                  onclick: function () { showCellDetail(row, cell); }
               }, [
                  el('span', { class: 'cell__code', text: text }),
                  showDev && cell.dev ? el('span', { class: 'cell__index', text: BJ.signed(cell.index, 0) }) : null
               ])
            ]);
            tr.appendChild(td);
         });
         body.appendChild(tr);
      });
      table.appendChild(body);
      host.appendChild(table);

      var legend = d.qs('#matrix-legend');
      d.clear(legend);
      var items = matrixState.view === 'surrender'
         ? [['r', 'R', 'Surrender', 'R']]
         : [['h', 'H', 'Hit', 'H'], ['s', 'S', 'Stand', 'S'], ['d', 'D', 'Double', 'D'],
         ['p', 'P', 'Split', 'P'], ['r', 'Rh', 'Surrender', 'R']];
      items.forEach(function (it) {
         var on = matrixState.filter === it[3];
         legend.appendChild(el('button', {
            class: 'legend__item' + (on ? ' legend__item--on' : ''), type: 'button',
            'aria-pressed': on ? 'true' : 'false',
            title: 'Show only ' + it[2].toLowerCase() + ' decisions',
            onclick: function () { setFilter(it[3]); }
         }, [
            el('span', { class: 'cell cell--' + it[0] + ' cell--chip', text: it[1] }),
            el('span', { text: it[2] })
         ]));
      });
      if (showDev) {
         var devOn = matrixState.filter === 'dev';
         legend.appendChild(el('button', {
            class: 'legend__item' + (devOn ? ' legend__item--on' : ''), type: 'button',
            'aria-pressed': devOn ? 'true' : 'false',
            title: 'Show only hands that carry an index',
            onclick: function () { setFilter('dev'); }
         }, [
            el('span', { class: 'cell cell--dev cell--chip', text: '+2' }),
            el('span', { text: 'Has an index' })
         ]));
      }
      if (matrixState.filter) {
         legend.appendChild(el('button', {
            class: 'linkbtn', type: 'button', text: 'Clear highlight',
            onclick: function () { setFilter(matrixState.filter); }
         }));
      }
   }

   function showCellDetail(row, cell) {
      var host = d.qs('#matrix-detail');
      d.clear(host);
      var rules = BJ.store.rules();
      var cards = cell.cards;
      var evaluation = null;
      try {
         evaluation = BJ.ev.evaluate({ cards: cards, up: cell.up, rules: rules, ctx: {} });
      } catch (e) { }

      var key = BJ.situationKey(cards, BJ.catalog.slotCard(cell.up));
      var sit = BJ.catalog.get(key);
      var m = BJ.store.mastery(key);
      var s = BJ.store.situation(key);

      host.appendChild(el('div', { class: 'detailhead' }, [
         el('div', { class: 'detailhead__hand' }, cards.map(function (c) { return d.cardTile(c, {}); })
            .concat([el('span', { class: 'detailhead__vs', text: 'vs' }), d.cardTile(BJ.catalog.slotCard(cell.up), {})])),
         el('div', {}, [
            el('h3', { text: CODE_TEXT[cell.code] || cell.code }),
            el('p', { class: 'muted', text: row.label + ' against ' + BJ.strategy.upLabel(cell.up) })
         ])
      ]));

      if (cell.dev) {
         host.appendChild(el('div', { class: 'callout callout--dev' }, [
            el('b', { text: 'Index ' + BJ.signed(cell.index, 0) + ' \u00b7 ' + cell.dev.group }),
            el('p', { text: cell.dev.note })
         ]));
      }

      (cell.notes || []).forEach(function (n) { host.appendChild(el('p', { text: n })); });

      if (evaluation) {
         var rows = evaluation.order.map(function (a) {
            return el('tr', { class: a === evaluation.best ? 'is-best' : '' }, [
               el('th', { scope: 'row', text: BJ.strategy.ACTION_LABEL[a] }),
               el('td', { class: 'num', text: BJ.ev.fmt(evaluation.values[a]) })
            ]);
         });
         host.appendChild(el('div', { class: 'evtable' }, [
            el('table', {}, [
               el('caption', { text: 'Expected value at a neutral shoe \u00b7 dealer busts ' + d.pctOrDash(evaluation.dealer.bust) }),
               el('tbody', {}, rows)
            ])
         ]));
         host.appendChild(el('p', { class: 'note', text: evaluation.note }));
      }

      if (sit) {
         host.appendChild(el('p', {
            class: 'muted', text: s && s.n
               ? 'You have seen this ' + s.n + ' times, ' + d.pctOrDash(s.c / s.n) + ' correct, mastery ' + Math.round(m) + '/100.'
               : 'You have not been asked this one yet.'
         }));
      }

      host.appendChild(el('div', { class: 'row-actions' }, [
         el('button', {
            class: 'btn btn--primary btn--sm', type: 'button', text: 'Drill this situation',
            onclick: function () { BJ.app.go('train'); BJ.trainer.startFromKey(key, { questions: 12, showCount: true }); }
         })
      ]));
   }

   /* ======================================================================
      Analytics
      ====================================================================== */

   function renderAnalytics(slots) {
      var L = slots;
      var host = L.main;
      d.clear(L.left); d.clear(L.main); d.clear(L.right);
      var st = BJ.store.state.stats;
      var rules = BJ.store.rules();

      host.appendChild(el('header', { class: 'view__head' }, [
         el('div', {}, [
            el('h2', { text: 'Analytics' }),
            el('p', { class: 'muted', text: 'How good you are, broken down far enough to tell you what to do about it.' })
         ])
      ]));

      if (!st.hands) {
         host.appendChild(el('p', { class: 'empty', text: 'No decisions recorded yet. Start a drill on the right and this fills in.' }));
         L.left.appendChild(sideCard('What is measured', [
            el('p', { class: 'muted', text: 'Every decision is stored with the cards, the dealer up-card, the count, the rules in force, the time you took and what the error cost.' })
         ]));
         L.right.appendChild(block('Nothing yet', [
            el('p', { class: 'muted', text: 'Results at the table appear here once a hand has been played out.' })
         ]));
         return;
      }

      L.left.appendChild(sideCard('Overall', [
         el('div', { class: 'kv' }, [
            kvPair('Accuracy', d.pctOrDash(st.correct / st.hands)),
            kvPair('Decisions', String(st.hands)),
            kvPair('Mistakes', String(st.hands - st.correct)),
            kvPair('Average', d.ms(st.timeMs / st.hands)),
            kvPair('Best streak', String(st.bestStreak)),
            kvPair('Theory score', String(Math.round(BJ.store.overallMastery(rules))))
         ]),
         el('p', { class: 'note', text: 'Fastest correct answer ' + d.ms(BJ.store.state.bests.fastestCorrectMs) + '.' })
      ]));

      host.appendChild(breakdown('By training mode', st.byMode, function (k) {
         return (BJ.trainer.MODES[k] && BJ.trainer.MODES[k].name) || k;
      }));
      host.appendChild(breakdown('By dealer up-card', st.byUp, function (k) { return 'Dealer ' + k; }, upOrder));
      host.appendChild(breakdown('By correct decision', st.byAction, function (k) {
         return BJ.strategy.ACTION_LABEL[k] || k;
      }));
      var DIFF_NAMES = { '1': 'Level 1 \u00b7 obvious', '2': 'Level 2', '3': 'Level 3', '4': 'Level 4', '5': 'Level 5 \u00b7 razor thin' };
      L.left.appendChild(sideCard('By difficulty', [
         el('div', { class: 'bars' }, Object.keys(st.byDifficulty).sort().map(function (k) {
            var e = st.byDifficulty[k];
            return barRow(DIFF_NAMES[k] || 'Level ' + k, e.n ? e.c / e.n : 0, e.n + ' seen');
         }))
      ]));
      L.left.appendChild(sideCard('By hand type', [
         el('div', { class: 'bars' }, Object.keys(st.byKind).map(function (k) {
            var e = st.byKind[k];
            var name = { hard: 'Hard', soft: 'Soft', pair: 'Pairs', deviation: 'Index', counting: 'Counting', insurance: 'Insurance', bet: 'Bet sizing' }[k] || k;
            return barRow(name, e.n ? e.c / e.n : 0, e.n + ' seen');
         }))
      ]));

      L.right.appendChild(tablePanel());
      L.right.appendChild(activityPanel());

      var sessions = BJ.store.state.sessions.slice(0, 6);
      if (sessions.length) {
         L.right.appendChild(el('section', { class: 'panel' }, [
            el('h3', { text: 'Recent sessions' }),
            el('ul', { class: 'ranked' }, sessions.map(function (ses) {
               return el('li', {}, [
                  el('div', { class: 'ranked__main' }, [
                     el('span', { class: 'ranked__label', text: ses.modeName }),
                     el('span', { class: 'ranked__meta', text: d.ago(ses.ts) + ' \u00b7 ' + ses.total + ' decisions \u00b7 ' + d.pctOrDash(ses.accuracy) })
                  ])
               ]);
            }))
         ]));
      }

      var worst = BJ.store.weaknesses(10, rules);
      if (worst.length) {
         host.appendChild(el('section', { class: 'panel' }, [
            el('h3', { text: 'Situation by situation' }),
            el('p', { class: 'note', text: 'Ordered the same way as the dashboard: cost of an error, how often it arises, and how sure the record is.' }),
            el('table', { class: 'table' }, [
               el('thead', {}, el('tr', {}, [
                  el('th', { text: 'Situation' }), el('th', { class: 'num', text: 'Seen' }),
                  el('th', { class: 'num', text: 'Correct' }), el('th', { class: 'num', text: 'Avg' }),
                  el('th', { class: 'num', text: 'Mastery' }), el('th', {})
               ])),
               el('tbody', {}, worst.map(function (w) {
                  return el('tr', {}, [
                     el('td', { text: w.label }),
                     el('td', { class: 'num', text: String(w.n) }),
                     el('td', { class: 'num', text: d.pctOrDash(w.accuracy) }),
                     el('td', { class: 'num', text: d.ms(w.avgMs) }),
                     el('td', { class: 'num', text: String(Math.round(w.mastery)) }),
                     el('td', {}, el('button', {
                        class: 'btn btn--sm', type: 'button', text: 'Drill',
                        onclick: function () { BJ.app.go('train'); BJ.trainer.drillKey(w.key, { questions: 12, showCount: true }); }
                     }))
                  ]);
               }))
            ])
         ]));
      }
   }

   function kvPair(k, v) {
      return el('div', { class: 'kv__item' }, [
         el('span', { class: 'kv__k', text: k }),
         el('span', { class: 'kv__v', text: v })
      ]);
   }

   function upOrder(a, b) {
      var order = ['2', '3', '4', '5', '6', '7', '8', '9', '10', 'A'];
      return order.indexOf(a) - order.indexOf(b);
   }

   function breakdown(title, map, labelFn, sortFn) {
      var keys = Object.keys(map || {});
      if (!keys.length) return el('section', { class: 'panel' }, [el('h3', { text: title }), el('p', { class: 'muted', text: 'No data yet.' })]);
      keys.sort(sortFn || function (a, b) { return map[b].n - map[a].n; });
      return el('section', { class: 'panel' }, [
         el('h3', { text: title }),
         el('div', { class: 'bars' }, keys.map(function (k) {
            var v = map[k];
            var acc = v.n ? v.c / v.n : 0;
            return el('div', { class: 'bar' }, [
               el('span', { class: 'bar__label', text: labelFn ? labelFn(k) : k }),
               el('span', { class: 'bar__track' }, el('span', {
                  class: 'bar__fill' + (acc < 0.7 ? ' bar__fill--low' : acc < 0.9 ? ' bar__fill--mid' : ''),
                  style: 'width:' + Math.round(acc * 100) + '%'
               })),
               el('span', { class: 'bar__value', text: d.pctOrDash(acc) }),
               el('span', { class: 'bar__meta', text: v.n + ' \u00b7 ' + d.ms(v.t / v.n) })
            ]);
         }))
      ]);
   }

   function tablePanel() {
      var t = BJ.store.table();
      if (!t.rounds) {
         return el('section', { class: 'panel' }, [
            el('h3', { text: 'Table results' }),
            el('p', { class: 'muted', text: 'No hands played out yet. Basic strategy, perfect theory and deviations all deal full hands with real bets.' })
         ]);
      }
      var decided = t.won + t.lost + t.pushed;
      var perHand = t.hands ? t.net / t.hands : 0;
      var errPerHand = t.hands ? t.evLost / t.hands : 0;
      return el('section', { class: 'panel' }, [
         el('h3', { text: 'Table results' }),
         el('div', { class: 'statrow' }, [
            miniStat(fmt$(t.net, true), 'Net result'),
            miniStat(fmt$(perHand, true), 'Per hand'),
            miniStat(fmt$(-t.evLost, true), 'Cost of errors'),
            miniStat(fmt$(-errPerHand, true), 'Error cost per hand'),
            miniStat(String(t.rounds), 'Rounds'),
            miniStat(String(t.shoes), 'Shoes')
         ]),
         el('div', { class: 'bars' }, [
            barRow('Hands won', decided ? t.won / decided : 0, t.won + ' hands'),
            barRow('Pushed', decided ? t.pushed / decided : 0, t.pushed + ' hands'),
            barRow('Lost', decided ? t.lost / decided : 0, t.lost + ' hands'),
            barRow('Blackjacks', t.hands ? t.blackjacks / t.hands : 0, t.blackjacks + ' dealt')
         ]),
         el('p', { class: 'note', text: 'A basic-strategy player wins about 43% of hands, pushes 9% and loses 48%: the money comes from blackjacks, doubles and splits, not from winning more hands than the dealer.' })
      ]);
   }

   function barRow(label, ratio, meta) {
      return el('div', { class: 'bar' }, [
         el('span', { class: 'bar__label', text: label }),
         el('span', { class: 'bar__track' }, el('span', { class: 'bar__fill', style: 'width:' + Math.round(ratio * 100) + '%' })),
         el('span', { class: 'bar__value', text: d.pctOrDash(ratio) }),
         el('span', { class: 'bar__meta', text: meta })
      ]);
   }

   function activityPanel() {
      var daily = BJ.store.state.stats.daily;
      var days = Object.keys(daily).sort();
      var last = days.slice(-21);
      var max = 1;
      last.forEach(function (k) { max = Math.max(max, daily[k].n); });
      return el('section', { class: 'panel' }, [
         el('h3', { text: 'Activity' }),
         el('div', { class: 'activity' }, last.map(function (k) {
            var v = daily[k];
            var acc = v.n ? v.c / v.n : 0;
            return el('div', {
               class: 'activity__day', title: k + ': ' + v.n + ' decisions, ' + d.pctOrDash(acc) + ' correct'
            }, el('div', {
               class: 'activity__fill',
               style: 'height:' + Math.max(6, Math.round((v.n / max) * 100)) + '%;opacity:' + (0.35 + acc * 0.65)
            }));
         })),
         el('p', { class: 'muted', text: last.length ? 'Bar height is volume, brightness is accuracy. Last ' + last.length + ' active days.' : 'No activity recorded yet.' })
      ]);
   }

   /* ======================================================================
      Mistake journal
      ====================================================================== */

   var journalFilter = 'all';

   function renderJournal(slots) {
      var L = slots;
      var host = L.main;
      d.clear(L.left); d.clear(L.main); d.clear(L.right);
      var mistakes = BJ.store.state.mistakes;

      host.appendChild(el('header', { class: 'view__head' }, [
         el('div', {}, [
            el('h2', { text: 'Mistake journal' }),
            el('p', { class: 'muted', text: 'Every wrong answer, with the exact position it came from.' })
         ]),
         mistakes.length ? el('button', {
            class: 'btn btn--primary', type: 'button', text: 'Train these hands',
            onclick: function () {
               var keys = mistakes.slice(0, 40).map(function (m) { return m.key; })
                  .filter(function (k, i, a) { return k && BJ.catalog.get(k) && a.indexOf(k) === i; });
               if (!keys.length) return d.toast('These were counting drills — start a counting session instead.');
               BJ.app.go('train');
               BJ.trainer.start('weakness', { pool: keys, questions: Math.min(30, keys.length * 3), showCount: true });
            }
         }) : null
      ]));

      if (!mistakes.length) {
         host.appendChild(el('p', { class: 'empty', text: 'Nothing here yet. Mistakes get logged automatically with the cards, the count and the rules that applied.' }));
         L.left.appendChild(sideCard('What gets logged', [
            el('p', { class: 'muted', text: 'The exact cards, the dealer up-card, the running and true count, the rules in force, what you played and what the engine wanted.' })
         ]));
         L.right.appendChild(el('section', { class: 'panel' }, [
            el('h3', { text: 'Why keep one' }),
            el('p', { class: 'muted', text: 'Errors cluster. Four sessions from now the same three hands will be sitting at the top of this list, and those are the ones worth drilling.' })
         ]));
         return;
      }

      var modes = ['all'].concat(mistakes.map(function (m) { return m.mode; })
         .filter(function (v, i, a) { return a.indexOf(v) === i; }));
      L.left.appendChild(sideCard('Filter', [
         el('div', { class: 'segmented segmented--stack' }, modes.map(function (m) {
            return segBtn(m, m === 'all' ? 'All modes' : (BJ.trainer.MODES[m] ? BJ.trainer.MODES[m].name : m), journalFilter === m, function (v) {
               journalFilter = v; BJ.app.refreshPanel();
            });
         }))
      ]));

      var shown = mistakes.filter(function (m) { return journalFilter === 'all' || m.mode === journalFilter; });

      // what keeps coming back
      var tally = {};
      mistakes.forEach(function (m) {
         if (!m.key) return;
         tally[m.key] = tally[m.key] || { label: m.label || BJ.prettyKey(m.key), n: 0, key: m.key };
         tally[m.key].n++;
      });
      var repeats = Object.keys(tally).map(function (k) { return tally[k]; })
         .sort(function (a, b) { return b.n - a.n; }).slice(0, 6);

      L.left.appendChild(sideCard('Logged', [
         el('div', { class: 'kv' }, [
            kvPair('Entries', String(mistakes.length)),
            kvPair('Showing', String(Math.min(shown.length, 80)))
         ])
      ]));

      if (repeats.length) {
         L.right.appendChild(el('section', { class: 'panel' }, [
            el('h3', { text: 'Most repeated' }),
            el('ul', { class: 'ranked' }, repeats.map(function (r) {
               return el('li', {}, [
                  el('div', { class: 'ranked__main' }, [
                     el('span', { class: 'ranked__label', text: r.label }),
                     el('span', { class: 'ranked__meta', text: r.n + (r.n === 1 ? ' time' : ' times') })
                  ]),
                  el('button', {
                     class: 'btn btn--sm', type: 'button', text: 'Drill',
                     onclick: function () { BJ.app.go('train'); BJ.trainer.drillKey(r.key, { questions: 12, showCount: true }); }
                  })
               ]);
            })),
            el('p', { class: 'note', text: 'A hand that shows up here three or four times is not bad luck, it is a hole in the chart.' })
         ]));
      }

      var list = el('div', { class: 'journal' });
      shown.slice(0, 80).forEach(function (m) { list.appendChild(journalEntry(m)); });
      host.appendChild(list);
   }

   function journalEntry(m) {
      var cards = (m.cards || []).map(function (r) { return el('span', { class: 'minicard', text: r }); });
      var up = m.up ? el('span', { class: 'minicard minicard--dealer', text: m.up === 1 ? 'A' : String(m.up) }) : null;

      return el('article', { class: 'entry' }, [
         el('div', { class: 'entry__hand' }, cards.concat([
            el('span', { class: 'entry__vs', text: 'vs' }), up
         ])),
         el('div', { class: 'entry__body' }, [
            el('div', { class: 'entry__head' }, [
               el('b', { text: m.label || BJ.prettyKey(m.key || '') }),
               el('span', { class: 'muted', text: d.ago(m.ts) })
            ]),
            el('p', { class: 'entry__answer' }, [
               el('span', { class: 'tag tag--bad', text: 'you ' + label(m.action) }),
               el('span', { class: 'tag tag--good', text: 'correct ' + label(m.correctAction) }),
               m.basicAction && m.basicAction !== m.correctAction ? el('span', { class: 'tag', text: 'basic ' + label(m.basicAction) }) : null,
               m.deviation ? el('span', { class: 'tag tag--dev', text: 'index play' }) : null
            ]),
            m.why ? el('p', { class: 'entry__why', text: m.why }) : null,
            m.costMoney > 0.005 ? el('p', { class: 'entry__cost', text: 'Cost ' + fmt$(-m.costMoney, true) + ' in expectation' }) : null,
            el('p', {
               class: 'entry__meta muted', text: [
                  m.tc !== null && m.tc !== undefined ? 'true ' + BJ.signed(m.tc, 0) + ' / running ' + BJ.signed(m.rc, 0) : null,
                  'difficulty ' + (m.difficulty || '?'),
                  d.ms(m.timeMs),
                  m.rules
               ].filter(Boolean).join('  \u00b7  ')
            })
         ]),
         el('div', { class: 'entry__actions' }, [
            m.key ? el('button', {
               class: 'btn btn--sm', type: 'button', text: 'Drill',
               onclick: function () { BJ.app.go('train'); BJ.trainer.drillKey(m.key, { questions: 10, showCount: true }); }
            }) : null,
            el('button', {
               class: 'btn btn--sm btn--quiet', type: 'button', text: 'Clear',
               onclick: function () { BJ.store.clearMistake(m.id); BJ.app.refreshPanel(); }
            })
         ])
      ]);
   }

   function label(a) {
      if (a === 'timeout') return 'ran out of time';
      if (typeof a === 'number' || /^-?\d+(\.\d+)?$/.test(String(a))) return String(a);
      return (BJ.strategy.ACTION_LABEL[a] || a || '\u2014').toLowerCase();
   }

   /* ======================================================================
      Settings
      ====================================================================== */

   function renderSettings(slots) {
      var L = slots;
      var host = L.main;
      d.clear(L.left); d.clear(L.main); d.clear(L.right);
      var s = BJ.store.settings();
      var r = s.rules;

      L.left.appendChild(sideCard('Current game', [
         el('p', { class: 'rules-now', text: BJ.ruleSummary(r) }),
         el('div', { class: 'kv' }, [
            kvPair('Decks', String(r.decks)),
            kvPair('Soft 17', r.hitSoft17 ? 'Hits' : 'Stands'),
            kvPair('Blackjack', r.blackjackPayout === 1.5 ? '3:2' : r.blackjackPayout === 1.2 ? '6:5' : '1:1'),
            kvPair('Surrender', r.lateSurrender ? 'Late' : 'None'),
            kvPair('DAS', r.das ? 'Yes' : 'No'),
            kvPair('Bankroll', fmt$(BJ.store.table().bankroll))
         ]),
         el('p', { class: 'note', text: 'Everything here feeds the strategy engine, the charts and the expected values at the same time.' })
      ]));

      L.left.appendChild(sideCard('Keyboard', [
         el('ul', { class: 'list list--key' }, [
            ['H', 'Hit'], ['S', 'Stand'], ['D', 'Double'], ['P', 'Split'], ['R', 'Surrender'],
            ['Y / N', 'Insurance'], ['1\u20135', 'Chips or answers'], ['Enter', 'Deal or continue'], ['Esc', 'End session']
         ].map(function (row) {
            return el('li', {}, [el('b', { text: row[0] }), el('span', { class: 'muted', text: row[1] })]);
         }))
      ]));

      host.appendChild(el('header', { class: 'view__head' }, [
         el('div', {}, [
            el('h2', { text: 'Settings' }),
            el('p', { class: 'muted', text: 'Rules feed straight into the strategy engine, the charts and the expected values.' })
         ])
      ]));

      host.appendChild(el('section', { class: 'panel' }, [
         el('h3', { text: 'Table rules' }),
         el('div', { class: 'settings-grid' }, [
            selectField('Decks', 'set-decks', [[1, 'Single deck'], [2, 'Double deck'], [4, '4 decks'], [6, '6 decks'], [8, '8 decks']], r.decks, function (v) { setRule('decks', Number(v)); }),
            selectField('Dealer on soft 17', 'set-s17', [['stand', 'Stands (S17)'], ['hit', 'Hits (H17)']], r.hitSoft17 ? 'hit' : 'stand', function (v) { setRule('hitSoft17', v === 'hit'); }),
            selectField('Blackjack pays', 'set-pay', [[1.5, '3:2'], [1.2, '6:5'], [1, '1:1']], r.blackjackPayout, function (v) { setRule('blackjackPayout', Number(v)); }),
            selectField('Doubling', 'set-double', [['any', 'Any two cards'], ['9-11', '9 to 11 only'], ['10-11', '10 and 11 only']], r.doubleOn, function (v) { setRule('doubleOn', v); }),
            selectField('Max splits', 'set-splits', [[1, '2 hands'], [2, '3 hands'], [3, '4 hands']], r.maxSplits, function (v) { setRule('maxSplits', Number(v)); }),
            selectField('Penetration', 'set-pen', [[0.5, '50%'], [0.66, '66%'], [0.75, '75%'], [0.85, '85%']], r.penetration, function (v) { setRule('penetration', Number(v)); })
         ]),
         el('div', { class: 'switches' }, [
            switchField('Double after split', r.das, function (v) { setRule('das', v); }),
            switchField('Late surrender', r.lateSurrender, function (v) { setRule('lateSurrender', v); }),
            switchField('Resplit aces', r.resplitAces, function (v) { setRule('resplitAces', v); }),
            switchField('Hit split aces', r.hitSplitAces, function (v) { setRule('hitSplitAces', v); }),
            switchField('Dealer peeks for blackjack', r.peek, function (v) { setRule('peek', v); })
         ]),
         el('p', { class: 'muted', text: 'Current set: ' + BJ.ruleSummary(r) })
      ]));

      var t = s.table;
      var money = BJ.store.table();
      host.appendChild(el('section', { class: 'panel' }, [
         el('h3', { text: 'Table and bankroll' }),
         el('div', { class: 'settings-grid' }, [
            selectField('Bet unit', 'set-unit', [[5, '$5'], [10, '$10'], [25, '$25'], [50, '$50'], [100, '$100']], t.unit, function (v) { setTable('unit', Number(v)); }),
            selectField('Table minimum', 'set-min', [[5, '$5'], [10, '$10'], [25, '$25'], [50, '$50'], [100, '$100']], t.min, function (v) { setTable('min', Number(v)); }),
            selectField('Table maximum', 'set-max', [[100, '$100'], [500, '$500'], [1000, '$1,000'], [5000, '$5,000']], t.max, function (v) { setTable('max', Number(v)); }),
            selectField('Bet spread', 'set-spread', [[2, '1 to 2'], [4, '1 to 4'], [8, '1 to 8'], [12, '1 to 12'], [20, '1 to 20']], t.spread, function (v) { setTable('spread', Number(v)); }),
            selectField('Starting bankroll', 'set-bankroll', [[500, '$500'], [1000, '$1,000'], [2500, '$2,500'], [10000, '$10,000']], t.startingBankroll, function (v) { setTable('startingBankroll', Number(v)); })
         ]),
         el('div', { class: 'switches' }, [
            switchField('Play hands out with bets', t.playOut !== false, function (v) { setTable('playOut', v); })
         ]),
         el('p', { class: 'muted', text: 'Current bankroll ' + fmt$(money.bankroll) + '. Switching hands off turns every mode into rapid single decisions.' }),
         el('div', { class: 'row-actions' }, [
            el('button', {
               class: 'btn', type: 'button', text: 'Reset bankroll to ' + fmt$(t.startingBankroll),
               onclick: function () { BJ.store.reset('bankroll'); d.toast('Bankroll reset'); BJ.app.refreshPanel(); BJ.bus.emit('data-reset'); }
            })
         ])
      ]));

      var sys = BJ.system(s.system);
      host.appendChild(el('section', { class: 'panel' }, [
         el('h3', { text: 'Counting' }),
         el('div', { class: 'settings-grid' }, [
            selectField('System', 'set-system', Object.keys(BJ.SYSTEMS).map(function (k) {
               return [k, BJ.SYSTEMS[k].name];
            }), s.system, function (v) { setSetting('system', v); }),
            selectField('True count rounding', 'set-round', [['floor', 'Round down (safest)'], ['half', 'Nearest half'], ['exact', 'Exact']], s.tcRounding, function (v) { setSetting('tcRounding', v); })
         ]),
         el('p', { class: 'muted', text: sys.note }),
         el('div', { class: 'tagrow' }, [1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map(function (slot) {
            var t = sys.tags[slot];
            return el('span', { class: 'tagcard' }, [
               el('b', { text: slot === 1 ? 'A' : slot === 10 ? '10-K' : String(slot) }),
               el('span', { class: t > 0 ? 'pos' : t < 0 ? 'neg' : 'zero', text: BJ.signed(t, 0) })
            ]);
         })),
         !sys.indexes ? el('p', { class: 'callout', text: 'Index numbers are bundled for Hi-Lo only, so deviation training uses Hi-Lo. Counting drills work with every system here.' }) : null
      ]));

      host.appendChild(el('section', { class: 'panel' }, [
         el('h3', { text: 'Training' }),
         el('div', { class: 'switches' }, [
            switchField('Move to the next drill question automatically', s.autoAdvance, function (v) { setSetting('autoAdvance', v); }),
            switchField('Show the count during perfect theory', s.showCount, function (v) { setSetting('showCount', v); }),
            switchField('Keyboard shortcuts', s.keyboard, function (v) { setSetting('keyboard', v); }),
            switchField('Sound', s.sound, function (v) { setSetting('sound', v); })
         ]),
         el('div', { class: 'settings-grid' }, [
            selectField('Decision time target', 'set-target', [[2000, '2 seconds'], [3500, '3.5 seconds'], [5000, '5 seconds'], [8000, '8 seconds']], s.decisionTarget, function (v) { setSetting('decisionTarget', Number(v)); }),
            selectField('Appearance', 'set-theme', [['dark', 'Dark'], ['light', 'Light']], s.theme, function (v) { setSetting('theme', v); document.documentElement.dataset.theme = v; })
         ])
      ]));

      host.appendChild(el('section', { class: 'panel' }, [
         el('h3', { text: 'Card artwork' }),
         el('div', { class: 'switches' }, [
            switchField('Draw cards with artwork', s.cardArt !== false, function (v) {
               setSetting('cardArt', v);
               BJ.trainer.render();
            })
         ]),
         el('p', {
            class: 'muted', text: BJ.deck.count()
               ? BJ.deck.count() + ' of your own faces are in use, over the bundled pack.'
               : 'Using the bundled pack. You can drop in your own faces below.'
         }),
         el('div', { class: 'row-actions' }, [
            el('label', { class: 'btn', text: 'UPLOAD SVG FACES' }, [
               el('input', {
                  type: 'file', accept: '.svg,image/svg+xml', multiple: true,
                  onchange: function (e) { uploadFaces(e.currentTarget.files); }
               })
            ]),
            BJ.deck.count() ? el('button', {
               class: 'btn btn--danger', type: 'button', text: 'RESET TO BUNDLED',
               onclick: function () {
                  if (!window.confirm('Remove your uploaded faces?')) return;
                  BJ.deck.clear();
                  BJ.trainer.render();
                  d.toast('Back to the bundled pack');
                  BJ.app.refreshPanel();
               }
            }) : null
         ]),
         el('p', { class: 'note', text: 'One SVG per face, named by rank and suit: AS.svg, 10H.svg, TD.svg, ace_of_spades.svg all work, and back.svg replaces the face-down card. Anything you do not supply falls back to the bundled pack.' })
      ]));

      L.right.appendChild(el('section', { class: 'panel' }, [
         el('h3', { text: 'Your data' }),
         el('p', { class: 'muted', text: 'Everything is stored in this browser only. No account, no server, nothing leaves the device.' }),
         el('div', { class: 'row-actions' }, [
            el('button', { class: 'btn', type: 'button', text: 'Download a backup', onclick: exportData }),
            el('label', { class: 'btn' }, [
               'Restore from a backup',
               el('input', { type: 'file', accept: 'application/json', hidden: true, onchange: importData })
            ])
         ]),
         el('div', { class: 'row-actions' }, [
            dangerButton('Clear the mistake journal', 'mistakes'),
            dangerButton('Clear session history', 'sessions'),
            dangerButton('Reset bankroll', 'bankroll'),
            dangerButton('Reset all progress', 'progress'),
            dangerButton('Reset everything', 'all')
         ]),
         !BJ.store.isAvailable() ? el('p', { class: 'callout', text: 'This browser is blocking local storage, so progress will not survive a refresh. Private browsing usually causes this.' }) : null
      ]));

      L.right.appendChild(el('section', { class: 'panel panel--about' }, [
         el('h3', { text: 'About the numbers' }),
         el('p', { text: 'Strategy comes from a rules-aware engine rather than a stored picture of a chart, so the tables above are recomputed whenever you change a rule.' }),
         el('p', { text: 'Expected values are computed from the exact remaining shoe: dealer outcome distributions are exact for the model, while probabilities are held fixed for the rest of the hand and split EV assumes a single split. Values are labelled as model estimates wherever they appear.' }),
         el('p', { text: 'Index numbers are the published Hi-Lo Illustrious 18 and Fab 4 set, applied only where the rules make them meaningful.' }),
         el('p', { text: 'Money is a training aid, not a game: there is no wagering, no purchase and no cash out. The bankroll exists so that bet sizing, spread and risk of ruin can be practised, and it resets whenever you want.' })
      ]));
   }

   function setRule(k, v) {
      BJ.store.settings().rules[k] = v;
      BJ.store.settings().rules = BJ.normaliseRules(BJ.store.settings().rules);
      BJ.store.save(true);
      d.toast('Rules updated');
      BJ.app.refreshPanel();
      BJ.bus.emit('rules-changed');
   }

   function uploadFaces(files) {
      BJ.deck.importFiles(files, function (report) {
         if (report.tooBig) return d.toast('That deck is too large to store', 'bad');
         if (!report.saved) return d.toast('This browser would not save the deck', 'bad');
         var msg = report.added + (report.added === 1 ? ' face' : ' faces') + ' loaded';
         if (report.skipped.length) msg += ' \u00b7 ' + report.skipped.length + ' not recognised';
         d.toast(msg, report.added ? '' : 'bad');
         BJ.trainer.render();
         BJ.app.refreshPanel();
      });
   }

   function setTable(k, v) {
      var t = BJ.store.settings().table;
      t[k] = v;
      if (t.min > t.max) t.min = t.max;
      if (t.unit < t.min) t.unit = t.min;
      if (t.unit > t.max) t.unit = t.max;
      BJ.store.save(true);
      d.toast('Table updated');
      BJ.app.refreshPanel();
   }

   function setSetting(k, v) {
      BJ.store.settings()[k] = v;
      BJ.store.save(true);
      if (k === 'system') { BJ.app.refreshPanel(); }
   }

   function selectField(label, id, options, value, onChange) {
      return el('label', { class: 'field' }, [
         el('span', { class: 'field__label', text: label }),
         el('select', {
            id: id, onchange: function (e) { onChange(e.currentTarget.value); }
         }, options.map(function (o) {
            return el('option', { value: String(o[0]), text: o[1], selected: String(o[0]) === String(value) });
         }))
      ]);
   }

   function switchField(label, on, onChange) {
      return el('label', { class: 'switch' }, [
         el('input', { type: 'checkbox', checked: !!on, onchange: function (e) { onChange(e.currentTarget.checked); } }),
         el('span', { class: 'switch__track' }),
         el('span', { class: 'switch__label', text: label })
      ]);
   }

   function dangerButton(label, scope) {
      return el('button', {
         class: 'btn btn--danger', type: 'button', text: label,
         onclick: function () {
            if (!window.confirm(label + '? This cannot be undone.')) return;
            BJ.store.reset(scope);
            d.toast('Done');
            BJ.app.refreshPanel();
            BJ.bus.emit('data-reset');
         }
      });
   }

   function exportData() {
      var blob = new Blob([BJ.store.exportJSON()], { type: 'application/json' });
      var url = URL.createObjectURL(blob);
      var a = el('a', { href: url, download: 'blackjack-trainer-' + BJ.store.today() + '.json' });
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
      d.toast('Backup downloaded');
   }

   function importData(e) {
      var file = e.currentTarget.files && e.currentTarget.files[0];
      if (!file) return;
      var reader = new FileReader();
      reader.onload = function () {
         try {
            BJ.store.importJSON(String(reader.result));
            d.toast('Progress restored');
            document.documentElement.dataset.theme = BJ.store.settings().theme;
            BJ.app.refreshPanel();
            BJ.bus.emit('data-reset');
         } catch (err) {
            d.toast('That file could not be read as a trainer backup.', 'bad');
         }
      };
      reader.readAsText(file);
   }

   BJ.views = {
      dashboard: renderDashboard,
      matrix: renderMatrix,
      analytics: renderAnalytics,
      journal: renderJournal,
      settings: renderSettings,
      drawMatrix: drawMatrix
   };

})(window.BJ = window.BJ || {});
