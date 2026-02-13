// app.js — Poker Client

const socket = io();

// ── Suit / Rank helpers ──────────────────────────────────────
const SUIT_SYM = { s: '♠', h: '♥', d: '♦', c: '♣' };
const RANK_DISP = { T: '10', J: 'J', Q: 'Q', K: 'K', A: 'A' };
function dispRank(r) { return RANK_DISP[r] || r; }
function isRed(suit) { return suit === 'h' || suit === 'd'; }

// ── State ────────────────────────────────────────────────────
const state = {
  screen: 'home',
  lobbyCode: null,
  isHost: false,
  mySeatIndex: -1,
  myUsername: null,
  myHand: [],
  seats: Array(8).fill(null),
  settings: { startingStack: 1000, smallBlind: 5, bigBlind: 10 },
  game: {
    phase: 'waiting',
    communityCards: [],
    pot: 0,
    currentBet: 0,
    dealerSeatIndex: -1,
    sbSeatIndex: -1,
    bbSeatIndex: -1,
    currentPlayerSeatIndex: -1,
    playerStates: {},
  },
  myActions: null,
  pendingApprovals: [],
  chatOpen: false,
  unreadChat: 0,
};

// ── DOM refs ─────────────────────────────────────────────────
const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => document.querySelectorAll(sel);

const el = {
  homeScreen: $('#home-screen'),
  lobbyScreen: $('#lobby-screen'),
  btnCreate: $('#btn-create'),
  btnJoin: $('#btn-join'),
  lobbyCodeVal: $('#lobby-code-value'),
  btnCopyCode: $('#btn-copy-code'),
  hostControls: $('#host-controls'),
  btnSettings: $('#btn-settings'),
  btnDeal: $('#btn-deal'),
  tableArea: $('#table-area'),
  communityCards: $('#community-cards'),
  potAmount: $('#pot-amount'),
  gameMessage: $('#game-message'),
  shuffleArea: $('#shuffle-area'),
  actionBar: $('#action-bar'),
  btnFold: $('#btn-fold'),
  btnCheck: $('#btn-check'),
  btnCall: $('#btn-call'),
  callAmount: $('#call-amount'),
  btnRaise: $('#btn-raise'),
  raiseSlider: $('#raise-slider'),
  raiseInput: $('#raise-input'),
  btnAllin: $('#btn-allin'),
  chatPanel: $('#chat-panel'),
  chatHeader: $('#chat-header'),
  chatMessages: $('#chat-messages'),
  chatInput: $('#chat-input'),
  btnSendChat: $('#btn-send-chat'),
  chatBadge: $('#chat-badge'),
  modalOverlay: $('#modal-overlay'),
  joinModal: $('#join-modal'),
  joinCodeInput: $('#join-code-input'),
  sitModal: $('#sit-modal'),
  usernameInput: $('#username-input'),
  settingsModal: $('#settings-modal'),
  approvalModal: $('#approval-modal'),
  approvalText: $('#approval-text'),
  waitingModal: $('#waiting-modal'),
  toastContainer: $('#toast-container'),
};

// ── View helpers ─────────────────────────────────────────────
function showScreen(id) {
  $$('.screen').forEach(s => s.classList.remove('active'));
  $(`#${id}`).classList.add('active');
  state.screen = id.replace('-screen', '');
}

function showModal(id) {
  el.modalOverlay.classList.remove('hidden');
  $$('.modal').forEach(m => m.classList.add('hidden'));
  $(`#${id}`).classList.remove('hidden');
}

function hideModal() {
  el.modalOverlay.classList.add('hidden');
  $$('.modal').forEach(m => m.classList.add('hidden'));
}

function toast(msg) {
  const t = document.createElement('div');
  t.className = 'toast';
  t.textContent = msg;
  el.toastContainer.appendChild(t);
  setTimeout(() => t.remove(), 3000);
}

// ── Home Screen ──────────────────────────────────────────────
el.btnCreate.onclick = () => socket.emit('create-lobby');
el.btnJoin.onclick = () => { el.joinCodeInput.value = ''; showModal('join-modal'); el.joinCodeInput.focus(); };
$('#btn-join-confirm').onclick = () => {
  const code = el.joinCodeInput.value.trim();
  if (code.length < 4) { toast('Enter a valid code'); return; }
  socket.emit('join-lobby', code);
};
$('#btn-join-cancel').onclick = hideModal;
el.joinCodeInput.addEventListener('keydown', e => { if (e.key === 'Enter') $('#btn-join-confirm').click(); });

// ── Lobby Events ─────────────────────────────────────────────
socket.on('lobby-created', (data) => enterLobby(data));
socket.on('lobby-joined', (data) => enterLobby(data));

function enterLobby(data) {
  hideModal();
  state.lobbyCode = data.code;
  state.isHost = data.isHost;
  state.settings = { ...data.settings };
  state.mySeatIndex = -1;
  state.myUsername = null;
  state.seats = data.seats.map((s, i) => {
    if (!s) return null;
    if (s.isMe) { state.mySeatIndex = s.seatIndex; state.myUsername = s.username; }
    return { ...s };
  });

  el.lobbyCodeVal.textContent = data.code;
  el.hostControls.style.display = data.isHost ? 'flex' : 'none';
  showScreen('lobby-screen');
  renderSeats();
}

// Copy code
el.btnCopyCode.onclick = () => {
  navigator.clipboard.writeText(state.lobbyCode).then(() => toast('Code copied'));
};

// ── Seat Rendering ───────────────────────────────────────────
function renderSeats() {
  for (let i = 0; i < 8; i++) {
    const seatEl = $(`.seat[data-seat="${i}"]`);
    const data = state.seats[i];
    seatEl.innerHTML = '';

    if (!data) {
      // Empty seat
      const btn = document.createElement('div');
      btn.className = 'seat-empty';
      btn.textContent = 'SIT';
      btn.onclick = () => requestSeat(i);
      seatEl.appendChild(btn);
    } else {
      // Cards area
      const cardsDiv = document.createElement('div');
      cardsDiv.className = 'seat-cards';
      cardsDiv.id = `seat-cards-${i}`;

      const ps = state.game.playerStates[i];
      const hasCards = state.game.phase !== 'waiting' && ps && !ps.folded;

      if (hasCards && i === state.mySeatIndex && state.myHand.length === 2) {
        // Show my hand face-up
        for (const c of state.myHand) {
          cardsDiv.appendChild(createCardEl(c, true));
        }
      } else if (hasCards) {
        // Show back of cards
        cardsDiv.appendChild(createCardEl(null, false));
        cardsDiv.appendChild(createCardEl(null, false));
      }
      seatEl.appendChild(cardsDiv);

      // Info box
      const info = document.createElement('div');
      info.className = 'seat-info';
      if (state.game.currentPlayerSeatIndex === i) info.classList.add('active-turn', 'pulse');
      if (ps && ps.folded) info.classList.add('folded');

      const name = document.createElement('span');
      name.className = 'player-name';
      name.textContent = data.username;
      info.appendChild(name);

      const chips = document.createElement('span');
      chips.className = 'player-chips';
      chips.textContent = (ps ? ps.chips : data.chips).toLocaleString();
      info.appendChild(chips);

      // Bet display
      if (ps && ps.currentBet > 0) {
        const bet = document.createElement('div');
        bet.className = 'player-bet-display';
        bet.textContent = ps.currentBet.toLocaleString();
        info.appendChild(bet);
      }

      seatEl.appendChild(info);

      // Badges
      const badges = document.createElement('div');
      if (state.game.dealerSeatIndex === i) {
        const b = document.createElement('span'); b.className = 'badge badge-dealer'; b.textContent = 'D'; badges.appendChild(b);
      }
      if (state.game.sbSeatIndex === i) {
        const b = document.createElement('span'); b.className = 'badge badge-sb'; b.textContent = 'SB'; badges.appendChild(b);
      }
      if (state.game.bbSeatIndex === i) {
        const b = document.createElement('span'); b.className = 'badge badge-bb'; b.textContent = 'BB'; badges.appendChild(b);
      }
      if (data.pendingNextRound) {
        const b = document.createElement('span'); b.className = 'badge badge-pending'; b.textContent = 'NEXT ROUND'; badges.appendChild(b);
      }
      if (badges.children.length) seatEl.appendChild(badges);

      // Host kick button (except for self)
      if (state.isHost && data.socketId !== socket.id && state.game.phase === 'waiting') {
        const kick = document.createElement('button');
        kick.className = 'btn-icon';
        kick.textContent = '✕';
        kick.title = 'Kick player';
        kick.style.fontSize = '0.65rem';
        kick.style.marginTop = '4px';
        kick.onclick = (e) => { e.stopPropagation(); socket.emit('kick-player', i); };
        seatEl.appendChild(kick);
      }
    }
  }
}

function createCardEl(card, faceUp) {
  const el = document.createElement('div');
  el.className = 'card' + (faceUp ? ' flipped' : '');
  const inner = document.createElement('div');
  inner.className = 'card-inner';

  const back = document.createElement('div');
  back.className = 'card-back';
  inner.appendChild(back);

  const front = document.createElement('div');
  front.className = 'card-front' + (card && isRed(card.suit) ? ' red' : '');
  if (card) {
    const rank = document.createElement('span');
    rank.className = 'card-rank';
    rank.textContent = dispRank(card.rank);
    front.appendChild(rank);
    const suit = document.createElement('span');
    suit.className = 'card-suit';
    suit.textContent = SUIT_SYM[card.suit];
    front.appendChild(suit);
  }
  inner.appendChild(front);
  el.appendChild(inner);
  return el;
}

function createCommunityCard(card) {
  const el = document.createElement('div');
  el.className = 'card community-card flipped';
  const inner = document.createElement('div');
  inner.className = 'card-inner';

  const back = document.createElement('div');
  back.className = 'card-back';
  inner.appendChild(back);

  const front = document.createElement('div');
  front.className = 'card-front' + (isRed(card.suit) ? ' red' : '');
  const rank = document.createElement('span');
  rank.className = 'card-rank';
  rank.textContent = dispRank(card.rank);
  front.appendChild(rank);
  const suit = document.createElement('span');
  suit.className = 'card-suit';
  suit.textContent = SUIT_SYM[card.suit];
  front.appendChild(suit);
  inner.appendChild(front);
  el.appendChild(inner);
  return el;
}

// ── Seat Request ─────────────────────────────────────────────
let pendingSeat = -1;
function requestSeat(idx) {
  if (state.mySeatIndex >= 0) { toast('Already seated'); return; }
  pendingSeat = idx;
  el.usernameInput.value = '';
  showModal('sit-modal');
  el.usernameInput.focus();
}
$('#btn-sit-confirm').onclick = () => {
  const name = el.usernameInput.value.trim();
  if (!name) { toast('Enter a name'); return; }
  socket.emit('request-seat', { seatIndex: pendingSeat, username: name });
  hideModal();
};
$('#btn-sit-cancel').onclick = hideModal;
el.usernameInput.addEventListener('keydown', e => { if (e.key === 'Enter') $('#btn-sit-confirm').click(); });

// ── Player Seated ────────────────────────────────────────────
socket.on('player-seated', (data) => {
  state.seats[data.seatIndex] = {
    username: data.username,
    seatIndex: data.seatIndex,
    chips: data.chips,
    approved: data.approved,
    pendingNextRound: data.pendingNextRound,
    socketId: data.socketId,
  };
  if (data.socketId === socket.id) {
    state.mySeatIndex = data.seatIndex;
    state.myUsername = data.username;
  }
  renderSeats();
  addSystemChat(`${data.username} sat down`);
});

socket.on('player-left', (data) => {
  const seat = state.seats[data.seatIndex];
  if (seat) addSystemChat(`${seat.username} left`);
  if (data.seatIndex === state.mySeatIndex) {
    state.mySeatIndex = -1;
    state.myUsername = null;
    state.myHand = [];
  }
  state.seats[data.seatIndex] = null;
  renderSeats();
});

socket.on('waiting-approval', () => showModal('waiting-modal'));
socket.on('seat-denied', () => { hideModal(); toast('Request denied'); });
socket.on('kicked', () => {
  hideModal();
  state.mySeatIndex = -1; state.myUsername = null; state.myHand = [];
  toast('You were removed');
  renderSeats();
});

// ── Approval (Host) ──────────────────────────────────────────
socket.on('approval-request', (data) => {
  state.pendingApprovals.push(data);
  showNextApproval();
});
function showNextApproval() {
  if (state.pendingApprovals.length === 0) { hideModal(); return; }
  const req = state.pendingApprovals[0];
  el.approvalText.textContent = `"${req.username}" wants to sit in seat ${req.seatIndex + 1}`;
  showModal('approval-modal');
}
$('#btn-approve').onclick = () => {
  const req = state.pendingApprovals.shift();
  if (req) socket.emit('approve-player', req.socketId);
  showNextApproval();
};
$('#btn-deny').onclick = () => {
  const req = state.pendingApprovals.shift();
  if (req) socket.emit('deny-player', req.socketId);
  showNextApproval();
};

// ── Host changed ─────────────────────────────────────────────
socket.on('host-changed', (data) => {
  state.isHost = data.newHostSocketId === socket.id;
  el.hostControls.style.display = state.isHost ? 'flex' : 'none';
  addSystemChat(`${data.username} is now the host`);
});

// ── Settings ─────────────────────────────────────────────────
el.btnSettings.onclick = () => {
  $('#setting-stack').value = state.settings.startingStack;
  $('#setting-sb').value = state.settings.smallBlind;
  $('#setting-bb').value = state.settings.bigBlind;
  showModal('settings-modal');
};
$('#btn-settings-save').onclick = () => {
  const s = {
    startingStack: parseInt($('#setting-stack').value) || 1000,
    smallBlind: parseInt($('#setting-sb').value) || 5,
    bigBlind: parseInt($('#setting-bb').value) || 10,
  };
  socket.emit('update-settings', s);
  hideModal();
};
$('#btn-settings-cancel').onclick = hideModal;
socket.on('settings-updated', (settings) => {
  state.settings = { ...settings };
  toast('Settings updated');
});

// ── Deal / Start ─────────────────────────────────────────────
el.btnDeal.onclick = () => socket.emit('start-game');

// ── Hand Started ─────────────────────────────────────────────
socket.on('hand-started', (data) => {
  hideModal();
  state.game.phase = 'preflop';
  state.game.dealerSeatIndex = data.dealerSeatIndex;
  state.game.sbSeatIndex = data.sbSeatIndex;
  state.game.bbSeatIndex = data.bbSeatIndex;
  state.game.pot = data.pot;
  state.game.currentBet = data.currentBet;
  state.game.currentPlayerSeatIndex = data.currentPlayerSeatIndex;
  state.game.communityCards = [];
  state.game.playerStates = {};

  for (const p of data.players) {
    state.game.playerStates[p.seatIndex] = {
      chips: p.chips,
      currentBet: p.currentBet,
      folded: false,
      allIn: false,
    };
    // Update seat chips
    if (state.seats[p.seatIndex]) state.seats[p.seatIndex].chips = p.chips;
  }

  el.potAmount.textContent = data.pot > 0 ? `POT ${data.pot.toLocaleString()}` : '';
  el.gameMessage.textContent = '';
  el.communityCards.innerHTML = '';
  el.actionBar.classList.add('hidden');
  state.myActions = null;

  // Animate dealing
  animateDeal(data.players, () => {
    renderSeats();
    renderCommunityCards();
  });
});

socket.on('your-hand', (data) => {
  state.myHand = data.hand;
  // Will render when animateDeal callback fires renderSeats
  // But if seats already rendered, update now
  if (state.mySeatIndex >= 0) {
    const cardsDiv = document.getElementById(`seat-cards-${state.mySeatIndex}`);
    if (cardsDiv && cardsDiv.children.length === 0) renderSeats();
  }
});

// ── Your Turn ────────────────────────────────────────────────
socket.on('your-turn', (actions) => {
  state.myActions = actions;
  showActionBar(actions);
});

function showActionBar(actions) {
  el.actionBar.classList.remove('hidden');

  el.btnCheck.style.display = actions.actions.includes('check') ? '' : 'none';
  el.btnCall.style.display = actions.actions.includes('call') ? '' : 'none';
  el.callAmount.textContent = actions.toCall > 0 ? actions.toCall.toLocaleString() : '';

  const canRaise = actions.actions.includes('raise');
  el.btnRaise.style.display = canRaise ? '' : 'none';
  el.raiseSlider.style.display = canRaise ? '' : 'none';
  el.raiseInput.style.display = canRaise ? '' : 'none';

  if (canRaise) {
    el.raiseSlider.min = actions.minRaise;
    el.raiseSlider.max = actions.maxRaise;
    el.raiseSlider.value = actions.minRaise;
    el.raiseInput.value = actions.minRaise;
    el.raiseInput.min = actions.minRaise;
    el.raiseInput.max = actions.maxRaise;
  }

  el.btnAllin.style.display = actions.actions.includes('allin') ? '' : 'none';
}

function hideActionBar() {
  el.actionBar.classList.add('hidden');
  state.myActions = null;
}

// Raise slider/input sync
el.raiseSlider.oninput = () => { el.raiseInput.value = el.raiseSlider.value; };
el.raiseInput.oninput = () => { el.raiseSlider.value = el.raiseInput.value; };

// Action buttons
el.btnFold.onclick = () => { socket.emit('player-action', { action: 'fold' }); hideActionBar(); };
el.btnCheck.onclick = () => { socket.emit('player-action', { action: 'check' }); hideActionBar(); };
el.btnCall.onclick = () => { socket.emit('player-action', { action: 'call' }); hideActionBar(); };
el.btnRaise.onclick = () => {
  const amt = parseInt(el.raiseInput.value);
  socket.emit('player-action', { action: 'raise', amount: amt });
  hideActionBar();
};
el.btnAllin.onclick = () => { socket.emit('player-action', { action: 'allin' }); hideActionBar(); };

// ── Player Acted ─────────────────────────────────────────────
socket.on('player-acted', (data) => {
  const ps = state.game.playerStates[data.seatIndex];
  if (ps) {
    ps.chips = data.chips;
    ps.currentBet = data.betAmount;
    if (data.action === 'fold') ps.folded = true;
    if (data.action === 'allin' || data.chips === 0) ps.allIn = true;
  }
  if (state.seats[data.seatIndex]) state.seats[data.seatIndex].chips = data.chips;
  state.game.pot = data.pot;
  state.game.currentBet = data.currentBet;
  state.game.currentPlayerSeatIndex = data.nextPlayerSeatIndex;

  el.potAmount.textContent = data.pot > 0 ? `POT ${data.pot.toLocaleString()}` : '';
  renderSeats();
});

// ── New Phase ────────────────────────────────────────────────
socket.on('new-phase', (data) => {
  state.game.phase = data.phase;
  state.game.communityCards = data.communityCards;
  state.game.pot = data.pot;
  state.game.currentPlayerSeatIndex = data.currentPlayerSeatIndex;
  state.game.currentBet = 0;

  // Reset bets
  for (const key in state.game.playerStates) {
    state.game.playerStates[key].currentBet = 0;
  }

  el.potAmount.textContent = data.pot > 0 ? `POT ${data.pot.toLocaleString()}` : '';
  animateCommunityCards(data.communityCards, () => {
    renderSeats();
  });
});

// ── Showdown ─────────────────────────────────────────────────
socket.on('showdown', (data) => {
  state.game.phase = 'showdown';
  state.game.communityCards = data.communityCards;

  // Update player states with revealed info
  for (const p of data.players) {
    state.game.playerStates[p.seatIndex] = {
      ...state.game.playerStates[p.seatIndex],
      chips: p.chips,
      hand: p.hand,
      bestHand: p.bestHand,
      folded: p.folded,
    };
    if (state.seats[p.seatIndex]) state.seats[p.seatIndex].chips = p.chips;
  }

  renderCommunityCards();
  renderShowdown(data);

  // Build winner message
  const winners = data.potResults.flatMap(pr => pr.winners);
  const msg = winners.map(w => `${w.username} wins ${w.amount.toLocaleString()}`).join(' · ');
  el.gameMessage.textContent = msg;
  hideActionBar();

  // Auto shuffle animation after delay
  setTimeout(() => {
    animateShuffle(() => {
      state.game.phase = 'waiting';
      state.game.communityCards = [];
      state.game.playerStates = {};
      state.game.currentPlayerSeatIndex = -1;
      state.game.dealerSeatIndex = -1;
      state.game.sbSeatIndex = -1;
      state.game.bbSeatIndex = -1;
      state.game.pot = 0;
      state.game.currentBet = 0;
      state.myHand = [];
      el.communityCards.innerHTML = '';
      el.potAmount.textContent = '';
      el.gameMessage.textContent = '';
      renderSeats();
    });
  }, 3500);
});

socket.on('hand-complete', (data) => {
  state.game.phase = 'complete';
  for (const p of data.players) {
    if (state.game.playerStates[p.seatIndex]) {
      state.game.playerStates[p.seatIndex].chips = p.chips;
    }
    if (state.seats[p.seatIndex]) state.seats[p.seatIndex].chips = p.chips;
  }

  const msg = data.winners.map(w => `${w.username} wins ${w.amount.toLocaleString()}`).join(' · ');
  el.gameMessage.textContent = msg;
  hideActionBar();
  renderSeats();

  setTimeout(() => {
    animateShuffle(() => {
      state.game.phase = 'waiting';
      state.game.communityCards = [];
      state.game.playerStates = {};
      state.game.currentPlayerSeatIndex = -1;
      state.game.dealerSeatIndex = -1;
      state.game.sbSeatIndex = -1;
      state.game.bbSeatIndex = -1;
      state.game.pot = 0;
      state.game.currentBet = 0;
      state.myHand = [];
      el.communityCards.innerHTML = '';
      el.potAmount.textContent = '';
      el.gameMessage.textContent = '';
      renderSeats();
    });
  }, 2500);
});

// ── Showdown Rendering ───────────────────────────────────────
function renderShowdown(data) {
  for (let i = 0; i < 8; i++) {
    const ps = state.game.playerStates[i];
    if (!ps || ps.folded || !ps.hand) continue;
    const cardsDiv = document.getElementById(`seat-cards-${i}`);
    if (!cardsDiv) continue;
    cardsDiv.innerHTML = '';
    for (const c of ps.hand) {
      const cardEl = createCardEl(c, false);
      cardsDiv.appendChild(cardEl);
      // Trigger flip animation
      setTimeout(() => cardEl.classList.add('flipped'), 100);
    }
  }
  // Update seat infos with hand name
  for (let i = 0; i < 8; i++) {
    const ps = state.game.playerStates[i];
    if (!ps || ps.folded || !ps.bestHand) continue;
    const seatEl = $(`.seat[data-seat="${i}"] .seat-info`);
    if (!seatEl) continue;
    let handLabel = seatEl.querySelector('.hand-label');
    if (!handLabel) {
      handLabel = document.createElement('div');
      handLabel.className = 'hand-label';
      handLabel.style.cssText = 'font-size:0.6rem;color:#aaa;margin-top:2px;letter-spacing:0.05em;';
      seatEl.appendChild(handLabel);
    }
    handLabel.textContent = ps.bestHand.name;
  }
}

// ── Community Cards Rendering ────────────────────────────────
function renderCommunityCards() {
  el.communityCards.innerHTML = '';
  for (const c of state.game.communityCards) {
    el.communityCards.appendChild(createCommunityCard(c));
  }
}

// ── Animations ───────────────────────────────────────────────

// Deal animation: cards fly from center to seats
function animateDeal(players, callback) {
  const tableRect = $('#poker-table').getBoundingClientRect();
  const deckX = tableRect.left + tableRect.width / 2 - 21;
  const deckY = tableRect.top + tableRect.height * 0.3;

  const totalCards = players.length * 2;
  let dealt = 0;

  // Deal 2 rounds
  for (let round = 0; round < 2; round++) {
    for (let i = 0; i < players.length; i++) {
      const p = players[i];
      const seatEl = $(`.seat[data-seat="${p.seatIndex}"]`);
      const seatRect = seatEl.getBoundingClientRect();
      const targetX = seatRect.left + seatRect.width / 2 - 21;
      const targetY = seatRect.top + 10;

      const delay = (round * players.length + i) * 100;

      setTimeout(() => {
        const card = document.createElement('div');
        card.className = 'card card-dealing';
        const inner = document.createElement('div');
        inner.className = 'card-inner';
        const back = document.createElement('div');
        back.className = 'card-back';
        inner.appendChild(back);
        const front = document.createElement('div');
        front.className = 'card-front';
        inner.appendChild(front);
        card.appendChild(inner);

        card.style.left = deckX + 'px';
        card.style.top = deckY + 'px';
        document.body.appendChild(card);

        requestAnimationFrame(() => {
          card.style.left = targetX + 'px';
          card.style.top = targetY + 'px';
        });

        setTimeout(() => {
          card.remove();
          dealt++;
          if (dealt === totalCards && callback) callback();
        }, 500);
      }, delay);
    }
  }

  // Fallback if no players
  if (totalCards === 0 && callback) callback();
}

// Community cards animation
function animateCommunityCards(cards, callback) {
  el.communityCards.innerHTML = '';
  const prevCount = el.communityCards.children.length;

  for (let i = 0; i < cards.length; i++) {
    const cardEl = createCommunityCard(cards[i]);
    cardEl.style.opacity = '0';
    cardEl.style.transform = 'translateY(-20px) scale(0.8)';
    cardEl.style.transition = 'opacity 0.4s ease, transform 0.4s ease';
    el.communityCards.appendChild(cardEl);

    setTimeout(() => {
      cardEl.style.opacity = '1';
      cardEl.style.transform = 'translateY(0) scale(1)';
    }, i * 120 + 50);
  }

  setTimeout(() => {
    if (callback) callback();
  }, cards.length * 120 + 500);
}

// Shuffle animation
function animateShuffle(callback) {
  el.shuffleArea.innerHTML = '';
  const numCards = 8;

  for (let i = 0; i < numCards; i++) {
    const card = document.createElement('div');
    card.className = 'shuffle-card';
    card.style.animation = `${i % 2 === 0 ? 'shuffleL' : 'shuffleR'} 0.6s ease ${i * 0.06}s 2`;
    card.style.zIndex = i;
    el.shuffleArea.appendChild(card);
  }

  setTimeout(() => {
    el.shuffleArea.innerHTML = '';
    if (callback) callback();
  }, 1800);
}

// ── Chat ─────────────────────────────────────────────────────
el.chatHeader.onclick = () => {
  state.chatOpen = !state.chatOpen;
  el.chatPanel.className = state.chatOpen ? 'chat-expanded' : 'chat-collapsed';
  if (state.chatOpen) {
    state.unreadChat = 0;
    el.chatBadge.classList.add('hidden');
    el.chatInput.focus();
    el.chatMessages.scrollTop = el.chatMessages.scrollHeight;
  }
};

el.btnSendChat.onclick = sendChat;
el.chatInput.addEventListener('keydown', e => { if (e.key === 'Enter') sendChat(); });

function sendChat() {
  const msg = el.chatInput.value.trim();
  if (!msg) return;
  socket.emit('chat-message', msg);
  el.chatInput.value = '';
}

socket.on('chat-message', (data) => {
  addChatMsg(data.username, data.message);
});

function addChatMsg(user, text) {
  const div = document.createElement('div');
  div.className = 'chat-msg';
  div.innerHTML = `<span class="chat-user">${escHtml(user)}</span><span class="chat-text">${escHtml(text)}</span>`;
  el.chatMessages.appendChild(div);
  el.chatMessages.scrollTop = el.chatMessages.scrollHeight;

  if (!state.chatOpen) {
    state.unreadChat++;
    el.chatBadge.textContent = state.unreadChat;
    el.chatBadge.classList.remove('hidden');
  }
}

function addSystemChat(text) {
  const div = document.createElement('div');
  div.className = 'chat-msg system';
  div.textContent = text;
  el.chatMessages.appendChild(div);
  el.chatMessages.scrollTop = el.chatMessages.scrollHeight;
}

function escHtml(str) {
  const d = document.createElement('div');
  d.textContent = str;
  return d.innerHTML;
}

// ── Error Handling ───────────────────────────────────────────
socket.on('error-msg', (msg) => toast(msg));
socket.on('connect_error', () => toast('Connection lost'));
socket.on('reconnect', () => toast('Reconnected'));

// ── Keyboard shortcuts ──────────────────────────────────────
document.addEventListener('keydown', (e) => {
  if (e.target.tagName === 'INPUT') return;
  if (state.myActions) {
    if (e.key === 'f') el.btnFold.click();
    if (e.key === 'c' && state.myActions.actions.includes('check')) el.btnCheck.click();
    if (e.key === 'c' && state.myActions.actions.includes('call') && !state.myActions.actions.includes('check')) el.btnCall.click();
    if (e.key === 'r' && state.myActions.actions.includes('raise')) el.btnRaise.click();
    if (e.key === 'a') el.btnAllin.click();
  }
});
