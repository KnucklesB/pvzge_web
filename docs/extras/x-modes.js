/*
 * PvZ2 Gardendless - Extra single-player modes and mutators.
 *
 * Modes are generated levels started with KeyListener.GoToGame (the same
 * level builders as the multiplayer Survival mode, mp-modes.js):
 *   - sandbox: the game's own (hidden) sandbox mode - LevelDefinition
 *     .SandBoxMode - with its zombie packet bar, plus infinite sun and no
 *     recharge;
 *   - endless: Survival with hundreds of growing waves; best wave goes to the
 *     "survival" leaderboard;
 *   - daily: one generated level per day (arena, preset plants, mutators
 *     picked from the date), scored on the "daily:<date>" leaderboard.
 *
 * Mutators change any single-player level when it is read
 * (LevelPlay.readLevelJson): level data edits (waves, sun, mowers, fog...)
 * and runtime ones (zombie health and walking speed).
 */
(function () {
  'use strict';

  var MP = window.PvZMP;
  var X = window.PvZX;
  var G = MP.game;
  var t = X.t;

  var modes = (X.modes = { current: null });
  var mut = (X.mutators = {});

  function rtid(name, where) {
    return 'RTID(' + name + '@' + where + ')';
  }

  function clone(o) {
    return JSON.parse(JSON.stringify(o));
  }

  function def(objects) {
    var d = objects.find(function (o) {
      return o.objclass === 'LevelDefinition';
    });
    return d && d.objdata;
  }

  /* ========================================================= mutators */

  mut.LIST = [
    { id: 'tough', runtime: true },
    { id: 'horde' },
    { id: 'scarce' },
    { id: 'nomowers' },
    { id: 'rush' },
    { id: 'slowseeds' },
    { id: 'nofood' },
    { id: 'fog' },
    { id: 'fast', runtime: true },
  ];

  // Mutators chosen in the Extras window (when enabled).
  mut.chosen = function () {
    if (!X.settings.mutatorsOn) return [];
    return mut.LIST.filter(function (m) {
      return X.settings.mutators[m.id];
    }).map(function (m) {
      return m.id;
    });
  };

  // Mutators of the level being played (set when it was read).
  var levelMutators = [];
  mut.active = function () {
    return levelMutators.slice();
  };
  mut.has = function (id) {
    return levelMutators.indexOf(id) >= 0;
  };

  var EDITS = {
    nomowers: function (objects) {
      var d = def(objects);
      if (d && d.Modules) {
        d.Modules = d.Modules.filter(function (m) {
          return !/Mowers?@/i.test(m);
        });
      }
    },
    scarce: function (objects) {
      var d = def(objects);
      if (!d) return;
      d.StartingSun = Math.floor((d.StartingSun != null ? Number(d.StartingSun) : 50) / 2 / 25) * 25;
      if (d.Modules) {
        d.Modules = d.Modules.map(function (m) {
          return /(Default|Fast|VeryFast)SunDropper@/.test(m) ? rtid('SlowSunDropper', 'LevelModules') : m;
        });
      }
    },
    rush: function (objects) {
      objects.forEach(function (o) {
        if (o.objclass === 'WaveManagerProperties' && o.objdata) {
          o.objdata.MinNextWaveHealthPercentage = 0.8;
          o.objdata.MaxNextWaveHealthPercentage = 0.9;
        }
      });
    },
    slowseeds: function (objects) {
      var d = def(objects);
      if (!d) return;
      var existing = objects.find(function (o) {
        return o.objclass === 'PlantCooldownModifierProperties';
      });
      if (existing && existing.objdata) {
        existing.objdata.CooldownMultiplier = (Number(existing.objdata.CooldownMultiplier) || 1) * 2;
        return;
      }
      objects.push({ objclass: 'PlantCooldownModifierProperties', aliases: ['XSlowSeeds'], objdata: { CooldownMultiplier: 2, HomeworldToExcludeFromOverride: '' } });
      d.Modules = (d.Modules || []).concat([rtid('XSlowSeeds', 'CurrentLevel')]);
    },
    nofood: function (objects) {
      objects.forEach(function (o) {
        var od = o.objdata;
        if (!od) return;
        if (Array.isArray(od.DynamicPlantfood)) {
          od.DynamicPlantfood = od.DynamicPlantfood.map(function () {
            return 0;
          });
        }
        if (od.AdditionalPlantfood) od.AdditionalPlantfood = 0;
      });
    },
    horde: function (objects) {
      objects.forEach(function (o) {
        var od = o.objdata;
        if (!od) return;
        if (/^SpawnZombies.*WaveActionProps$/.test(o.objclass) && Array.isArray(od.Zombies)) od.Zombies = od.Zombies.concat(clone(od.Zombies));
        if (o.objclass === 'WaveManagerModuleProperties' && Array.isArray(od.DynamicZombies)) {
          od.DynamicZombies.forEach(function (dz) {
            if (dz && dz.StartingPoints > 0) dz.StartingPoints *= 2;
            if (dz && dz.PointIncrementPerWave > 0) dz.PointIncrementPerWave *= 2;
          });
        }
      });
    },
    fog: function (objects) {
      if (
        objects.some(function (o) {
          return o.objclass === 'LevelFogProperties';
        })
      )
        return;
      // Columns 5..8 of every lane (same matrix layout as the beach levels).
      var row = '0000011111111111';
      objects.push({ objclass: 'LevelFogProperties', aliases: ['XFog'], objdata: { Fogs: [{ BasePosition: { x: 0, y: 0 }, FogMatrix: [row, row, row, row, row, row] }] } });
      var d = def(objects);
      if (d) d.Modules = (d.Modules || []).concat([rtid('XFog', 'CurrentLevel')]);
    },
  };

  mut.apply = function (objects, ids) {
    ids.forEach(function (id) {
      if (EDITS[id]) {
        try {
          EDITS[id](objects);
        } catch (e) {
          MP.warn('mutator failed', id, e);
        }
      }
    });
    return objects;
  };

  // Runtime mutators. Pooled zombies are reused: the flag is cleared each
  // time one is enabled again, and every live zombie is reinforced once.
  function boostZombies() {
    if (!mut.has('tough')) return;
    var pool;
    try {
      pool = G.m.CharacterManager.ZombiePool.pool();
    } catch (e) {
      return;
    }
    for (var i = 0; i < pool.length; i++) {
      var z = pool[i];
      try {
        // Spawning sets the health after enabling: wait until it walks in.
        if (z._xBoosted || z.hypnotized || !z.enteredLawn || !z.isAlive() || !(z.toughness > 0)) continue;
        z._xBoosted = true;
        // toughness is a getter on the zombie's own copy of its props.
        var own = z.objdataOwn;
        var org = z.objdataOwnOrg || own;
        var t0 = Number((org && org.Toughness) || z.toughness);
        if (own && typeof own === 'object' && own !== org) own.Toughness = t0 * 2;
        z.health = Math.min(t0 * 2, z.health + t0);
        z._xMax = t0 * 2;
        (z._armors || []).forEach(function (a) {
          if (a && a.toughness > 0) {
            var a0 = a.toughness;
            a.toughness = a0 * 2;
            a.health = Math.min(a.toughness, a.health + a0);
          }
        });
      } catch (e) {}
    }
  }

  function installMutatorHooks() {
    var LP = G.LP();
    // The level component (levelController) reads the level; LevelPlay is
    // its static facade holding levelData.
    var LC = G.m.levelController && G.m.levelController.levelController;
    var proto = LC && LC.prototype;
    if (proto && proto.readLevelJson && !proto._xMut) {
      var orig = proto.readLevelJson;
      var lastIn = null;
      var lastOut = null;
      proto.readLevelJson = function () {
        try {
          var src = LP.levelData;
          if (src && src === lastOut) src = lastIn;
          var ids = X.online() ? [] : modes.current && modes.current.mutators ? modes.current.mutators : mut.chosen();
          levelMutators = ids.slice();
          if (ids.length && src && src.length) {
            lastIn = src;
            lastOut = mut.apply(clone(src), ids);
            LP.levelData = lastOut;
          } else if (src !== LP.levelData) LP.levelData = src;
          // A campaign level read from its own file (no levelData): only the
          // runtime mutators apply.
          if (ids.length && !(src && src.length)) {
            levelMutators = ids.filter(function (id) {
              return mut.LIST.some(function (m) {
                return m.id === id && m.runtime;
              });
            });
          }
        } catch (e) {
          MP.warn('mutators', e);
        }
        return orig.apply(this, arguments);
      };
      proto._xMut = true;
    }
    var Zmod = G.m.Zombie && G.m.Zombie.Zombie;
    if (Zmod && !Zmod.prototype._xBoostHook) {
      var origEnable = Zmod.prototype.characterOnEnable;
      Zmod.prototype.characterOnEnable = function () {
        this._xBoosted = false;
        return origEnable.apply(this, arguments);
      };
      Zmod.prototype._xBoostHook = true;
    }
    if (Zmod && !Zmod.prototype._xFast) {
      var origSpeed = Zmod.prototype.walkSpeedScaleExtra;
      Zmod.prototype.walkSpeedScaleExtra = function () {
        var v = origSpeed.apply(this, arguments);
        return mut.has('fast') && !this.hypnotized ? v * 1.5 : v;
      };
      Zmod.prototype._xFast = true;
    }
  }

  /* ============================================================ modes */

  X.STAGE_IDS = ['modern', 'egypt', 'west', 'future', 'dark'];

  function survivalSettings(over) {
    return MP.normalizeSettings(Object.assign({ mode: 'survival', stage: 'modern', waves: 15, difficulty: 'normal', plantPool: 'all', seedSlots: 8, startSun: 50, sunRate: 'normal', plantCooldown: 1, mowers: 'on' }, over || {}));
  }

  function canStart() {
    if (X.online()) return false;
    var s = G.sceneName();
    return G.ready && (s === 'mainScene' || s === 'worldMapScene' || s === 'inGameScene');
  }

  function start(current, objects) {
    if (!canStart()) {
      if (MP.ui) MP.ui.toast(t('only_menu'), 'bad');
      return false;
    }
    modes.current = current;
    if (X.ui) X.ui.close();
    G.startCustomLevel(objects);
    return true;
  }

  // Sandbox --------------------------------------------------------------

  modes.sandboxOptions = X.store.get('sandbox', { stage: 'modern', waves: false, infiniteSun: true, noCooldown: true, mowers: true });

  modes.startSandbox = function (opts) {
    opts = Object.assign({}, modes.sandboxOptions, opts || {});
    modes.sandboxOptions = opts;
    X.store.set('sandbox', opts);
    var s = survivalSettings({ stage: opts.stage, waves: 30, mowers: opts.mowers ? 'on' : 'off', startSun: 500, plantCooldown: 1 });
    var objects = MP.buildLevel.survival(s);
    var d = def(objects);
    d.Name = t('mode_sandbox');
    d.Description = t('mode_sandbox_desc');
    d.SandBoxMode = true;
    d.StartingSun = opts.infiniteSun ? 9900 : 500;
    if (!opts.waves) {
      d.Modules = d.Modules.filter(function (m) {
        return !/NewWaves@|ZombiesDeadWinCon@/.test(m);
      });
    }
    if (opts.noCooldown) {
      objects.push({ objclass: 'PlantCooldownModifierProperties', aliases: ['XNoCooldown'], objdata: { CooldownMultiplier: 0.02, HomeworldToExcludeFromOverride: '' } });
      d.Modules.push(rtid('XNoCooldown', 'CurrentLevel'));
    }
    return start({ kind: 'sandbox', id: 'sandbox', options: opts, mutators: mut.chosen() }, objects);
  };

  // Endless survival -----------------------------------------------------

  modes.endlessOptions = X.store.get('endless', { stage: 'modern', difficulty: 'normal' });
  var ENDLESS_WAVES = 300;

  modes.startEndless = function (opts) {
    opts = Object.assign({}, modes.endlessOptions, opts || {});
    modes.endlessOptions = opts;
    X.store.set('endless', opts);
    var s = survivalSettings({ stage: opts.stage, waves: 60, difficulty: opts.difficulty });
    var objects = MP.buildLevel.survival(s);
    var d = def(objects);
    d.Name = t('mode_endless');
    d.Description = t('mode_endless_desc');
    var wm = objects.find(function (o) {
      return o.objclass === 'WaveManagerProperties';
    });
    wm.objdata.WaveCount = ENDLESS_WAVES;
    wm.objdata.FlagWaveInterval = 10;
    wm.objdata.Waves = Array.from({ length: ENDLESS_WAVES }, function () {
      return [];
    });
    return start({ kind: 'endless', id: 'endless', options: opts, mutators: mut.chosen() }, objects);
  };

  modes.bestWave = function () {
    return X.store.get('bestWave', 0);
  };

  // Daily challenge ------------------------------------------------------

  var dailyCache = null;

  // {date, seed} from the server (same for everyone), or from this browser's
  // date when there is no server.
  modes.daily = function () {
    var local = { date: X.today(), seed: X.hashSeed('daily:' + X.today()) };
    if (dailyCache && dailyCache.date === X.today()) return Promise.resolve(dailyCache);
    if (!X.api.available()) return Promise.resolve((dailyCache = local));
    return X.api
      .daily()
      .then(function (d) {
        return (dailyCache = d && d.date ? { date: d.date, seed: d.seed >>> 0, server: true } : local);
      })
      .catch(function () {
        return (dailyCache = local);
      });
  };

  var DAILY_MUTATORS = ['tough', 'horde', 'scarce', 'nomowers', 'rush', 'slowseeds', 'nofood', 'fast'];

  // What the day's level looks like (deterministic for a seed).
  modes.dailyPlan = function (day) {
    var rnd = X.rng(day.seed);
    var pick = function (arr) {
      return arr[Math.floor(rnd() * arr.length)];
    };
    var stage = pick(X.STAGE_IDS);
    var all = MP.allPlants().slice().sort();
    var plants = [];
    if (all.indexOf('sunflower') >= 0) plants.push('sunflower');
    // At least one basic attacker, so every day is winnable.
    var attackers = ['peashooter', 'cabbagepult', 'kernelpult', 'snowpea', 'repeater', 'bloomerang', 'threepeater', 'melonpult'].filter(function (p) {
      return all.indexOf(p) >= 0;
    });
    if (attackers.length) plants.push(pick(attackers));
    while (plants.length < 8 && plants.length < all.length) {
      var p = pick(all);
      if (plants.indexOf(p) < 0) plants.push(p);
    }
    var nm = 1 + Math.floor(rnd() * 2);
    var mutators = [];
    while (mutators.length < nm) {
      var m = pick(DAILY_MUTATORS);
      if (mutators.indexOf(m) < 0) mutators.push(m);
    }
    var difficulty = pick(['normal', 'normal', 'hard']);
    return { date: day.date, stage: stage, plants: plants, mutators: mutators, difficulty: difficulty, waves: 20 };
  };

  modes.startDaily = function () {
    return modes.daily().then(function (day) {
      var plan = modes.dailyPlan(day);
      var s = survivalSettings({ stage: plan.stage, waves: 30, difficulty: plan.difficulty, startSun: 150 });
      var objects = MP.buildLevel.survival(s);
      var d = def(objects);
      d.Name = t('daily_today', { date: plan.date });
      d.Description = t('mode_daily_desc');
      var wm = objects.find(function (o) {
        return o.objclass === 'WaveManagerProperties';
      });
      wm.objdata.WaveCount = plan.waves;
      wm.objdata.FlagWaveInterval = 5;
      wm.objdata.Waves = Array.from({ length: plan.waves }, function () {
        return [];
      });
      var bank = objects.find(function (o) {
        return o.objclass === 'SeedBankProperties';
      });
      bank.objdata = {
        SuppressObjectiveTip: true,
        SelectionMethod: 'preset',
        PresetPlantList: plan.plants.map(function (p) {
          return { PlantType: p, Level: -1 };
        }),
      };
      return start({ kind: 'daily', id: 'daily:' + plan.date, plan: plan, mutators: plan.mutators }, objects);
    });
  };

  // Score of a run: waves, zombies defeated, a bonus for winning fast and
  // without losing plants.
  modes.score = function (s) {
    var base = s.wave * 40 + s.kills * 5;
    if (s.result === 'won') base += 1000 + Math.max(0, 900 - Math.round(s.time)) + Math.max(0, 300 - s.lost * 15);
    return Math.max(0, Math.round(base));
  };

  /* ===================================================== level events */

  function onLevelEnd(s) {
    var cur = modes.current;
    if (!cur || s.online) return;
    s.mode = cur.kind;
    if (cur.kind === 'endless') {
      var waves = s.result === 'won' ? s.waveCount : Math.max(0, s.wave - 1);
      s.score = waves;
      s.survived = waves;
      if (waves > modes.bestWave()) {
        X.store.set('bestWave', waves);
        s.newBest = true;
      }
      submit('survival', waves, { waves: waves, kills: s.kills, time: Math.round(s.time), stage: cur.options.stage }, s);
    } else if (cur.kind === 'daily') {
      s.score = modes.score(s);
      var key = 'daily.' + cur.plan.date;
      var prev = X.store.get(key, null);
      if (prev == null || s.score > prev) {
        X.store.set(key, s.score);
        s.newBest = prev != null;
      }
      var days = X.store.get('dailyDays', []);
      if (days.indexOf(cur.plan.date) < 0) {
        days.push(cur.plan.date);
        X.store.set('dailyDays', days.slice(-60));
      }
      submit(cur.id, s.score, { waves: s.wave, kills: s.kills, time: Math.round(s.time), plants: s.planted, stage: cur.plan.stage, mutators: cur.plan.mutators.join(',') }, s);
    }
  }

  function submit(board, score, details, s) {
    if (!X.api.available()) return;
    if (!X.api.loggedIn()) {
      setTimeout(function () {
        X.play.summaryNote(t('summary_login'), 'pvzx-muted');
      }, 1300);
      return;
    }
    X.api
      .postScore(board, score, details)
      .then(function (r) {
        s.rank = r.rank;
        setTimeout(function () {
          if (r.improved && s.newBest) X.play.summaryNote(t('summary_best'), 'pvzx-good');
          if (r.rank) X.play.summaryNote(t('summary_rank', { n: r.rank }), 'pvzx-good');
        }, 1300);
      })
      .catch(function (e) {
        MP.warn('score not sent', e);
      });
  }

  function onFrame() {
    if (G.inLevel()) boostZombies();
    var cur = modes.current;
    if (!cur) return;
    // Infinite sun in the sandbox.
    if (cur.kind === 'sandbox' && cur.options.infiniteSun && G.inLevel()) {
      try {
        var SC = G.m.SunCount.SunCount;
        var c = SC && SC.component;
        if (c && c.CurrentValue < 9000) {
          X._sunTopUp = true;
          c.SunAdd(9900 - c.CurrentValue);
        }
      } catch (e) {
      } finally {
        X._sunTopUp = false;
      }
    }
  }

  modes.init = function () {
    installMutatorHooks();
    X.on('level-end', onLevelEnd);
    G.on('frame', onFrame);
    G.on('scene', function (name) {
      // Back on the menu or the map: the mode is over.
      if (name !== 'inGameScene') {
        modes.current = null;
        levelMutators = [];
      }
    });
  };
})();
