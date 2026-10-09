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

Click **Multiplayer** on the main menu to play with a friend over the internet. One player creates a room and shares the 5-letter code (or the invite link); the other joins with it.

| Mode | How it plays |
| --- | --- |
| **Co-op** | The host plays any level of the game (campaign, endless zones, minigames). Both players share the sun, seed packets and plant food, and each has their own cursor. |
| **Versus** | One player defends with plants, the other spends brains on zombie packets and picks the lanes to attack. Plants win if they hold until the timer runs out; zombies win by reaching the house. Five arenas, each with its own zombie deck. |
| **Survival** | Both players defend together against generated, ever-growing waves (15, 30 or 60) on the chosen arena. |

The multiplayer screens follow the game's language (English by default, or Chinese) and can be switched to English, Português or 中文 from the lobby.

Guest controls: click seed packets (or `1`-`4`, `Q`-`R`), `D` shovel, `F` plant food, right click cancels. As zombies: click a packet (or `1`-`6`) and then a lane. `Enter` opens the chat.

How it works: the host runs the real game and streams it to the guest over WebRTC (video + game audio); the guest's inputs are sent back over a data channel and executed through the game's own planting/shovel/plant-food code paths, so every plant, zombie and level behaves exactly as in single player. The code lives in [`docs/multiplayer`](docs/multiplayer) and does not modify the game bundle.

Players find each other through a [PeerJS](https://peerjs.com/) signaling server. The public PeerJS cloud is used by default, so it works on static hosting such as GitHub Pages. To use your own server, run `docker compose up -d` (game + signaling server on http://localhost:8080), or start [`server`](server) anywhere and point the game at it with `?mp_server=wss://your.host:443/` or in [`docs/multiplayer/mp-config.js`](docs/multiplayer/mp-config.js). Players behind very strict NATs may need a TURN server, which can be added to `iceServers` in the same file.

## Using Docker

Deploy the game locally by using [Docker image](https://hub.docker.com/r/gaozih/pvzge)

To run the game together with a self-hosted multiplayer signaling server, use `docker compose up -d` (see [Multiplayer](#multiplayer)).
