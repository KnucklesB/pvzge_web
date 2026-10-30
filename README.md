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

### Português (pt-BR)

The game itself can be played in Brazilian Portuguese: in the game's **Settings**, the **Language** button now cycles *English → Português → 简体中文*. Portuguese is chosen automatically when the browser's language is Portuguese and nothing was picked yet. The translation (menus, almanac, plant and zombie names and descriptions, tips, dialogues, level names, quests…) is in [`docs/i18n/pt-BR.json`](docs/i18n/pt-BR.json) (English text → Portuguese) and is applied by [`docs/multiplayer/mp-i18n.js`](docs/multiplayer/mp-i18n.js) without modifying the game bundle; plant and zombie names follow the official Brazilian ones where known.

Three of the game fonts had no accented letters; [`tools/font-accents.py`](tools/font-accents.py) adds them (`python3 tools/font-accents.py <donor.ttf> <font.ttf>...`, needs `pip install fonttools`). After updating the game, run `node tools/i18n-missing.js` to list new texts that still need a translation, and re-run the font script if upstream replaced those fonts.

### Updating the game

After merging a new game version from upstream, run `node tools/game-version.js <previous game commit> <version>` (e.g. `node tools/game-version.js 0e4a0534 0.16.1`) and commit `docs/version.json`. Many game files keep their name across versions with new content; the page uses this list to make browsers that cached the previous version download them again, instead of mixing versions (black screen). The bundled nginx also makes browsers revalidate the game files (`Cache-Control: no-cache`, answered with a cheap 304 when unchanged). If a CDN such as Cloudflare caches the site, purge its cache after updating.

## Using Docker

Deploy the game locally by using [Docker image](https://hub.docker.com/r/gaozih/pvzge)

To run the game together with a self-hosted multiplayer signaling server, use `docker compose up -d` (see [Multiplayer](#multiplayer)).
