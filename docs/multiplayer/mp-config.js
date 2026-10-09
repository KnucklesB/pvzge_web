/*
 * PvZ2 Gardendless - Multiplayer configuration.
 *
 * Self-hosters can override any of these values by defining
 * `window.PVZ_MP_CONFIG` before this file is loaded, or by editing this file.
 *
 * Multiplayer server:
 *   Players find each other through a PeerJS signaling server. By default the
 *   free public PeerJS cloud is used, so the game keeps working on static
 *   hosting (GitHub Pages) - but accounts, cloud saves, the public room list
 *   and match history need your own multiplayer server (see /server in the
 *   repository). Set its base URL in `server`, e.g.:
 *
 *     server: 'https://mp.example.com'
 *
 *   It can also be set per-page with the `?mp_server=https://host` query
 *   parameter.
 *
 * NAT traversal:
 *   STUN is enough for most home connections. Players behind strict
 *   corporate/mobile NATs need a TURN relay; add one to `iceServers`.
 */
window.PVZ_MP_CONFIG = Object.assign(
  {
    server: null,
    iceServers: [
      { urls: 'stun:stun.l.google.com:19302' },
      { urls: 'stun:stun1.l.google.com:19302' },
      { urls: 'stun:global.stun.twilio.com:3478' },
    ],
    roomPrefix: 'pvzge-mp-v1-',
    debug: false,
  },
  window.PVZ_MP_CONFIG || {},
);
