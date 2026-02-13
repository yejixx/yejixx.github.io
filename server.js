// server.js — Poker Site WebSocket Server

const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const { PokerGame, SUIT_SYMBOLS, displayRank } = require('./poker-engine');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static('public'));

// ── State ────────────────────────────────────────────────────

const lobbies = new Map();
const socketLobby = new Map();   // socketId → lobbyCode

function generateCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  for (let i = 0; i < 6; i++) code += chars[Math.floor(Math.random() * chars.length)];
  return code;
}

function lobbyState(lobby, forSocketId) {
  const isHost = lobby.hostId === forSocketId;
  return {
    code: lobby.code,
    isHost,
    settings: { ...lobby.settings },
    seats: lobby.seats.map(s => s ? {
      username: s.username,
      seatIndex: s.seatIndex,
      chips: s.chips,
      approved: s.approved,
      pendingNextRound: s.pendingNextRound,
      isMe: s.socketId === forSocketId,
      socketId: s.socketId,
      connected: s.connected,
      bustCount: s.bustCount || 0,
      winCount: s.winCount || 0,
    } : null),
    gameInProgress: lobby.game !== null && lobby.game.phase !== 'waiting' && lobby.game.phase !== 'complete',
  };
}

// ── Socket Handling ──────────────────────────────────────────

io.on('connection', (socket) => {

  // ── Create Lobby ───────────────────────────────────────────
  socket.on('create-lobby', () => {
    let code;
    do { code = generateCode(); } while (lobbies.has(code));

    const lobby = {
      code,
      hostId: socket.id,
      seats: Array(8).fill(null),
      spectators: new Set([socket.id]),
      settings: { startingStack: 1000, smallBlind: 5, bigBlind: 10 },
      game: null,
      pendingApprovals: [],
      handCount: 0,
      playerStats: new Map(),  // socketId → { bustCount, winCount }
    };

    lobbies.set(code, lobby);
    socket.join(code);
    socketLobby.set(socket.id, code);
    socket.emit('lobby-created', lobbyState(lobby, socket.id));
  });

  // ── Join Lobby ─────────────────────────────────────────────
  socket.on('join-lobby', (code) => {
    code = (code || '').toUpperCase().trim();
    const lobby = lobbies.get(code);
    if (!lobby) { socket.emit('error-msg', 'Lobby not found'); return; }

    lobby.spectators.add(socket.id);
    socket.join(code);
    socketLobby.set(socket.id, code);
    socket.emit('lobby-joined', lobbyState(lobby, socket.id));
  });

  // ── Request Seat ───────────────────────────────────────────
  socket.on('request-seat', ({ seatIndex, username }) => {
    const lobby = getLobby(socket);
    if (!lobby) return;
    if (seatIndex < 0 || seatIndex > 7 || lobby.seats[seatIndex]) {
      socket.emit('error-msg', 'Seat unavailable');
      return;
    }
    // Already seated?
    if (lobby.seats.some(s => s && s.socketId === socket.id)) {
      socket.emit('error-msg', 'Already seated');
      return;
    }

    const gameActive = lobby.game && !['waiting', 'complete'].includes(lobby.game.phase);

    if (socket.id === lobby.hostId) {
      seatPlayer(lobby, socket.id, seatIndex, username, gameActive);
    } else {
      lobby.pendingApprovals.push({ socketId: socket.id, seatIndex, username });
      io.to(lobby.hostId).emit('approval-request', { socketId: socket.id, seatIndex, username });
      socket.emit('waiting-approval');
    }
  });

  // ── Approve / Deny ────────────────────────────────────────
  socket.on('approve-player', (targetSocketId) => {
    const lobby = getLobby(socket);
    if (!lobby || socket.id !== lobby.hostId) return;
    const idx = lobby.pendingApprovals.findIndex(p => p.socketId === targetSocketId);
    if (idx === -1) return;
    const req = lobby.pendingApprovals.splice(idx, 1)[0];
    if (lobby.seats[req.seatIndex]) {
      io.to(targetSocketId).emit('error-msg', 'Seat was taken');
      return;
    }
    const gameActive = lobby.game && !['waiting', 'complete'].includes(lobby.game.phase);
    seatPlayer(lobby, req.socketId, req.seatIndex, req.username, gameActive);
  });

  socket.on('deny-player', (targetSocketId) => {
    const lobby = getLobby(socket);
    if (!lobby || socket.id !== lobby.hostId) return;
    lobby.pendingApprovals = lobby.pendingApprovals.filter(p => p.socketId !== targetSocketId);
    io.to(targetSocketId).emit('seat-denied');
  });

  // ── Leave Seat ─────────────────────────────────────────────
  socket.on('leave-seat', () => {
    const lobby = getLobby(socket);
    if (!lobby) return;
    const seatIdx = lobby.seats.findIndex(s => s && s.socketId === socket.id);
    if (seatIdx === -1) return;

    // If game active, fold them
    if (lobby.game && !['waiting', 'complete'].includes(lobby.game.phase)) {
      const result = lobby.game.handleAction(seatIdx, 'fold');
      if (result && !result.error) broadcastAction(lobby, result);
    }

    lobby.seats[seatIdx] = null;
    io.to(lobby.code).emit('player-left', { seatIndex: seatIdx });
  });

  // ── Start / Deal ───────────────────────────────────────────
  socket.on('start-game', () => {
    const lobby = getLobby(socket);
    if (!lobby || socket.id !== lobby.hostId) return;

    // Activate pending-next-round players
    for (const s of lobby.seats) {
      if (s && s.pendingNextRound) s.pendingNextRound = false;
    }

    const activePlayers = lobby.seats
      .filter(s => s && s.approved && !s.pendingNextRound && s.chips > 0 && s.connected !== false)
      .map(s => ({ seatIndex: s.seatIndex, username: s.username, socketId: s.socketId, chips: s.chips }));

    if (activePlayers.length < 2) {
      socket.emit('error-msg', 'Need at least 2 seated players with chips');
      return;
    }

    if (!lobby.game) lobby.game = new PokerGame(lobby.settings);
    lobby.game.settings = { ...lobby.settings };
    lobby.game._allInRevealed = false;
    lobby.handCount++;

    const result = lobby.game.startHand(activePlayers);
    if (!result) { socket.emit('error-msg', 'Could not start hand'); return; }

    // Send private hands
    for (const p of result.players) {
      io.to(p.socketId).emit('your-hand', { hand: p.hand });
    }

    // Broadcast game state (no private cards)
    io.to(lobby.code).emit('hand-started', {
      handNumber: lobby.handCount,
      dealerSeatIndex: result.dealerSeatIndex,
      sbSeatIndex: result.sbSeatIndex,
      bbSeatIndex: result.bbSeatIndex,
      pot: result.pot,
      currentBet: result.currentBet,
      currentPlayerSeatIndex: result.currentPlayerSeatIndex,
      players: result.players.map(p => ({
        seatIndex: p.seatIndex, username: p.username, chips: p.chips, currentBet: p.currentBet,
      })),
    });

    // Send available actions to first player
    sendActions(lobby);
  });

  // ── Player Action ──────────────────────────────────────────
  socket.on('player-action', ({ action, amount }) => {
    const lobby = getLobby(socket);
    if (!lobby || !lobby.game) return;
    const seatIdx = lobby.seats.findIndex(s => s && s.socketId === socket.id);
    if (seatIdx === -1) return;

    const result = lobby.game.handleAction(seatIdx, action, amount);
    if (result.error) { socket.emit('error-msg', result.error); return; }

    broadcastAction(lobby, result);
  });

  // ── Chat ───────────────────────────────────────────────────
  socket.on('chat-message', (msg) => {
    const lobby = getLobby(socket);
    if (!lobby || typeof msg !== 'string' || !msg.trim()) return;
    const seat = lobby.seats.find(s => s && s.socketId === socket.id);
    const name = seat ? seat.username : 'Spectator';
    io.to(lobby.code).emit('chat-message', { username: name, message: msg.trim().substring(0, 200) });
  });

  // ── Settings ───────────────────────────────────────────────
  socket.on('update-settings', (settings) => {
    const lobby = getLobby(socket);
    if (!lobby || socket.id !== lobby.hostId) return;
    if (settings.startingStack) lobby.settings.startingStack = Math.max(100, Math.min(100000, parseInt(settings.startingStack) || 1000));
    if (settings.smallBlind) lobby.settings.smallBlind = Math.max(1, Math.min(10000, parseInt(settings.smallBlind) || 5));
    if (settings.bigBlind) lobby.settings.bigBlind = Math.max(2, Math.min(20000, parseInt(settings.bigBlind) || 10));
    io.to(lobby.code).emit('settings-updated', lobby.settings);
  });

  // ── Kick Player ────────────────────────────────────────────
  socket.on('kick-player', (seatIndex) => {
    const lobby = getLobby(socket);
    if (!lobby || socket.id !== lobby.hostId) return;
    if (!lobby.seats[seatIndex]) return;
    const kicked = lobby.seats[seatIndex];
    lobby.seats[seatIndex] = null;
    io.to(kicked.socketId).emit('kicked');
    io.to(lobby.code).emit('player-left', { seatIndex });
  });

  // ── Disconnect ─────────────────────────────────────────────
  socket.on('disconnect', () => {
    const code = socketLobby.get(socket.id);
    if (!code) return;
    const lobby = lobbies.get(code);
    if (!lobby) return;

    lobby.spectators.delete(socket.id);
    lobby.pendingApprovals = lobby.pendingApprovals.filter(p => p.socketId !== socket.id);

    const seatIdx = lobby.seats.findIndex(s => s && s.socketId === socket.id);
    if (seatIdx !== -1) {
      // If game is active, fold
      if (lobby.game && !['waiting', 'complete'].includes(lobby.game.phase)) {
        const result = lobby.game.handleAction(seatIdx, 'fold');
        if (result && !result.error) broadcastAction(lobby, result);
      }
      lobby.seats[seatIdx] = null;
      io.to(code).emit('player-left', { seatIndex: seatIdx });
    }

    // If host left, transfer or close
    if (lobby.hostId === socket.id) {
      const nextHost = lobby.seats.find(s => s && s.socketId !== socket.id);
      if (nextHost) {
        lobby.hostId = nextHost.socketId;
        io.to(code).emit('host-changed', { newHostSocketId: nextHost.socketId, username: nextHost.username });
      } else if (lobby.spectators.size === 0) {
        lobbies.delete(code);
      }
    }

    socketLobby.delete(socket.id);
  });
});

// ── Helpers ──────────────────────────────────────────────────

function getLobby(socket) {
  const code = socketLobby.get(socket.id);
  return code ? lobbies.get(code) : null;
}

function seatPlayer(lobby, socketId, seatIndex, username, gameActive) {
  const stats = lobby.playerStats.get(socketId) || { bustCount: 0, winCount: 0 };
  const player = {
    socketId,
    username,
    seatIndex,
    chips: lobby.settings.startingStack,
    approved: true,
    pendingNextRound: gameActive,
    connected: true,
    bustCount: stats.bustCount,
    winCount: stats.winCount,
  };
  lobby.seats[seatIndex] = player;
  io.to(lobby.code).emit('player-seated', {
    seatIndex,
    username,
    chips: player.chips,
    approved: true,
    pendingNextRound: player.pendingNextRound,
    socketId,
    bustCount: stats.bustCount,
    winCount: stats.winCount,
  });
}

function sendActions(lobby) {
  if (!lobby.game || lobby.game.phase === 'complete' || lobby.game.phase === 'waiting') return;
  for (const p of lobby.game.players) {
    const actions = lobby.game.getAvailableActions(p.seatIndex);
    if (actions) {
      io.to(p.socketId).emit('your-turn', actions);
    }
  }
}

function broadcastAction(lobby, result) {
  if (result.type === 'action') {
    io.to(lobby.code).emit('player-acted', {
      seatIndex: result.seatIndex,
      action: result.action,
      betAmount: result.betAmount,
      chips: result.chips,
      pot: result.pot,
      currentBet: result.currentBet,
      nextPlayerSeatIndex: result.nextPlayerSeatIndex,
    });
    sendActions(lobby);
  } else if (result.type === 'newPhase') {
    io.to(lobby.code).emit('new-phase', {
      phase: result.phase,
      communityCards: result.communityCards,
      pot: result.pot,
      currentPlayerSeatIndex: result.currentPlayerSeatIndex,
      allInRunout: !!result.allInRunout,
    });
    if (result.allInRunout) {
      // Reveal all active players' hands in all-in runout
      if (!lobby.game._allInRevealed) {
        lobby.game._allInRevealed = true;
        const hands = lobby.game.players
          .filter(p => !p.folded)
          .map(p => ({ seatIndex: p.seatIndex, hand: [...p.hand] }));
        io.to(lobby.code).emit('cards-revealed', { hands });
      }
      // Auto-advance to next phase after delay
      setTimeout(() => {
        if (!lobby.game || lobby.game.phase === 'complete' || lobby.game.phase === 'showdown') return;
        const next = lobby.game._nextPhase();
        if (next) broadcastAction(lobby, next);
      }, 1800);
    } else {
      sendActions(lobby);
    }
  } else if (result.type === 'showdown') {
    io.to(lobby.code).emit('showdown', {
      communityCards: result.communityCards,
      potResults: result.potResults,
      players: result.players,
    });
    // Update seat chips and track wins
    for (const p of result.players) {
      const seat = lobby.seats[p.seatIndex];
      if (seat) seat.chips = p.chips;
    }
    for (const pr of result.potResults) {
      for (const w of pr.winners) {
        const seat = lobby.seats[w.seatIndex];
        if (seat) {
          seat.winCount = (seat.winCount || 0) + 1;
          const st = lobby.playerStats.get(seat.socketId) || { bustCount: 0, winCount: 0 };
          st.winCount = seat.winCount;
          lobby.playerStats.set(seat.socketId, st);
        }
      }
    }
    // Handle busted players after animation
    setTimeout(() => handleBustedPlayers(lobby), 4500);
  } else if (result.type === 'handComplete') {
    // Track wins
    for (const w of result.winners) {
      const seat = lobby.seats[w.seatIndex];
      if (seat) {
        seat.winCount = (seat.winCount || 0) + 1;
        const st = lobby.playerStats.get(seat.socketId) || { bustCount: 0, winCount: 0 };
        st.winCount = seat.winCount;
        lobby.playerStats.set(seat.socketId, st);
      }
    }
    io.to(lobby.code).emit('hand-complete', {
      winners: result.winners,
      players: result.players,
    });
    for (const p of result.players) {
      const seat = lobby.seats[p.seatIndex];
      if (seat) seat.chips = p.chips;
    }
    // Handle busted players after animation
    setTimeout(() => handleBustedPlayers(lobby), 3500);
  }
}

function handleBustedPlayers(lobby) {
  for (let i = 0; i < lobby.seats.length; i++) {
    const seat = lobby.seats[i];
    if (seat && seat.chips <= 0) {
      const stats = lobby.playerStats.get(seat.socketId) || { bustCount: 0, winCount: 0 };
      stats.bustCount++;
      lobby.playerStats.set(seat.socketId, stats);
      io.to(lobby.code).emit('player-busted', {
        seatIndex: i,
        username: seat.username,
        bustCount: stats.bustCount,
        socketId: seat.socketId,
      });
      lobby.seats[i] = null;
    }
  }
}

// ── Start Server ─────────────────────────────────────────────

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Poker server running → http://localhost:${PORT}`);
});
