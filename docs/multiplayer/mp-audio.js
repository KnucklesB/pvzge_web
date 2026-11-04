/*
 * PvZ2 Gardendless - Multiplayer audio routing.
 *
 * Must run before the game creates its audio. Two paths are covered:
 *  - Web Audio (Cocos): every connection to an AudioContext's destination is
 *    redirected through a per-context master gain that feeds both the
 *    speakers and a MediaStream;
 *  - the <audio> element pool of game 0.16+ (window.audioEngine, from
 *    game-audio.js): left untouched in single player; when multiplayer needs
 *    the sound, every element is routed through a Web Audio graph with the
 *    same master gain + MediaStream tap.
 * So the host can stream the game's audio to the guests, and a guest can
 * mute its own (idle) game while it watches the host.
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

  /* ---------------------------------------- <audio> pool (game 0.16+) */

  var engine = null;
  var media = null; // {ctx, gain, tap, wired}

  try {
    Object.defineProperty(window, 'audioEngine', {
      configurable: true,
      get: function () {
        return engine;
      },
      set: function (value) {
        engine = value;
        if (muted) muteElements(true);
      },
    });
  } catch (e) {}

  function poolElements() {
    return engine && engine.pool
      ? engine.pool.map(function (slot) {
          return slot.el;
        })
      : [];
  }

  // Muting without Web Audio: the elements keep their `muted` flag across
  // the clips they play.
  function muteElements(value) {
    poolElements().forEach(function (el) {
      el.muted = value;
    });
  }

  // Routes every element of the pool through our graph (once per element:
  // an element can only ever have one MediaElementSource).
  function wireEngine() {
    var Ctx = window.AudioContext || window.webkitAudioContext;
    if (!engine || !Ctx) return null;
    if (!media) {
      try {
        var ctx = new Ctx();
        var gain = ctx.createGain();
        origConnect.call(gain, ctx.destination);
        var tap = ctx.createMediaStreamDestination();
        origConnect.call(gain, tap);
        media = { ctx: ctx, gain: gain, tap: tap, wired: new WeakSet() };
      } catch (e) {
        MP.warn('audio capture unavailable', e);
        return null;
      }
    }
    poolElements().forEach(function (el) {
      if (media.wired.has(el)) return;
      try {
        el.muted = false;
        origConnect.call(media.ctx.createMediaElementSource(el), media.gain);
        media.wired.add(el);
      } catch (e) {
        MP.warn('audio element routing failed', e);
      }
    });
    media.gain.gain.value = muted ? 0 : 1;
    if (media.ctx.state === 'suspended') media.ctx.resume().catch(function () {});
    return media;
  }

  api.getStream = function () {
    var m = wireEngine();
    if (m) return m.tap.stream;
    var best = null;
    masters.forEach(function (x, ctx) {
      if (x.tap && ctx.state !== 'closed' && !best) best = x.tap.stream;
    });
    return best;
  };

  function setGain(g, ctx) {
    try {
      g.gain.setTargetAtTime(muted ? 0 : 1, ctx.currentTime, 0.05);
    } catch (e) {
      g.gain.value = muted ? 0 : 1;
    }
  }

  api.setLocalMuted = function (value) {
    muted = !!value;
    masters.forEach(function (m, ctx) {
      setGain(m.gain, ctx);
    });
    if (media) {
      setGain(media.gain, media.ctx);
      if (media.ctx.state === 'suspended') media.ctx.resume().catch(function () {});
    }
    // Elements not routed through our graph (yet) are muted directly.
    poolElements().forEach(function (el) {
      el.muted = muted && !(media && media.wired.has(el));
    });
  };
})();
