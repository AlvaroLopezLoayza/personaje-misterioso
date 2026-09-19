// node test_game.js  -> verifica ronda, pistas, intentos, puntaje y bonos.
const assert = require('assert');
const { G, players, tick, guess, startRound, closeRound, clueView, ROUND_SECONDS } = require('./server');

function seed(n) {
  players.clear();
  for (let i = 1; i <= n; i++) {
    players.set('p' + i, {
      pid: 'p' + i, name: 'J' + i, avatar: 'rojo', score: 0, wasMystery: false, online: true,
      a1: 'a1', a2: 'a2', a3: 'a3', a4: 'a4', a5: 'a5', photo: 'data:image/jpeg;base64,x'
    });
  }
  Object.assign(G, { phase: 'lobby', round: 0, rounds: 5, mysteryId: null, nextMysteryId: null, left: 0, attempts: {}, correct: [], paused: false, bonusMsg: '', winner: null });
}

// --- compensación +75 al misterioso y fase de revelación
seed(10);
G.nextMysteryId = 'p1';
startRound();
assert.strictEqual(G.mysteryId, 'p1');
assert.strictEqual(players.get('p1').score, 0, 'la compensación no se acredita al abrir la ronda: delataría al misterioso');
assert.strictEqual(G.phase, 'reveal');

tick(5);
assert.strictEqual(G.phase, 'round');
assert.strictEqual(G.left, ROUND_SECONDS);

// --- secuencia de 5 pistas de 8s
assert.strictEqual(clueView().no, 1);
assert.strictEqual(clueView().photo !== null, true, 'pista 1 es la foto');
tick(8); assert.strictEqual(clueView().no, 2);
tick(16); assert.strictEqual(clueView().no, 4);
tick(8); assert.strictEqual(clueView().no, 5);
assert.strictEqual(clueView().text, 'a4  -  a5', 'pista 5 combina pasatiempo y viaje');

// --- escala de puntos por velocidad
seed(10); G.nextMysteryId = 'p1'; startRound(); tick(5);
assert.strictEqual(guess('p2', 'p1'), 'acierto');
assert.strictEqual(players.get('p2').score, 100, '0-16s = 100');
tick(20); // elapsed 20
assert.strictEqual(guess('p3', 'p1'), 'acierto');
assert.strictEqual(players.get('p3').score, 75, '17-32s = 75');
tick(13); // elapsed 33
assert.strictEqual(guess('p4', 'p1'), 'acierto');
assert.strictEqual(players.get('p4').score, 50, '33-40s = 50');

// --- 2 intentos máximo y el misterioso no juega
assert.strictEqual(guess('p5', 'p9'), 'fallo');
assert.strictEqual(guess('p5', 'p9'), 'fallo');
assert.strictEqual(guess('p5', 'p1'), 'sin-intentos', 'tercer intento bloqueado');
assert.strictEqual(players.get('p5').score, 0);
assert.strictEqual(guess('p1', 'p1'), 'bloqueado', 'el misterioso no adivina');
assert.strictEqual(guess('p2', 'p1'), 'sin-intentos', 'no se acierta dos veces');

// --- bono de gran misterio: 3 de 9 aciertos = 33% -> sin bono
closeRound();
assert.strictEqual(players.get('p1').score, 75, 'compensación de equidad al cerrar, sin bono con >=30%');
assert.strictEqual(G.phase, 'board');

// --- bono cuando casi nadie acierta
seed(10); G.nextMysteryId = 'p1'; startRound(); tick(5);
guess('p2', 'p1');
closeRound();
assert.strictEqual(players.get('p1').score, 125, '+50 de bono');
assert.ok(G.bonusMsg.includes('+50'));

// --- nadie repite como misterioso y el juego cierra al agotar rondas
seed(3);
G.rounds = 5;
const elegidos = new Set();
for (let i = 0; i < 3; i++) { startRound(); elegidos.add(G.mysteryId); G.phase = 'board'; }
assert.strictEqual(elegidos.size, 3, 'sin repetir personaje');
startRound();
assert.strictEqual(G.phase, 'final', 'sin candidatos -> final');
assert.ok(G.winner, 'hay ganador');

console.log('OK — todas las pruebas pasaron');
