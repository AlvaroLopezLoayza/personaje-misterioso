// node test_flow.js -> arranca el servidor real y simula el evento completo
// por WebSocket: registro, panel, revelación, aciertos, tabla y ganador.
const assert = require('assert');
const { spawn } = require('child_process');
const { io } = require('socket.io-client');

const PORT = 3921;
const URL = 'http://localhost:' + PORT;
const PHOTO = 'data:image/jpeg;base64,/9j/4AAQSkZJRg==';
const wait = ms => new Promise(r => setTimeout(r, ms));
const until = async (fn, msg, ms = 8000) => {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) { if (fn()) return; await wait(100); }
  throw new Error('timeout: ' + msg);
};

const srv = spawn(process.execPath, ['server.js'], {
  env: { ...process.env, PORT: String(PORT), ADMIN_PIN: '1111' },
  stdio: 'ignore'
});
const sockets = [];
const bye = code => { sockets.forEach(s => s.close()); srv.kill(); process.exit(code); };
process.on('uncaughtException', e => { console.error('FALLO:', e.message); bye(1); });

function connect() { const s = io(URL, { transports: ['websocket'] }); sockets.push(s); return s; }

(async () => {
  await wait(1200);

  // --- pantalla LED
  const host = connect();
  let hostState = null;
  host.on('state', s => (hostState = s));
  host.emit('host:join');
  await until(() => hostState, 'la pantalla LED no recibió estado');
  assert.strictEqual(hostState.phase, 'lobby');

  // --- 6 jugadores se registran desde el móvil
  const P = [];
  for (let i = 1; i <= 6; i++) {
    const s = connect();
    const st = { last: null };
    s.on('state', x => (st.last = x));
    const pid = await new Promise(res => s.emit('player:join', {
      name: 'Jugador ' + i, avatar: 'azul', photo: PHOTO,
      a1: '2 años', a2: 'Ana', a3: 'polo negro', a4: 'guitarra', a5: 'Japón'
    }, r => res(r.pid)));
    P.push({ s, st, pid });
  }
  await until(() => hostState.players.length === 6, 'la LED no lista a los 6 jugadores');
  assert.strictEqual(new Set(P.map(p => p.pid)).size, 6, 'cada jugador recibe un id único');

  // el dropdown del jugador excluye su propio nombre
  await until(() => P[0].st.last, 'el jugador 1 no recibió estado');
  assert.strictEqual(P[0].st.last.names.length, 5, 'el selector debe excluirse a sí mismo');

  // --- PIN incorrecto rechazado
  const admin = connect();
  let denied = false, adminState = null;
  admin.on('admin:denied', () => (denied = true));
  admin.on('admin', s => (adminState = s));
  admin.emit('admin:join', '0000');
  await until(() => denied, 'el PIN incorrecto no fue rechazado');
  assert.strictEqual(adminState, null, 'no debe llegar estado de admin sin PIN válido');

  // un socket sin admin no puede iniciar el juego
  P[0].s.emit('admin:start');
  await wait(400);
  assert.strictEqual(hostState.phase, 'lobby', 'un jugador no debe poder iniciar la partida');

  // --- admin real
  admin.emit('admin:join', '1111');
  await until(() => adminState, 'el admin no entró con el PIN correcto');
  admin.emit('admin:rounds', 2);
  await until(() => adminState.rounds === 2, 'no se aplicó el número de rondas');

  admin.emit('admin:start');
  await until(() => hostState.phase === 'reveal', 'el juego no inició');

  // --- la identidad del misterioso no viaja a la pantalla ni a los jugadores
  assert.strictEqual(hostState.mysteryId, undefined, 'la LED no debe conocer el pid del misterioso');
  const mystery = P.find(p => p.st.last.you.isMystery);
  assert.ok(mystery, 'alguien debe ser el personaje misterioso');
  assert.strictEqual(P.filter(p => p.st.last.you.isMystery).length, 1, 'sólo uno por ronda');
  assert.strictEqual(mystery.st.last.you.score, 0, 'la tabla no debe delatar al misterioso durante la ronda');
  const otros = P.filter(p => p !== mystery);
  // El pid del misterioso sí viaja dentro de `names` (el selector lo necesita, igual
  // que el de todos); lo que no debe existir es ningún otro campo que lo señale.
  assert.ok(otros.every(p => {
    const sinLista = Object.assign({}, p.st.last, { names: null });
    return !JSON.stringify(sinLista).includes(mystery.pid) && p.st.last.you.isMystery === false;
  }), 'ningún campo debe delatar quién es el misterioso');

  // --- pistas en la pantalla LED
  await until(() => hostState.phase === 'round', 'no arrancó la ronda');
  assert.strictEqual(hostState.clue.no, 1);
  assert.ok(hostState.clue.photo, 'la pista 1 muestra la foto');
  assert.ok(hostState.clue.clueLeft <= 8 && hostState.clue.clueLeft >= 1);

  // --- aciertos: el monito cruza a victoriosos
  otros[0].s.emit('player:guess', mystery.pid);
  await until(() => otros[0].st.last.you.correct, 'no se registró el acierto');
  assert.strictEqual(otros[0].st.last.you.score, 100, '100 pts en las primeras pistas');
  await until(() => hostState.players.find(p => p.pid === otros[0].pid).solved,
    'la LED no movió al monito a victoriosos');
  assert.strictEqual(hostState.players.find(p => p.pid === mystery.pid).solved, false,
    'el misterioso se queda en la zona de espera (camuflaje)');

  // --- dos intentos y bloqueo
  otros[1].s.emit('player:guess', otros[2].pid);
  await until(() => otros[1].st.last.you.attempts === 1, 'no contó el primer intento');
  otros[1].s.emit('player:guess', otros[3].pid);
  await until(() => otros[1].st.last.you.attempts === 2, 'no contó el segundo intento');
  otros[1].s.emit('player:guess', mystery.pid);
  await wait(500);
  assert.strictEqual(otros[1].st.last.you.attempts, 2, 'el tercer intento debe ignorarse');
  assert.strictEqual(otros[1].st.last.you.correct, false, 'no puede acertar sin intentos');

  // el misterioso no puede jugar su ronda
  mystery.s.emit('player:guess', otros[0].pid);
  await wait(400);
  assert.strictEqual(mystery.st.last.you.attempts, 0, 'el misterioso no gasta intentos');

  // --- cierre de ronda -> tabla de posiciones
  admin.emit('admin:next');
  await until(() => hostState.phase === 'board', 'no pasó a la tabla de posiciones');
  assert.ok(hostState.board.length === 6 && hostState.board[0].score >= hostState.board[5].score,
    'la tabla debe venir ordenada de mayor a menor');
  assert.ok(hostState.bonusMsg.includes('+50'), 'bono de gran misterio con 1 de 5 aciertos');

  // --- ronda 2 y final
  admin.emit('admin:next');
  await until(() => hostState.phase === 'reveal' && hostState.round === 2, 'no arrancó la ronda 2');
  const mystery2 = P.find(p => p.st.last.you.isMystery);
  assert.notStrictEqual(mystery2.pid, mystery.pid, 'nadie repite como personaje misterioso');

  admin.emit('admin:next');
  await until(() => hostState.phase === 'board', 'no cerró la ronda 2');
  admin.emit('admin:next');
  await until(() => hostState.phase === 'final', 'no llegó a la pantalla final');
  assert.ok(hostState.winner && hostState.winner.score > 0, 'debe haber gran ganador');

  // --- reconexión tras bloquear la pantalla del celular
  const pid0 = otros[0].pid;
  const puntos0 = otros[0].st.last.you.score;   // puede haber sido misterioso en la ronda 2
  otros[0].s.close();
  await until(() => hostState.players.find(p => p.pid === pid0).online === false,
    'la LED no marcó al jugador como desconectado');
  const back = connect();
  let resumed = null;
  back.on('state', s => (resumed = s));
  await new Promise(res => back.emit('player:resume', pid0, r => { assert.ok(r.pid, 'no se pudo reanudar'); res(); }));
  await until(() => resumed && resumed.you.score === puntos0, 'el puntaje no sobrevivió a la reconexión');
  assert.ok(puntos0 >= 100, 'el acierto de la ronda 1 debe seguir contando');

  // --- reinicio deja todo en cero
  admin.emit('admin:reset');
  await until(() => hostState.phase === 'lobby', 'no reinició');
  assert.ok(hostState.players.every(p => p.score === 0), 'los puntajes deben quedar en cero');

  console.log('OK — flujo completo verificado (' + sockets.length + ' conexiones)');
  bye(0);
})();
