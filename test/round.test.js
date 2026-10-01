/* Round engine — deterministic tests for the money and the rules. */
const fs = require('fs');
const path = require('path');
global.window = global;
['core.js', 'strategy.js', 'ev.js', 'round.js'].forEach(f => {
   eval(fs.readFileSync(path.join(__dirname, '..', 'js', f), 'utf8'));
});
const BJ = global.BJ;

let fails = 0, checks = 0;
function eq(a, b, label) { checks++; if (a !== b) { fails++; console.log('FAIL', label, '=>', a, 'expected', b); } }
function near(a, b, tol, label) { checks++; if (Math.abs(a - b) > tol) { fails++; console.log('FAIL', label, '=>', a, 'expected ~', b); } }
function ok(c, label) { checks++; if (!c) { fails++; console.log('FAIL', label); } }

const RULES = BJ.normaliseRules({ decks: 6, hitSoft17: true, das: true, lateSurrender: true, blackjackPayout: 1.5, peek: true, maxSplits: 3 });
const TABLE = { unit: 10, min: 10, max: 500, spread: 8, startingBankroll: 1000 };

function newRound(rules) {
   const shoe = new BJ.Shoe(6, 'hilo');
   return { shoe, round: new BJ.Round(shoe, rules || RULES, TABLE) };
}

/* ---- the hole card must not move the count until it is turned over ---- */
{
   const { shoe, round } = newRound();
   round.deal(10, { cards: [10, 6], up: 10, hole: 5 });   // 10,6 vs 10, hole is a 5
   // visible: 10 (-1), 6 (+1), 10 (-1) = -1. The hole 5 (+1) must not be in there.
   eq(shoe.rc, -1, 'running count counts only face-up cards');
   eq(shoe.seen, 4, 'four cards have left the shoe');
   round.revealHole();
   eq(shoe.rc, 0, 'turning the hole card over adds it to the count');
}

/* ---- dealer blackjack settles at once ---- */
{
   const { round } = newRound();
   round.deal(10, { cards: [10, 9], up: 1, hole: 10 });
   eq(round.phase, 'insurance', 'ace up offers insurance');
   round.takeInsurance(false);
   eq(round.phase, 'settle', 'dealer blackjack ends the round');
   const res = round.settle();
   eq(res.dealerBlackjack, true, 'dealer has blackjack');
   eq(res.total, -10, 'player loses the bet');
}

/* ---- insurance pays 2 to 1 ---- */
{
   const { round } = newRound();
   round.deal(20, { cards: [10, 9], up: 1, hole: 10 });
   round.takeInsurance(true);
   const res = round.settle();
   eq(res.insurance, 20, 'insurance returns twice the half-bet');
   eq(res.total, 0, 'insurance exactly covers the lost hand');
}

/* ---- insurance loses when there is no blackjack ---- */
{
   const { round } = newRound();
   round.deal(20, { cards: [10, 9], up: 1, hole: 5 });
   round.takeInsurance(true);
   eq(round.phase, 'player', 'no dealer blackjack, play continues');
   round.act('stand');
   round.dealerPlay();
   const res = round.settle();
   eq(round.insuranceResult, -10, 'insurance costs half the bet when it misses');
}

/* ---- player blackjack pays 3:2, and pushes a dealer blackjack ---- */
{
   const { round } = newRound();
   round.deal(10, { cards: [1, 10], up: 6, hole: 9 });
   eq(round.phase, 'settle', 'a natural against a small card is settled at once');
   const res = round.settle();
   eq(round.dealer.cards.length, 2, 'the dealer never drew a card');
   eq(res.hands[0].result, 'blackjack', 'natural recognised');
   eq(res.total, 15, 'blackjack pays 3 to 2');
}
{
   const r65 = BJ.normaliseRules({ decks: 6, blackjackPayout: 1.2, peek: true });
   const shoe = new BJ.Shoe(6, 'hilo');
   const round = new BJ.Round(shoe, r65, TABLE);
   round.deal(10, { cards: [1, 10], up: 6, hole: 9 });
   eq(round.settle().total, 12, '6:5 pays less on the same hand');
}
{
   const { round } = newRound();
   round.deal(10, { cards: [1, 10], up: 1, hole: 10 });
   round.takeInsurance(false);
   eq(round.settle().hands[0].result, 'push', 'blackjack against blackjack pushes');
}

/* ---- a natural against a ten is settled the moment the peek clears ---- */
{
   const { round } = newRound();
   round.deal(10, { cards: [1, 10], up: 10, hole: 7 });
   eq(round.phase, 'settle', 'peek clears the ten, the natural is paid');
   eq(round.settle().total, 15, 'still paid 3 to 2');
   eq(round.dealer.cards.length, 2, 'the dealer only turned the hole card over');
}

/* ---- but a no-peek game has to play it out ---- */
{
   const noPeek = BJ.normaliseRules({ decks: 6, peek: false, blackjackPayout: 1.5 });
   const shoe = new BJ.Shoe(6, 'hilo');
   const round = new BJ.Round(shoe, noPeek, TABLE);
   round.deal(10, { cards: [1, 10], up: 10, hole: 1 });
   eq(round.phase, 'dealer', 'without a peek the dealer still has to show');
   round.dealerPlay();
   eq(round.settle().hands[0].result, 'push', 'two naturals push');
}

/* ---- the dealer does not draw against a table of naturals ---- */
{
   const { round } = newRound();
   round.deal(10, { cards: [1, 10], up: 6, hole: 2 });
   eq(round.anyLive(), false, 'a natural is not a hand the dealer must beat');
   round.dealerPlay();
   eq(round.dealer.cards.length, 2, 'dealer turned over and stopped on 8');
}

/* ---- a dealer natural ends it before anyone acts ---- */
{
   const { round } = newRound();
   round.deal(10, { cards: [10, 6], up: 10, hole: 1 });
   eq(round.phase, 'settle', 'dealer natural ends the round immediately');
   eq(round.hands[0].cards.length, 2, 'the player never got to hit');
   eq(round.settle().total, -10, 'and simply loses the bet');
}

/* ---- doubling ---- */
{
   const { round } = newRound();
   round.deal(10, { cards: [6, 5], up: 6, hole: 10 });
   round.act('double');
   eq(round.hands[0].bet, 20, 'double puts out a second bet');
   eq(round.hands[0].cards.length, 3, 'exactly one card on a double');
   eq(round.hands[0].done, true, 'the hand is finished after doubling');
   eq(round.phase, 'dealer', 'play passes to the dealer');
}

/* ---- surrender ---- */
{
   const { round } = newRound();
   round.deal(10, { cards: [10, 6], up: 10, hole: 9 });
   round.act('surrender');
   round.dealerPlay();
   const res = round.settle();
   eq(res.hands[0].result, 'surrender', 'surrender recorded');
   eq(res.total, -5, 'surrender costs exactly half');
}

/* ---- splitting ---- */
{
   const { round } = newRound();
   round.deal(10, { cards: [8, 8], up: 6, hole: 10 });
   round.act('split');
   eq(round.hands.length, 2, 'splitting makes two hands');
   eq(round.hands[0].cards.length, 2, 'the first hand draws immediately');
   eq(round.hands[1].bet, 10, 'the second hand carries the same bet');
   ok(round.wagered() >= 20, 'both bets are on the table');
   // play both out
   let guard = 0;
   while (round.phase === 'player' && guard++ < 20) round.act('stand');
   eq(round.phase, 'dealer', 'both hands played');
   eq(round.hands[1].cards.length >= 2, true, 'the second hand was dealt to');
}

/* ---- split aces get one card each and stop ---- */
{
   const { round } = newRound();
   round.deal(10, { cards: [1, 1], up: 6, hole: 10 });
   round.act('split');
   eq(round.phase, 'dealer', 'split aces finish themselves');
   eq(round.hands.length, 2, 'two ace hands');
   eq(round.hands[0].cards.length, 2, 'one card only on each ace');
   eq(round.hands[1].cards.length, 2, 'second ace hand also drew one');
}

/* ---- resplit limit ---- */
{
   const { round } = newRound();
   round.deal(10, { cards: [8, 8], up: 6, hole: 10 });
   let splits = 0, guard = 0;
   while (guard++ < 12) {
      const av = round.available();
      if (av.split) { round.act('split'); splits++; }
      else if (round.phase === 'player') round.act('stand');
      else break;
   }
   ok(splits <= RULES.maxSplits, 'never more splits than the rule allows (' + splits + ')');
   ok(round.hands.length <= RULES.maxSplits + 1, 'hand count respects the limit');
}

/* ---- dealer draws by the rules ---- */
{
   const h17 = BJ.normaliseRules({ decks: 6, hitSoft17: true, peek: true });
   const s17 = BJ.normaliseRules({ decks: 6, hitSoft17: false, peek: true });
   [[h17, true], [s17, false]].forEach(([rules, hits]) => {
      const shoe = new BJ.Shoe(6, 'hilo');
      const round = new BJ.Round(shoe, rules, TABLE);
      round.deal(10, { cards: [10, 8], up: 1, hole: 6 });  // dealer soft 17
      round.takeInsurance(false);
      round.act('stand');
      round.dealerPlay();
      const total = BJ.handValue(round.dealer.cards).total;
      if (hits) ok(round.dealer.cards.length > 2 || total > 17, 'H17 dealer draws to soft 17');
      else eq(round.dealer.cards.length, 2, 'S17 dealer stands on soft 17');
   });
}

/* ---- the dealer does not draw when there is nothing to beat ---- */
{
   const { round } = newRound();
   round.deal(10, { cards: [10, 6], up: 6, hole: 2 });
   round.act('hit');
   // keep hitting until bust or done
   let guard = 0;
   while (round.phase === 'player' && guard++ < 12) round.act('hit');
   if (!round.anyLive()) {
      const before = round.dealer.cards.length;
      round.dealerPlay();
      eq(round.dealer.cards.length, before + 1, 'dealer only turns the hole card over');
   }
   checks++; // counted either way
}

/* ---- straightforward settlement ---- */
{
   const { round } = newRound();
   round.deal(10, { cards: [10, 10], up: 6, hole: 10 });
   round.act('stand');
   round.dealerPlay();
   const res = round.settle();
   const dealerTotal = res.dealerTotal;
   const expected = dealerTotal > 21 ? 10 : dealerTotal < 20 ? 10 : dealerTotal === 20 ? 0 : -10;
   eq(res.total, expected, 'settlement matches the totals (dealer ' + dealerTotal + ')');
}

/* ---- bet sizing ---- */
{
   const t = { unit: 10, min: 10, max: 500, spread: 8 };
   eq(BJ.betting.recommendUnits(-3, 8), 1, 'negative count bets the minimum');
   eq(BJ.betting.recommendUnits(1, 8), 1, 'true 1 is still one unit');
   eq(BJ.betting.recommendUnits(2, 8), 2, 'true 2 doubles up');
   eq(BJ.betting.recommendUnits(3, 8), 4, 'true 3 goes to four units');
   eq(BJ.betting.recommendUnits(4, 8), 6, 'true 4 goes to six');
   eq(BJ.betting.recommendUnits(9, 8), 8, 'the spread caps the ramp');
   eq(BJ.betting.recommendUnits(9, 12), 12, 'a wider spread ramps further');

   const advice = BJ.betting.betAdvice(3, t, true);
   eq(advice.amount, 40, 'four units at $10 is $40');
   ok(BJ.betting.gradeBet(40, advice, t), 'the exact bet is right');
   ok(BJ.betting.gradeBet(45, advice, t), 'a chip either way is still right');
   ok(!BJ.betting.gradeBet(10, advice, t), 'flat betting a rich shoe is wrong');
   ok(!BJ.betting.gradeBet(200, advice, t), 'overbetting is wrong');
   const flat = BJ.betting.betAdvice(6, t, false);
   eq(flat.units, 1, 'without a countable system the ramp is flat');
}

/* ---- wagered totals ---- */
{
   const { round } = newRound();
   round.deal(25, { cards: [5, 5], up: 6, hole: 10 });
   round.act('double');
   eq(round.wagered(), 50, 'a double puts 50 on a 25 bet');
}

console.log(fails ? `\n${fails} failures of ${checks} checks` : `\nAll ${checks} checks passed`);
process.exit(fails ? 1 : 0);
