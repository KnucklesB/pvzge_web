/*
 * PvZ2 Gardendless - Multiplayer audio routing.
 *
 * Must run before the Cocos engine creates its audio graph. Every connection
 * to an AudioContext's destination is redirected through a per-context master
 * gain node. That master feeds both the speakers and a MediaStream, so the
 * host can stream the game's audio to the guest, and the guest can mute its
 * own (idle) game while it watches the host.
 */
(function () {
  'use strict';

  var MP = window.PvZMP;
  var api = (MP.audio = {
    getStream: function () {
      return null;
    },
    setLocalMuted: function () {},
  });

  if (!window.AudioNode || !window.AudioDestinationNode) return;

  var masters = new Map();
  var muted = false;
  var origConnect = AudioNode.prototype.connect;
  var origDisconnect = AudioNode.prototype.disconnect;

  function master(ctx) {
    var m = masters.get(ctx);
    if (m) return m;
    m = { gain: ctx.createGain(), tap: null };
    m.gain.gain.value = muted ? 0 : 1;
    origConnect.call(m.gain, ctx.destination);
    try {
      m.tap = ctx.createMediaStreamDestination();
      origConnect.call(m.gain, m.tap);
    } catch (e) {
      /* OfflineAudioContext or unsupported */
    }
    masters.set(ctx, m);
    return m;
  }

  AudioNode.prototype.connect = function (dest) {
    if (dest instanceof AudioDestinationNode && !(dest.context instanceof OfflineAudioContext)) {
      var args = Array.prototype.slice.call(arguments);
      args[0] = master(dest.context).gain;
      origConnect.apply(this, args);
      return dest;
    }
    return origConnect.apply(this, arguments);
  };

  AudioNode.prototype.disconnect = function (dest) {
    if (dest instanceof AudioDestinationNode && masters.has(dest.context)) {
      var args = Array.prototype.slice.call(arguments);
      args[0] = masters.get(dest.context).gain;
      try {
        return origDisconnect.apply(this, args);
      } catch (e) {
        return undefined;
      }
    }
    return origDisconnect.apply(this, arguments);
  };

  api.getStream = function () {
    var best = null;
    masters.forEach(function (m, ctx) {
      if (m.tap && ctx.state !== 'closed' && !best) best = m.tap.stream;
    });
    return best;
  };

  api.setLocalMuted = function (value) {
    muted = !!value;
    masters.forEach(function (m, ctx) {
      try {
        m.gain.gain.setTargetAtTime(muted ? 0 : 1, ctx.currentTime, 0.05);
      } catch (e) {
        m.gain.gain.value = muted ? 0 : 1;
      }
    });
  };
})();
