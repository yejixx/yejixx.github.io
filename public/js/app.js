// app.js — Poker Client (v3)

const socket = io();

// ── Suit / Rank helpers ──────────────────────────────────────
const SUIT_SYM = { s: '♠', h: '♥', d: '♦', c: '♣' };
const RANK_DISP = { T: '10', J: 'J', Q: 'Q', K: 'K', A: 'A' };
const RANKS_ORDER = ['2','3','4','5','6','7','8','9','T','J','Q','K','A'];
const HAND_NAMES = [
  'High Card','Pair','Two Pair','Three of a Kind',
  'Straight','Flush','Full House','Four of a Kind',
  'Straight Flush','Royal Flush',
];
function dispRank(r) { return RANK_DISP[r] || r; }
function isRed(suit) { return suit === 'h' || suit === 'd'; }

// ── Client-side Hand Evaluation (for "best hand" display) ────
function rvC(rank) { return RANKS_ORDER.indexOf(rank) + 2; }

function eval5C(cards) {
  const vals = cards.map(c => rvC(c.rank)).sort((a, b) => b - a);
  const suits = cards.map(c => c.suit);
  const isFlush = suits.every(s => s === suits[0]);
  let isStraight = false, straightHigh = vals[0];
  const unique = [...new Set(vals)];
  if (unique.length === 5) {
    if (vals[0] - vals[4] === 4) isStraight = true;
    if (vals[0] === 14 && vals[1] === 5 && vals[2] === 4 && vals[3] === 3 && vals[4] === 2) {
      isStraight = true; straightHigh = 5;
    }
  }
  const freq = {};
  vals.forEach(v => (freq[v] = (freq[v] || 0) + 1));
  const groups = Object.entries(freq)
    .map(([v, c]) => ({ val: parseInt(v), count: c }))
    .sort((a, b) => b.count - a.count || b.val - a.val);

  if (isStraight && isFlush) return { hr: straightHigh === 14 ? 9 : 8, name: HAND_NAMES[straightHigh === 14 ? 9 : 8] };
  if (groups[0].count === 4) return { hr: 7, name: HAND_NAMES[7] };
  if (groups[0].count === 3 && groups.length >= 2 && groups[1].count === 2) return { hr: 6, name: HAND_NAMES[6] };
  if (isFlush) return { hr: 5, name: HAND_NAMES[5] };
  if (isStraight) return { hr: 4, name: HAND_NAMES[4] };
  if (groups[0].count === 3) return { hr: 3, name: HAND_NAMES[3] };
  if (groups[0].count === 2 && groups.length >= 2 && groups[1].count === 2) return { hr: 2, name: HAND_NAMES[2] };
  if (groups[0].count === 2) return { hr: 1, name: HAND_NAMES[1] };
  return { hr: 0, name: HAND_NAMES[0] };
}

function combosC(arr, k) {
  if (k === 0) return [[]];
  if (arr.length < k) return [];
  const [first, ...rest] = arr;
  return [...combosC(rest, k - 1).map(c => [first, ...c]), ...combosC(rest, k)];
}

function getMyBestHandName() {
  if (state.myHand.length === 0) return '';
  const all = [...state.myHand, ...state.game.communityCards];
  if (all.length < 5) {
    // Preflop — check for pocket pair
    if (all.length >= 2 && all[0].rank === all[1].rank) return 'Pair';
    return 'High Card';
  }
  let best = null;
  for (const combo of combosC(all, 5)) {
    const r = eval5C(combo);
    if (!best || r.hr > best.hr) best = r;
  }
  return best ? best.name : '';
}

// ── State ────────────────────────────────────────────────────
const state = {
  screen: 'home',
  lobbyCode: null,
  isHost: false,
  hostSocketId: null,
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
    activeSeatOrder: [],
  },
  myActions: null,
  pendingApprovals: [],
  chatOpen: false,
  unreadChat: 0,
  playersOpen: false,
  displayedCommunityCount: 0,
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
  pokerTable: $('#poker-table'),
  communityCards: $('#community-cards'),
  potAmount: $('#pot-amount'),
  gameMessage: $('#game-message'),
  deckArea: $('#deck-area'),
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
  playersPanel: $('#players-panel'),
  playersHeader: $('#players-header'),
  playersList: $('#players-list'),
  playersCount: $('#players-count'),
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
socket.on('lobby-created', (data) => { state.hostSocketId = socket.id; enterLobby(data); });
socket.on('lobby-joined', (data) => enterLobby(data));

function enterLobby(data) {
  hideModal();
  state.lobbyCode = data.code;
  state.isHost = data.isHost;
  state.settings = { ...data.settings };
  state.mySeatIndex = -1;
  state.myUsername = null;
  state.seats = data.seats.map((s) => {
    if (!s) return null;
    if (s.isMe) { state.mySeatIndex = s.seatIndex; state.myUsername = s.username; }
    return { ...s };
  });

  el.lobbyCodeVal.textContent = data.code;
  el.hostControls.style.display = data.isHost ? 'flex' : 'none';
  showScreen('lobby-screen');
  renderSeats();
  renderPlayersPanel();
}

el.btnCopyCode.onclick = () => {
  navigator.clipboard.writeText(state.lobbyCode).then(() => toast('Code copied'));
};

// ── Players Panel ────────────────────────────────────────────
el.playersHeader.onclick = () => {
  state.playersOpen = !state.playersOpen;
  el.playersPanel.className = state.playersOpen ? 'panel-expanded' : 'panel-collapsed';
};

function renderPlayersPanel() {
  const seated = state.seats.filter(s => s);
  el.playersCount.textContent = seated.length;
  el.playersList.innerHTML = '';
  for (const s of seated) {
    const row = document.createElement('div');
    row.className = 'player-list-item';
    const nameSpan = document.createElement('span');
    nameSpan.className = 'player-list-name';
    nameSpan.textContent = s.username;
    if (s.socketId === state.hostSocketId || (state.isHost && s.isMe)) {
      const hb = document.createElement('span');
      hb.className = 'player-list-host';
      hb.textContent = 'HOST';
      nameSpan.appendChild(hb);
    }
    row.appendChild(nameSpan);
    const chips = document.createElement('span');
    chips.className = 'player-list-chips';
    const ps = state.game.playerStates[s.seatIndex];
    chips.textContent = (ps ? ps.chips : s.chips).toLocaleString();
    row.appendChild(chips);
    el.playersList.appendChild(row);
  }
}

// ── Seat Rendering ───────────────────────────────────────────
function renderSeats() {
  for (let i = 0; i < 8; i++) {
    const seatEl = $(`.seat[data-seat="${i}"]`);
    const data = state.seats[i];
    seatEl.innerHTML = '';

    if (!data) {
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
      const inHand = state.game.phase !== 'waiting' && ps && !ps.folded;

      // Check if cards should be revealed (all-in runout or own cards)
      if (inHand && ps.revealedHand) {
        // All-in runout: show revealed cards face-up
        for (const c of ps.revealedHand) cardsDiv.appendChild(createCardEl(c, true));
      } else if (inHand && i === state.mySeatIndex && state.myHand.length === 2) {
        for (const c of state.myHand) cardsDiv.appendChild(createCardEl(c, true));
      } else if (inHand) {
        cardsDiv.appendChild(createCardEl(null, false));
        cardsDiv.appendChild(createCardEl(null, false));
      }
      seatEl.appendChild(cardsDiv);

      // Info box
      const info = document.createElement('div');
      info.className = 'seat-info';
      const isMyTurn = state.game.currentPlayerSeatIndex === i;
      if (isMyTurn) info.classList.add('active-turn', 'pulse');
      if (ps && ps.folded) info.classList.add('folded');

      // "YOUR TURN" label for the current turn player (at their own seat)
      if (isMyTurn && i === state.mySeatIndex) {
        const turnLabel = document.createElement('div');
        turnLabel.className = 'your-turn-label';
        turnLabel.textContent = 'YOUR TURN';
        info.appendChild(turnLabel);
      }

      // Turn order number
      const orderIdx = state.game.activeSeatOrder.indexOf(i);
      if (orderIdx !== -1 && state.game.phase !== 'waiting' && ps && !ps.folded) {
        const orderBadge = document.createElement('div');
        orderBadge.className = 'turn-order-num';
        if (isMyTurn) orderBadge.classList.add('is-current');
        orderBadge.textContent = orderIdx + 1;
        info.appendChild(orderBadge);
      }

      const name = document.createElement('span');
      name.className = 'player-name';
      name.textContent = data.username;
      info.appendChild(name);

      const chips = document.createElement('span');
      chips.className = 'player-chips';
      chips.textContent = (ps ? ps.chips : data.chips).toLocaleString();
      info.appendChild(chips);

      if (ps && ps.currentBet > 0) {
        const bet = document.createElement('div');
        bet.className = 'player-bet-display';
        bet.textContent = ps.currentBet.toLocaleString();
        info.appendChild(bet);
      }

      // Best hand label (show for own seat during active game)
      if (i === state.mySeatIndex && inHand && state.game.phase !== 'waiting') {
        const handName = getMyBestHandName();
        if (handName) {
          const hl = document.createElement('div');
          hl.className = 'best-hand-label';
          hl.textContent = handName;
          info.appendChild(hl);
        }
      }

      seatEl.appendChild(info);

      // Badges (dealer/sb/bb)
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

      // Stat badges (wins / busts)
      const statBadges = document.createElement('div');
      statBadges.className = 'stat-badges';
      if (data.winCount > 0) {
        const wb = document.createElement('span');
        wb.className = 'stat-badge stat-badge-wins';
        wb.textContent = `${data.winCount}W`;
        statBadges.appendChild(wb);
      }
      if (data.bustCount > 0) {
        const bb = document.createElement('span');
        bb.className = 'stat-badge stat-badge-busts';
        bb.textContent = `${data.bustCount}L`;
        statBadges.appendChild(bb);
      }
      if (statBadges.children.length) seatEl.appendChild(statBadges);

      // Host kick button
      if (state.isHost && data.socketId !== socket.id && state.game.phase === 'waiting') {
        const kick = document.createElement('button');
        kick.className = 'btn-icon';
        kick.textContent = '✕';
        kick.title = 'Kick player';
        kick.style.cssText = 'font-size:0.65rem;margin-top:4px;';
        kick.onclick = (e) => { e.stopPropagation(); socket.emit('kick-player', i); };
        seatEl.appendChild(kick);
      }
    }
  }
  renderPlayersPanel();
}

// ── Card Elements ────────────────────────────────────────────
function createCardEl(card, faceUp) {
  const div = document.createElement('div');
  div.className = 'card' + (faceUp ? ' flipped' : '');
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
  div.appendChild(inner);
  return div;
}

function createCommunityCardEl(card, startFaceDown) {
  const div = document.createElement('div');
  div.className = 'card community-card' + (startFaceDown ? '' : ' flipped');
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
  div.appendChild(inner);
  return div;
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
    bustCount: data.bustCount || 0,
    winCount: data.winCount || 0,
  };
  if (data.socketId === socket.id) {
    state.mySeatIndex = data.seatIndex;
    state.myUsername = data.username;
    hideModal(); // Dismiss "waiting for approval" modal
  }
  renderSeats();
  addSystemChat(`${data.username} sat down`);
});

socket.on('player-left', (data) => {
  const seat = state.seats[data.seatIndex];
  if (seat) addSystemChat(`${seat.username} left the table`);
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

// ── Player Busted ────────────────────────────────────────────
socket.on('player-busted', (data) => {
  const seat = state.seats[data.seatIndex];
  const name = seat ? seat.username : data.username;
  addSystemChat(`${name} busted out! (${data.bustCount} time${data.bustCount > 1 ? 's' : ''})`);
  if (data.seatIndex === state.mySeatIndex) {
    state.mySeatIndex = -1;
    state.myUsername = null;
    state.myHand = [];
    toast('You busted! Sit down to rebuy.');
  }
  state.seats[data.seatIndex] = null;
  renderSeats();
});

// ── Cards Revealed (all-in runout) ───────────────────────────
socket.on('cards-revealed', (data) => {
  for (const { seatIndex, hand } of data.hands) {
    const ps = state.game.playerStates[seatIndex];
    if (ps) ps.revealedHand = hand;
  }
  renderSeats();
  addSystemChat('Cards revealed — all in!');
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
  state.hostSocketId = data.newHostSocketId;
  el.hostControls.style.display = state.isHost ? 'flex' : 'none';
  addSystemChat(`${data.username} is now the host`);
  renderPlayersPanel();
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
  addSystemChat(`Settings updated — Stack: ${settings.startingStack}, Blinds: ${settings.smallBlind}/${settings.bigBlind}`);
});

// ── Deal / Start ─────────────────────────────────────────────
el.btnDeal.onclick = () => socket.emit('start-game');

// ── Helpers: get deck center for animation origin ────────────
function getDeckCenter() {
  const deckRect = el.deckArea.getBoundingClientRect();
  return {
    x: deckRect.left + deckRect.width / 2,
    y: deckRect.top + deckRect.height / 2,
  };
}

function getSeatCardTarget(seatIndex) {
  const seatEl = $(`.seat[data-seat="${seatIndex}"]`);
  const rect = seatEl.getBoundingClientRect();
  return { x: rect.left + rect.width / 2, y: rect.top + 20 };
}

// Card sizes for animations (match CSS)
const SEAT_CARD_W = 58, SEAT_CARD_H = 79;
const COMM_CARD_W = 72, COMM_CARD_H = 101;

// ── Build turn order ─────────────────────────────────────────
function buildTurnOrder(players, dealerSeatIndex) {
  const sorted = [...players].sort((a, b) => a.seatIndex - b.seatIndex);
  const dIdx = sorted.findIndex(p => p.seatIndex === dealerSeatIndex);
  const ordered = [];
  for (let i = 1; i <= sorted.length; i++) {
    ordered.push(sorted[(dIdx + i) % sorted.length].seatIndex);
  }
  return ordered;
}

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
  state.displayedCommunityCount = 0;

  for (const p of data.players) {
    state.game.playerStates[p.seatIndex] = {
      chips: p.chips,
      currentBet: p.currentBet,
      folded: false,
      allIn: false,
      revealedHand: null,
    };
    if (state.seats[p.seatIndex]) state.seats[p.seatIndex].chips = p.chips;
  }

  state.game.activeSeatOrder = buildTurnOrder(data.players, data.dealerSeatIndex);

  el.potAmount.textContent = data.pot > 0 ? `POT ${data.pot.toLocaleString()}` : '';
  el.gameMessage.textContent = '';
  el.communityCards.innerHTML = '';
  el.actionBar.classList.add('hidden');
  state.myActions = null;

  showDeck();

  addSystemChat(`Hand #${data.handNumber || ''} — Dealer: Seat ${data.dealerSeatIndex + 1}`);

  placeCommunitySlots();

  animateDeal(data.players, () => {
    renderSeats();
  });
});

socket.on('your-hand', (data) => {
  state.myHand = data.hand;
  if (state.mySeatIndex >= 0) {
    const cardsDiv = document.getElementById(`seat-cards-${state.mySeatIndex}`);
    if (cardsDiv && cardsDiv.children.length === 0) renderSeats();
  }
});

// ── Place 5 face-down community slots ────────────────────────
function placeCommunitySlots() {
  el.communityCards.innerHTML = '';
  for (let i = 0; i < 5; i++) {
    const card = createCommunityCardEl(null, true);
    card.style.opacity = '0';
    card.dataset.slotIndex = i;
    el.communityCards.appendChild(card);
  }
}

// ── Show / Hide deck ─────────────────────────────────────────
function showDeck() { el.deckArea.classList.add('visible'); }
function hideDeck() { el.deckArea.classList.remove('visible'); }

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

el.raiseSlider.oninput = () => { el.raiseInput.value = el.raiseSlider.value; };
el.raiseInput.oninput = () => { el.raiseSlider.value = el.raiseInput.value; };

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
  const seat = state.seats[data.seatIndex];
  const name = seat ? seat.username : `Seat ${data.seatIndex + 1}`;

  if (ps) {
    ps.chips = data.chips;
    ps.currentBet = data.betAmount;
    if (data.action === 'fold') ps.folded = true;
    if (data.action === 'allin' || data.chips === 0) ps.allIn = true;
  }
  if (seat) seat.chips = data.chips;
  state.game.pot = data.pot;
  state.game.currentBet = data.currentBet;
  state.game.currentPlayerSeatIndex = data.nextPlayerSeatIndex;

  const actionText = {
    fold: 'folded',
    check: 'checked',
    call: `called ${data.betAmount.toLocaleString()}`,
    raise: `raised to ${data.betAmount.toLocaleString()}`,
    allin: `went all in (${data.betAmount.toLocaleString()})`,
  };
  addSystemChat(`${name} ${actionText[data.action] || data.action}`);

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

  for (const key in state.game.playerStates) {
    state.game.playerStates[key].currentBet = 0;
  }

  el.potAmount.textContent = data.pot > 0 ? `POT ${data.pot.toLocaleString()}` : '';

  const phaseNames = { flop: 'Flop', turn: 'Turn', river: 'River' };
  addSystemChat(`— ${phaseNames[data.phase] || data.phase} —`);

  animateNewCommunityCards(data.communityCards, () => {
    renderSeats();
  });
});

// ── Showdown ─────────────────────────────────────────────────
socket.on('showdown', (data) => {
  state.game.phase = 'showdown';
  state.game.communityCards = data.communityCards;

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

  revealAllCommunityCards();
  renderShowdown(data);

  const winners = data.potResults.flatMap(pr => pr.winners);
  const msg = winners.map(w => `${w.username} wins ${w.amount.toLocaleString()}`).join(' · ');
  el.gameMessage.textContent = msg;
  hideActionBar();

  for (const w of winners) addSystemChat(`${w.username} wins ${w.amount.toLocaleString()}`);

  // Update win counts on seat data
  for (const w of winners) {
    if (state.seats[w.seatIndex]) {
      state.seats[w.seatIndex].winCount = (state.seats[w.seatIndex].winCount || 0) + 1;
    }
  }

  setTimeout(() => {
    animateShuffle(() => {
      resetGameState();
      renderSeats();
    });
  }, 3500);
});

socket.on('hand-complete', (data) => {
  state.game.phase = 'complete';
  for (const p of data.players) {
    if (state.game.playerStates[p.seatIndex]) state.game.playerStates[p.seatIndex].chips = p.chips;
    if (state.seats[p.seatIndex]) state.seats[p.seatIndex].chips = p.chips;
  }

  const msg = data.winners.map(w => `${w.username} wins ${w.amount.toLocaleString()}`).join(' · ');
  el.gameMessage.textContent = msg;
  hideActionBar();

  // Update win counts
  for (const w of data.winners) {
    if (state.seats[w.seatIndex]) {
      state.seats[w.seatIndex].winCount = (state.seats[w.seatIndex].winCount || 0) + 1;
    }
  }
  renderSeats();

  for (const w of data.winners) addSystemChat(`${w.username} wins ${w.amount.toLocaleString()}`);

  setTimeout(() => {
    animateShuffle(() => {
      resetGameState();
      renderSeats();
    });
  }, 2500);
});

function resetGameState() {
  state.game.phase = 'waiting';
  state.game.communityCards = [];
  state.game.playerStates = {};
  state.game.currentPlayerSeatIndex = -1;
  state.game.dealerSeatIndex = -1;
  state.game.sbSeatIndex = -1;
  state.game.bbSeatIndex = -1;
  state.game.pot = 0;
  state.game.currentBet = 0;
  state.game.activeSeatOrder = [];
  state.myHand = [];
  state.displayedCommunityCount = 0;
  el.communityCards.innerHTML = '';
  el.potAmount.textContent = '';
  el.gameMessage.textContent = '';
  hideDeck();
}

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
      setTimeout(() => cardEl.classList.add('flipped'), 200);
    }
  }
  // Hand labels
  for (let i = 0; i < 8; i++) {
    const ps = state.game.playerStates[i];
    if (!ps || ps.folded || !ps.bestHand) continue;
    const seatEl = $(`.seat[data-seat="${i}"] .seat-info`);
    if (!seatEl) continue;
    let handLabel = seatEl.querySelector('.best-hand-label');
    if (!handLabel) {
      handLabel = document.createElement('div');
      handLabel.className = 'best-hand-label';
      seatEl.appendChild(handLabel);
    }
    handLabel.textContent = ps.bestHand.name;
  }
}

// ── Reveal all community cards (for showdown) ────────────────
function revealAllCommunityCards() {
  const slots = el.communityCards.querySelectorAll('.card.community-card');
  slots.forEach((slot, i) => {
    if (i < state.game.communityCards.length) {
      slot.style.opacity = '1';
      if (!slot.classList.contains('flipped')) {
        updateCardFace(slot, state.game.communityCards[i]);
        setTimeout(() => slot.classList.add('flipped'), i * 100);
      }
    }
  });
}

function updateCardFace(cardEl, card) {
  const front = cardEl.querySelector('.card-front');
  front.innerHTML = '';
  front.className = 'card-front' + (isRed(card.suit) ? ' red' : '');
  const rank = document.createElement('span');
  rank.className = 'card-rank';
  rank.textContent = dispRank(card.rank);
  front.appendChild(rank);
  const suit = document.createElement('span');
  suit.className = 'card-suit';
  suit.textContent = SUIT_SYM[card.suit];
  front.appendChild(suit);
}

// ── Animations ───────────────────────────────────────────────

// Deal cards from deck stack to each seat
function animateDeal(players, callback) {
  const origin = getDeckCenter();
  const totalCards = players.length * 2;
  let dealt = 0;

  if (totalCards === 0) { if (callback) callback(); return; }

  for (let round = 0; round < 2; round++) {
    for (let i = 0; i < players.length; i++) {
      const p = players[i];
      const target = getSeatCardTarget(p.seatIndex);
      const delay = (round * players.length + i) * 130;

      setTimeout(() => {
        const flyCard = document.createElement('div');
        flyCard.className = 'card card-dealing';
        flyCard.style.width = SEAT_CARD_W + 'px';
        flyCard.style.height = SEAT_CARD_H + 'px';

        const inner = document.createElement('div');
        inner.className = 'card-inner';
        const back = document.createElement('div');
        back.className = 'card-back';
        inner.appendChild(back);
        const front = document.createElement('div');
        front.className = 'card-front';
        inner.appendChild(front);
        flyCard.appendChild(inner);

        const halfW = SEAT_CARD_W / 2;
        const halfH = SEAT_CARD_H / 2;
        flyCard.style.left = (origin.x - halfW) + 'px';
        flyCard.style.top = (origin.y - halfH) + 'px';
        flyCard.style.opacity = '1';
        flyCard.style.transition = 'left .45s cubic-bezier(.22,.61,.36,1), top .45s cubic-bezier(.22,.61,.36,1), opacity .15s';
        document.body.appendChild(flyCard);

        requestAnimationFrame(() => {
          requestAnimationFrame(() => {
            flyCard.style.left = (target.x - halfW) + 'px';
            flyCard.style.top = (target.y - halfH) + 'px';
          });
        });

        setTimeout(() => {
          flyCard.style.opacity = '0';
          setTimeout(() => {
            flyCard.remove();
            dealt++;
            if (dealt === totalCards && callback) callback();
          }, 150);
        }, 470);
      }, delay);
    }
  }
}

// Animate new community cards — deal from deck face-down, then flip
function animateNewCommunityCards(allCards, callback) {
  const newCards = allCards.slice(state.displayedCommunityCount);
  const startIdx = state.displayedCommunityCount;
  const origin = getDeckCenter();

  let done = 0;
  if (newCards.length === 0) { if (callback) callback(); return; }

  newCards.forEach((card, ni) => {
    const slotIdx = startIdx + ni;
    const slot = el.communityCards.children[slotIdx];
    if (!slot) {
      done++;
      if (done === newCards.length) {
        state.displayedCommunityCount = allCards.length;
        if (callback) callback();
      }
      return;
    }

    // Make slot visible (still face down) and set card face data
    slot.style.opacity = '1';
    updateCardFace(slot, card);

    // Create flying card from deck
    const flyCard = document.createElement('div');
    flyCard.className = 'card community-card card-dealing';
    flyCard.style.width = COMM_CARD_W + 'px';
    flyCard.style.height = COMM_CARD_H + 'px';

    const inner = document.createElement('div');
    inner.className = 'card-inner';
    const back = document.createElement('div');
    back.className = 'card-back';
    inner.appendChild(back);
    const front = document.createElement('div');
    front.className = 'card-front';
    inner.appendChild(front);
    flyCard.appendChild(inner);

    const halfW = COMM_CARD_W / 2;
    const halfH = COMM_CARD_H / 2;
    flyCard.style.left = (origin.x - halfW) + 'px';
    flyCard.style.top = (origin.y - halfH) + 'px';
    flyCard.style.opacity = '1';
    flyCard.style.transition = 'left .5s cubic-bezier(.22,.61,.36,1), top .5s cubic-bezier(.22,.61,.36,1), opacity .15s';
    document.body.appendChild(flyCard);

    const delay = ni * 200;

    setTimeout(() => {
      // Calculate slot target position
      const slotRect = slot.getBoundingClientRect();
      const targetX = slotRect.left + slotRect.width / 2 - halfW;
      const targetY = slotRect.top + slotRect.height / 2 - halfH;

      // Hide slot while flying card approaches
      slot.style.visibility = 'hidden';

      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          flyCard.style.left = targetX + 'px';
          flyCard.style.top = targetY + 'px';
        });
      });

      // After arrival: remove flyer, show slot face-down, then flip
      setTimeout(() => {
        flyCard.remove();
        slot.style.visibility = 'visible';

        // Flip to reveal
        setTimeout(() => {
          slot.classList.add('flipped');
          done++;
          if (done === newCards.length) {
            state.displayedCommunityCount = allCards.length;
            if (callback) callback();
          }
        }, 150);
      }, 530);
    }, delay);
  });
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

socket.on('chat-message', (data) => addChatMsg(data.username, data.message));

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

  if (!state.chatOpen) {
    state.unreadChat++;
    el.chatBadge.textContent = state.unreadChat;
    el.chatBadge.classList.remove('hidden');
  }
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
