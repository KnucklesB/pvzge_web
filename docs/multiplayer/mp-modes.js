/*
 * PvZ2 Gardendless - Multiplayer game modes.
 *
 *  coop     - shared lawn: the host plays any level of the game (campaign,
 *             endless zones, minigames...); the guest shares the seed bank,
 *             sun and plant food and can help pick seeds.
 *  versus   - shared lawn: one player defends with plants picked in the
 *             native seed chooser, the other spends brains on a zombie deck
 *             they pick in the lobby. Plants win if they hold until the timer
 *             runs out, zombies win by reaching the house.
 *  survival - one lawn per player: both run the same generated level with
 *             ever-growing waves on their own screen, watching each other's
 *             lawn in a live picture-in-picture.
 *
 * Shared-lawn matches run on the host (`Match`); in Survival each player also
 * runs a `SoloRun` tracker for their own lawn.
 */
(function () {
  'use strict';

  var MP = window.PvZMP;
  var G = MP.game;
  var t = MP.t;

  MP.MODE_LIST = ['coop', 'versus', 'survival'];

  /* ============================================================ settings */

  // Every option shown in the lobby: values, labels and which modes use it.
  MP.OPTIONS = {
    duration: { modes: ['versus'], values: [3, 5, 7, 10], def: 5, label: 'duration', fmt: 'minutes' },
    waves: { modes: ['survival'], values: [15, 30, 60], def: 15, label: 'waves', fmt: 'waves_n' },
    difficulty: { modes: ['survival'], values: ['easy', 'normal', 'hard'], def: 'normal', label: 'difficulty', fmt: 'difficulty_' },
    plantPool: { modes: ['versus', 'survival'], values: ['all', 'classic', 'collection'], def: 'all', label: 'plant_pool', fmt: 'pool_' },
    seedSlots: { modes: ['versus', 'survival'], values: [6, 8], def: 8, label: 'seed_slots' },
    startSun: { modes: ['versus', 'survival'], values: [50, 150, 300, 500], def: 50, label: 'start_sun' },
    sunRate: { modes: ['versus', 'survival'], values: ['slow', 'normal', 'fast', 'very_fast'], def: 'normal', label: 'sun_rate', fmt: 'rate_' },
    plantCooldown: { modes: ['versus', 'survival'], values: [0.5, 1, 1.5], def: 1, label: 'plant_cooldown', fmt: 'mult' },
    mowers: { modes: ['versus', 'survival'], values: ['on', 'off'], def: 'on', label: 'mowers', fmt: 'onoff_' },
    zombiePool: { modes: ['versus'], values: ['all', 'arena'], def: 'all', label: 'zombie_pool', fmt: 'zpool_' },
    startBrains: { modes: ['versus'], values: [100, 200, 400, 800], def: 200, label: 'start_brains' },
    brainRate: { modes: ['versus'], values: [0.75, 1, 1.5, 2], def: 1, label: 'brain_rate', fmt: 'mult' },
    zombieCooldown: { modes: ['versus'], values: [0.5, 0.75, 1, 1.5], def: 1, label: 'zombie_cooldown', fmt: 'mult' },
  };

  MP.DEFAULT_SETTINGS = { mode: 'coop', stage: 'modern', hostSide: 'plants', quality: 'medium', public: true, zdeck: null };
  Object.keys(MP.OPTIONS).forEach(function (k) {
    MP.DEFAULT_SETTINGS[k] = MP.OPTIONS[k].def;
  });

  // Fills in missing/invalid values (e.g. settings saved by an older version).
  MP.normalizeSettings = function (s) {
    var out = Object.assign({}, MP.DEFAULT_SETTINGS, s || {});
    if (MP.MODE_LIST.indexOf(out.mode) < 0) out.mode = 'coop';
    if (!MP.STAGES[out.stage]) out.stage = 'modern';
    if (out.hostSide !== 'zombies') out.hostSide = 'plants';
    Object.keys(MP.OPTIONS).forEach(function (k) {
      if (MP.OPTIONS[k].values.indexOf(out[k]) < 0) out[k] = MP.OPTIONS[k].def;
    });
    out.zdeck = MP.validDeck(out.stage, out.zdeck, out.zombiePool);
    return out;
  };

  /* ============================================================== arenas */

  MP.STAGES = {
    modern: {
      label: 'stage_modern',
      img: 'frontyard',
      stage: 'ModernStage',
      mowers: 'ModernMowers',
      zombies: ['tutorial', 'tutorial_armor1', 'tutorial_armor2', 'tutorial_flag', 'modern_newspaper', 'modern_balloon', 'modern_allstar', 'tutorial_imp', 'catapult', 'tutorial_gargantuar'],
    },
    egypt: {
      label: 'stage_egypt',
      img: 'egypt',
      stage: 'EgyptStage',
      mowers: 'EgyptMowers',
      zombies: ['mummy', 'mummy_armor1', 'mummy_armor2', 'mummy_flag', 'explorer', 'ra', 'tomb_raiser', 'pharaoh', 'egypt_imp', 'egypt_gargantuar'],
    },
    west: {
      label: 'stage_west',
      img: 'cowboy',
      stage: 'WestStage',
      mowers: 'WestMowers',
      zombies: ['cowboy', 'cowboy_armor1', 'cowboy_armor2', 'cowboy_flag', 'prospector', 'poncho', 'piano', 'chicken_farmer', 'west_bull', 'cowboy_gargantuar'],
    },
    future: {
      label: 'stage_future',
      img: 'future',
      stage: 'FutureStage',
      mowers: 'FutureMowers',
      zombies: ['future', 'future_armor1', 'future_armor2', 'future_flag', 'future_jetpack', 'future_protector', 'mech_cone', 'football_mech', 'disco_mech', 'future_imp', 'future_gargantuar'],
    },
    dark: {
      label: 'stage_dark',
      img: 'dark',
      stage: 'DarkStage',
      mowers: 'DarkMowers',
      zombies: ['dark', 'dark_armor1', 'dark_armor2', 'dark_flag', 'dark_juggler', 'dark_wizard', 'dark_king', 'dark_imp', 'dark_gargantuar'],
    },
  };

  MP.DECK_SIZE = 6;

  // Default deck: the arena's first zombies without the flag zombie.
  MP.defaultDeck = function (stage) {
    var st = MP.STAGES[stage] || MP.STAGES.modern;
    return st.zombies
      .filter(function (z) {
        return !/_flag$/.test(z);
      })
      .slice(0, MP.DECK_SIZE);
  };

  // Zombies the zombie player may pick: the arena's own, or the whole almanac.
  MP.zombieChoices = function (stage, pool) {
    var st = MP.STAGES[stage] || MP.STAGES.modern;
    var all = MP.cards ? MP.cards.catalog() : [];
    if (pool === 'arena' || !all.length) {
      return st.zombies.map(function (type) {
        var hit = all.find(function (z) {
          return z.type === type;
        });
        return { type: type, world: hit ? hit.world : st.img };
      });
    }
    return all;
  };

  MP.validDeck = function (stage, deck, pool) {
    // Before the game has loaded the almanac can't be read yet: keep the deck.
    var catalogReady = MP.cards && MP.cards.catalog().length > 0;
    var allowed =
      pool === 'arena' || catalogReady
        ? MP.zombieChoices(stage, pool).map(function (z) {
            return z.type;
          })
        : null;
    var out = (Array.isArray(deck) ? deck : []).filter(function (z, i, a) {
      return typeof z === 'string' && (!allowed || allowed.indexOf(z) >= 0) && a.indexOf(z) === i;
    });
    out = out.slice(0, MP.DECK_SIZE);
    return out.length ? out : MP.defaultDeck(stage);
  };

  // Brain cost and recharge for any zombie, from the game's wave point cost.
  var COST_OVERRIDES = { tutorial_imp: 50, egypt_imp: 50, future_imp: 75, dark_imp: 50, ra: 75, catapult: 150, piano: 150 };
  MP.zombieCost = function (type) {
    var cost = COST_OVERRIDES[type];
    if (!cost) {
      var wp = 100;
      try {
        var E = G.m.Zombies.ZombieEnum;
        var p = G.m.Zombies.zombies.getZombiePropsByID(E[type]);
        wp = Number(p && p.WavePointCost) || 100;
      } catch (e) {}
      cost = wp <= 100 ? 50 : wp <= 200 ? 75 : wp <= 300 ? 100 : wp <= 450 ? 125 : wp <= 650 ? 150 : wp <= 1000 ? 200 : 275;
    }
    var cd = cost <= 50 ? 3 : cost <= 75 ? 4.5 : cost <= 100 ? 6 : cost <= 150 ? 9 : cost <= 200 ? 13 : 22;
    return { cost: cost, cd: cd };
  };

  MP.zombieName = function (type) {
    try {
      var f = G.m.Zombies.zombies.getZombieFeature(G.m.Zombies.ZombieEnum[type]);
      var n = f && f.NAME;
      if (n) return (MP.lang === 'zh' && n.zh) || n.en || type;
    } catch (e) {}
    return type;
  };

  /* ============================================================= plants */

  var CLASSIC_PLANTS = [
    'sunflower', 'peashooter', 'wallnut', 'potatomine', 'cabbagepult', 'snowpea', 'repeater', 'cherry_bomb',
    'chomper', 'bonkchoy', 'kernelpult', 'spikeweed', 'squash', 'jalapeno', 'tallnut', 'melonpult',
    'threepeater', 'puffshroom', 'iceburg', 'bloomerang', 'twinsunflower', 'torchwood', 'splitpea', 'starfruit',
  ];
  var NOT_PLANTABLE = /^(tool_|powerplant|zombiepotion|marigold_|hollybarrierleaf)|_mgp$|_rhythm$|^atombomb_seedling$|^seedling$|^imitater$/;

  MP.allPlants = function () {
    var out = [];
    try {
      var P = G.m.Plants;
      Object.keys(P.PlantEnum).forEach(function (k) {
        if (!isNaN(+k)) return;
        var f = P.plants.getPlantFeature(P.PlantEnum[k]);
        if (f && f.CODENAME && !NOT_PLANTABLE.test(f.CODENAME) && out.indexOf(f.CODENAME) < 0) out.push(f.CODENAME);
      });
    } catch (e) {}
    return out.length ? out : CLASSIC_PLANTS.slice();
  };

  /* ======================================================= level builders */

  function rtid(name, where) {
    return 'RTID(' + name + '@' + where + ')';
  }

  var SUN_DROPPERS = { slow: 'SlowSunDropper', normal: 'DefaultSunDropper', fast: 'FastSunDropper', very_fast: 'VeryFastSunDropper' };

  function seedBank(s) {
    var data = { SuppressObjectiveTip: true, SelectionMethod: 'chooser', AlwaysUseChooser: true, OverrideSeedSlotsCount: Number(s.seedSlots) || 8 };
    if (s.plantPool !== 'collection') {
      data.PlantIncludeList = s.plantPool === 'classic' ? CLASSIC_PLANTS.slice() : MP.allPlants();
      data.UnlockAll = true;
    }
    return { objclass: 'SeedBankProperties', aliases: ['SeedBank'], objdata: data };
  }

  function commonModules(s, st, objects) {
    var modules = [rtid(SUN_DROPPERS[s.sunRate] || 'DefaultSunDropper', 'LevelModules')];
    if (s.mowers !== 'off') modules.push(rtid(st.mowers, 'LevelModules'));
    modules.push(rtid('SeedBank', 'CurrentLevel'), rtid('DefaultZombieWinCondition', 'LevelModules'));
    if (Number(s.plantCooldown) !== 1) {
      objects.push({ objclass: 'PlantCooldownModifierProperties', aliases: ['MPCooldown'], objdata: { CooldownMultiplier: Number(s.plantCooldown), HomeworldToExcludeFromOverride: '' } });
      modules.push(rtid('MPCooldown', 'CurrentLevel'));
    }
    return modules;
  }

  var INTRO = { objclass: 'LevelIntroProperties', aliases: ['MPIntro'], objdata: { PanStartOffset: -40, PanStreetOffset: 440, PanEndOffset: 0, PanRightDuration: 0.5, PanLeftDuration: 1, PanMoveRightTime: 1.2, PanMoveLeftTime: 1.2, AdditionalStartingSun: 0, ZombiePreviewOff: true } };

  MP.buildLevel = {
    versus: function (s) {
      var st = MP.STAGES[s.stage] || MP.STAGES.modern;
      var extra = [];
      var modules = [rtid('MPIntro', 'CurrentLevel')].concat(commonModules(s, st, extra));
      // The host's mouse isn't the plant player: sun must not depend on hovering.
      if (s.hostSide === 'zombies') modules.push(rtid('AutoCollect', 'LevelModules'));
      return [
        {
          objclass: 'LevelDefinition',
          objdata: {
            Name: t('level_name_versus'),
            Description: t('mode_versus_desc'),
            LevelNumber: 1,
            Loot: rtid('NoLoot', 'LevelModules'),
            StageModule: rtid(st.stage, 'LevelModules'),
            StartingSun: Number(s.startSun) || 50,
            SuppressAwardScreen: true,
            Modules: modules,
          },
        },
        INTRO,
        seedBank(s),
      ].concat(extra);
    },

    survival: function (s) {
      var st = MP.STAGES[s.stage] || MP.STAGES.modern;
      var waves = Number(s.waves) || 15;
      var diff = { easy: 0.7, normal: 1, hard: 1.45 }[s.difficulty] || 1;
      var inc = Math.round((waves <= 15 ? 90 : waves <= 30 ? 70 : 55) * diff);
      var pool = st.zombies.filter(G.zombieExists).map(function (zt) {
        return rtid(zt, 'ZombieTypes');
      });
      var dyn = { PointIncrementPerWave: inc, StartingPoints: Math.round(150 * diff), StartingWave: 0, ZombiePool: pool };
      var extra = [];
      var modules = [rtid('MPIntro', 'CurrentLevel'), rtid('ZombiesDeadWinCon', 'LevelModules')].concat(commonModules(s, st, extra), [rtid('NewWaves', 'CurrentLevel')]);
      return [
        {
          objclass: 'LevelDefinition',
          objdata: {
            Name: t('level_name_survival'),
            Description: t('mode_survival_desc'),
            LevelNumber: 1,
            Loot: rtid('NoLoot', 'LevelModules'),
            StageModule: rtid(st.stage, 'LevelModules'),
            StartingSun: Number(s.startSun) || 50,
            SuppressAwardScreen: true,
            Modules: modules,
          },
        },
        INTRO,
        seedBank(s),
        {
          objclass: 'WaveManagerModuleProperties',
          aliases: ['NewWaves'],
          objdata: { WaveManagerProps: rtid('WaveManagerProps', 'CurrentLevel'), DynamicZombies: [dyn, dyn, dyn, dyn, dyn, dyn, dyn] },
        },
        {
          objclass: 'WaveManagerProperties',
          aliases: ['WaveManagerProps'],
          objdata: {
            FlagWaveInterval: waves <= 15 ? 5 : 10,
            WaveCount: waves,
            WaveSpendingPointIncrement: 0,
            WaveSpendingPoints: 0,
            MinNextWaveHealthPercentage: 0.5,
            MaxNextWaveHealthPercentage: 0.7,
            Waves: Array.from({ length: waves }, function () {
              return [];
            }),
          },
        },
      ].concat(extra);
    },
  };

  /* ================================================================ seats */

  var KEY_CARDS = { '1': 0, '2': 1, '3': 2, '4': 3, q: 4, w: 5, e: 6, r: 7 };
  var KEY_ZCARDS = { '1': 0, '2': 1, '3': 2, '4': 3, '5': 4, '6': 5, q: 0, w: 1, e: 2, r: 3, t: 4, y: 5 };

  /*
   * PlantSeat: the remote (guest) player using the plant side through the
   * game's own planting/shovel/plant food code paths. The host plays plants
   * with the game's native input, so a PlantSeat is only ever remote.
   */
  function PlantSeat(stats) {
    this.sel = null; // {kind:'card'|'shovel'|'food', i}
    this.ui = null;
    this.stats = stats;
  }

  PlantSeat.prototype.pointer = function (ui) {
    this.ui = ui;
    G.setRemotePointer(ui);
  };

  PlantSeat.prototype.cancel = function (silent) {
    if (!this.sel) return false;
    this.sel = null;
    if (!silent) G.play('playRightButtonCancel');
    return true;
  };

  PlantSeat.prototype.selectCard = function (i) {
    if (this.sel && this.sel.kind === 'card' && this.sel.i === i) return this.cancel();
    if (!G.canAct() || !G.cardSelectable(i)) {
      G.play('playCardChooseFailed');
      return false;
    }
    this.sel = { kind: 'card', i: i };
    G.play('playCardChosen');
    return true;
  };

  PlantSeat.prototype.selectTool = function (kind) {
    if (this.sel && this.sel.kind === kind) return this.cancel();
    if (!G.canAct()) return false;
    if (kind === 'food' && G.plantFoodCount() <= 0) {
      G.play('playCardChooseFailed');
      return false;
    }
    this.sel = { kind: kind };
    G.play(kind === 'shovel' ? 'playShovelActive' : 'playCardChosen');
    return true;
  };

  PlantSeat.prototype.down = function (ui, button) {
    if (!G.inLevel()) return;
    this.pointer(ui);
    if (button === 2) return this.cancel();
    var i = G.hitPlantCard(ui);
    if (i >= 0) return this.selectCard(i);
    if (G.hitNode(G.shovelNode(), ui)) return this.selectTool('shovel');
    var food = G.foodNode();
    if (food && G.hitNode(food, ui)) return this.selectTool('food');
    var cell = G.cellAt(ui);
    if (!cell || !this.sel) return;
    var ok = false;
    if (this.sel.kind === 'card') {
      ok = G.p2PlacePlant(this.sel.i, cell);
      if (ok) this.stats.planted[1]++;
    } else if (this.sel.kind === 'shovel') ok = G.p2Shovel(cell);
    else if (this.sel.kind === 'food') ok = G.p2PlantFood(cell);
    if (ok) this.sel = null;
  };

  PlantSeat.prototype.key = function (k) {
    if (!G.inLevel()) return;
    if (k === 'escape') return this.cancel();
    if (k === 'd') return this.selectTool('shovel');
    if (k === 'f') return this.selectTool('food');
    if (KEY_CARDS[k] != null && G.plantCards()[KEY_CARDS[k]]) return this.selectCard(KEY_CARDS[k]);
  };

  PlantSeat.prototype.frame = function () {
    if (!G.inLevel() || G.levelOver()) {
      this.sel = null;
      if (!G.inLevel()) G.setRemotePointer(null);
    }
  };

  PlantSeat.prototype.state = function () {
    var cell = this.sel && this.ui ? G.cellAt(this.ui) : null;
    return { sel: this.sel, cell: cell };
  };

  /*
   * ZombieSeat: the zombie side of Versus. Uses the sandbox zombie packet bar
   * and brains as currency. Can be driven by the host (local) or the guest.
   */
  function ZombieSeat(settings, stats) {
    var cdMult = Number(settings.zombieCooldown) || 1;
    this.deck = MP.validDeck(settings.stage, settings.zdeck, settings.zombiePool)
      .filter(G.zombieExists)
      .map(function (type) {
        var c = MP.zombieCost(type);
        return { type: type, cost: c.cost, cd: c.cd * cdMult };
      });
    this.cds = this.deck.map(function () {
      return 0;
    });
    this.rate = Number(settings.brainRate) || 1;
    this.brains = Number(settings.startBrains) || 200;
    this.income = 8 * this.rate; // brains per second, grows over time
    this.elapsed = 0;
    this.sel = null;
    this.ui = null;
    this.stats = stats;
    this.bar = null;
  }

  ZombieSeat.prototype.mount = function () {
    var self = this;
    return G.mountZombieBar(
      this.deck.map(function (d) {
        return d.type;
      }),
      this.deck.map(function (d) {
        return d.cost;
      }),
    ).then(function (sb) {
      self.bar = sb;
      // Short head start for the plants.
      self.cds = self.deck.map(function (d) {
        return Math.min(d.cd, 5);
      });
      return sb;
    });
  };

  ZombieSeat.prototype.canUse = function (j) {
    var d = this.deck[j];
    return !!d && this.cds[j] <= 0 && this.brains >= d.cost;
  };

  ZombieSeat.prototype.select = function (j) {
    if (this.sel && this.sel.i === j) {
      this.sel = null;
      G.play('playCardCancel');
      return;
    }
    if (!this.canUse(j)) {
      G.play('playCardChooseFailed');
      return;
    }
    this.sel = { kind: 'zcard', i: j };
    G.play('playCardChosen');
  };

  ZombieSeat.prototype.pointer = function (ui) {
    this.ui = ui;
  };

  ZombieSeat.prototype.down = function (ui, button) {
    if (!G.gameStarted() || G.levelOver() || G.isPaused()) return;
    this.ui = ui;
    if (button === 2) {
      if (this.sel) {
        this.sel = null;
        G.play('playRightButtonCancel');
      }
      return;
    }
    var j = G.hitZombieCard(ui);
    if (j >= 0) return this.select(j);
    if (!this.sel) return;
    var lane = G.laneAt(ui);
    if (lane < 0) return;
    this.spawn(this.sel.i, lane);
  };

  ZombieSeat.prototype.spawn = function (j, lane) {
    var d = this.deck[j];
    if (!this.canUse(j)) {
      G.play('playCardChooseFailed');
      this.sel = null;
      return;
    }
    this.brains -= d.cost;
    this.cds[j] = d.cd;
    this.sel = null;
    this.stats.sent++;
    this.stats.brains += d.cost;
    G.play('playPlantOnFloor');
    G.spawnZombie(lane, d.type);
  };

  ZombieSeat.prototype.key = function (k) {
    if (k === 'escape') {
      this.sel = null;
      return;
    }
    if (KEY_ZCARDS[k] != null && this.deck[KEY_ZCARDS[k]]) this.select(KEY_ZCARDS[k]);
  };

  ZombieSeat.prototype.frame = function (dt) {
    if (!G.gameStarted() || G.levelOver() || G.isPaused()) return;
    this.elapsed += dt;
    this.income = (8 + Math.floor(this.elapsed / 60) * 1.5) * this.rate;
    this.brains = Math.min(3000, this.brains + this.income * dt);
    for (var i = 0; i < this.cds.length; i++) if (this.cds[i] > 0) this.cds[i] = Math.max(0, this.cds[i] - dt);
    if (this.sel && !this.canUse(this.sel.i)) this.sel = null;
    var sb = this.bar;
    if (G.isValid(sb)) {
      var self = this;
      sb.index = this.sel ? this.sel.i : -1;
      sb.zombieCards.forEach(function (card, i) {
        if (!self.deck[i]) return;
        card.ca.affordable = self.brains >= self.deck[i].cost;
        card.ca.cooling = self.cds[i] > 0;
      });
    }
  };

  ZombieSeat.prototype.state = function () {
    var self = this;
    return {
      sel: this.sel,
      lane: this.sel && this.ui ? G.laneAt(this.ui) : -1,
      brains: this.brains,
      income: this.income,
      cd: this.cds.map(function (c, i) {
        return self.deck[i] ? c / self.deck[i].cd : 0;
      }),
    };
  };

  /* ============================================================= solo run */

  /*
   * SoloRun: tracks one player's own Survival lawn (used by both host and
   * guest). Level start is only detected on a freshly launched scene, since
   * static game flags still describe the previous level until then.
   */
  function SoloRun(settings, onChange) {
    this.settings = settings;
    this.onChange = onChange || function () {};
    this.phase = 'loading'; // loading -> playing -> done
    this.result = null; // 'won' | 'lost'
    this.wave = 0;
    this.time = 0;
    this.planted = 0;
    this.sceneReady = false;
    this.sawIdle = false;
    var self = this;
    this._onScene = function (name) {
      if (name === 'inGameScene') {
        if (self.phase === 'playing') self.reset();
        self.sceneReady = true;
      }
    };
    this._onPlant = function () {
      self.planted++;
    };
    G.on('scene', this._onScene);
    G.on('local-planted', this._onPlant);
  }

  SoloRun.prototype.reset = function () {
    this.phase = 'loading';
    this.result = null;
    this.wave = 0;
    this.time = 0;
    this.planted = 0;
    this.sawIdle = false;
    this.onChange(this.state());
  };

  SoloRun.prototype.start = function () {
    return G.startCustomLevel(MP.buildLevel.survival(this.settings));
  };

  SoloRun.prototype.frame = function (dt) {
    if (this.phase === 'done' || !this.sceneReady || !G.inLevel()) return;
    var lp = G.lp();
    if (this.phase === 'loading') {
      if (!G.gameStarted()) {
        this.sawIdle = true;
        return;
      }
      if (!this.sawIdle) return;
      this.phase = 'playing';
      this.onChange(this.state());
    }
    if (!G.isPaused()) this.time += dt;
    var wave = Math.max(this.wave, lp.currentWave || 0);
    var changed = wave !== this.wave;
    this.wave = wave;
    if (lp.gameLost || lp.gameWon) {
      this.phase = 'done';
      this.result = lp.gameWon ? 'won' : 'lost';
      changed = true;
    }
    if (changed) this.onChange(this.state());
  };

  SoloRun.prototype.state = function () {
    return { phase: this.phase, result: this.result, wave: this.wave, time: Math.round(this.time), planted: this.planted };
  };

  SoloRun.prototype.dispose = function () {
    G.off('scene', this._onScene);
    G.off('local-planted', this._onPlant);
  };

  MP.SoloRun = SoloRun;

  /* ================================================================ match */

  function Match(app, settings) {
    this.app = app;
    this.settings = MP.normalizeSettings(settings);
    this.mode = this.settings.mode;
    this.phase = 'loading'; // loading -> playing -> over
    this.stats = { planted: [0, 0], sent: 0, brains: 0, time: 0, wave: 0 };
    this.plantSeat = null;
    this.zombieSeat = null;
    this.run = null; // survival: our own lawn
    this.partner = null; // survival: the guest's lawn, as reported by the guest
    this.timeLeft = (Number(this.settings.duration) || 5) * 60;
    this.warned30 = false;
    this.sceneReady = false;
    this.sawIdle = false;
    var self = this;
    this._onLocalPlant = function () {
      self.stats.planted[0]++;
    };
    this._onScene = function (name) {
      if (self.mode === 'coop' || self.phase === 'over') return;
      if (name === 'inGameScene') {
        // A level restarted from the pause menu starts the match over.
        if (self.phase === 'playing' && self.mode === 'versus') self.restartLevel();
        self.sceneReady = true;
      } else if (self.sceneReady && (name === 'mainScene' || name === 'worldMapScene')) {
        // The host left the level from the pause menu.
        self.phase = 'over';
        app.onHostLeftLevel();
      }
    };
    G.on('local-planted', this._onLocalPlant);
    G.on('scene', this._onScene);
  }

  // Which side the guest plays.
  Match.prototype.guestSeat = function () {
    if (this.mode === 'survival') return 'own';
    if (this.mode !== 'versus') return 'plants';
    return this.settings.hostSide === 'plants' ? 'zombies' : 'plants';
  };

  Match.prototype.start = function () {
    var s = this.settings;
    G.hooks.blockLocalPlantInput = false;
    if (this.mode === 'survival') {
      var app = this.app;
      this.run = new SoloRun(s, function () {
        app.sendHud(true);
      });
      this.partner = { phase: 'loading', result: null, wave: 0, time: 0, planted: 0 };
      return this.run.start();
    }
    this.plantSeat = this.guestSeat() === 'plants' ? new PlantSeat(this.stats) : null;
    if (this.mode === 'versus') {
      this.zombieSeat = new ZombieSeat(s, this.stats);
      G.hooks.blockLocalPlantInput = s.hostSide === 'zombies';
      return G.startCustomLevel(MP.buildLevel.versus(s));
    }
    this.phase = 'playing';
    return G.goToWorldMap();
  };

  Match.prototype.restartLevel = function () {
    this.phase = 'loading';
    this.sawIdle = false;
    this.warned30 = false;
    this.timeLeft = (Number(this.settings.duration) || 5) * 60;
    this.stats.sent = 0;
    this.stats.brains = 0;
    this.stats.time = 0;
    this.stats.wave = 0;
    this.stats.planted = [0, 0];
    if (this.plantSeat) this.plantSeat.sel = null;
    if (this.zombieSeat) this.zombieSeat = new ZombieSeat(this.settings, this.stats);
  };

  Match.prototype.remoteSeat = function () {
    if (this.mode === 'survival') return null;
    return this.guestSeat() === 'plants' ? this.plantSeat : this.zombieSeat;
  };

  Match.prototype.localZombies = function () {
    return this.mode === 'versus' && this.settings.hostSide === 'zombies';
  };

  // The native seed chooser is open and the guest is (also) picking plants.
  Match.prototype.guestPicksSeeds = function () {
    if (!G.inLevel() || !G.seedChooserOpen()) return false;
    return this.mode === 'coop' || (this.mode === 'versus' && this.guestSeat() === 'plants');
  };

  // Only the guest may use the chooser (Versus with the guest on plants).
  Match.prototype.guestOwnsChooser = function () {
    return this.mode === 'versus' && this.guestSeat() === 'plants' && G.inLevel() && G.seedChooserOpen();
  };

  Match.prototype.remotePointer = function (ui, norm) {
    if (this.guestPicksSeeds() && norm) G.injectPointer('move', norm.x, norm.y, 0);
    var seat = this.remoteSeat();
    if (seat) seat.pointer(ui);
    else if (this.mode !== 'survival') G.setRemotePointer(ui);
  };

  Match.prototype.remoteDown = function (ui, button, norm) {
    if (this.phase === 'over' || this.mode === 'survival') return;
    if (this.guestPicksSeeds() && norm) {
      G.injectPointer('down', norm.x, norm.y, button);
      G.injectPointer('up', norm.x, norm.y, button);
      return;
    }
    var seat = this.remoteSeat();
    if (seat) seat.down(ui, button);
  };

  Match.prototype.remoteKey = function (k) {
    if (this.phase === 'over') return;
    var seat = this.remoteSeat();
    if (seat) seat.key(k);
  };

  Match.prototype.localDown = function (ui, button) {
    if (this.localZombies() && this.zombieSeat && this.phase === 'playing') this.zombieSeat.down(ui, button);
  };
  Match.prototype.localPointer = function (ui) {
    if (this.localZombies() && this.zombieSeat) this.zombieSeat.pointer(ui);
  };
  Match.prototype.localKey = function (k) {
    if (this.localZombies() && this.zombieSeat && this.phase === 'playing') {
      this.zombieSeat.key(k);
      return true;
    }
    return false;
  };

  Match.prototype.frame = function (dt) {
    if (this.plantSeat) this.plantSeat.frame(dt);
    if (this.mode === 'coop') return;
    if (this.mode === 'survival') return this.frameSurvival(dt);
    if (!G.inLevel()) return;
    var lp = G.lp();
    if (this.phase === 'loading') {
      if (!this.sceneReady) return;
      if (!G.gameStarted()) {
        this.sawIdle = true;
        return;
      }
      if (!this.sawIdle) return;
      this.phase = 'playing';
      G.lockGameSpeed();
      this.zombieSeat.mount();
      this.app.toastBoth(null, null, 'good', {
        host: this.settings.hostSide === 'plants' ? 'versus_plants_goal' : 'versus_zombies_goal',
        guest: this.guestSeat() === 'plants' ? 'versus_plants_goal' : 'versus_zombies_goal',
      });
    }
    if (this.phase !== 'playing') return;
    var paused = G.isPaused();
    if (!paused) this.stats.time += dt;
    this.zombieSeat.frame(paused ? 0 : dt);
    if (lp.gameLost) return this.finish({ winner: 'zombies' });
    if (!paused) this.timeLeft -= dt;
    if (!this.warned30 && this.timeLeft <= 30) {
      this.warned30 = true;
      this.app.toastBoth('last_30', null, 'warn');
    }
    if (this.timeLeft <= 0) {
      this.timeLeft = 0;
      G.freezeLevel();
      this.finish({ winner: 'plants' });
    }
  };

  Match.prototype.frameSurvival = function (dt) {
    this.run.frame(dt);
    var mine = this.run.state();
    var other = this.partner;
    if (this.phase === 'loading' && (mine.phase !== 'loading' || other.phase !== 'loading')) this.phase = 'playing';
    if (this.phase !== 'playing') return;
    if (mine.phase === 'done' && !this._toldDone) {
      this._toldDone = true;
      if (other.phase !== 'done') this.app.onLocalRunDone(mine);
    }
    if (mine.phase === 'done' && other.phase === 'done') {
      this.finish({ players: [mine, other] });
    }
  };

  Match.prototype.partnerUpdate = function (state) {
    if (!this.partner || !state) return;
    this.partner = {
      phase: state.phase === 'done' ? 'done' : state.phase === 'playing' ? 'playing' : 'loading',
      result: state.result === 'won' ? 'won' : state.result === 'lost' ? 'lost' : null,
      wave: Math.max(0, Number(state.wave) || 0),
      time: Math.max(0, Number(state.time) || 0),
      planted: Math.max(0, Number(state.planted) || 0),
    };
  };

  Match.prototype.finish = function (outcome) {
    if (this.phase === 'over') return;
    this.phase = 'over';
    if (this.plantSeat) this.plantSeat.sel = null;
    if (this.zombieSeat) this.zombieSeat.sel = null;
    var result = Object.assign(
      {
        mode: this.mode,
        stage: this.settings.stage,
        hostSide: this.settings.hostSide,
        waveTotal: Number(this.settings.waves) || 0,
        stats: JSON.parse(JSON.stringify(this.stats)),
      },
      outcome,
    );
    var app = this.app;
    setTimeout(
      function () {
        app.onMatchFinished(result);
      },
      outcome.winner === 'plants' || this.mode === 'survival' ? 800 : 2600,
    );
  };

  Match.prototype.forfeit = function () {
    if (this.phase === 'over') return false;
    if (this.mode === 'versus') {
      G.freezeLevel();
      this.finish({ winner: this.settings.hostSide, forfeit: true });
      return true;
    }
    if (this.mode === 'survival' && this.partner) {
      // The guest left: their run ends where it was.
      if (this.partner.phase !== 'done') this.partner = Object.assign({}, this.partner, { phase: 'done', result: 'lost' });
    }
    return false;
  };

  // State mirrored to the guest (and used for the host's own overlay).
  Match.prototype.hud = function () {
    var out = { mode: this.mode, phase: this.phase, seat: this.guestSeat(), paused: G.isPaused(), loading: G.loadingState() };
    if (this.plantSeat) {
      var ps = this.plantSeat.state();
      out.sel = ps.sel;
      out.cell = ps.cell;
    }
    if (this.zombieSeat) {
      var zs = this.zombieSeat.state();
      out.brains = zs.brains;
      out.income = zs.income;
      out.cd = zs.cd;
      out.timeLeft = this.timeLeft;
      if (this.guestSeat() === 'zombies') {
        out.sel = zs.sel;
        out.lane = zs.lane;
      } else {
        out.hostSel = zs.sel;
        out.hostLane = zs.lane;
      }
    }
    if (this.mode !== 'survival') out.chooser = this.guestPicksSeeds();
    if (this.run) {
      out.run = this.run.state();
      out.waveTotal = Number(this.settings.waves) || 0;
    }
    return out;
  };

  Match.prototype.dispose = function () {
    G.off('local-planted', this._onLocalPlant);
    G.off('scene', this._onScene);
    if (this.run) this.run.dispose();
    G.setRemotePointer(null);
    G.hooks.blockLocalPlantInput = false;
    G.hooks.managedZombieBar = false;
    G.hooks.lockSpeed = false;
    G.hooks.remoteChooser = false;
  };

  MP.Match = Match;

  /* ======================================================= result screen */

  // Turns a host-side result into texts for the given perspective.
  MP.describeResult = function (r, role, names) {
    var out = { win: false, title: '', sub: '', headers: [names[0], names[1]], stats: [] };
    if (r.mode === 'versus') {
      var s = r.stats;
      var time = ' • ' + t('stat_time') + ' ' + MP.util.formatTime(s.time);
      var mySide = role === 'host' ? r.hostSide : r.hostSide === 'plants' ? 'zombies' : 'plants';
      out.win = r.winner === mySide;
      out.title = out.win ? t('result_victory') : t('result_defeat');
      out.sub = (r.winner === 'plants' ? t('result_plants_win') : t('result_zombies_win')) + time;
      if (r.forfeit) out.sub = t('result_forfeit') + time;
      var plantsIdx = r.hostSide === 'plants' ? 0 : 1;
      var row = [t('stat_planted'), '', ''];
      row[1 + plantsIdx] = s.planted[0] + s.planted[1];
      out.stats.push(row);
      var zrow = [t('stat_zombies_sent'), '', ''];
      zrow[2 - plantsIdx] = s.sent;
      out.stats.push(zrow);
      var brow = [t('stat_brains_spent'), '', ''];
      brow[2 - plantsIdx] = s.brains;
      out.stats.push(brow);
      return out;
    }
    // survival: [host run, guest run]
    var p = r.players || [];
    var a = p[0] || {};
    var b = p[1] || {};
    var mine = role === 'host' ? a : b;
    var both = a.result === 'won' && b.result === 'won';
    out.win = mine.result === 'won';
    out.title = both ? t('result_survived') : out.win ? t('result_victory') : t('result_overrun');
    var best = (a.wave || 0) >= (b.wave || 0) ? 0 : 1;
    out.sub = t('best_wave', { name: names[best], n: Math.max(a.wave || 0, b.wave || 0), total: r.waveTotal });
    function res(x) {
      return x.result === 'won' ? t('survived') : t('fell');
    }
    out.stats.push([t('stat_wave'), (a.wave || 0) + '/' + r.waveTotal, (b.wave || 0) + '/' + r.waveTotal]);
    out.stats.push([t('stat_result'), res(a), res(b)]);
    out.stats.push([t('stat_time'), MP.util.formatTime(a.time || 0), MP.util.formatTime(b.time || 0)]);
    out.stats.push([t('stat_planted'), a.planted || 0, b.planted || 0]);
    return out;
  };

  // Summary sent to the server's match history.
  MP.matchRecord = function (r, names) {
    if (r.mode === 'versus') {
      var hostWin = r.winner === r.hostSide;
      return {
        mode: 'versus',
        winner: r.winner,
        duration: Math.round(r.stats.time),
        waves: 0,
        players: [
          { name: names[0], side: r.hostSide, win: hostWin, score: 0 },
          { name: names[1], side: r.hostSide === 'plants' ? 'zombies' : 'plants', win: !hostWin, score: 0 },
        ],
      };
    }
    var p = r.players || [];
    return {
      mode: 'survival',
      winner: '',
      duration: Math.round(Math.max((p[0] && p[0].time) || 0, (p[1] && p[1].time) || 0)),
      waves: r.waveTotal,
      players: [0, 1].map(function (i) {
        var x = p[i] || {};
        return { name: names[i], side: 'plants', win: x.result === 'won', score: x.wave || 0 };
      }),
    };
  };
})();
