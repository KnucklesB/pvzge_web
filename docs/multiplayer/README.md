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
- **Survival** gives each player their own lawn: both run the generated level
  locally and stream it to the other (picture-in-picture).
- **Seed chooser:** when the guest picks plants, their clicks/scrolls are
  replayed as DOM events on the host's canvas and the host's real mouse is held
  back (`hooks.remoteChooser`).
- **Signaling** uses PeerJS (public cloud by default, or `/server`), which also
  serves the accounts / cloud saves / rooms / history API.

## Files

| File | Role |
| --- | --- |
| `mp-config.js` | Signaling server / ICE configuration (overridable). |
| `mp-core.js` | Namespace, events, storage, utilities, translations (en / pt / zh, switchable in the lobby; defaults to the game's language). |
| `mp-audio.js` | Game audio capture/mute: Web Audio master gain + `MediaStream` tap, and (game 0.16+) routing of the `<audio>` pool of `window.audioEngine` (`game-audio.js`) through the same kind of graph when multiplayer needs it. Must load before the engine. |
| `mp-net.js` | `Session`: rooms, handshake, heartbeat/RTT, media streams (both directions) and bitrate tuning. |
| `mp-api.js` | REST client for the multiplayer server (accounts, saves, rooms, matches). |
| `mp-cloud.js` | Mirrors the game's localStorage profiles to the logged-in account. |
| `mp-game.js` | Bridge to the game internals: modules, coordinates, actions, hooks. |
| `mp-skin.js` | Cuts the game's own sprites/fonts at runtime for the HTML UI. |
| `mp-ui.js` / `mp.css` | Lobby, HUD, overlays, stream viewer, results, chat, toasts. |
| `mp-save.js` | Save files: export/import (several formats) and the save editor's progress shortcuts. |
| `mp-levels.js` | Campaign level catalog per world (read from the game's world maps) for the Co-op level picker. |
| `mp-cards.js` | Draws zombie seed packets (world background + portrait) from the game's DragonBones atlases for the lobby's zombie chooser. |
| `mp-modes.js` | Options, arenas/zombie decks, generated levels, plant/zombie seats, `SoloRun`, `Match`. |
| `mp-app.js` | Controller tying session, lobby, match and overlays together; main menu button. |
| `vendor/peerjs.min.js` | PeerJS 1.5.4 (MIT). |

## Protocol (data channel, JSON)

Star topology: the host (slot 0) has one data channel per guest (slots 1-3)
and relays what the others need. Protocol version 3 (older clients are
refused with `err_version`).

- Guest → host: `hello` (+ account ticket), `ready`, `side` (Versus team),
  `zdeck`, `ptr {x,y}`, `down {x,y,b}`, `wheel {x,y,dy}`, `key {k}`, `sv`
  (own Survival run), `watch {slot}` (Survival: whose lawn to receive),
  `to-room`, `end-request`, `chat`.
- Host → guest: `welcome {you: slot, roster}`, `reject`, `lobby`, `roster`
  (names, ready, pings), `start {seat}`, `hud` (10 Hz, per guest: own
  selection, team brains, other players' cursors, Survival runs), `layout`
  (packet/grid rectangles), `toast`, `end`, `lobby-return`, `chat {from}`.
- Both: `ping`/`pong`, `bye {reason}`.

Media: the host calls each guest with its canvas (metadata `src: 0`); in
Survival each guest calls the host with its own lawn, and the host re-sends
to a guest the lawn of the player it asked to `watch` (`src: slot`).

Coordinates are normalized to the game canvas (`0..1`, top-left origin), so
they map 1:1 onto the streamed video regardless of window sizes or DPR.

## Game internals relied upon

If a game update breaks multiplayer, check these first (`mp-game.js`):
`KeyListener.GoToGame/GoToMain/GoToWorldmap`, `LevelPlay` statics
(`gameStarted`, `levelData`, `component.gameLost/gameWon/currentWave`),
`UIInGame` (`index`, `currentCF`, `tryChangingIndex`, `plantInHand`, `paused`,
`SBZombieCards`, `SBZombieCardsSlot`, `s2xButton`, `speedUp`), `LnC`
methods above, `Square` (`getLnC`, `judgeLIndex/judgeCIndex`, `lawnRec`),
`dropping.prototype.characterUpdate`, `SandBoxZombieCards`, `zombies`,
`LevelPlay.component.isSeedChooserMode`, `AllPlayerProperties.savePP` and the
`PvZ2_PlayerProperties` / `PvZ2_Settings` localStorage keys. Co-op levels use `KeyListener.goToLevel` and the world
map prefabs (`resources/worldmaps/*WORLDMAP`, see `mp-levels.js`); the save
editor uses `PlayerProperties` enums (`LevelProgress`, `PlantObtainProgress`,
`WorldMapSceneDisplayEnum`), `currentPlayer.forceLevel` and
`Plants.plants.defaultPlantChooserOrder`.

While a room is open the engine's auto-pause on hidden tabs
(`cc.game.pauseByEngine`) is disabled and, when the browser throttles
`requestAnimationFrame`, frames are driven from a worker timer through
`cc.game._updateCallback`, so a host that switches tabs (or plays on the same
PC as the guest) keeps the match running.

## Server API (`/server`)

| Method | Path | |
| --- | --- | --- |
| POST | `/api/auth/register`, `/api/auth/login` | `{username, password}` → `{token, user}` |
| POST | `/api/auth/logout`, `/api/auth/password` | bearer token |
| GET | `/api/auth/me`, `/api/auth/ticket` | profile; signed ticket proving the account to the host |
| GET/PUT | `/api/save` | cloud save (`base` timestamp for conflict detection) |
| GET | `/api/admin/users?q=` | admin (`ADMIN_USERS`): accounts and their save info |
| POST | `/api/admin/users/:name/password` | admin: set a new password for a player |
| GET/PUT | `/api/admin/users/:name/save` | admin: read / replace a player's cloud save (previous one backed up) |
| GET | `/api/rooms` | public rooms (hosts heartbeat with `PUT /api/rooms/:code` + secret key) |
| GET/POST | `/api/matches` | history; only the live room's host (key) can report a result |

Passwords are hashed with scrypt, sessions are random bearer tokens stored
hashed, and auth/save endpoints are rate limited.

Testing locally: serve `docs/`, run `server/` (`HOST=127.0.0.1 PORT=9000 npm start`)
and open two browser windows with `?mp_server=http://127.0.0.1:9000`.
Add `&mp_debug=1` for logs.
