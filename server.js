const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const QR = require('qrcode');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { maxHttpBufferSize: 6e6 });

const PORT = process.env.PORT || 3000;
const ADMIN_PIN = process.env.ADMIN_PIN || '2580';

// ---------------------------------------------------------------- estado
// ponytail: todo vive en memoria. Si el evento debe sobrevivir a un reinicio
// del servicio, persistir `players` en Redis/SQLite.
const players = new Map();   // pid -> jugador
const sockets = new Map();   // pid -> socket.id

const CLUES = [
  { label: 'FOTO MISTERIOSA', field: 'photo' },
  { label: 'TIEMPO EN LA IGLESIA', field: 'a1' },
  { label: 'AMIGO MAS CERCANO', field: 'a2' },
  { label: 'PRENDA / DETALLE DE HOY', field: 'a3' },
  { label: 'PASATIEMPO / VIAJE SOÑADO', field: 'a45' }
];
const CLUE_SECONDS = 8;
const REVEAL_SECONDS = 5;
const ROUND_SECONDS = CLUES.length * CLUE_SECONDS; // 40
const BOARD_SECONDS = 10;

const G = {
  phase: 'lobby',        // lobby | reveal | round | board | final
  round: 0,
  rounds: 5,
  mysteryId: null,
  nextMysteryId: null,   // elección manual del admin
  left: 0,               // segundos restantes de la fase
  attempts: {},          // pid -> intentos usados en la ronda
  correct: [],           // pids que acertaron, en orden
  paused: false,
  bonusMsg: '',
  winner: null
};

const alive = () => [...players.values()];
const pool = () => alive().filter(p => !p.wasMystery);

function startRound() {
  const picked = G.nextMysteryId && players.has(G.nextMysteryId) && !players.get(G.nextMysteryId).wasMystery
    ? [players.get(G.nextMysteryId)]
    : pool();
  if (!picked.length || G.round >= G.rounds) return endGame();

  const m = picked[Math.floor(Math.random() * picked.length)];
  m.wasMystery = true;
  m.score += 75;                    // compensación de equidad
  G.nextMysteryId = null;
  G.mysteryId = m.pid;
  G.round += 1;
  G.attempts = {};
  G.correct = [];
  G.bonusMsg = '';
  G.phase = 'reveal';
  G.left = REVEAL_SECONDS;
}

function closeRound() {
  const eligible = alive().length - 1;
  if (eligible > 0 && (G.correct.length <= 1 || G.correct.length / eligible < 0.3)) {
    const m = players.get(G.mysteryId);
    if (m) m.score += 50;
    G.bonusMsg = '+50 PUNTOS EXTRA POR SER EL PERSONAJE MISTERIOSO!';
  }
  G.phase = 'board';
  G.left = BOARD_SECONDS;
}

function endGame() {
  G.phase = 'final';
  G.mysteryId = null;
  G.left = 0;
  G.winner = alive().sort((a, b) => b.score - a.score)[0] || null;
}

function guess(pid, targetId) {
  const p = players.get(pid);
  if (!p || G.phase !== 'round' || pid === G.mysteryId) return 'bloqueado';
  if (G.correct.includes(pid) || (G.attempts[pid] || 0) >= 2) return 'sin-intentos';
  G.attempts[pid] = (G.attempts[pid] || 0) + 1;
  if (targetId !== G.mysteryId) return 'fallo';
  const elapsed = ROUND_SECONDS - G.left;
  p.score += elapsed <= 16 ? 100 : elapsed <= 32 ? 75 : 50;
  G.correct.push(pid);
  return 'acierto';
}

function tick(step) {
  if (G.paused || !['reveal', 'round', 'board'].includes(G.phase)) return;
  G.left -= step;
  if (G.left > 0) return;
  if (G.phase === 'reveal') { G.phase = 'round'; G.left = ROUND_SECONDS; }
  else if (G.phase === 'round') closeRound();
  else if (G.round >= G.rounds || !pool().length) endGame();
  else startRound();
}

// ---------------------------------------------------------------- vistas
function clueView() {
  const m = players.get(G.mysteryId);
  if (G.phase !== 'round' || !m) return { no: 0, label: '', text: '', photo: null, clueLeft: 0 };
  const elapsed = ROUND_SECONDS - G.left;
  const i = Math.min(CLUES.length - 1, Math.floor(elapsed / CLUE_SECONDS));
  const c = CLUES[i];
  return {
    no: i + 1,
    label: c.label,
    text: c.field === 'photo' ? '' : c.field === 'a45' ? m.a4 + '  -  ' + m.a5 : m[c.field],
    photo: c.field === 'photo' ? m.photo : null,
    clueLeft: Math.max(1, Math.ceil(CLUE_SECONDS - (elapsed % CLUE_SECONDS)))
  };
}

function hostState() {
  return {
    phase: G.phase, round: G.round, rounds: G.rounds, paused: G.paused,
    left: Math.ceil(G.left), bonusMsg: G.bonusMsg,
    clue: clueView(),
    winner: G.winner && { name: G.winner.name, avatar: G.winner.avatar, score: G.winner.score },
    players: alive().map(p => ({
      pid: p.pid, name: p.name, avatar: p.avatar, score: p.score,
      solved: G.correct.includes(p.pid), online: p.online
    })),
    board: alive().sort((a, b) => b.score - a.score)
      .map(p => ({ pid: p.pid, name: p.name, avatar: p.avatar, score: p.score }))
  };
}

function playerState(p) {
  return {
    phase: G.phase, round: G.round, rounds: G.rounds, left: Math.ceil(G.left),
    clueNo: clueView().no,
    you: {
      name: p.name, avatar: p.avatar, score: p.score,
      isMystery: p.pid === G.mysteryId,
      attempts: G.attempts[p.pid] || 0,
      correct: G.correct.includes(p.pid)
    },
    names: alive().filter(x => x.pid !== p.pid)
      .map(x => ({ pid: x.pid, name: x.name }))
      .sort((a, b) => a.name.localeCompare(b.name)),
    board: alive().sort((a, b) => b.score - a.score).slice(0, 10)
      .map(x => ({ name: x.name, avatar: x.avatar, score: x.score })),
    winner: G.winner && { name: G.winner.name, score: G.winner.score }
  };
}

function broadcast() {
  const hs = hostState();
  io.to('host').emit('state', hs);
  io.to('admin').emit('admin', Object.assign({}, hs, { mysteryId: G.mysteryId }));
  for (const p of players.values()) {
    const sid = sockets.get(p.pid);
    if (sid) io.to(sid).emit('state', playerState(p));
  }
}

// ---------------------------------------------------------------- sockets
io.on('connection', socket => {
  const isAdmin = () => socket.rooms.has('admin');

  socket.on('host:join', () => { socket.join('host'); socket.emit('state', hostState()); });

  socket.on('admin:join', pin => {
    if (pin !== ADMIN_PIN) return socket.emit('admin:denied');
    socket.join('admin');
    socket.emit('admin', Object.assign({}, hostState(), { mysteryId: G.mysteryId }));
  });

  socket.on('player:join', (d, ack) => {
    d = d || {};
    const name = String(d.name || '').trim().slice(0, 30);
    if (!name) return ack && ack({ error: 'Nombre requerido' });
    if (typeof d.photo === 'string' && d.photo.length > 5e6) return ack && ack({ error: 'Foto demasiado grande' });
    const pid = String(d.pid || '').slice(0, 40) || Math.random().toString(36).slice(2, 10);
    const p = players.get(pid) || { pid, score: 0, wasMystery: false };
    Object.assign(p, {
      name,
      avatar: String(d.avatar || 'rojo').slice(0, 12),
      a1: String(d.a1 || '-').slice(0, 80),
      a2: String(d.a2 || '-').slice(0, 80),
      a3: String(d.a3 || '-').slice(0, 80),
      a4: String(d.a4 || '-').slice(0, 80),
      a5: String(d.a5 || '-').slice(0, 80),
      photo: (typeof d.photo === 'string' && d.photo.startsWith('data:image/')) ? d.photo : p.photo || null,
      online: true
    });
    players.set(pid, p);
    sockets.set(pid, socket.id);
    socket.data.pid = pid;
    ack && ack({ pid });
    broadcast();
  });

  socket.on('player:resume', (pid, ack) => {
    const p = players.get(pid);
    if (!p) return ack && ack({ error: 'no-registrado' });
    p.online = true;
    sockets.set(pid, socket.id);
    socket.data.pid = pid;
    ack && ack({ pid });
    broadcast();
  });

  socket.on('player:guess', targetId => { guess(socket.data.pid, targetId); broadcast(); });

  // --- admin
  socket.on('admin:rounds', n => { if (isAdmin()) { G.rounds = Math.max(1, Math.min(20, Number(n) || 5)); broadcast(); } });
  socket.on('admin:start', () => {
    if (!isAdmin() || alive().length < 2) return;
    G.round = 0; G.winner = null;
    alive().forEach(p => { p.score = 0; p.wasMystery = false; });
    startRound();
    broadcast();
  });
  socket.on('admin:pick', pid => { if (isAdmin()) { G.nextMysteryId = pid || null; broadcast(); } });
  socket.on('admin:pause', () => { if (isAdmin()) { G.paused = !G.paused; broadcast(); } });
  socket.on('admin:next', () => {
    if (!isAdmin()) return;
    if (G.phase === 'round' || G.phase === 'reveal') closeRound();
    else if (G.phase === 'board') (G.round >= G.rounds || !pool().length) ? endGame() : startRound();
    broadcast();
  });
  socket.on('admin:reset', () => {
    if (!isAdmin()) return;
    Object.assign(G, {
      phase: 'lobby', round: 0, mysteryId: null, nextMysteryId: null,
      left: 0, attempts: {}, correct: [], paused: false, bonusMsg: '', winner: null
    });
    alive().forEach(p => { p.score = 0; p.wasMystery = false; });
    broadcast();
  });
  socket.on('admin:kick', pid => { if (isAdmin()) { players.delete(pid); sockets.delete(pid); broadcast(); } });

  socket.on('disconnect', () => {
    const p = players.get(socket.data.pid);
    if (p && sockets.get(p.pid) === socket.id) { p.online = false; sockets.delete(p.pid); }
  });
});

// ---------------------------------------------------------------- http
app.use(express.static('public'));
app.get('/qr', async (req, res) => {
  const base = process.env.PUBLIC_URL || (req.protocol + '://' + req.get('host'));
  res.type('svg').send(await QR.toString(base + '/', { type: 'svg', margin: 1 }));
});

if (require.main === module) {
  setInterval(() => { tick(0.5); broadcast(); }, 500);
  server.listen(PORT, () => console.log('Personaje Misterioso escuchando en :' + PORT));
}

module.exports = { G, players, tick, guess, startRound, closeRound, clueView, playerState, ROUND_SECONDS };
