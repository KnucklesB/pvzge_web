/*
 * Multiplayer configuration used by docker-compose: the signaling server is
 * reached through the same origin as the game (nginx proxies /peerjs).
 */
window.PVZ_MP_CONFIG = Object.assign(
  {
    peer: {
      host: location.hostname,
      port: location.port ? Number(location.port) : location.protocol === 'https:' ? 443 : 80,
      path: '/',
      secure: location.protocol === 'https:',
    },
    iceServers: [
      { urls: 'stun:stun.l.google.com:19302' },
      { urls: 'stun:stun1.l.google.com:19302' },
    ],
    roomPrefix: 'pvzge-mp-v1-',
    debug: false,
  },
  window.PVZ_MP_CONFIG || {},
);
