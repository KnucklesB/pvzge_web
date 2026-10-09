/*
 * PvZ2 Gardendless - Multiplayer configuration.
 *
 * Self-hosters can override any of these values by defining
 * `window.PVZ_MP_CONFIG` before this file is loaded, or by editing this file.
 *
 * Signaling:
 *   Players find each other through a PeerJS signaling server. By default the
 *   free public PeerJS cloud is used, so the game keeps working on static
 *   hosting (GitHub Pages). To use your own server (see /server in the repo),
 *   set `peer` below, e.g.:
 *
 *     peer: { host: 'play.example.com', port: 443, path: '/peerjs', secure: true }
 *
 *   It can also be set per-page with the `?mp_server=wss://host:port/path`
 *   query parameter.
 *
 * NAT traversal:
 *   STUN is enough for most home connections. Players behind strict
 *   corporate/mobile NATs need a TURN relay; add one to `iceServers`.
 */
window.PVZ_MP_CONFIG = Object.assign(
  {
    peer: null,
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
