<div align="center">

<img width=20% src="https://pvzge.com/pvz_logo-round.webp" alt="">

# PvZ2 Gardendless

**An endless garden requires an endless defense!**

Thanks to everyone who has supported this project!

![](https://img.shields.io/badge/author-Gaozih-%2366ccff)
![](https://img.shields.io/github/license/Gzh0821/pvzge_web)
![](https://img.shields.io/docker/pulls/gaozih/pvzge)
![](https://img.shields.io/discord/1265377295846346803?label=discord)
![](https://img.shields.io/github/stars/Gzh0821/pvzge_web)
</div>

### Info

This is the open source repo of the web version of "PvZ2 Gardendless".

"PvZ2 Gardendless" is a rewritten "Plants vs Zombies 2" entirely using only Web technologies(including the cocos engine)!

Visit our [website](https://pvzge.com/en/) for download links, game guides and more. You can also report bugs, make comments and suggestions in the feedback module of the website or in the issues and discussions of this project!

## Web Play

Try PvZ2 Gardendless online in [here](https://play.pvzge.com/) !

- Note: The version for online play may not be the latest version and may load slowly. For more related issues, please refer to the relevant instructions on the official website

## Source checkout

Install Git LFS before cloning this repository. After pulling updates, run `git lfs pull` to download large game assets before serving `docs/` or building a Docker image.

## Multiplayer

Click **Multiplayer** on the main menu to play with up to 3 friends (4 players) over the internet. Create a room and share the 5-letter code or invite link, or join one from the public room list. The host can limit the room to 2, 3 or 4 players and remove players; everyone's cursor is shown on the shared lawn in their own color.

| Mode | How it plays |
| --- | --- |
| **Co-op** | Shared lawn for up to 4 players: pick any campaign level of any world in the room (556 levels, bosses and plant quests included), even if the host's profile hasn't unlocked it, or let the host roam the game's own map. All players share sun, seed packets and plant food, each with their own cursor and selection, and all can pick seeds. |
| **Versus** | Shared lawn, plant team vs. zombie team (1v1, 2v2, 1v3, 3v1, 2v1…; each player picks a side in the room). The plant team picks plants in the game's seed chooser and shares sun; the zombie team builds a 6-zombie deck in the lobby with a seed chooser that shows the game's own zombie packets (every almanac zombie of every world, or only the arena's zombies) and shares a brain bank (income grows a little with team size) to send zombies down any lane; every zombie player has their own selection. Plants win by holding until the timer runs out; zombies win by reaching the house. |
| **Survival** | One lawn per player (up to 4): everyone runs the same generated level with ever-growing waves on their own screen and watches the others' lawns live (picture-in-picture with ◀ ▶ to switch players, can be enlarged). Whoever lasts more waves wins. |

Match options (host): players in the room, arena, sides, duration, waves, difficulty, available plants (all, classic or own collection), seed slots, starting sun, sky sun rate, plant recharge, lawn mowers, available zombies, starting brains, brain income, zombie recharge, stream quality and room visibility.

After a match everyone stays in the room: rematch, change settings or leave. Any player can end a match early from the side panel. `Enter` opens the chat. The screens are available in English, Português and 中文.

### Accounts, cloud saves, rooms and history

The game itself keeps its progress in the browser (`localStorage`, per profile name). With a multiplayer server (see below) players can sign up and log in from the **Account** button next to the profile name on the main menu (or the lobby's **Account** tab):

- every game profile in the browser, including single-player progress, is uploaded to the account and kept in sync automatically; logging in on another browser downloads it (if both changed, the player chooses which to keep);
- **Export save** downloads all profiles as a `.json` file;
- **Import save** and the **save editor** (coins, gems, world keys, tickets, sprouts, "finish tutorial", "unlock every world", "complete every level", "unlock every plant" and the raw profile JSON) are reserved for the accounts listed in the server's `ADMIN_USERS`. Administrators also get a **Players' saves** list to download or edit any player's cloud save (the previous one is kept as `<id>.bak.json`); the player receives it on their next sync. `SAVE_IMPORT=all` lets every logged-in player import files;
- public rooms are listed in the **Rooms** tab, finished Versus/Survival matches in the **Matches** tab, and accounts get win/best-wave stats.

### How it works

Shared-lawn modes are host-authoritative: the host runs the real game and streams it to each guest over WebRTC (video + game audio); the guests' inputs travel back over their data channels and run through the game's own planting/shovel/plant-food/seed-chooser code paths, so everything behaves exactly as in single player. In Survival every guest streams their own lawn to the host, which relays to each player the lawn they choose to watch. The code lives in [`docs/multiplayer`](docs/multiplayer) and does not modify the game bundle.

### Server

Without configuration the game uses the public PeerJS cloud for signaling, so playing with a room code works on static hosting such as GitHub Pages; accounts, cloud saves, the room list and history need the multiplayer server in [`server`](server) (Node.js; PeerJS signaling + REST API, data stored in `DATA_DIR`).

- `docker compose up -d --build --remove-orphans` runs the game and the server together on http://localhost:8080 (accounts and saves are kept in the `multiplayer-data` volume). In Portainer, use this repository's `docker-compose.yml` for the stack.
- Or run `server/` anywhere (`npm install && npm start`) and point the game at it with `server` in [`docs/multiplayer/mp-config.js`](docs/multiplayer/mp-config.js) or `?mp_server=https://your.host`. Set `ALLOWED_ORIGINS` to the site that serves the game.
- Set `ADMIN_USERS` (comma separated usernames, e.g. `ADMIN_USERS=knuckles`) to choose who may import and edit saves; with Docker Compose/Portainer add it to the stack's environment variables and redeploy.
- Forgotten passwords and the account list: on the server's container run `node cli.js users` (list accounts) or `node cli.js password <user> [new password]` (a random one is generated when omitted). With Docker Compose: `docker compose exec multiplayer node cli.js users`; in Portainer: *Containers → …-multiplayer-1 → Console → Connect* and type the command. Administrators can also set a new password for any player from **Players' saves**, and every player can change theirs in **Account**.
- If logging in shows *"The account server is not responding (HTTP 502)"*, the `multiplayer` container is stopped or restarting: check its status and logs (Portainer: *Containers → …-multiplayer-1 → Logs*). The log names the cause, e.g. `DATA_DIR /data is not writable`.
- Players behind very strict NATs may need a TURN server, which can be added to `iceServers` in the same config file.

#### MariaDB

Point the server at your MariaDB (or MySQL) server with `DB_HOST`, `DB_PORT` (3306), `DB_USER`, `DB_PASSWORD` and `DB_NAME` (pvzge), or `DATABASE_URL=mariadb://user:password@host:3306/pvzge`. With Docker Compose / Portainer put them in the stack's environment variables or a `.env` file; a MariaDB on the same machine is reached as `DB_HOST=host.docker.internal`. The database and its user must exist (`CREATE DATABASE pvzge; GRANT ALL ON pvzge.* TO 'pvzge'@'%' IDENTIFIED BY '...';`); the tables are created on the first start. Without these variables the server keeps using files in `DATA_DIR`, as before.

- Tables: `users`, `sessions`, `saves` (current cloud save), `save_history` (the previous `SAVE_HISTORY` versions of each save, default 20; players restore them in Extras → Cloud, admins through the API), `save_profiles` (one row per game profile: name, coins, gems, world keys, tickets, sprouts and the profile JSON), `matches`, `scores` and `achievements`.
- Synchronizing with other tools: change a save from outside by writing `saves.data` and setting `saves.updated_at` to the current time in milliseconds (`UNIX_TIMESTAMP()*1000`); within `DB_SYNC_SECONDS` (default 30) the server picks it up (and accounts added or whose password changed in the database), refreshes `save_profiles`, and the player's game downloads it on its next sync.
- Tables also include `branding_images` (logos / images uploaded in Extras → Visual; `meta.branding` says which game image each one replaces).
- `node cli.js users` / `password` work with either storage.

#### Legacy import (save JSON files into the database)

- **Automatic**: on the first start against an empty database, `DATA_DIR/db.json` and `DATA_DIR/saves/*.json` (the old file storage) are imported (accounts with their passwords, sessions, saves and their `.bak` backups, match history, scores, achievements); `db.json` is then renamed to `db.json.migrated`.
- **Any time**, also into a database already in use: `node cli.js import-legacy <dir>` (Docker: `docker compose exec multiplayer node cli.js import-legacy /data`, or `/data` renamed: point it at the folder that has `db.json` and `saves/`). It merges: accounts that already exist (same id or username) are kept, a legacy save replaces the database one only when it is newer (`--overwrite`: always; the replaced save goes to `save_history`), and running it again changes nothing. A running server sees the imported accounts within `DB_SYNC_SECONDS`.
- **One save file**: `node cli.js import-save <user> <file.json>` replaces a player's cloud save with a save `.json`: an export from the game's Account window, a cloud save (`{"data": ...}`), the raw `PvZ2_PlayerProperties` value or `{"PvZ2_PlayerProperties": ..., "PvZ2_Settings": ...}`. Works with either storage, with the server running or stopped; the previous save is kept (history / `.bak`).

### Português (pt-BR)

The game itself can be played in Brazilian Portuguese: in the game's **Settings**, the **Language** button now cycles *English → Português → 简体中文*. Portuguese is chosen automatically when the browser's language is Portuguese and nothing was picked yet. The translation (menus, almanac, plant and zombie names and descriptions, tips, dialogues, level names, quests…) is in [`docs/i18n/pt-BR.json`](docs/i18n/pt-BR.json) (English text → Portuguese) and is applied by [`docs/multiplayer/mp-i18n.js`](docs/multiplayer/mp-i18n.js) without modifying the game bundle; plant and zombie names follow the official Brazilian ones where known.

Three of the game fonts had no accented letters; [`tools/font-accents.py`](tools/font-accents.py) adds them (`python3 tools/font-accents.py <donor.ttf> <font.ttf>...`, needs `pip install fonttools`). After updating the game, run `node tools/i18n-missing.js` to list new texts that still need a translation, and re-run the font script if upstream replaced those fonts.

### Updating the game

After merging a new game version from upstream, run `node tools/game-version.js <previous game commit> <version>` (e.g. `node tools/game-version.js 0e4a0534 0.16.8-ptbr`) and commit `docs/version.json`. When the upstream repository can't be reached, the same game files are in the official Docker image (`gaozih/pvzge`, under `/usr/share/nginx/html`): commit them over the previous upstream version and merge that commit. Many game files keep their name across versions with new content; the page uses this list to make browsers that cached the previous version download them again, instead of mixing versions (black screen). The bundled nginx also makes browsers revalidate the game files (`Cache-Control: no-cache`, answered with a cheap 304 when unchanged). If a CDN such as Cloudflare caches the site, purge its cache after updating.

## Extras

Click **Extras** on the main menu for single-player additions (they never modify the game bundle and are switched off during multiplayer matches where they would change the game):

| Tab | What it does |
| --- | --- |
| **Modes** | **Sandbox**: the game's own hidden sandbox mode (zombie packet bar to drop any zombie on any lane, lawn tools) with infinite sun, no recharge, optional waves and mowers. **Endless Survival**: ever-growing waves until you lose; your best wave goes to the leaderboard. **Inverted Mode**: roles reversed: waves of plants appear on the left and hop one square to the right every few seconds (the Beghouled minigame's plant leap), shooting as usual, while you defend with zombies: brain bank, the game's zombie packet bar, pick a zombie and click a square of the right half, where it walks in and holds the line, eating the plants that come close; a plant past the last column wins for the plants, holding out through every wave wins for you (score on the leaderboard). Each arena sends its own world's plants (mushrooms in the Dark Ages, laser beans in the Far Future, pea pods and cacti in the Wild West...), waves come in formations (advance, wall of nuts with shooters behind, fast rush, artillery, focused attack on one or two lanes, elite) with a huge wave every 5, some plants are hasty, energized (they use plant food when a zombie gets close) or elite (triple health, bigger), and on normal/hard a jalapeno may sweep your most defended lane after a warning. **Mirrored Mode**: the Inverted Mode back to front: the plants come in from the right turned to face left and march shooting at your zombies, who hold the left half turned to face right (the game's own reversed zombies). The game has no turned-around plants, so the mode adds them: mirrored sprite, detection towards the left edge and shots fired the other way (peashooter, repeater, snow pea, gatling, fire/electric/primal peashooters, mega gatling, homing thistle); lobbers, nuts, traps, close-combat plants and the plants that shoot both ways complete the waves. **Daily Challenge**: one generated level per day, the same for everyone (arena, 8 preset plants, difficulty and 1-2 mutators picked from the date), scored for the day's leaderboard. |
| **Options** | Extra speed (½x, 2x, 3x on top of the game's 1.5x button; keys `-` and `=`), auto-collect of sun / coins, gems and sprouts / plant food, health bars over zombies (body and armor) and damaged plants (key `V`; zombies hidden in fog stay hidden), damage numbers, zombie preview of the level in the seed chooser, end-of-level summary (time, zombies defeated, sun, plants planted and lost, plant food, mowers, waves, most used plant) and the in-level shortcut bar. |
| **Mutators** | Apply to any single-player level: tough zombies (double health), double horde, scarce sun, no mowers, rushed waves, slow recharge, no plant food, fog and hasty zombies. |
| **Achievements** | 21 achievements (no mowers, minimalist, untouchable, speedrun, 1,000 zombies, endless waves, daily streak...), kept in the browser and merged with the account when logged in. |
| **Leaderboard** | Today's challenge and Endless Survival (needs the multiplayer server and an account). |
| **Cloud** | **Import save (.json)** to restore a save file (the game's export, a cloud save or the raw localStorage value; it replaces this browser's progress and, when logged in, is uploaded with the previous save kept in the history; with a server only `ADMIN_USERS`, or everyone with `SAVE_IMPORT=all`), **Export save (.json)**, the profiles in your cloud save and its earlier versions, restorable in one click. |
| **Visual** (admins) | Replace the game's logos and images for every player of the server: browser tab title and icon, a logo of your own over the menu (position and size sliders), the menu background (which carries the game's logo), the loading screen background and logo, the **zombie faces** of each world (the head of the world's zombies, with the jaw kept, hidden or replaced; it applies to every zombie sharing that world's texture: basic, cone, bucket, flag...), and any other game image by its name (buttons, icons...), with live preview, the original's size shown and **Download original** to edit it. Images are stored on the server (MariaDB table `branding_images`, or `DATA_DIR/branding`) and applied from the first frame, loading screen included. Without a server, put `branding/branding.json` (the tab shows the format) and the images next to `index.html`. |

The code lives in [`docs/extras`](docs/extras) (`x-play.js`: speed, auto-collect, health bars, statistics, preview and summary; `x-modes.js`: modes and mutators; `x-inverted.js`: Inverted and Mirrored modes; `x-brand.js`: logos and images; `x-achievements.js`; `x-ui.js`: window and menu button).

## Using Docker

Deploy the game locally by using [Docker image](https://hub.docker.com/r/gaozih/pvzge)

To run the game together with a self-hosted multiplayer signaling server, use `docker compose up -d` (see [Multiplayer](#multiplayer)).
