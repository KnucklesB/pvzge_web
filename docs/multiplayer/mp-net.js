/*
 * PvZ2 Gardendless - Multiplayer networking.
 *
 * A Session wraps PeerJS (WebRTC). The host owns the room (its peer id is
 * derived from the room code), runs the authoritative game and streams its
 * canvas + audio to every guest (star topology, up to 3 guests). Each guest
 * has its own reliable data channel with the host for lobby state, inputs,
 * HUD state and chat; the host relays what the others need to know.
 */
(function () {
  'use strict';

  var MP = window.PvZMP;
  var util = MP.util;

  var QUALITY = {
    low: { height: 540, fps: 24, bitrate: 1500000 },
    medium: { height: 720, fps: 30, bitrate: 3500000 },
    high: { height: 1080, fps: 30, bitrate: 8000000 },
  };
  MP.QUALITY = QUALITY;

  var HEARTBEAT_MS = 1000;
  // Generous: loading a level can block a slow PC's main thread for a while;
  // a really closed data channel is reported right away by its 'close' event.
  var TIMEOUT_MS = 30000;
  var CONNECT_TIMEOUT_MS = 20000;

  function peerOptions() {
    var opts = {
      debug: MP.config.debug ? 2 : 0,
      config: { iceServers: MP.config.iceServers, sdpSemantics: 'unified-plan' },
    };
    if (MP.config.peer) Object.assign(opts, MP.config.peer);
    return opts;
  }

  function errorKey(err) {
    var type = err && err.type;
    switch (type) {
      case 'peer-unavailable':
        return 'err_not_found';
      case 'network':
      case 'server-error':
      case 'socket-error':
      case 'socket-closed':
        return 'err_network';
      case 'browser-incompatible':
        return 'err_no_stream';
      default:
        return err && err.mpKey ? err.mpKey : 'err_generic';
    }
  }
  MP.errorKey = errorKey;

  // Ask the encoder to start near the target bitrate instead of the default
  // ~300 kbps ramp-up, so the guest gets a sharp picture from the first second.
  function boostSdp(kbps) {
    return function (sdp) {
      try {
        var lines = sdp.split('\r\n');
        var pts = [];
        lines.forEach(function (l) {
          var m = /^a=rtpmap:(\d+) (VP8|VP9|H264|AV1)\//i.exec(l);
          if (m) pts.push(m[1]);
        });
        var extra = 'x-google-start-bitrate=' + kbps + ';x-google-min-bitrate=' + Math.round(kbps / 4);
        pts.forEach(function (pt) {
          var idx = lines.findIndex(function (l) {
            return l.indexOf('a=fmtp:' + pt + ' ') === 0;
          });
          if (idx >= 0) {
            if (lines[idx].indexOf('x-google-start-bitrate') < 0) lines[idx] += ';' + extra;
          } else {
            var at = lines.findIndex(function (l) {
              return l.indexOf('a=rtpmap:' + pt + ' ') === 0;
            });
            if (at >= 0) lines.splice(at + 1, 0, 'a=fmtp:' + pt + ' ' + extra);
          }
        });
        return lines.join('\r\n');
      } catch (e) {
        return sdp;
      }
    };
  }

  function mpError(key) {
    var e = new Error(key);
    e.mpKey = key;
    return e;
  }

  /*
   * One remote player as seen from this side: for the host, each guest; for a
   * guest, the host. Slot 0 is always the host, guests get slots 1..3.
   */
  function Link(slot, conn, name) {
    this.slot = slot;
    this.conn = conn;
    this.name = name;
    this.info = null; // {account, ticket} sent by a guest
    this.rtt = 0;
    this.lastSeen = util.now();
    this.out = null; // media we send to them
    this.outSrc = null; // whose lawn that media shows (slot)
    this.watch = 0; // host: whose lawn this guest wants to see
    this.inCall = null; // media they send to us
    this.inStream = null;
    this.pingSeq = 0;
    this.pingSent = {};
  }

  function Session() {
    MP.Emitter.call(this);
    this.role = null; // 'host' | 'guest'
    this.peer = null;
    this.links = {}; // slot -> Link
    this.slot = 0; // our own slot
    this.maxGuests = 3;
    this.code = null;
    this.localName = '';
    this._hb = null;
    this._closing = false;
    this._local = null; // our canvas (+ game audio) stream
    this._canvas = null;
    this.quality = 'medium';
  }
  Session.prototype = Object.create(MP.Emitter.prototype);
  Session.prototype.constructor = Session;

  Session.MAX_PLAYERS = 4;

  Session.prototype.guests = function () {
    var self = this;
    return Object.keys(this.links)
      .map(Number)
      .filter(function (s) {
        return s > 0 && self.links[s];
      })
      .sort()
      .map(function (s) {
        return self.links[s];
      });
  };

  Session.prototype.link = function (slot) {
    return this.links[slot] || null;
  };

  Object.defineProperty(Session.prototype, 'connected', {
    get: function () {
      return this.role === 'guest' ? !!this.links[0] : this.guests().length > 0;
    },
  });
  // Guest side: the host's name and our round trip time to the host.
  Object.defineProperty(Session.prototype, 'remoteName', {
    get: function () {
      return this.links[0] ? this.links[0].name : '';
    },
  });
  Object.defineProperty(Session.prototype, 'rtt', {
    get: function () {
      return this.links[0] ? this.links[0].rtt : 0;
    },
  });

  Session.prototype._createPeer = function (id) {
    var self = this;
    return new Promise(function (resolve, reject) {
      if (typeof window.Peer !== 'function') return reject(mpError('err_no_stream'));
      var peer = id ? new window.Peer(id, peerOptions()) : new window.Peer(peerOptions());
      var done = false;
      var timer = setTimeout(function () {
        if (done) return;
        done = true;
        try {
          peer.destroy();
        } catch (e) {}
        reject(mpError('err_timeout'));
      }, CONNECT_TIMEOUT_MS);
      peer.on('open', function () {
        if (done) return;
        done = true;
        clearTimeout(timer);
        resolve(peer);
      });
      peer.on('error', function (err) {
        if (!done) {
          done = true;
          clearTimeout(timer);
          try {
            peer.destroy();
          } catch (e) {}
          reject(err);
          return;
        }
        self._onPeerError(err);
      });
      peer.on('disconnected', function () {
        // Lost the signaling server; established P2P links keep working.
        if (!self._closing && !peer.destroyed) {
          setTimeout(function () {
            try {
              if (!peer.destroyed && peer.disconnected) peer.reconnect();
            } catch (e) {}
          }, 1500);
        }
      });
      peer.on('call', function (call) {
        self._onCall(call);
      });
    });
  };

  Session.prototype._onPeerError = function (err) {
    MP.log('peer error', err && err.type, err);
    if (err && err.type === 'peer-unavailable' && this.role === 'guest' && !this.connected) {
      this.emit('error', mpError('err_not_found'));
    } else if (err && (err.type === 'network' || err.type === 'server-error')) {
      if (!this.connected) this.emit('error', mpError('err_network'));
    }
  };

  /* -------------------------------------------------------------------- host */

  Session.prototype.host = function (name, maxPlayers) {
    var self = this;
    this.role = 'host';
    this.slot = 0;
    this.localName = name;
    this.setMaxPlayers(maxPlayers);
    this._closing = false;
    var attempt = 0;
    function tryOpen() {
      var code = util.randomCode(5);
      return self._createPeer(MP.config.roomPrefix + code.toLowerCase()).then(
        function (peer) {
          self.peer = peer;
          self.code = code;
          peer.on('connection', function (conn) {
            self._onIncoming(conn);
          });
          return code;
        },
        function (err) {
          if (err && err.type === 'unavailable-id' && ++attempt < 5) return tryOpen();
          throw err;
        },
      );
    }
    return tryOpen();
  };

  Session.prototype.setMaxPlayers = function (n) {
    n = Math.max(2, Math.min(Session.MAX_PLAYERS, Number(n) || Session.MAX_PLAYERS));
    this.maxGuests = n - 1;
  };

  Session.prototype._freeSlot = function () {
    for (var s = 1; s <= this.maxGuests; s++) if (!this.links[s]) return s;
    return 0;
  };

  function refuse(conn, reason) {
    try {
      conn.send({ t: 'reject', reason: reason });
    } catch (e) {}
    setTimeout(function () {
      try {
        conn.close();
      } catch (e) {}
    }, 600);
  }

  Session.prototype._onIncoming = function (conn) {
    var self = this;
    var gotHello = false;
    var helloTimer = setTimeout(function () {
      if (!gotHello) conn.close();
    }, 10000);
    conn.on('data', function onData(msg) {
      if (gotHello || !msg || msg.t !== 'hello') return;
      gotHello = true;
      clearTimeout(helloTimer);
      conn.off('data', onData);
      if (msg.v !== MP.PROTOCOL) return refuse(conn, 'err_version');
      var slot = self._freeSlot();
      if (!slot) return refuse(conn, 'err_full');
      var link = new Link(slot, conn, String(msg.name || 'Player').slice(0, 20));
      link.info = { account: msg.account ? String(msg.account).slice(0, 20) : null, ticket: msg.ticket ? String(msg.ticket).slice(0, 400) : null };
      self.links[slot] = link;
      self._attach(link);
      self.emit('peer-joined', link);
    });
  };

  /* ------------------------------------------------------------------- guest */

  // `hello` carries optional extra handshake data (account name + ticket).
  Session.prototype.join = function (code, name, hello) {
    var self = this;
    this.role = 'guest';
    this.localName = name;
    this.code = code.toUpperCase();
    this._closing = false;
    return this._createPeer(null).then(function (peer) {
      self.peer = peer;
      return new Promise(function (resolve, reject) {
        var settled = false;
        var conn = peer.connect(MP.config.roomPrefix + self.code.toLowerCase(), {
          reliable: true,
          serialization: 'json',
        });
        var timer = setTimeout(function () {
          fail(mpError('err_timeout'));
        }, CONNECT_TIMEOUT_MS);
        function fail(err) {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          self.off('error', fail);
          self.close(true);
          reject(err);
        }
        self.on('error', fail);
        conn.on('open', function () {
          conn.send(Object.assign({}, hello || {}, { t: 'hello', v: MP.PROTOCOL, name: name, mp: MP.VERSION }));
        });
        conn.on('data', function onData(msg) {
          if (settled || !msg) return;
          if (msg.t === 'reject') {
            fail(mpError(msg.reason || 'err_generic'));
          } else if (msg.t === 'welcome') {
            settled = true;
            clearTimeout(timer);
            self.off('error', fail);
            conn.off('data', onData);
            self.slot = Number(msg.you) || 1;
            var link = new Link(0, conn, String(msg.name || 'Host').slice(0, 20));
            self.links[0] = link;
            self._attach(link);
            resolve(msg);
          }
        });
        conn.on('error', function (err) {
          fail(err);
        });
      });
    });
  };

  /* ------------------------------------------------------------------ shared */

  Session.prototype._linkByPeer = function (peerId) {
    var self = this;
    var found = null;
    Object.keys(this.links).forEach(function (s) {
      var l = self.links[s];
      if (l && l.conn && l.conn.peer === peerId) found = l;
    });
    return found;
  };

  // Media from a known player: a guest's own lawn (host side, Survival) or
  // the lawn the host shows us (guest side; metadata.src = whose lawn).
  Session.prototype._onCall = function (call) {
    var self = this;
    var link = this._linkByPeer(call.peer);
    if (!link) {
      call.close();
      return;
    }
    var src = this.role === 'guest' ? Number(call.metadata && call.metadata.src) || 0 : link.slot;
    if (link.inCall && link.inCall !== call) {
      try {
        link.inCall.close();
      } catch (e) {}
    }
    link.inCall = call;
    call.on('stream', function (stream) {
      if (link.inCall !== call) return;
      link.inStream = stream;
      self.emit('stream', stream, src, link);
      // Host: other guests watching this lawn get it relayed.
      if (self.role === 'host') {
        self.guests().forEach(function (g) {
          if (g !== link && g.watch === link.slot) self.streamTo(g.slot, link.slot, true);
        });
      }
    });
    call.on('close', function () {
      if (link.inCall !== call) return;
      link.inCall = null;
      link.inStream = null;
      self.emit('stream-ended', src, link);
    });
    call.on('error', function (err) {
      MP.warn('media error', err);
    });
    call.answer(undefined, { sdpTransform: boostSdp(2500) });
  };

  Session.prototype._attach = function (link) {
    var self = this;
    var conn = link.conn;
    link.lastSeen = util.now();
    conn.on('data', function (msg) {
      link.lastSeen = util.now();
      if (!msg || typeof msg.t !== 'string') return;
      if (msg.t === 'ping') {
        link.rtt = msg.rtt || link.rtt;
        conn.send({ t: 'pong', id: msg.id });
        self.emit('rtt', link);
        return;
      }
      if (msg.t === 'pong') {
        var sent = link.pingSent[msg.id];
        if (sent) {
          link.rtt = Math.round(util.now() - sent);
          delete link.pingSent[msg.id];
          self.emit('rtt', link);
        }
        return;
      }
      if (msg.t === 'bye') {
        self._drop(link, msg.reason === 'kicked' ? 'kicked' : 'bye');
        return;
      }
      self.emit('message', msg, link);
    });
    conn.on('close', function () {
      if (self.links[link.slot] === link) self._drop(link, 'closed');
    });
    conn.on('error', function (err) {
      MP.warn('data channel error', err);
    });
    if (!this._hb) {
      this._hb = setInterval(function () {
        self._heartbeat();
      }, HEARTBEAT_MS);
    }
  };

  Session.prototype._heartbeat = function () {
    var self = this;
    var now = util.now();
    Object.keys(this.links).forEach(function (s) {
      var link = self.links[s];
      if (!link) return;
      if (now - link.lastSeen > TIMEOUT_MS) return self._drop(link, 'timeout');
      if (self.role === 'host' && link.conn.open) {
        var id = ++link.pingSeq;
        link.pingSent[id] = now;
        if (id > 30) delete link.pingSent[id - 30];
        try {
          link.conn.send({ t: 'ping', id: id, rtt: link.rtt });
        } catch (e) {}
      }
    });
  };

  function closeQuietly(x) {
    try {
      if (x) x.close();
    } catch (e) {}
  }

  Session.prototype._drop = function (link, reason) {
    if (this.links[link.slot] !== link) return;
    delete this.links[link.slot];
    closeQuietly(link.conn);
    closeQuietly(link.out);
    closeQuietly(link.inCall);
    link.out = link.inCall = link.inStream = null;
    var self = this;
    if (this.role === 'host') {
      // Whoever watched that lawn goes back to the host's.
      this.guests().forEach(function (g) {
        if (g.watch === link.slot) self.streamTo(g.slot, 0);
      });
    }
    this.emit('peer-left', link, reason);
  };

  function sendOn(link, msg) {
    if (link && link.conn && link.conn.open) {
      try {
        link.conn.send(msg);
        return true;
      } catch (e) {
        MP.warn('send failed', e);
      }
    }
    return false;
  }

  // Host: to every guest (but `except`); guest: to the host.
  Session.prototype.send = function (msg, except) {
    if (this.role === 'guest') return sendOn(this.links[0], msg);
    var ok = false;
    this.guests().forEach(function (g) {
      if (g.slot !== except) ok = sendOn(g, msg) || ok;
    });
    return ok;
  };

  Session.prototype.sendTo = function (slot, msg) {
    return sendOn(this.links[slot], msg);
  };

  Session.prototype.welcome = function (link, payload) {
    sendOn(link, Object.assign({ t: 'welcome', v: MP.PROTOCOL, name: this.localName, code: this.code, you: link.slot }, payload || {}));
  };

  Session.prototype.kick = function (slot, reason) {
    var link = this.links[slot];
    if (!link) return;
    sendOn(link, { t: 'bye', reason: reason || 'kicked' });
    this._drop(link, 'kicked');
  };

  /* ------------------------------------------------------------------ stream */

  Session.prototype._localStream = function (canvas, quality) {
    this.quality = QUALITY[quality] ? quality : this.quality;
    if (this._local && this._canvas === canvas && this._local.getVideoTracks()[0] && this._local.getVideoTracks()[0].readyState === 'live') return this._local;
    if (!canvas || !canvas.captureStream) {
      MP.warn('canvas.captureStream unsupported');
      return null;
    }
    this._stopLocal();
    var stream = canvas.captureStream(QUALITY[this.quality].fps);
    var video = stream.getVideoTracks()[0];
    if (video && 'contentHint' in video) video.contentHint = 'motion';
    var audio = MP.audio.getStream();
    if (audio && audio.getAudioTracks()[0]) stream.addTrack(audio.getAudioTracks()[0]);
    this._local = stream;
    this._canvas = canvas;
    return stream;
  };

  Session.prototype._stopLocal = function () {
    if (!this._local) return;
    this._local.getVideoTracks().forEach(function (t) {
      t.stop();
    });
    this._local = null;
  };

  /*
   * Starts sending our lawn. Host: to every guest (each one gets the lawn
   * they asked to watch, the host's by default). Guest: to the host.
   */
  Session.prototype.startStream = function (canvas, quality) {
    var local = this._localStream(canvas, quality);
    if (!local) return false;
    var self = this;
    if (this.role === 'host') {
      this.guests().forEach(function (g) {
        self.streamTo(g.slot, g.watch || 0, true);
      });
      return true;
    }
    var host = this.links[0];
    if (!host) return false;
    closeQuietly(host.out);
    host.out = this._call(host, local, this.slot);
    host.outSrc = this.slot;
    return true;
  };

  // Host: (re)send to one guest the lawn of `src` (0 = ours, else a guest's,
  // relayed). Without that lawn yet, the guest waits until it arrives.
  Session.prototype.streamTo = function (slot, src, restart) {
    var link = this.links[slot];
    if (!link || this.role !== 'host') return;
    src = Number(src) || 0;
    link.watch = src;
    if (!restart && link.out && link.outSrc === src) return;
    var stream = src === 0 ? this._local : this.links[src] && this.links[src].inStream;
    closeQuietly(link.out);
    link.out = null;
    link.outSrc = null;
    if (!stream || src === slot) return;
    link.out = this._call(link, stream, src);
    link.outSrc = src;
  };

  Session.prototype._call = function (link, stream, src) {
    var q = QUALITY[this.quality];
    var call = this.peer.call(link.conn.peer, stream, { metadata: { src: src }, sdpTransform: boostSdp(Math.round((q.bitrate * 0.7) / 1000)) });
    var self = this;
    call.on('close', function () {
      if (link.out === call) link.out = null;
    });
    call.on('error', function (err) {
      MP.warn('media call error', err);
    });
    this._tuneSender(link, call, 0);
    return call;
  };

  Session.prototype._tuneSender = function (link, call, tries) {
    var self = this;
    if (call !== link.out && tries > 0) return;
    if (tries > 40) return;
    var pc = call.peerConnection;
    var ready = pc && (pc.connectionState === 'connected' || pc.iceConnectionState === 'connected' || pc.iceConnectionState === 'completed');
    if (!ready) {
      setTimeout(function () {
        self._tuneSender(link, call, tries + 1);
      }, 500);
      return;
    }
    this._applyTo(call);
  };

  Session.prototype._applyTo = function (call) {
    var q = QUALITY[this.quality];
    var pc = call && call.peerConnection;
    if (!pc) return;
    // Several viewers share the host's upload: split the bitrate a little.
    var viewers = Math.max(1, this.role === 'host' ? this.guests().length : 1);
    var bitrate = Math.round(q.bitrate / Math.sqrt(viewers));
    var canvas = this._canvas;
    pc.getSenders().forEach(function (sender) {
      if (!sender.track || sender.track.kind !== 'video') return;
      try {
        var params = sender.getParameters();
        if (!params.encodings || !params.encodings.length) params.encodings = [{}];
        var h = (canvas && canvas.height) || q.height;
        params.encodings[0].maxBitrate = bitrate;
        params.encodings[0].maxFramerate = q.fps;
        params.encodings[0].scaleResolutionDownBy = Math.max(1, h / q.height);
        params.degradationPreference = 'balanced';
        sender.setParameters(params).catch(function (e) {
          MP.log('setParameters failed', e);
        });
      } catch (e) {
        MP.log('sender tuning failed', e);
      }
    });
  };

  Session.prototype.applyQuality = function (quality, canvas) {
    if (QUALITY[quality]) this.quality = quality;
    if (canvas) this._canvas = canvas;
    var self = this;
    Object.keys(this.links).forEach(function (s) {
      var l = self.links[s];
      if (l && l.out) self._applyTo(l.out);
    });
  };

  Session.prototype.stopStream = function () {
    var self = this;
    Object.keys(this.links).forEach(function (s) {
      var l = self.links[s];
      if (!l) return;
      closeQuietly(l.out);
      l.out = null;
      l.outSrc = null;
      if (self.role === 'host') l.watch = 0;
    });
    this._stopLocal();
  };

  Session.prototype.close = function (silent) {
    this._closing = true;
    var self = this;
    var links = Object.keys(this.links).map(function (s) {
      return self.links[s];
    });
    links.forEach(function (l) {
      sendOn(l, { t: 'bye' });
    });
    this.stopStream();
    links.forEach(function (l) {
      closeQuietly(l.inCall);
    });
    this.links = {};
    clearInterval(this._hb);
    this._hb = null;
    var peer = this.peer;
    this.peer = null;
    setTimeout(function () {
      links.forEach(function (l) {
        closeQuietly(l.conn);
      });
      try {
        if (peer) peer.destroy();
      } catch (e) {}
    }, 200);
    if (!silent) this.emit('closed');
  };

  MP.Session = Session;
})();
