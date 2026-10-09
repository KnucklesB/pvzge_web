/*
 * PvZ2 Gardendless - Multiplayer networking.
 *
 * A Session wraps PeerJS (WebRTC). The host owns the room (its peer id is
 * derived from the room code), runs the authoritative game and streams its
 * canvas + audio to the guest. Both sides exchange small JSON messages over
 * a reliable data channel: lobby state, inputs, HUD state, chat...
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

  function Session() {
    MP.Emitter.call(this);
    this.role = null; // 'host' | 'guest'
    this.peer = null;
    this.conn = null;
    this.call = null; // outgoing media (our canvas)
    this.inCall = null; // incoming media (the other player's canvas)
    this.code = null;
    this.localName = '';
    this.remoteName = '';
    this.rtt = 0;
    this.connected = false;
    this._lastSeen = 0;
    this._hb = null;
    this._pingSeq = 0;
    this._pingSent = {};
    this._closing = false;
    this._stream = null;
    this.quality = 'medium';
  }
  Session.prototype = Object.create(MP.Emitter.prototype);
  Session.prototype.constructor = Session;

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

  Session.prototype.host = function (name) {
    var self = this;
    this.role = 'host';
    this.localName = name;
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
          peer.on('call', function (call) {
            // Only the connected guest may stream to us (Survival).
            if (!self.conn || call.peer !== self.conn.peer) {
              call.close();
              return;
            }
            self._onCall(call);
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

  Session.prototype._onIncoming = function (conn) {
    var self = this;
    if (this.conn && this.conn.open) {
      conn.on('open', function () {
        conn.send({ t: 'reject', reason: 'err_full' });
        setTimeout(function () {
          conn.close();
        }, 600);
      });
      return;
    }
    var gotHello = false;
    var helloTimer = setTimeout(function () {
      if (!gotHello) conn.close();
    }, 10000);
    conn.on('data', function onData(msg) {
      if (gotHello) return;
      if (!msg || msg.t !== 'hello') return;
      gotHello = true;
      clearTimeout(helloTimer);
      conn.off('data', onData);
      if (msg.v !== MP.PROTOCOL) {
        conn.send({ t: 'reject', reason: 'err_version' });
        setTimeout(function () {
          conn.close();
        }, 600);
        return;
      }
      if (self.conn && self.conn.open) {
        conn.send({ t: 'reject', reason: 'err_full' });
        setTimeout(function () {
          conn.close();
        }, 600);
        return;
      }
      self.remoteName = String(msg.name || 'Player').slice(0, 20);
      self.remoteInfo = { account: msg.account ? String(msg.account).slice(0, 20) : null, ticket: msg.ticket ? String(msg.ticket).slice(0, 400) : null };
      self._attach(conn);
      self.emit('peer-joined', { name: self.remoteName });
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
      peer.on('call', function (call) {
        if (!self.conn || call.peer !== self.conn.peer) {
          call.close();
          return;
        }
        self._onCall(call);
      });
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
            self.remoteName = String(msg.name || 'Host').slice(0, 20);
            self._attach(conn);
            resolve(msg);
          }
        });
        conn.on('error', function (err) {
          fail(err);
        });
      });
    });
  };

  Session.prototype._onCall = function (call) {
    var self = this;
    if (this.inCall) {
      try {
        this.inCall.close();
      } catch (e) {}
    }
    this.inCall = call;
    call.on('stream', function (stream) {
      self.emit('stream', stream);
    });
    call.on('close', function () {
      if (self.inCall === call) {
        self.inCall = null;
        self.emit('stream-ended');
      }
    });
    call.on('error', function (err) {
      MP.warn('media error', err);
    });
    call.answer(undefined, { sdpTransform: boostSdp(2500) });
  };

  /* ------------------------------------------------------------------ shared */

  Session.prototype._attach = function (conn) {
    var self = this;
    this.conn = conn;
    this.connected = true;
    this._lastSeen = util.now();
    conn.on('data', function (msg) {
      self._lastSeen = util.now();
      if (!msg || typeof msg.t !== 'string') return;
      if (msg.t === 'ping') {
        self.rtt = msg.rtt || self.rtt;
        conn.send({ t: 'pong', id: msg.id });
        self.emit('rtt', self.rtt);
        return;
      }
      if (msg.t === 'pong') {
        var sent = self._pingSent[msg.id];
        if (sent) {
          self.rtt = Math.round(util.now() - sent);
          delete self._pingSent[msg.id];
          self.emit('rtt', self.rtt);
        }
        return;
      }
      if (msg.t === 'bye') {
        self._dropPeer('bye');
        return;
      }
      self.emit('message', msg);
      self.emit('msg:' + msg.t, msg);
    });
    conn.on('close', function () {
      if (self.conn === conn) self._dropPeer('closed');
    });
    conn.on('error', function (err) {
      MP.warn('data channel error', err);
    });
    clearInterval(this._hb);
    this._hb = setInterval(function () {
      self._heartbeat();
    }, HEARTBEAT_MS);
  };

  Session.prototype._heartbeat = function () {
    if (!this.conn) return;
    if (util.now() - this._lastSeen > TIMEOUT_MS) {
      this._dropPeer('timeout');
      return;
    }
    if (this.role === 'host' && this.conn.open) {
      var id = ++this._pingSeq;
      this._pingSent[id] = util.now();
      if (id > 30) delete this._pingSent[id - 30];
      this.conn.send({ t: 'ping', id: id, rtt: this.rtt });
    }
  };

  Session.prototype._dropPeer = function (reason) {
    var conn = this.conn;
    if (!conn) return;
    this.conn = null;
    this.connected = false;
    clearInterval(this._hb);
    this._hb = null;
    try {
      conn.close();
    } catch (e) {}
    this.stopStream();
    if (this.inCall) {
      try {
        this.inCall.close();
      } catch (e) {}
      this.inCall = null;
    }
    var name = this.remoteName;
    this.emit('peer-left', { name: name, reason: reason });
  };

  Session.prototype.send = function (msg) {
    if (this.conn && this.conn.open) {
      try {
        this.conn.send(msg);
        return true;
      } catch (e) {
        MP.warn('send failed', e);
      }
    }
    return false;
  };

  Session.prototype.welcome = function (payload) {
    this.send(Object.assign({ t: 'welcome', v: MP.PROTOCOL, name: this.localName, code: this.code }, payload || {}));
  };

  Session.prototype.kick = function () {
    this.send({ t: 'bye' });
    this._dropPeer('kicked');
  };

  /* ------------------------------------------------------------------ stream */

  Session.prototype.startStream = function (canvas, quality) {
    if (!this.conn) return false;
    this.quality = QUALITY[quality] ? quality : this.quality;
    var q = QUALITY[this.quality];
    if (!canvas.captureStream) {
      MP.warn('canvas.captureStream unsupported');
      return false;
    }
    this.stopStream();
    var stream = canvas.captureStream(q.fps);
    var video = stream.getVideoTracks()[0];
    if (video && 'contentHint' in video) video.contentHint = 'motion';
    var audio = MP.audio.getStream();
    if (audio && audio.getAudioTracks()[0]) stream.addTrack(audio.getAudioTracks()[0]);
    this._stream = stream;
    var call = this.peer.call(this.conn.peer, stream, { sdpTransform: boostSdp(Math.round((q.bitrate * 0.7) / 1000)) });
    this.call = call;
    var self = this;
    call.on('close', function () {
      if (self.call === call) self.call = null;
    });
    call.on('error', function (err) {
      MP.warn('media call error', err);
    });
    this._tuneSender(call, canvas, 0);
    return true;
  };

  Session.prototype._tuneSender = function (call, canvas, tries) {
    var self = this;
    if (call !== this.call || tries > 40) return;
    var pc = call.peerConnection;
    var ready = pc && (pc.connectionState === 'connected' || pc.iceConnectionState === 'connected' || pc.iceConnectionState === 'completed');
    if (!ready) {
      setTimeout(function () {
        self._tuneSender(call, canvas, tries + 1);
      }, 500);
      return;
    }
    this.applyQuality(this.quality, canvas);
  };

  Session.prototype.applyQuality = function (quality, canvas) {
    if (QUALITY[quality]) this.quality = quality;
    var q = QUALITY[this.quality];
    var pc = this.call && this.call.peerConnection;
    if (!pc) return;
    pc.getSenders().forEach(function (sender) {
      if (!sender.track || sender.track.kind !== 'video') return;
      try {
        var params = sender.getParameters();
        if (!params.encodings || !params.encodings.length) params.encodings = [{}];
        var h = (canvas && canvas.height) || q.height;
        params.encodings[0].maxBitrate = q.bitrate;
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

  Session.prototype.stopStream = function () {
    if (this.call) {
      try {
        this.call.close();
      } catch (e) {}
      this.call = null;
    }
    if (this._stream) {
      this._stream.getVideoTracks().forEach(function (t) {
        t.stop();
      });
      this._stream = null;
    }
  };

  Session.prototype.close = function (silent) {
    this._closing = true;
    if (this.conn && this.conn.open) {
      try {
        this.conn.send({ t: 'bye' });
      } catch (e) {}
    }
    var conn = this.conn;
    this.conn = null;
    this.connected = false;
    clearInterval(this._hb);
    this.stopStream();
    if (this.inCall) {
      try {
        this.inCall.close();
      } catch (e) {}
      this.inCall = null;
    }
    var peer = this.peer;
    this.peer = null;
    setTimeout(function () {
      try {
        if (conn) conn.close();
      } catch (e) {}
      try {
        if (peer) peer.destroy();
      } catch (e) {}
    }, 200);
    if (!silent) this.emit('closed');
  };

  MP.Session = Session;
})();
