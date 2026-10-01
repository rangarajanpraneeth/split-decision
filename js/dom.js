/* ==========================================================================
   dom.js — minimal helpers. No framework, no dependencies.
   ========================================================================== */
(function (BJ) {
   'use strict';

   function qs(sel, root) { return (root || document).querySelector(sel); }
   function qsa(sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); }

   function el(tag, attrs, children) {
      var node = document.createElement(tag);
      if (attrs) {
         for (var k in attrs) if (attrs.hasOwnProperty(k)) {
            var v = attrs[k];
            if (v === null || v === undefined || v === false) continue;
            if (k === 'class') node.className = v;
            else if (k === 'html') node.innerHTML = v;
            else if (k === 'text') node.textContent = v;
            else if (k === 'dataset') { for (var d in v) if (v.hasOwnProperty(d)) node.dataset[d] = v[d]; }
            else if (k.slice(0, 2) === 'on' && typeof v === 'function') node.addEventListener(k.slice(2), v);
            else if (v === true) node.setAttribute(k, '');
            else node.setAttribute(k, v);
         }
      }
      append(node, children);
      return node;
   }

   function append(node, children) {
      if (children === null || children === undefined) return node;
      if (!Array.isArray(children)) children = [children];
      for (var i = 0; i < children.length; i++) {
         var c = children[i];
         if (c === null || c === undefined || c === false) continue;
         node.appendChild(typeof c === 'object' && c.nodeType ? c : document.createTextNode(String(c)));
      }
      return node;
   }

   function clear(node) { while (node && node.firstChild) node.removeChild(node.firstChild); return node; }

   function on(node, evt, fn, opts) { node.addEventListener(evt, fn, opts); return node; }

   function delegate(root, evt, sel, fn) {
      root.addEventListener(evt, function (e) {
         var t = e.target.closest(sel);
         if (t && root.contains(t)) fn(e, t);
      });
   }

   /* ---------- formatting ---------- */

   function ms(v) {
      if (v === null || v === undefined || isNaN(v)) return '\u2014';
      if (v < 1000) return Math.round(v) + 'ms';
      return (v / 1000).toFixed(v < 10000 ? 2 : 1) + 's';
   }

   function pctOrDash(v, dp) {
      if (v === null || v === undefined || isNaN(v)) return '\u2014';
      return (v * 100).toFixed(dp === undefined ? 0 : dp) + '%';
   }

   function ago(ts) {
      var d = Date.now() - ts;
      if (d < 60000) return 'just now';
      if (d < 3600000) return Math.floor(d / 60000) + 'm ago';
      if (d < 86400000) return Math.floor(d / 3600000) + 'h ago';
      var days = Math.floor(d / 86400000);
      if (days < 30) return days + 'd ago';
      return new Date(ts).toLocaleDateString();
   }

   function dateTime(ts) {
      var d = new Date(ts);
      return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) + ' ' +
         d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
   }

   /* ---------- card tiles ---------- */

   var RED = { H: true, D: true };

   var SUIT_NAME = { S: 'spades', H: 'hearts', D: 'diamonds', C: 'clubs' };

   /**
    * Card markup is parsed once per face and cloned after that. Re-parsing a
    * kilobyte of SVG for every card of every hand is the kind of cost that
    * turns a keystroke into a visible pause.
    */
   var artCache = {};
   function artNode(key, markup) {
      var cached = artCache[key];
      if (!cached) {
         var holder = document.createElement('div');
         holder.innerHTML = markup;
         cached = artCache[key] = holder.firstChild;
         if (!cached) return null;
      }
      return cached.cloneNode(true);
   }

   function clearCardCache() { artCache = {}; }

   function cardTile(card, opts) {
      opts = opts || {};
      var label = opts.facedown ? 'Face-down card'
         : card.rank + ' of ' + (SUIT_NAME[card.suit] || card.suit);

      var wantsArt = !BJ.store || BJ.store.settings().cardArt !== false;
      if (wantsArt && BJ.deck) {
         var artKey = opts.facedown ? 'BACK' : BJ.deck.key(card);
         var art = BJ.deck.art(artKey);
         if (art) {
            var face = artNode(BJ.deck.revision() + ':' + artKey, art);
            if (face) {
               var node = el('div', {
                  class: 'card card--art' + (opts.small ? ' card--sm' : '') + (opts.facedown ? ' card--down' : ''),
                  role: 'img', 'aria-label': label
               });
               node.appendChild(face);
               return node;
            }
         }
      }

      if (opts.facedown) {
         return el('div', { class: 'card card--down' + (opts.small ? ' card--sm' : ''), 'aria-label': label },
            el('span', { class: 'card__back' }));
      }
      var cls = 'card' + (RED[card.suit] ? ' card--red' : '') + (opts.small ? ' card--sm' : '');
      return el('div', { class: cls, 'aria-label': label },
         [el('span', { class: 'card__rank', text: card.rank }),
         el('span', { class: 'card__suit', text: BJ.SUIT_GLYPH[card.suit] })]);
   }

   /* ---------- sound ---------- */

   var audioCtx = null;
   function beep(kind) {
      if (!BJ.store || !BJ.store.settings().sound) return;
      try {
         if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
         var t = audioCtx.currentTime;
         var osc = audioCtx.createOscillator();
         var gain = audioCtx.createGain();
         osc.connect(gain); gain.connect(audioCtx.destination);
         var f = kind === 'ok' ? 720 : kind === 'bad' ? 190 : 520;
         osc.frequency.setValueAtTime(f, t);
         if (kind === 'ok') osc.frequency.exponentialRampToValueAtTime(f * 1.5, t + 0.09);
         gain.gain.setValueAtTime(0.0001, t);
         gain.gain.exponentialRampToValueAtTime(0.09, t + 0.01);
         gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.16);
         osc.start(t); osc.stop(t + 0.18);
      } catch (e) { /* audio is a nicety, never a failure */ }
   }

   /* ---------- toast ---------- */

   var toastTimer = null;
   function toast(message, kind) {
      var host = qs('#toast');
      if (!host) return;
      host.textContent = message;
      host.className = 'toast toast--show' + (kind ? ' toast--' + kind : '');
      clearTimeout(toastTimer);
      toastTimer = setTimeout(function () { host.className = 'toast'; }, 2600);
   }

   /* ---------- tiny event bus ---------- */

   var handlers = {};
   var bus = {
      on: function (evt, fn) { (handlers[evt] = handlers[evt] || []).push(fn); },
      emit: function (evt, data) {
         (handlers[evt] || []).forEach(function (fn) { try { fn(data); } catch (e) { console.error(e); } });
      }
   };

   /* ---------- sparkline ---------- */

   function sparkline(values, opts) {
      opts = opts || {};
      var w = opts.width || 240, h = opts.height || 46, pad = 3;
      var svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      svg.setAttribute('viewBox', '0 0 ' + w + ' ' + h);
      svg.setAttribute('class', 'spark ' + (opts.class || ''));
      svg.setAttribute('preserveAspectRatio', 'none');
      svg.setAttribute('role', 'img');
      svg.setAttribute('aria-label', opts.label || 'trend');
      if (!values || values.length < 2) return svg;
      var min = opts.min !== undefined ? opts.min : Math.min.apply(null, values);
      var max = opts.max !== undefined ? opts.max : Math.max.apply(null, values);
      if (max - min < 1e-9) { max = min + 1; }
      var step = (w - pad * 2) / (values.length - 1);
      var pts = values.map(function (v, i) {
         var x = pad + i * step;
         var y = h - pad - ((v - min) / (max - min)) * (h - pad * 2);
         return x.toFixed(1) + ',' + y.toFixed(1);
      });
      var area = document.createElementNS('http://www.w3.org/2000/svg', 'polygon');
      area.setAttribute('points', pad + ',' + (h - pad) + ' ' + pts.join(' ') + ' ' + (w - pad) + ',' + (h - pad));
      area.setAttribute('class', 'spark__area');
      var line = document.createElementNS('http://www.w3.org/2000/svg', 'polyline');
      line.setAttribute('points', pts.join(' '));
      line.setAttribute('class', 'spark__line');
      svg.appendChild(area);
      svg.appendChild(line);
      return svg;
   }

   BJ.dom = {
      qs: qs, qsa: qsa, el: el, append: append, clear: clear, on: on, delegate: delegate,
      ms: ms, pctOrDash: pctOrDash, ago: ago, dateTime: dateTime,
      cardTile: cardTile,
      clearCardCache: clearCardCache, beep: beep, toast: toast, sparkline: sparkline
   };
   BJ.bus = bus;

})(window.BJ = window.BJ || {});
