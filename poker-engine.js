// poker-engine.js — Texas Hold'em Game Engine

const SUITS = ['s', 'h', 'd', 'c'];
const RANKS = ['2', '3', '4', '5', '6', '7', '8', '9', 'T', 'J', 'Q', 'K', 'A'];
const HAND_NAMES = [
  'High Card', 'Pair', 'Two Pair', 'Three of a Kind',
  'Straight', 'Flush', 'Full House', 'Four of a Kind',
  'Straight Flush', 'Royal Flush'
];

const SUIT_SYMBOLS = { s: '♠', h: '♥', d: '♦', c: '♣' };
const RANK_DISPLAY = { T: '10', J: 'J', Q: 'Q', K: 'K', A: 'A' };

function rankValue(rank) {
  return RANKS.indexOf(rank) + 2;
}

function displayRank(rank) {
  return RANK_DISPLAY[rank] || rank;
}

function createDeck() {
  const deck = [];
  for (const suit of SUITS) {
    for (const rank of RANKS) {
      deck.push({ rank, suit });
    }
  }
  return shuffleArray(deck);
}

function shuffleArray(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// ── Hand Evaluation ──────────────────────────────────────────

function evaluate5(cards) {
  const vals = cards.map(c => rankValue(c.rank)).sort((a, b) => b - a);
  const suits = cards.map(c => c.suit);

  const isFlush = suits.every(s => s === suits[0]);

  let isStraight = false;
  let straightHigh = vals[0];
  const unique = [...new Set(vals)];
  if (unique.length === 5) {
    if (vals[0] - vals[4] === 4) isStraight = true;
    if (vals[0] === 14 && vals[1] === 5 && vals[2] === 4 && vals[3] === 3 && vals[4] === 2) {
      isStraight = true;
      straightHigh = 5;
    }
  }

  const freq = {};
  vals.forEach(v => (freq[v] = (freq[v] || 0) + 1));
  const groups = Object.entries(freq)
    .map(([v, c]) => ({ val: parseInt(v), count: c }))
    .sort((a, b) => b.count - a.count || b.val - a.val);

  if (isStraight && isFlush) {
    const hr = straightHigh === 14 ? 9 : 8;
    return { handRank: hr, score: [hr, straightHigh], name: HAND_NAMES[hr] };
  }
  if (groups[0].count === 4) {
    return { handRank: 7, score: [7, groups[0].val, groups[1].val], name: HAND_NAMES[7] };
  }
  if (groups[0].count === 3 && groups.length >= 2 && groups[1].count === 2) {
    return { handRank: 6, score: [6, groups[0].val, groups[1].val], name: HAND_NAMES[6] };
  }
  if (isFlush) {
    return { handRank: 5, score: [5, ...vals], name: HAND_NAMES[5] };
  }
  if (isStraight) {
    return { handRank: 4, score: [4, straightHigh], name: HAND_NAMES[4] };
  }
  if (groups[0].count === 3) {
    const kickers = groups.filter(g => g.count === 1).map(g => g.val).sort((a, b) => b - a);
    return { handRank: 3, score: [3, groups[0].val, ...kickers], name: HAND_NAMES[3] };
  }
  if (groups[0].count === 2 && groups.length >= 2 && groups[1].count === 2) {
    const p1 = Math.max(groups[0].val, groups[1].val);
    const p2 = Math.min(groups[0].val, groups[1].val);
    const kicker = groups.find(g => g.count === 1)?.val || 0;
    return { handRank: 2, score: [2, p1, p2, kicker], name: HAND_NAMES[2] };
  }
  if (groups[0].count === 2) {
    const kickers = groups.filter(g => g.count === 1).map(g => g.val).sort((a, b) => b - a);
    return { handRank: 1, score: [1, groups[0].val, ...kickers], name: HAND_NAMES[1] };
  }
  return { handRank: 0, score: [0, ...vals], name: HAND_NAMES[0] };
}

function compareScores(a, b) {
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    if ((a[i] || 0) > (b[i] || 0)) return 1;
    if ((a[i] || 0) < (b[i] || 0)) return -1;
  }
  return 0;
}

function combinations(arr, k) {
  if (k === 0) return [[]];
  if (arr.length < k) return [];
  const [first, ...rest] = arr;
  return [
    ...combinations(rest, k - 1).map(c => [first, ...c]),
    ...combinations(rest, k),
  ];
}

function getBestHand(cards) {
  let best = null;
  for (const combo of combinations(cards, 5)) {
    const result = evaluate5(combo);
    if (!best || compareScores(result.score, best.score) > 0) {
      best = { ...result, cards: combo };
    }
  }
  return best;
}

// ── Pot Calculation ──────────────────────────────────────────

function calculatePots(players) {
  const sorted = [...players]
    .filter(p => p.totalBet > 0)
    .sort((a, b) => a.totalBet - b.totalBet);

  if (sorted.length === 0) return [];

  const pots = [];
  let prevLevel = 0;

  for (let i = 0; i < sorted.length; i++) {
    const lvl = sorted[i].totalBet;
    if (lvl <= prevLevel) continue;
    const contribution = lvl - prevLevel;
    const contributors = sorted.filter(p => p.totalBet > prevLevel);
    const potAmount = contribution * contributors.length;
    const eligible = contributors.filter(p => !p.folded).map(p => p.seatIndex);
    if (potAmount > 0 && eligible.length > 0) {
      pots.push({ amount: potAmount, eligible });
    }
    prevLevel = lvl;
  }
  return pots;
}

// ── Game Class ───────────────────────────────────────────────

class PokerGame {
  constructor(settings) {
    this.settings = {
      startingStack: settings.startingStack || 1000,
      smallBlind: settings.smallBlind || 5,
      bigBlind: settings.bigBlind || 10,
    };
    this.dealerSeatIndex = -1;
    this.phase = 'waiting';
    this.deck = [];
    this.communityCards = [];
    this.pot = 0;
    this.players = [];
    this.currentBet = 0;
    this.minRaise = 0;
    this.currentPlayerIdx = -1;
    this.needsToAct = new Set();
    this.handNumber = 0;
  }

  /* Start a new hand with given active players (sorted by seat) */
  startHand(activePlayers) {
    if (activePlayers.length < 2) return null;

    this.handNumber++;
    this.deck = createDeck();
    this.communityCards = [];
    this.pot = 0;
    this.currentBet = 0;
    this.minRaise = this.settings.bigBlind;
    this.phase = 'preflop';

    this.players = activePlayers
      .sort((a, b) => a.seatIndex - b.seatIndex)
      .map(p => ({
        seatIndex: p.seatIndex,
        username: p.username,
        socketId: p.socketId,
        chips: p.chips,
        hand: [],
        currentBet: 0,
        totalBet: 0,
        folded: false,
        allIn: false,
      }));

    // Advance dealer
    this.dealerSeatIndex = this._nextDealer();
    const dIdx = this.players.findIndex(p => p.seatIndex === this.dealerSeatIndex);

    let sbIdx, bbIdx, firstIdx;
    if (this.players.length === 2) {
      sbIdx = dIdx;
      bbIdx = (dIdx + 1) % this.players.length;
      firstIdx = dIdx;
    } else {
      sbIdx = (dIdx + 1) % this.players.length;
      bbIdx = (dIdx + 2) % this.players.length;
      firstIdx = (bbIdx + 1) % this.players.length;
    }

    this._postBlind(sbIdx, this.settings.smallBlind);
    this._postBlind(bbIdx, this.settings.bigBlind);
    this.currentBet = this.settings.bigBlind;

    // Deal
    for (let r = 0; r < 2; r++) {
      for (let i = 0; i < this.players.length; i++) {
        const to = (dIdx + 1 + i) % this.players.length;
        this.players[to].hand.push(this.deck.pop());
      }
    }

    this.needsToAct = new Set();
    for (let i = 0; i < this.players.length; i++) {
      if (!this.players[i].allIn) this.needsToAct.add(i);
    }

    this.currentPlayerIdx = firstIdx;
    if (this.players[this.currentPlayerIdx].allIn) {
      this.currentPlayerIdx = this._nextActive(this.currentPlayerIdx);
    }

    return {
      dealerSeatIndex: this.dealerSeatIndex,
      sbSeatIndex: this.players[sbIdx].seatIndex,
      bbSeatIndex: this.players[bbIdx].seatIndex,
      players: this.players.map(p => ({
        seatIndex: p.seatIndex, username: p.username, socketId: p.socketId,
        chips: p.chips, hand: [...p.hand], currentBet: p.currentBet,
      })),
      pot: this.pot,
      currentBet: this.currentBet,
      currentPlayerSeatIndex: this.currentPlayerIdx >= 0
        ? this.players[this.currentPlayerIdx].seatIndex : -1,
    };
  }

  _nextDealer() {
    const seats = this.players.map(p => p.seatIndex).sort((a, b) => a - b);
    if (this.dealerSeatIndex === -1) return seats[0];
    for (const s of seats) { if (s > this.dealerSeatIndex) return s; }
    return seats[0];
  }

  _postBlind(idx, amount) {
    const p = this.players[idx];
    const amt = Math.min(amount, p.chips);
    p.chips -= amt;
    p.currentBet = amt;
    p.totalBet = amt;
    this.pot += amt;
    if (p.chips === 0) p.allIn = true;
  }

  _nextActive(fromIdx) {
    let idx = (fromIdx + 1) % this.players.length;
    for (let n = 0; n < this.players.length; n++) {
      if (this.needsToAct.has(idx) && !this.players[idx].folded && !this.players[idx].allIn) {
        return idx;
      }
      idx = (idx + 1) % this.players.length;
    }
    return -1;
  }

  getAvailableActions(seatIndex) {
    const idx = this.players.findIndex(p => p.seatIndex === seatIndex);
    if (idx !== this.currentPlayerIdx || idx === -1) return null;
    const p = this.players[idx];
    const toCall = this.currentBet - p.currentBet;
    const actions = ['fold'];
    if (toCall <= 0) actions.push('check');
    else actions.push('call');
    if (p.chips > toCall) actions.push('raise');
    if (p.chips > 0) actions.push('allin');
    return {
      actions,
      toCall: Math.min(toCall, p.chips),
      minRaise: this.currentBet + this.minRaise,
      maxRaise: p.currentBet + p.chips,
      pot: this.pot,
    };
  }

  handleAction(seatIndex, action, amount = 0) {
    const idx = this.players.findIndex(p => p.seatIndex === seatIndex);
    if (idx === -1 || idx !== this.currentPlayerIdx) return { error: 'Not your turn' };
    const p = this.players[idx];
    const toCall = this.currentBet - p.currentBet;

    switch (action) {
      case 'fold':
        p.folded = true;
        this.needsToAct.delete(idx);
        break;

      case 'check':
        if (toCall > 0) return { error: 'Cannot check' };
        this.needsToAct.delete(idx);
        break;

      case 'call': {
        const amt = Math.min(toCall, p.chips);
        p.chips -= amt; p.currentBet += amt; p.totalBet += amt; this.pot += amt;
        if (p.chips === 0) p.allIn = true;
        this.needsToAct.delete(idx);
        break;
      }

      case 'raise': {
        let raiseTo = amount;
        const minTo = this.currentBet + this.minRaise;
        if (raiseTo < minTo && (p.currentBet + p.chips) > minTo) {
          return { error: `Min raise to ${minTo}` };
        }
        raiseTo = Math.min(raiseTo, p.currentBet + p.chips);
        const putIn = raiseTo - p.currentBet;
        if (raiseTo > this.currentBet) {
          const raiseBy = raiseTo - this.currentBet;
          if (raiseBy >= this.minRaise) this.minRaise = raiseBy;
          this.currentBet = raiseTo;
          for (let i = 0; i < this.players.length; i++) {
            if (i !== idx && !this.players[i].folded && !this.players[i].allIn)
              this.needsToAct.add(i);
          }
        }
        p.chips -= putIn; p.currentBet = raiseTo; p.totalBet += putIn; this.pot += putIn;
        if (p.chips === 0) p.allIn = true;
        this.needsToAct.delete(idx);
        break;
      }

      case 'allin': {
        const allIn = p.chips;
        const newBet = p.currentBet + allIn;
        if (newBet > this.currentBet) {
          const raiseBy = newBet - this.currentBet;
          if (raiseBy >= this.minRaise) this.minRaise = raiseBy;
          this.currentBet = newBet;
          for (let i = 0; i < this.players.length; i++) {
            if (i !== idx && !this.players[i].folded && !this.players[i].allIn)
              this.needsToAct.add(i);
          }
        }
        this.pot += allIn; p.totalBet += allIn; p.chips = 0;
        p.currentBet = newBet; p.allIn = true;
        this.needsToAct.delete(idx);
        break;
      }

      default:
        return { error: 'Invalid action' };
    }

    // Last player standing?
    const active = this.players.filter(pl => !pl.folded);
    if (active.length === 1) return this._endLastMan(active[0]);

    // Round over?
    if (this.needsToAct.size === 0) return this._nextPhase();

    this.currentPlayerIdx = this._nextActive(this.currentPlayerIdx);
    if (this.currentPlayerIdx === -1) return this._nextPhase();

    return {
      type: 'action',
      seatIndex: p.seatIndex,
      action,
      betAmount: p.currentBet,
      chips: p.chips,
      pot: this.pot,
      currentBet: this.currentBet,
      nextPlayerSeatIndex: this.players[this.currentPlayerIdx].seatIndex,
    };
  }

  _endLastMan(winner) {
    winner.chips += this.pot;
    this.phase = 'complete';
    return {
      type: 'handComplete',
      winners: [{ seatIndex: winner.seatIndex, username: winner.username, amount: this.pot }],
      players: this.players.map(p => ({
        seatIndex: p.seatIndex, chips: p.chips, folded: p.folded,
      })),
    };
  }

  _nextPhase() {
    for (const p of this.players) p.currentBet = 0;
    this.currentBet = 0;
    this.minRaise = this.settings.bigBlind;

    const canAct = this.players.filter(p => !p.folded && !p.allIn);

    if (this.phase === 'preflop') {
      this.phase = 'flop';
      this.deck.pop(); // burn
      this.communityCards.push(this.deck.pop(), this.deck.pop(), this.deck.pop());
    } else if (this.phase === 'flop') {
      this.phase = 'turn';
      this.deck.pop();
      this.communityCards.push(this.deck.pop());
    } else if (this.phase === 'turn') {
      this.phase = 'river';
      this.deck.pop();
      this.communityCards.push(this.deck.pop());
    } else if (this.phase === 'river') {
      return this._showdown();
    }

    if (canAct.length <= 1) {
      return {
        type: 'newPhase',
        phase: this.phase,
        communityCards: [...this.communityCards],
        pot: this.pot,
        currentPlayerSeatIndex: -1,
        allInRunout: true,
      };
    }

    this.needsToAct = new Set();
    for (let i = 0; i < this.players.length; i++) {
      if (!this.players[i].folded && !this.players[i].allIn) this.needsToAct.add(i);
    }

    const dIdx = this.players.findIndex(p => p.seatIndex === this.dealerSeatIndex);
    this.currentPlayerIdx = this._nextActive(dIdx);
    if (this.currentPlayerIdx === -1) {
      return {
        type: 'newPhase',
        phase: this.phase,
        communityCards: [...this.communityCards],
        pot: this.pot,
        currentPlayerSeatIndex: -1,
        allInRunout: true,
      };
    }

    return {
      type: 'newPhase',
      phase: this.phase,
      communityCards: [...this.communityCards],
      pot: this.pot,
      currentPlayerSeatIndex: this.players[this.currentPlayerIdx].seatIndex,
    };
  }

  _showdown() {
    this.phase = 'showdown';
    const active = this.players.filter(p => !p.folded);

    for (const p of active) {
      p.bestHand = getBestHand([...p.hand, ...this.communityCards]);
    }

    const pots = calculatePots(this.players);
    const potResults = [];

    for (const pot of pots) {
      const eligible = active.filter(p => pot.eligible.includes(p.seatIndex));
      if (eligible.length === 0) continue;

      let bestScore = null;
      for (const p of eligible) {
        if (!bestScore || compareScores(p.bestHand.score, bestScore) > 0) bestScore = p.bestHand.score;
      }
      const winners = eligible.filter(p => compareScores(p.bestHand.score, bestScore) === 0);
      const share = Math.floor(pot.amount / winners.length);
      const rem = pot.amount % winners.length;

      const wr = [];
      for (let i = 0; i < winners.length; i++) {
        const prize = share + (i < rem ? 1 : 0);
        winners[i].chips += prize;
        wr.push({ seatIndex: winners[i].seatIndex, username: winners[i].username, amount: prize });
      }
      potResults.push({ amount: pot.amount, winners: wr });
    }

    this.phase = 'complete';

    return {
      type: 'showdown',
      communityCards: [...this.communityCards],
      potResults,
      players: this.players.map(p => ({
        seatIndex: p.seatIndex, username: p.username,
        hand: p.folded ? null : [...p.hand],
        bestHand: p.folded ? null : p.bestHand,
        chips: p.chips, folded: p.folded,
      })),
    };
  }
}

module.exports = {
  PokerGame, HAND_NAMES, SUIT_SYMBOLS, RANK_DISPLAY,
  getBestHand, evaluate5, displayRank, rankValue,
};
