/*
 * Multiplayer configuration used by docker-compose: the multiplayer server
 * (signaling + accounts API) is reached on the same origin as the game.
 */
window.PVZ_MP_CONFIG = Object.assign(
  {
    server: location.origin,
    iceServers: [
      { urls: 'stun:stun.l.google.com:19302' },
      { urls: 'stun:stun1.l.google.com:19302' },
    ],
    roomPrefix: 'pvzge-mp-v1-',
    debug: false,
  },
  window.PVZ_MP_CONFIG || {},
);
