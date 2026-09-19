# El Personaje Misterioso

Juego arcade en vivo. Pantalla LED + celulares, en tiempo real con Socket.io.

## Rutas

| Ruta | Para |
|---|---|
| `/` | Jugadores (móvil) — registro, cuestionario y adivinación |
| `/host.html` | Pantalla LED gigante (abrir en la PC, F11 pantalla completa) |
| `/admin.html` | Panel de control (PIN, por defecto `2580`) |
| `/qr` | QR de ingreso en SVG (ya embebido en la pantalla LED) |

## Local

```bash
npm install
npm start          # http://localhost:3000
node test_game.js  # verifica rondas, pistas, intentos, puntaje y bonos
```

## Desplegar en Render

1. Sube esta carpeta a un repo de GitHub.
2. En Render: **New → Web Service** → conecta el repo.
   - Runtime: **Node**
   - Build command: `npm install`
   - Start command: `npm start`
   - (O deja que Render lea `render.yaml` con **New → Blueprint**.)
3. Variables de entorno:
   - `ADMIN_PIN` → tu PIN de moderador.
   - `PUBLIC_URL` *(opcional)* → la URL final, ej. `https://personaje-misterioso.onrender.com`, para que el QR apunte ahí.
4. Deploy. `PORT` lo inyecta Render solo; WebSockets funcionan sin configuración extra.

**Plan free:** el servicio se duerme tras 15 min sin tráfico y arranca en ~50 s. Abre la pantalla LED unos minutos antes del evento, o usa el plan Starter para el día del juego.

## Flujo del evento

1. Abre `/host.html` en la pantalla LED → muestra el QR.
2. La gente escanea, se registra (nombre, monito, 5 preguntas, foto sin rostros).
3. Abre `/admin.html`, ingresa el PIN, fija el número de rondas y presiona **INICIAR**.
4. Cada ronda: 5 s de aviso discreto → 5 pistas × 8 s → 10 s de tabla de posiciones.
5. Al terminar las rondas: pantalla de gran ganador con confeti 8-bit.

## Reglas implementadas

- +75 fijos al Personaje Misterioso por no poder jugar su ronda.
- Aciertos: 100 pts (0–16 s), 75 pts (17–32 s), 50 pts (33–40 s).
- Máximo 2 intentos por jugador por ronda.
- Bono +50 al Misterioso si lo descubre menos del 30 % del grupo (o solo 1 persona).
- Nadie es Personaje Misterioso dos veces.
- La pantalla del Misterioso no cambia de color (discreción en penumbra).
- Su monito sigue saltando en la zona de espera para no delatarse.

## Límites conocidos

- Estado en memoria: un reinicio del servicio borra jugadores y puntajes.
- Fotos como data URL en RAM (~200 KB c/u tras comprimir): hasta ~150 jugadores sin problema.
- Una sola partida simultánea por instancia (sin salas múltiples).
