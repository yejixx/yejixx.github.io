// app.js — Poker Client (v3)

const socket = io();

// ── Suit / Rank helpers ──────────────────────────────────────
const SUIT_SYM = { s: '♠', h: '♥', d: '♦', c: '♣' };
const RANK_DISP = { T: '10', J: 'J', Q: 'Q', K: 'K', A: 'A' };
function dispRank(r) { return RANK_DISP[r] || r; }
function isRed(suit) { return suit === 'h' || suit === 'd'; }

// ── Client-Side Hand Evaluator ───────────────────────────────
const RANK_ORD = ['2','3','4','5','6','7','8','9','T','J','Q','K','A'];
const HAND_LABELS = ['High Card','Pair','Two Pair','Three of a Kind','Straight','Flush','Full House','Four of a Kind','Straight Flush','Royal Flush'];

function rvC(r) { return RANK_ORD.indexOf(r) + 2; }

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
  vals.forEach(v => freq[v] = (freq[v] || 0) + 1);
  const groups = Object.entries(freq).map(([v, c]) => ({ val: +v, count: c })).sort((a, b) => b.count - a.count || b.val - a.val);

  if (isStraight && isFlush) { const r = straightHigh === 14 ? 9 : 8; return { rank: r, name: HAND_LABELS[r], score: [r, straightHigh] }; }
  if (groups[0].count === 4) return { rank: 7, name: HAND_LABELS[7], score: [7, groups[0].val, groups[1].val] };
  if (groups[0].count === 3 && groups.length >= 2 && groups[1].count === 2) return { rank: 6, name: HAND_LABELS[6], score: [6, groups[0].val, groups[1].val] };
  if (isFlush) return { rank: 5, name: HAND_LABELS[5], score: [5, ...vals] };
  if (isStraight) return { rank: 4, name: HAND_LABELS[4], score: [4, straightHigh] };
  if (groups[0].count === 3) return { rank: 3, name: HAND_LABELS[3], score: [3, groups[0].val] };
  if (groups[0].count === 2 && groups.length >= 2 && groups[1].count === 2) {
    const p1 = Math.max(groups[0].val, groups[1].val), p2 = Math.min(groups[0].val, groups[1].val);
    return { rank: 2, name: HAND_LABELS[2], score: [2, p1, p2] };
  }
  if (groups[0].count === 2) return { rank: 1, name: HAND_LABELS[1], score: [1, groups[0].val] };
  return { rank: 0, name: HAND_LABELS[0], score: [0, ...vals] };
}

function combosC(arr, k) {
  if (k === 0) return [[]];
  if (arr.length < k) return [];
  const [first, ...rest] = arr;
  return [...combosC(rest, k - 1).map(c => [first, ...c]), ...combosC(rest, k)];
}

function cmpScores(a, b) {
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    if ((a[i] || 0) !== (b[i] || 0)) return (a[i] || 0) - (b[i] || 0);
  }
  return 0;
}

function getMyBestHand(hole, community) {
  if (hole.length < 2 || community.length < 3) return null;
  const all = [...hole, ...community];
  let best = null;
  for (const combo of combosC(all, 5)) {
    const r = eval5C(combo);
    if (!best || cmpScores(r.score, best.score) > 0) best = r;
  }
  return best;
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
  maxSeats: 8,
  seats: [],
  settings: { startingStack: 1000, smallBlind: 5, bigBlind: 10 },
  lobbyName: '',
  isPublic: true,
  autoAccept: false,
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
  findRefreshTimer: null,
};

// ── DOM refs ─────────────────────────────────────────────────
const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => document.querySelectorAll(sel);

const el = {
  homeScreen: $('#home-screen'),
  findScreen: $('#find-screen'),
  lobbyScreen: $('#lobby-screen'),
  btnCreate: $('#btn-create'),
  btnFind: $('#btn-find'),
  btnJoin: $('#btn-join'),
  btnFindBack: $('#btn-find-back'),
  btnFindRefresh: $('#btn-find-refresh'),
  findSearchInput: $('#find-search-input'),
  findLobbyList: $('#find-lobby-list'),
  findEmpty: $('#find-empty'),
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
  createModal: $('#create-modal'),
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
el.btnCreate.onclick = () => {
  $('#create-name').value = '';
  $('#create-public').checked = true;
  $('#create-auto-accept').checked = false;
  $('#create-max-seats').value = '8';
  $('#create-stack').value = '1000';
  $('#create-sb').value = '5';
  $('#create-bb').value = '10';
  showModal('create-modal');
  $('#create-name').focus();
};

$('#btn-create-confirm').onclick = () => {
  socket.emit('create-lobby', {
    lobbyName: $('#create-name').value.trim(),
    isPublic: $('#create-public').checked,
    autoAccept: $('#create-auto-accept').checked,
    maxSeats: parseInt($('#create-max-seats').value) || 8,
    startingStack: parseInt($('#create-stack').value) || 1000,
    smallBlind: parseInt($('#create-sb').value) || 5,
    bigBlind: parseInt($('#create-bb').value) || 10,
  });
};
$('#btn-create-cancel').onclick = hideModal;

el.btnJoin.onclick = () => {
  el.joinCodeInput.value = '';
  showModal('join-modal');
  el.joinCodeInput.focus();
};
$('#btn-join-confirm').onclick = () => {
  const code = el.joinCodeInput.value.trim();
  if (code.length < 4) { toast('Enter a valid code'); return; }
  socket.emit('join-lobby', code);
};
$('#btn-join-cancel').onclick = hideModal;
el.joinCodeInput.addEventListener('keydown', e => { if (e.key === 'Enter') $('#btn-join-confirm').click(); });

// ── Find Lobby Screen ────────────────────────────────────────
el.btnFind.onclick = () => {
  showScreen('find-screen');
  el.findSearchInput.value = '';
  socket.emit('list-public-lobbies');
  if (state.findRefreshTimer) clearInterval(state.findRefreshTimer);
  state.findRefreshTimer = setInterval(() => {
    if (state.screen === 'find') socket.emit('list-public-lobbies');
  }, 5000);
};

el.btnFindBack.onclick = () => {
  showScreen('home-screen');
  if (state.findRefreshTimer) { clearInterval(state.findRefreshTimer); state.findRefreshTimer = null; }
};

el.btnFindRefresh.onclick = () => socket.emit('list-public-lobbies');

el.findSearchInput.oninput = () => filterLobbyList();

let allPublicLobbies = [];

socket.on('public-lobbies', (list) => {
  allPublicLobbies = list;
  filterLobbyList();
});

function filterLobbyList() {
  const q = el.findSearchInput.value.trim().toLowerCase();
  const filtered = q
    ? allPublicLobbies.filter(l => l.lobbyName.toLowerCase().includes(q) || l.code.toLowerCase().includes(q))
    : allPublicLobbies;

  el.findLobbyList.innerHTML = '';
  el.findEmpty.classList.toggle('hidden', filtered.length > 0);

  for (const lobby of filtered) {
    const card = document.createElement('div');
    card.className = 'lobby-card';

    const info = document.createElement('div');
    info.className = 'lobby-card-info';

    const topRow = document.createElement('div');
    topRow.className = 'lobby-card-top';

    const name = document.createElement('span');
    name.className = 'lobby-card-name';
    name.textContent = lobby.lobbyName;
    topRow.appendChild(name);

    const code = document.createElement('span');
    code.className = 'lobby-card-code';
    code.textContent = lobby.code;
    topRow.appendChild(code);

    const status = document.createElement('span');
    status.className = 'lobby-card-status ' + (lobby.gameInProgress ? 'in-progress' : 'waiting');
    status.textContent = lobby.gameInProgress ? 'IN GAME' : 'WAITING';
    topRow.appendChild(status);

    info.appendChild(topRow);

    const details = document.createElement('div');
    details.className = 'lobby-card-details';
    details.innerHTML = `<span>${lobby.playerCount}/${lobby.maxSeats} players</span><span>Stack: ${lobby.startingStack.toLocaleString()}</span><span>Blinds: ${lobby.smallBlind}/${lobby.bigBlind}</span>`;
    info.appendChild(details);

    card.appendChild(info);

    const joinBtn = document.createElement('button');
    joinBtn.className = 'lobby-card-join';
    joinBtn.textContent = 'JOIN';
    joinBtn.onclick = (e) => {
      e.stopPropagation();
      if (state.findRefreshTimer) { clearInterval(state.findRefreshTimer); state.findRefreshTimer = null; }
      socket.emit('join-lobby', lobby.code);
    };
    card.appendChild(joinBtn);

    card.onclick = () => {
      if (state.findRefreshTimer) { clearInterval(state.findRefreshTimer); state.findRefreshTimer = null; }
      socket.emit('join-lobby', lobby.code);
    };

    el.findLobbyList.appendChild(card);
  }
}

// ── Lobby Events ─────────────────────────────────────────────
socket.on('lobby-created', (data) => { state.hostSocketId = socket.id; enterLobby(data); });
socket.on('lobby-joined', (data) => enterLobby(data));

function enterLobby(data) {
  hideModal();
  if (state.findRefreshTimer) { clearInterval(state.findRefreshTimer); state.findRefreshTimer = null; }

  state.lobbyCode = data.code;
  state.isHost = data.isHost;
  state.settings = { ...data.settings };
  state.lobbyName = data.lobbyName || data.code;
  state.isPublic = data.isPublic !== false;
  state.autoAccept = !!data.autoAccept;
  state.maxSeats = data.maxSeats || 8;
  state.mySeatIndex = -1;
  state.myUsername = null;
  state.myHand = [];
  state.seats = [];

  for (let i = 0; i < state.maxSeats; i++) {
    const s = data.seats[i] || null;
    if (s) {
      if (s.isMe) { state.mySeatIndex = s.seatIndex; state.myUsername = s.username; }
      state.seats.push({ ...s });
    } else {
      state.seats.push(null);
    }
  }

  el.lobbyCodeVal.textContent = data.code;
  el.hostControls.style.display = data.isHost ? 'flex' : 'none';
  showScreen('lobby-screen');
  createAndPositionSeats(state.maxSeats);
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

// ── Dynamic Seat Creation ────────────────────────────────────
function createAndPositionSeats(maxSeats) {
  // Remove existing seats
  el.tableArea.querySelectorAll('.seat').forEach(e => e.remove());

  for (let i = 0; i < maxSeats; i++) {
    const seatEl = document.createElement('div');
    seatEl.className = 'seat';
    seatEl.dataset.seat = i;

    // Position around ellipse (counterclockwise from bottom)
    const t = (2 * Math.PI / maxSeats) * i;
    const xFactor = -Math.sin(t);
    const yFactor = Math.cos(t);

    seatEl.style.left = `calc(50% + ${xFactor.toFixed(4)} * min(38vw, 400px))`;
    seatEl.style.top = `calc(50% + ${yFactor.toFixed(4)} * min(28vw, 295px))`;

    el.tableArea.appendChild(seatEl);
  }
}

// ── Seat Rendering ───────────────────────────────────────────
function renderSeats() {
  for (let i = 0; i < state.maxSeats; i++) {
    const seatEl = $(`.seat[data-seat="${i}"]`);
    if (!seatEl) continue;
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

      if (inHand && i === state.mySeatIndex && state.myHand.length === 2) {
        for (const c of state.myHand) cardsDiv.appendChild(createCardEl(c, true));
      } else if (inHand && ps && ps.revealedHand) {
        // All-in revealed cards
        for (const c of ps.revealedHand) {
          const cardEl = createCardEl(c, false);
          cardsDiv.appendChild(cardEl);
          setTimeout(() => cardEl.classList.add('flipped'), 100);
        }
      } else if (inHand) {
        cardsDiv.appendChild(createCardEl(null, false));
        cardsDiv.appendChild(createCardEl(null, false));
      }
      seatEl.appendChild(cardsDiv);

      // Info box
      const info = document.createElement('div');
      info.className = 'seat-info';
      if (state.game.currentPlayerSeatIndex === i) info.classList.add('active-turn', 'pulse');
      if (ps && ps.folded) info.classList.add('folded');

      // Turn order number
      const orderIdx = state.game.activeSeatOrder.indexOf(i);
      if (orderIdx !== -1 && state.game.phase !== 'waiting' && ps && !ps.folded) {
        const orderBadge = document.createElement('div');
        orderBadge.className = 'turn-order-num';
        if (state.game.currentPlayerSeatIndex === i) orderBadge.classList.add('is-current');
        orderBadge.textContent = orderIdx + 1;
        info.appendChild(orderBadge);
      }

      // YOUR TURN label
      if (state.game.currentPlayerSeatIndex === i && i === state.mySeatIndex) {
        const turnLabel = document.createElement('div');
        turnLabel.className = 'your-turn-label';
        turnLabel.textContent = 'YOUR TURN';
        info.appendChild(turnLabel);
      }

      // Name row with position badges
      const nameRow = document.createElement('div');
      nameRow.className = 'seat-name-row';
      const nameSpan = document.createElement('span');
      nameSpan.className = 'player-name';
      nameSpan.textContent = data.username;
      nameRow.appendChild(nameSpan);

      if (state.game.dealerSeatIndex === i) {
        const b = document.createElement('span'); b.className = 'badge badge-dealer'; b.textContent = 'D'; nameRow.appendChild(b);
      }
      if (state.game.sbSeatIndex === i) {
        const b = document.createElement('span'); b.className = 'badge badge-sb'; b.textContent = 'SB'; nameRow.appendChild(b);
      }
      if (state.game.bbSeatIndex === i) {
        const b = document.createElement('span'); b.className = 'badge badge-bb'; b.textContent = 'BB'; nameRow.appendChild(b);
      }
      info.appendChild(nameRow);

      // Chips row
      const chipsRow = document.createElement('div');
      chipsRow.className = 'seat-chips-row';
      const chipsSpan = document.createElement('span');
      chipsSpan.className = 'player-chips';
      chipsSpan.textContent = (ps ? ps.chips : data.chips).toLocaleString();
      chipsRow.appendChild(chipsSpan);
      info.appendChild(chipsRow);

      // Bet display
      if (ps && ps.currentBet > 0) {
        const bet = document.createElement('div');
        bet.className = 'player-bet-display';
        bet.textContent = 'BET ' + ps.currentBet.toLocaleString();
        info.appendChild(bet);
      }

      // Best hand display (for own cards)
      if (i === state.mySeatIndex && state.myHand.length === 2 && state.game.communityCards.length >= 3) {
        const best = getMyBestHand(state.myHand, state.game.communityCards);
        if (best) {
          const handLabel = document.createElement('div');
          handLabel.className = 'best-hand-label';
          handLabel.textContent = best.name;
          info.appendChild(handLabel);
        }
      }

      // Stat badges
      const wc = data.winCount || 0;
      const bc = data.bustCount || 0;
      if (wc > 0 || bc > 0) {
        const statDiv = document.createElement('div');
        statDiv.className = 'stat-badges';
        if (wc > 0) {
          const ws = document.createElement('span');
          ws.className = 'stat-badge stat-badge-wins';
          ws.textContent = `W ${wc}`;
          statDiv.appendChild(ws);
        }
        if (bc > 0) {
          const bs = document.createElement('span');
          bs.className = 'stat-badge stat-badge-busts';
          bs.textContent = `B ${bc}`;
          statDiv.appendChild(bs);
        }
        info.appendChild(statDiv);
      }

      seatEl.appendChild(info);

      // Pending next round badge
      if (data.pendingNextRound) {
        const pb = document.createElement('span');
        pb.className = 'badge badge-pending';
        pb.textContent = 'NEXT ROUND';
        seatEl.appendChild(pb);
      }

      // Host kick button
      if (state.isHost && data.socketId !== socket.id && state.game.phase === 'waiting') {
        const kick = document.createElement('button');
        kick.className = 'btn-kick';
        kick.textContent = '✕ KICK';
        kick.title = 'Kick player';
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
    hideModal(); // dismiss waiting-approval
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
  $('#setting-name').value = state.lobbyName || '';
  $('#setting-public').checked = state.isPublic;
  $('#setting-auto-accept').checked = state.autoAccept;
  $('#setting-max-seats').value = state.maxSeats;
  $('#setting-stack').value = state.settings.startingStack;
  $('#setting-sb').value = state.settings.smallBlind;
  $('#setting-bb').value = state.settings.bigBlind;
  showModal('settings-modal');
};
$('#btn-settings-save').onclick = () => {
  const s = {
    lobbyName: $('#setting-name').value.trim(),
    isPublic: $('#setting-public').checked,
    autoAccept: $('#setting-auto-accept').checked,
    maxSeats: parseInt($('#setting-max-seats').value) || 8,
    startingStack: parseInt($('#setting-stack').value) || 1000,
    smallBlind: parseInt($('#setting-sb').value) || 5,
    bigBlind: parseInt($('#setting-bb').value) || 10,
  };
  socket.emit('update-settings', s);
  hideModal();
};
$('#btn-settings-cancel').onclick = hideModal;

socket.on('settings-updated', (settings) => {
  state.settings.startingStack = settings.startingStack;
  state.settings.smallBlind = settings.smallBlind;
  state.settings.bigBlind = settings.bigBlind;
  if (settings.maxSeats !== undefined) {
    const oldMax = state.maxSeats;
    state.maxSeats = settings.maxSeats;
    if (settings.maxSeats !== oldMax) {
      // Resize seats array
      while (state.seats.length < settings.maxSeats) state.seats.push(null);
      if (state.seats.length > settings.maxSeats) state.seats.length = settings.maxSeats;
      createAndPositionSeats(settings.maxSeats);
    }
  }
  if (settings.autoAccept !== undefined) state.autoAccept = settings.autoAccept;
  if (settings.isPublic !== undefined) state.isPublic = settings.isPublic;
  if (settings.lobbyName !== undefined) state.lobbyName = settings.lobbyName;
  addSystemChat(`Settings updated — Stack: ${settings.startingStack}, Blinds: ${settings.smallBlind}/${settings.bigBlind}, Seats: ${state.maxSeats}`);
  renderSeats();
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
  return { x: rect.left + rect.width / 2, y: rect.top + 16 };
}

function getCommunityCardTarget(index) {
  const containerRect = el.communityCards.getBoundingClientRect();
  const cardW = 60, gap = 8;
  const totalW = 5 * cardW + 4 * gap;
  const startX = containerRect.left + (containerRect.width - totalW) / 2;
  return {
    x: startX + index * (cardW + gap) + cardW / 2,
    y: containerRect.top + containerRect.height / 2,
  };
}

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
  renderSeats(); // refresh to show YOUR TURN label
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

// ── Cards Revealed (all-in runout) ───────────────────────────
socket.on('cards-revealed', (data) => {
  for (const h of data.hands) {
    const ps = state.game.playerStates[h.seatIndex];
    if (ps) ps.revealedHand = h.hand;
  }
  renderSeats();
});

// ── Player Busted ────────────────────────────────────────────
socket.on('player-busted', (data) => {
  const seat = state.seats[data.seatIndex];
  if (seat) {
    addSystemChat(`${data.username} busted out (bust #${data.bustCount})`);
  }
  if (data.seatIndex === state.mySeatIndex) {
    state.mySeatIndex = -1;
    state.myUsername = null;
    state.myHand = [];
    toast('You busted! Sit down again to rebuy.');
  }
  state.seats[data.seatIndex] = null;
  renderSeats();
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

  // Update win counts locally
  for (const w of winners) {
    const seat = state.seats[w.seatIndex];
    if (seat) seat.winCount = (seat.winCount || 0) + 1;
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
  renderSeats();

  for (const w of data.winners) {
    addSystemChat(`${w.username} wins ${w.amount.toLocaleString()}`);
    const seat = state.seats[w.seatIndex];
    if (seat) seat.winCount = (seat.winCount || 0) + 1;
  }

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
  for (let i = 0; i < state.maxSeats; i++) {
    const ps = state.game.playerStates[i];
    if (!ps || ps.folded || !ps.hand) continue;
    const cardsDiv = document.getElementById(`seat-cards-${i}`);
    if (!cardsDiv) continue;
    cardsDiv.innerHTML = '';
    for (const c of ps.hand) {
      const cardEl = createCardEl(c, false);
      cardsDiv.appendChild(cardEl);
      setTimeout(() => cardEl.classList.add('flipped'), 150);
    }
  }
  // Hand labels
  for (let i = 0; i < state.maxSeats; i++) {
    const ps = state.game.playerStates[i];
    if (!ps || ps.folded || !ps.bestHand) continue;
    const seatEl = $(`.seat[data-seat="${i}"] .seat-info`);
    if (!seatEl) continue;
    let handLabel = seatEl.querySelector('.hand-label');
    if (!handLabel) {
      handLabel = document.createElement('div');
      handLabel.className = 'hand-label';
      seatEl.appendChild(handLabel);
    }
    handLabel.textContent = ps.bestHand.name;
  }
}

// ── Reveal all community cards (for showdown) ────────────────
function revealAllCommunityCards() {
  const slots = el.communityCards.querySelectorAll('.card.community-card');
  slots.forEach((slot, i) => {
    if (state.game.communityCards[i] && !slot.classList.contains('flipped')) {
      updateCardFace(slot, state.game.communityCards[i]);
      slot.style.opacity = '1';
      setTimeout(() => slot.classList.add('flipped'), i * 80);
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

function animateDeal(players, callback) {
  const origin = getDeckCenter();
  const totalCards = players.length * 2;
  let dealt = 0;

  if (totalCards === 0) { if (callback) callback(); return; }

  for (let round = 0; round < 2; round++) {
    for (let i = 0; i < players.length; i++) {
      const p = players[i];
      const target = getSeatCardTarget(p.seatIndex);
      const delay = (round * players.length + i) * 120;

      setTimeout(() => {
        const flyCard = document.createElement('div');
        flyCard.className = 'card card-dealing';
        flyCard.style.width = '48px';
        flyCard.style.height = '66px';

        const inner = document.createElement('div');
        inner.className = 'card-inner';
        const back = document.createElement('div');
        back.className = 'card-back';
        inner.appendChild(back);
        const front = document.createElement('div');
        front.className = 'card-front';
        inner.appendChild(front);
        flyCard.appendChild(inner);

        flyCard.style.left = (origin.x - 24) + 'px';
        flyCard.style.top = (origin.y - 33) + 'px';
        flyCard.style.opacity = '1';
        flyCard.style.transition = 'left .4s cubic-bezier(.25,.46,.45,.94), top .4s cubic-bezier(.25,.46,.45,.94), opacity .15s';
        document.body.appendChild(flyCard);

        requestAnimationFrame(() => {
          requestAnimationFrame(() => {
            flyCard.style.left = (target.x - 24) + 'px';
            flyCard.style.top = (target.y - 33) + 'px';
          });
        });

        setTimeout(() => {
          flyCard.style.opacity = '0';
          setTimeout(() => {
            flyCard.remove();
            dealt++;
            if (dealt === totalCards && callback) callback();
          }, 150);
        }, 420);
      }, delay);
    }
  }
}

function animateNewCommunityCards(allCards, callback) {
  const newCards = allCards.slice(state.displayedCommunityCount);
  const startIdx = state.displayedCommunityCount;
  const origin = getDeckCenter();

  let done = 0;
  if (newCards.length === 0) { if (callback) callback(); return; }

  newCards.forEach((card, ni) => {
    const slotIdx = startIdx + ni;
    const slot = el.communityCards.children[slotIdx];
    if (!slot) return;

    slot.style.opacity = '1';
    updateCardFace(slot, card);

    const flyCard = document.createElement('div');
    flyCard.className = 'card community-card card-dealing';
    flyCard.style.width = '60px';
    flyCard.style.height = '84px';

    const inner = document.createElement('div');
    inner.className = 'card-inner';
    const back = document.createElement('div');
    back.className = 'card-back';
    inner.appendChild(back);
    const front = document.createElement('div');
    front.className = 'card-front';
    inner.appendChild(front);
    flyCard.appendChild(inner);

    flyCard.style.left = (origin.x - 30) + 'px';
    flyCard.style.top = (origin.y - 42) + 'px';
    flyCard.style.opacity = '1';
    flyCard.style.transition = 'left .45s cubic-bezier(.25,.46,.45,.94), top .45s cubic-bezier(.25,.46,.45,.94), opacity .15s';
    document.body.appendChild(flyCard);

    const slotRect = slot.getBoundingClientRect();
    const targetX = slotRect.left + slotRect.width / 2 - 30;
    const targetY = slotRect.top + slotRect.height / 2 - 42;

    const delay = ni * 180;

    setTimeout(() => {
      slot.style.visibility = 'hidden';

      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          flyCard.style.left = targetX + 'px';
          flyCard.style.top = targetY + 'px';
        });
      });

      setTimeout(() => {
        flyCard.remove();
        slot.style.visibility = 'visible';

        setTimeout(() => {
          slot.classList.add('flipped');
          done++;
          if (done === newCards.length) {
            state.displayedCommunityCount = allCards.length;
            if (callback) callback();
          }
        }, 120);
      }, 480);
    }, delay);
  });
}

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
