/*
 * PvZ2 Gardendless - Save files: export, import and the save editor.
 *
 * A save is what the game keeps in localStorage: "PvZ2_PlayerProperties"
 * (a JSON array with one object per player profile) and "PvZ2_Settings".
 * Exported files wrap both strings; imports also accept the bare profile
 * array, a {PvZ2_PlayerProperties, PvZ2_Settings} object or a cloud blob.
 *
 * Applying a save rewrites localStorage and reloads the page (the running
 * game keeps its profiles in memory and would overwrite the change), so it
 * is only done from the main menu. Cloud sync then uploads the new save.
 */
(function () {
  'use strict';

  var MP = window.PvZMP;
  var G = MP.game;
  var KEYS = { players: 'PvZ2_PlayerProperties', settings: 'PvZ2_Settings' };
  var FORMAT = 'pvzge-save';

  var saves = (MP.saves = {});

  saves.readLocal = function () {
    var out = { players: null, settings: null };
    try {
      out.players = localStorage.getItem(KEYS.players);
      out.settings = localStorage.getItem(KEYS.settings);
    } catch (e) {}
    return out;
  };

  function stamp() {
    var d = new Date();
    function p(n) {
      return (n < 10 ? '0' : '') + n;
    }
    return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()) + '_' + p(d.getHours()) + p(d.getMinutes());
  }

  // {players, settings} (strings) -> file text.
  saves.toFile = function (blob, owner) {
    return JSON.stringify(
      {
        format: FORMAT,
        v: 1,
        exportedAt: new Date().toISOString(),
        owner: owner || undefined,
        profiles: saves.profileNames(blob),
        players: blob.players,
        settings: blob.settings || null,
      },
      null,
      1,
    );
  };

  saves.download = function (blob, owner) {
    var text = saves.toFile(blob, owner);
    var a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
    a.download = 'pvzge-save' + (owner ? '-' + owner : '') + '_' + stamp() + '.json';
    document.body.appendChild(a);
    a.click();
    setTimeout(function () {
      URL.revokeObjectURL(a.href);
      a.remove();
    }, 1000);
  };

  function validPlayers(arr) {
    return (
      Array.isArray(arr) &&
      arr.length > 0 &&
      arr.every(function (p) {
        return p && typeof p === 'object' && !Array.isArray(p);
      })
    );
  }

  function asString(v) {
    if (v == null) return null;
    return typeof v === 'string' ? v : JSON.stringify(v);
  }

  // Any supported save text -> {players, settings} (strings), or throws.
  saves.parse = function (text) {
    var o = JSON.parse(text);
    var players = null;
    var settings = null;
    if (Array.isArray(o)) players = o;
    else if (o && typeof o === 'object') {
      var p = o.players != null ? o.players : o[KEYS.players];
      var s = o.settings != null ? o.settings : o[KEYS.settings];
      players = typeof p === 'string' ? JSON.parse(p) : p;
      settings = s;
      // A cloud blob stored as {data: "<json>"}
      if (!players && typeof o.data === 'string') return saves.parse(o.data);
    }
    if (!validPlayers(players)) throw new Error('bad_save');
    return { players: JSON.stringify(players), settings: asString(settings) };
  };

  saves.profileNames = function (blob) {
    try {
      return JSON.parse(blob.players).map(function (p) {
        return p.name || '?';
      });
    } catch (e) {
      return [];
    }
  };

  saves.canApply = function () {
    return !(MP.app && MP.app.session) && (!G.ready || G.sceneName() === 'mainScene');
  };

  // Writes a save into this browser and restarts the game on it.
  saves.applyLocal = function (blob) {
    if (!saves.canApply()) throw new Error('save_only_menu');
    localStorage.setItem(KEYS.players, blob.players);
    if (blob.settings) localStorage.setItem(KEYS.settings, blob.settings);
    setTimeout(function () {
      location.reload();
    }, 900);
  };

  /* ------------------------------------------------------------ editing */

  var PP = function () {
    return G.m.PlayerProperties;
  };

  function enumValue(name, key, fallback) {
    try {
      var v = PP()[name][key];
      return typeof v === 'number' ? v : fallback;
    } catch (e) {
      return fallback;
    }
  }

  function worldCount() {
    return enumValue('WorldMapSceneDisplayEnum', 'amount', 28);
  }

  saves.NUMBERS = [
    { key: 'coin', label: 'editor_coins', max: 99999999 },
    { key: 'gem', label: 'editor_gems', max: 99999 },
    { key: 'worldkey', label: 'editor_keys', max: 999 },
    { key: 'ticket', label: 'editor_tickets', max: 99999 },
    { key: 'sprout', label: 'editor_sprouts', max: 999 },
  ];

  // Progress shortcuts, applied to one profile object in place.
  saves.ACTIONS = {
    skipTutorial: function (p) {
      p.forceLevel = '';
      p.features = p.features || {};
      Object.keys(p.features).forEach(function (k) {
        p.features[k] = true;
      });
      ['feature_lod', 'feature_zengarden', 'feature_almanac', 'feature_coins', 'feature_worldmap', 'feature_worldkeys', 'feature_plantfood', 'feature_powerup', 'feature_store'].forEach(function (k) {
        p.features[k] = true;
      });
      p.tutorial = p.tutorial || {};
      Object.keys(p.tutorial).forEach(function (k) {
        p.tutorial[k] = true;
      });
      p.levelProps = p.levelProps || {};
      ['tutorial1', 'tutorial2', 'tutorial3', 'tutorial4'].forEach(function (id) {
        p.levelProps[id] = Object.assign({}, p.levelProps[id], { progress: enumValue('LevelProgress', 'finished', 4) });
      });
      p.worldProps = p.worldProps || {};
      [0, enumValue('WorldMapSceneDisplayEnum', 'egypt', 1)].forEach(function (i) {
        p.worldProps[i] = Object.assign({ viewed: false, wmx: 0 }, p.worldProps[i], { unlocked: true });
      });
    },
    unlockWorlds: function (p) {
      p.worldProps = p.worldProps || {};
      for (var i = 0; i < worldCount(); i++) p.worldProps[i] = Object.assign({ viewed: false, wmx: 0 }, p.worldProps[i], { unlocked: true });
    },
    finishLevels: function (p) {
      var done = enumValue('LevelProgress', 'finished', 4);
      p.levelProps = p.levelProps || {};
      (MP.LEVELS || []).forEach(function (w) {
        w.levels.forEach(function (lv) {
          lv.ids.forEach(function (id) {
            p.levelProps[id] = Object.assign({}, p.levelProps[id], { progress: done });
          });
        });
      });
    },
    unlockPlants: function (p) {
      var owned = enumValue('PlantObtainProgress', 'obtained', 2);
      var list = [];
      try {
        list = G.m.Plants.plants.defaultPlantChooserOrder || [];
      } catch (e) {}
      p.plantProps = p.plantProps || {};
      list.forEach(function (code) {
        var cur = p.plantProps[code];
        p.plantProps[code] = Object.assign({ medal: false, tutorialLevel: 0, costume: -1, costumes: [], boost: 0 }, cur, {
          progress: Math.max(owned, (cur && cur.progress) || 0),
        });
      });
    },
  };

  saves.ACTION_LABELS = {
    skipTutorial: 'editor_skip_tutorial',
    unlockWorlds: 'editor_unlock_worlds',
    finishLevels: 'editor_finish_levels',
    unlockPlants: 'editor_unlock_plants',
  };
})();
