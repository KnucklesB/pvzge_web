# Multiplayer module

Online Co-op, Versus and Survival for PvZ2 Gardendless. Everything lives in this
folder and is loaded by `docs/index.html` before the engine; the compiled game
bundle is not modified.

## Architecture

- **Host-authoritative.** The host runs the real game. Its canvas and game audio
  are streamed to the guest over WebRTC (`canvas.captureStream()` + a WebAudio
  tap), so every plant, zombie, level module and animation behaves exactly as
  in single player.
- **Inputs, not state, travel back.** The guest sends pointer/key events over a
  reliable data channel. The host turns them into game actions through the
  game's own code paths (`LnC.PlaceUIPlant`, `LnC.removePlant`, `LnC.plantfood`,
  `zombies.spawnZombieFromLaneByType`, drop collection on hover), temporarily
  swapping the UI's current selection so the host's own selection is untouched.
- **Signaling** uses PeerJS (public cloud by default, or `/server`).

## Files

| File | Role |
| --- | --- |
| `mp-config.js` | Signaling server / ICE configuration (overridable). |
| `mp-core.js` | Namespace, events, storage, utilities, translations (en / pt / zh, switchable in the lobby; defaults to the game's language). |
| `mp-audio.js` | Routes WebAudio through a master gain + `MediaStream` tap. Must load before the engine. |
| `mp-net.js` | `Session`: rooms, handshake, heartbeat/RTT, media stream and bitrate tuning. |
| `mp-game.js` | Bridge to the game internals: modules, coordinates, actions, hooks. |
| `mp-skin.js` | Cuts the game's own sprites/fonts at runtime for the HTML UI. |
| `mp-ui.js` / `mp.css` | Lobby, HUD, overlays, stream viewer, results, chat, toasts. |
| `mp-modes.js` | Mode definitions, generated levels, plant/zombie seats, `Match`. |
| `mp-app.js` | Controller tying session, lobby, match and overlays together; main menu button. |
| `vendor/peerjs.min.js` | PeerJS 1.5.4 (MIT). |

## Protocol (data channel, JSON)

- Guest → host: `hello`, `ready`, `ptr {x,y}`, `down {x,y,b}`, `key {k}`, `chat`.
- Host → guest: `welcome`, `reject`, `lobby`, `start`, `hud` (10 Hz), `layout`
  (packet/grid rectangles), `toast`, `end`, `lobby-return`, `chat`.
- Both: `ping`/`pong`, `bye`.

Coordinates are normalized to the game canvas (`0..1`, top-left origin), so
they map 1:1 onto the streamed video regardless of window sizes or DPR.

## Game internals relied upon

If a game update breaks multiplayer, check these first (`mp-game.js`):
`KeyListener.GoToGame/GoToMain/GoToWorldmap`, `LevelPlay` statics
(`gameStarted`, `levelData`, `component.gameLost/gameWon/currentWave`),
`UIInGame` (`index`, `currentCF`, `tryChangingIndex`, `plantInHand`, `paused`,
`SBZombieCards`, `SBZombieCardsSlot`, `s2xButton`, `speedUp`), `LnC`
methods above, `Square` (`getLnC`, `judgeLIndex/judgeCIndex`, `lawnRec`),
`dropping.prototype.characterUpdate`, `SandBoxZombieCards`, `zombies`.

Testing locally: serve `docs/`, run `server/` (`HOST=127.0.0.1 PORT=9000 node index.js`)
and open two browser windows with `?mp_server=http://127.0.0.1:9000/`.
Add `&mp_debug=1` for logs.
