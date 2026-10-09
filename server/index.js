/*
 * Optional self-hosted signaling server for PvZ2 Gardendless multiplayer.
 *
 * Players only use it to find each other (WebRTC offer/answer exchange);
 * the game stream and inputs then flow directly between the two browsers.
 *
 *   PORT       listening port (default 9000)
 *   HOST       listening address (default: all interfaces)
 *   PEER_PATH  mount path (default "/"; the client then uses "<path>peerjs")
 *   PEER_KEY   API key shared with the clients (default "peerjs")
 *   PROXIED    set to "true" when running behind a reverse proxy
 */
const { PeerServer } = require('peer');

const port = Number(process.env.PORT) || 9000;
const server = PeerServer({
  port,
  host: process.env.HOST || undefined,
  path: process.env.PEER_PATH || '/',
  key: process.env.PEER_KEY || 'peerjs',
  proxied: process.env.PROXIED === 'true',
  allow_discovery: false,
  alive_timeout: 60000,
  expire_timeout: 5000,
  concurrent_limit: 5000,
});

server.on('connection', (client) => console.log(`[peer] connected ${client.getId()}`));
server.on('disconnect', (client) => console.log(`[peer] disconnected ${client.getId()}`));
console.log(`PvZ2 Gardendless multiplayer signaling server listening on :${port}`);
