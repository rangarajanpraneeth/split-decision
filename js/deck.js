/* ==========================================================================
   deck.js — which artwork a card is drawn with.

   Three sources, in order: faces the player has uploaded, the bundled pack,
   then a typographic fallback that needs no artwork at all. Uploads are kept
   in their own localStorage key so a full deck cannot push training progress
   out of the quota.
   ========================================================================== */
(function (BJ) {
   'use strict';

   var KEY = 'bjpt.deck.v1';
   var LIMIT = 1400000;               // ~1.4MB of markup, well inside a 5MB quota
   var custom = null;
   var revision = 0;

   var RANK_LETTER = {
      'A': 'A', '2': '2', '3': '3', '4': '4', '5': '5', '6': '6',
      '7': '7', '8': '8', '9': '9', '10': 'T', 'J': 'J', 'Q': 'Q', 'K': 'K'
   };

   var WORD_RANK = {
      ace: 'A', two: '2', three: '3', four: '4', five: '5', six: '6', seven: '7',
      eight: '8', nine: '9', ten: 'T', jack: 'J', queen: 'Q', king: 'K'
   };
   var WORD_SUIT = { spade: 'S', spades: 'S', heart: 'H', hearts: 'H', diamond: 'D', diamonds: 'D', club: 'C', clubs: 'C' };

   function load() {
      if (custom) return custom;
      custom = {};
      try {
         var raw = localStorage.getItem(KEY);
         if (raw) custom = JSON.parse(raw) || {};
      } catch (e) { custom = {}; }
      return custom;
   }

   function save() {
      try {
         localStorage.setItem(KEY, JSON.stringify(custom || {}));
         return true;
      } catch (e) {
         return false;
      }
   }

   function key(card) {
      if (!card) return null;
      var r = RANK_LETTER[card.rank];
      return r && card.suit ? r + card.suit : null;
   }

   /**
    * Work out which card a file is meant to be. Accepts the common schemes:
    * AS.svg, 10h.svg, ace_of_spades.svg, king-of-hearts.svg, back.svg.
    */
   function keyFromFilename(name) {
      var stem = String(name).replace(/\.[a-z]+$/i, '').trim();
      var flat = stem.toUpperCase().replace(/[^A-Z0-9]/g, '');

      if (/^(BACK|CARDBACK|1B|2B)$/.test(flat)) return 'BACK';

      var short = flat.match(/^(10|[A23456789TJQK])([CDHS])$/);
      if (short) return (short[1] === '10' ? 'T' : short[1]) + short[2];

      var reversed = flat.match(/^([CDHS])(10|[A23456789TJQK])$/);
      if (reversed) return (reversed[2] === '10' ? 'T' : reversed[2]) + reversed[1];

      var words = stem.toLowerCase().match(/^([a-z0-9]+)[_\- ]*(?:of[_\- ]*)?([a-z]+)$/);
      if (words) {
         var r = WORD_RANK[words[1]] || (/^(10|[2-9])$/.test(words[1]) ? (words[1] === '10' ? 'T' : words[1]) : null);
         var s = WORD_SUIT[words[2]];
         if (r && s) return r + s;
      }
      return null;
   }

   /** Markup for a face, or null when there is nothing to draw with. */
   function art(cardKey) {
      if (!cardKey) return null;
      var mine = load();
      if (mine[cardKey]) return mine[cardKey];
      return (BJ.cardArt && BJ.cardArt[cardKey]) || null;
   }

   function artFor(card, facedown) {
      return art(facedown ? 'BACK' : key(card));
   }

   /**
    * Take a set of uploaded files. Returns a report rather than throwing, so
    * the interface can say exactly which files were not understood.
    */
   function importFiles(files, done) {
      var list = Array.prototype.slice.call(files || []);
      var report = { added: 0, skipped: [], tooBig: false, saved: true };
      if (!list.length) return done(report);

      var pending = list.length;
      var staged = {};

      list.forEach(function (file) {
         var cardKey = keyFromFilename(file.name);
         if (!cardKey) {
            report.skipped.push(file.name);
            if (--pending === 0) finish();
            return;
         }
         var reader = new FileReader();
         reader.onload = function () {
            var text = String(reader.result || '');
            if (text.indexOf('<svg') === -1) report.skipped.push(file.name);
            else staged[cardKey] = clean(text);
            if (--pending === 0) finish();
         };
         reader.onerror = function () {
            report.skipped.push(file.name);
            if (--pending === 0) finish();
         };
         reader.readAsText(file);
      });

      function finish() {
         var mine = load();
         var merged = {};
         var k;
         for (k in mine) if (mine.hasOwnProperty(k)) merged[k] = mine[k];
         for (k in staged) if (staged.hasOwnProperty(k)) merged[k] = staged[k];

         var size = 0;
         for (k in merged) if (merged.hasOwnProperty(k)) size += merged[k].length;
         if (size > LIMIT) {
            report.tooBig = true;
            return done(report);
         }

         custom = merged;
         revision++;
         if (BJ.dom && BJ.dom.clearCardCache) BJ.dom.clearCardCache();
         report.added = Object.keys(staged).length;
         report.saved = save();
         done(report);
      }
   }

   /** Strip the parts of an uploaded file that would fight with the page. */
   function clean(text) {
      var svg = text.replace(/<\?xml[^>]*\?>/gi, '')
         .replace(/<!DOCTYPE[^>]*>/gi, '')
         .replace(/<!--[\s\S]*?-->/g, '')
         .replace(/<script[\s\S]*?<\/script>/gi, '')
         .replace(/\son\w+="[^"]*"/gi, '')
         .trim();
      var open = svg.indexOf('<svg');
      if (open > 0) svg = svg.slice(open);
      var head = svg.slice(0, svg.indexOf('>') + 1);
      var rest = svg.slice(svg.indexOf('>') + 1);
      head = head.replace(/\s(width|height)="[^"]*"/gi, '').replace(/class="card"/gi, 'class="cardart"');
      return head + rest;
   }

   function clear() {
      custom = {};
      revision++;
      if (BJ.dom && BJ.dom.clearCardCache) BJ.dom.clearCardCache();
      try { localStorage.removeItem(KEY); } catch (e) { }
   }

   function count() {
      var mine = load();
      return Object.keys(mine).length;
   }

   function bundledCount() {
      return BJ.cardArt ? Object.keys(BJ.cardArt).length : 0;
   }

   /** Which faces are still missing, so the interface can say so plainly. */
   function missing() {
      var out = [];
      var ranks = ['A', '2', '3', '4', '5', '6', '7', '8', '9', 'T', 'J', 'Q', 'K'];
      var suits = ['S', 'H', 'D', 'C'];
      for (var i = 0; i < ranks.length; i++) {
         for (var j = 0; j < suits.length; j++) {
            if (!art(ranks[i] + suits[j])) out.push(ranks[i] + suits[j]);
         }
      }
      if (!art('BACK')) out.push('BACK');
      return out;
   }

   BJ.deck = {
      key: key,
      revision: function () { return revision; },
      art: art,
      artFor: artFor,
      keyFromFilename: keyFromFilename,
      importFiles: importFiles,
      clear: clear,
      count: count,
      bundledCount: bundledCount,
      missing: missing,
      clean: clean
   };

})(window.BJ = window.BJ || {});
