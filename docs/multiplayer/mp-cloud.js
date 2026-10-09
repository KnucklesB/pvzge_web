/*
 * PvZ2 Gardendless - Cloud saves.
 *
 * The game keeps every player profile in the browser's localStorage
 * ("PvZ2_PlayerProperties", plus "PvZ2_Settings"). When the player is logged
 * in, that data is mirrored to their account on the multiplayer server:
 *   - changes made in the game are uploaded automatically (debounced);
 *   - progress made on another device is downloaded and the game reloads;
 *   - if both changed since the last sync, the player chooses which to keep.
 */
(function () {
  'use strict';

  var MP = window.PvZMP;
  var api = MP.api;
  var KEYS = { players: 'PvZ2_PlayerProperties', settings: 'PvZ2_Settings' };
  var AUTO_DELAY = 6000;

  var cloud = (MP.cloud = new MP.Emitter());
  cloud.status = 'idle'; // idle | syncing | synced | conflict | error | offline
  cloud.lastSync = null;
  var timer = null;
  var busy = null;

  function hash(str) {
    var h = 0x811c9dc5;
    for (var i = 0; i < str.length; i++) {
      h ^= str.charCodeAt(i);
      h = Math.imul(h, 0x01000193) >>> 0;
    }
    return h.toString(16) + ':' + str.length;
  }

  function readLocal() {
    var out = {};
    try {
      out.players = localStorage.getItem(KEYS.players);
      out.settings = localStorage.getItem(KEYS.settings);
    } catch (e) {}
    return out;
  }

  function localHash(local) {
    return hash((local.players || '') + '\u0000' + (local.settings || ''));
  }

  function stateKey() {
    var u = api.user();
    return u ? 'cloud.' + u.id : null;
  }

  function getState() {
    var k = stateKey();
    return k ? MP.store.get(k, null) : null;
  }

  function setState(st) {
    var k = stateKey();
    if (k) MP.store.set(k, st);
  }

  function setStatus(s) {
    cloud.status = s;
    cloud.emit('status', s);
  }

  function upload(local, base, force) {
    var blob = JSON.stringify({ v: 1, players: local.players || null, settings: local.settings || null });
    return api.putSave(blob, base, force).then(function (meta) {
      setState({ synced: meta.updatedAt, hash: localHash(local) });
      cloud.lastSync = meta.updatedAt;
      setStatus('synced');
      return 'uploaded';
    });
  }

  function canReloadNow() {
    var G = MP.game;
    return !(MP.app && MP.app.phase === 'match') && (!G.ready || G.sceneName() === 'mainScene');
  }

  // Writes the cloud copy into localStorage and restarts the game on it.
  function apply(save) {
    var blob;
    try {
      blob = JSON.parse(save.data);
    } catch (e) {
      throw new Error('bad_save');
    }
    if (!blob || !blob.players) throw new Error('bad_save');
    if (!canReloadNow()) {
      cloud.pending = save;
      return 'deferred';
    }
    localStorage.setItem(KEYS.players, blob.players);
    if (blob.settings) localStorage.setItem(KEYS.settings, blob.settings);
    setState({ synced: save.updatedAt, hash: localHash(readLocal()) });
    cloud.emit('reloading');
    setTimeout(function () {
      location.reload();
    }, 900);
    return 'downloaded';
  }

  cloud.download = function () {
    return api.getSave().then(function (save) {
      if (!save) return 'empty';
      return apply(save);
    });
  };

  cloud.keepLocal = function () {
    var meta = cloud.conflict && cloud.conflict.cloud;
    cloud.conflict = null;
    setStatus('syncing');
    return upload(readLocal(), meta ? meta.updatedAt : undefined, true);
  };

  cloud.keepCloud = function () {
    cloud.conflict = null;
    setStatus('syncing');
    return cloud.download();
  };

  // Brings this browser and the account in line. Resolves to one of:
  // 'uploaded' | 'downloaded' | 'deferred' | 'in-sync' | 'conflict' | 'empty' | 'skipped'.
  cloud.sync = function () {
    if (!api.available() || !api.loggedIn()) return Promise.resolve('skipped');
    if (busy) return busy;
    setStatus('syncing');
    var local = readLocal();
    var lh = localHash(local);
    var st = getState();
    busy = api
      .saveMeta()
      .then(function (meta) {
        if (!meta) return local.players ? upload(local) : (setStatus('synced'), 'empty');
        cloud.lastSync = meta.updatedAt;
        if (st && meta.updatedAt === st.synced) {
          if (lh === st.hash) {
            setStatus('synced');
            return 'in-sync';
          }
          return upload(local, st.synced);
        }
        // The account has progress from somewhere else.
        if (!local.players || (st && lh === st.hash)) return cloud.download();
        cloud.conflict = { cloud: meta };
        setStatus('conflict');
        cloud.emit('conflict', cloud.conflict);
        return 'conflict';
      })
      .catch(function (e) {
        if (e && e.code === 'conflict') {
          cloud.conflict = { cloud: e.data && e.data.save };
          setStatus('conflict');
          cloud.emit('conflict', cloud.conflict);
          return 'conflict';
        }
        setStatus(e && e.code === 'offline' ? 'offline' : 'error');
        throw e;
      })
      .finally(function () {
        busy = null;
      });
    return busy;
  };

  // Throttled: the game saves often during a level; upload at most once per
  // AUTO_DELAY after the first change.
  cloud.schedule = function (delay) {
    if (!api.loggedIn() || cloud.status === 'conflict' || timer) return;
    timer = setTimeout(function () {
      timer = null;
      cloud.sync().catch(function () {});
    }, delay == null ? AUTO_DELAY : delay);
  };

  cloud.init = function () {
    var G = MP.game;
    var PP = G.m.PlayerProperties && G.m.PlayerProperties.AllPlayerProperties;
    if (PP && typeof PP.savePP === 'function' && !PP._mpWrapped) {
      var orig = PP.savePP;
      PP.savePP = function () {
        var r = orig.apply(this, arguments);
        cloud.schedule();
        return r;
      };
      PP._mpWrapped = true;
    }
    api.on('auth', function (user) {
      if (!user) {
        clearTimeout(timer);
        timer = null;
        cloud.conflict = null;
        setStatus('idle');
      }
    });
    G.on('scene', function (name) {
      if (name === 'mainScene' && cloud.pending) {
        var save = cloud.pending;
        cloud.pending = null;
        try {
          apply(save);
        } catch (e) {}
      }
    });
    if (api.loggedIn()) {
      api.refreshMe().catch(function () {});
      cloud.sync().catch(function () {});
    }
  };
})();
