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
  MP.MAX_PLAYERS = 4;
  MP.SLOT_COLORS = ['var(--mp-p1)', 'var(--mp-p2)', 'var(--mp-p3)', 'var(--mp-p4)'];

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

  MP.DEFAULT_SETTINGS = { mode: 'coop', stage: 'modern', hostSide: 'plants', quality: 'medium', public: true, zdeck: null, coopLevel: 'map', maxPlayers: 4, sides: {} };
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
    if (out.coopLevel !== 'map' && !MP.findLevel(out.coopLevel)) out.coopLevel = 'map';
    out.maxPlayers = Math.max(2, Math.min(4, Math.round(Number(out.maxPlayers) || 4)));
    var sides = {};
    Object.keys(out.sides && typeof out.sides === 'object' ? out.sides : {}).forEach(function (k) {
      var n = Number(k);
      if (n >= 1 && n <= 3 && (out.sides[k] === 'plants' || out.sides[k] === 'zombies')) sides[n] = out.sides[k];
    });
    out.sides = sides;
    return out;
  };

  // Versus side of a player (slot 0 = host). Guests without a side yet face
  // the host.
  MP.sideOf = function (settings, slot) {
    if (!settings || settings.mode !== 'versus') return 'plants';
    if (!slot) return settings.hostSide === 'zombies' ? 'zombies' : 'plants';
    var side = settings.sides && settings.sides[slot];
    if (side === 'plants' || side === 'zombies') return side;
    return settings.hostSide === 'plants' ? 'zombies' : 'plants';
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

  function bump(map, slot, n) {
    map[slot] = (map[slot] || 0) + (n == null ? 1 : n);
  }

  /*
   * PlantSeat: one remote (guest) player on the plant side, using the game's
   * own planting/shovel/plant food code paths. The host plays plants with
   * the game's native input, so a PlantSeat is only ever remote.
   */
  function PlantSeat(slot, stats) {
    this.slot = slot;
    this.sel = null; // {kind:'card'|'shovel'|'food', i}
    this.ui = null;
    this.stats = stats;
  }

  PlantSeat.prototype.pointer = function (ui) {
    this.ui = ui;
    G.setRemotePointer(this.slot, ui);
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
      if (ok) bump(this.stats.planted, this.slot);
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
      if (!G.inLevel()) G.setRemotePointer(this.slot, null);
    }
  };

  PlantSeat.prototype.state = function () {
    var cell = this.sel && this.ui ? G.cellAt(this.ui) : null;
    return { sel: this.sel, cell: cell };
  };

  PlantSeat.prototype.dispose = function () {
    G.setRemotePointer(this.slot, null);
  };

  /*
   * ZombieTeam: the zombie side of Versus. One shared deck (the sandbox
   * zombie packet bar), brain bank and recharge timers; every zombie player
   * (host and/or guests) has their own selected packet and pointer.
   */
  function ZombieTeam(settings, stats) {
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
    this.size = 1; // players on the team: income grows a bit with it
    this.income = 8 * this.rate;
    this.elapsed = 0;
    this.players = {}; // slot -> {sel, ui}
    this.stats = stats;
    this.bar = null;
  }

  ZombieTeam.prototype.join = function (slot) {
    if (!this.players[slot]) this.players[slot] = { sel: null, ui: null };
    this.size = Object.keys(this.players).length;
  };

  ZombieTeam.prototype.leave = function (slot) {
    delete this.players[slot];
    this.size = Math.max(1, Object.keys(this.players).length);
  };

  ZombieTeam.prototype.mount = function () {
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

  ZombieTeam.prototype.canUse = function (j) {
    var d = this.deck[j];
    return !!d && this.cds[j] <= 0 && this.brains >= d.cost;
  };

  ZombieTeam.prototype.select = function (slot, j) {
    var p = this.players[slot];
    if (!p) return;
    if (p.sel && p.sel.i === j) {
      p.sel = null;
      G.play('playCardCancel');
      return;
    }
    if (!this.canUse(j)) {
      G.play('playCardChooseFailed');
      return;
    }
    p.sel = { kind: 'zcard', i: j };
    G.play('playCardChosen');
  };

  ZombieTeam.prototype.pointer = function (slot, ui) {
    if (this.players[slot]) this.players[slot].ui = ui;
  };

  ZombieTeam.prototype.down = function (slot, ui, button) {
    var p = this.players[slot];
    if (!p || !G.gameStarted() || G.levelOver() || G.isPaused()) return;
    p.ui = ui;
    if (button === 2) {
      if (p.sel) {
        p.sel = null;
        G.play('playRightButtonCancel');
      }
      return;
    }
    var j = G.hitZombieCard(ui);
    if (j >= 0) return this.select(slot, j);
    if (!p.sel) return;
    var lane = G.laneAt(ui);
    if (lane < 0) return;
    this.spawn(slot, p.sel.i, lane);
  };

  ZombieTeam.prototype.spawn = function (slot, j, lane) {
    var d = this.deck[j];
    var p = this.players[slot];
    if (!this.canUse(j)) {
      G.play('playCardChooseFailed');
      if (p) p.sel = null;
      return;
    }
    this.brains -= d.cost;
    this.cds[j] = d.cd;
    if (p) p.sel = null;
    bump(this.stats.sent, slot);
    bump(this.stats.brains, slot, d.cost);
    G.play('playPlantOnFloor');
    G.spawnZombie(lane, d.type);
  };

  ZombieTeam.prototype.key = function (slot, k) {
    var p = this.players[slot];
    if (!p) return;
    if (k === 'escape') {
      p.sel = null;
      return;
    }
    if (KEY_ZCARDS[k] != null && this.deck[KEY_ZCARDS[k]]) this.select(slot, KEY_ZCARDS[k]);
  };

  ZombieTeam.prototype.frame = function (dt) {
    if (!G.gameStarted() || G.levelOver() || G.isPaused()) return;
    var self = this;
    this.elapsed += dt;
    // A bigger team earns more, but less than proportionally.
    var teamBoost = 1 + (this.size - 1) * 0.5;
    this.income = (8 + Math.floor(this.elapsed / 60) * 1.5) * this.rate * teamBoost;
    this.brains = Math.min(3000 * teamBoost, this.brains + this.income * dt);
    for (var i = 0; i < this.cds.length; i++) if (this.cds[i] > 0) this.cds[i] = Math.max(0, this.cds[i] - dt);
    var slots = Object.keys(this.players);
    slots.forEach(function (s) {
      var p = self.players[s];
      if (p.sel && !self.canUse(p.sel.i)) p.sel = null;
    });
    var sb = this.bar;
    if (G.isValid(sb)) {
      // The bar's own highlight shows the host's pick (or the only zombie
      // player's); everyone's picks are drawn on the overlays.
      var shown = this.players[0] || (slots.length === 1 ? this.players[slots[0]] : null);
      sb.index = shown && shown.sel ? shown.sel.i : -1;
      sb.zombieCards.forEach(function (card, i) {
        if (!self.deck[i]) return;
        card.ca.affordable = self.brains >= self.deck[i].cost;
        card.ca.cooling = self.cds[i] > 0;
      });
    }
  };

  ZombieTeam.prototype.playerState = function (slot) {
    var p = this.players[slot];
    return { sel: p ? p.sel : null, lane: p && p.sel && p.ui ? G.laneAt(p.ui) : -1 };
  };

  ZombieTeam.prototype.state = function () {
    var self = this;
    return {
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

  function emptyRun() {
    return { phase: 'loading', result: null, wave: 0, time: 0, planted: 0 };
  }

  function cleanRun(state) {
    state = state || {};
    return {
      phase: state.phase === 'done' ? 'done' : state.phase === 'playing' ? 'playing' : 'loading',
      result: state.result === 'won' ? 'won' : state.result === 'lost' ? 'lost' : null,
      wave: Math.max(0, Number(state.wave) || 0),
      time: Math.max(0, Number(state.time) || 0),
      planted: Math.max(0, Number(state.planted) || 0),
    };
  }

  /*
   * Match: the host's side of a running match for up to 4 players (slot 0 is
   * the host). `roster` is [{slot, name}] of the players in the room.
   */
  function Match(app, settings, roster) {
    this.app = app;
    this.settings = MP.normalizeSettings(settings);
    this.mode = this.settings.mode;
    this.phase = 'loading'; // loading -> playing -> over
    this.stats = { planted: {}, sent: {}, brains: {}, time: 0 };
    this.players = {}; // slot -> {slot, name, seat, left}
    this.seats = {}; // slot -> PlantSeat (guests on the plant side)
    this.zombies = this.mode === 'versus' ? new ZombieTeam(this.settings, this.stats) : null;
    this.run = null; // survival: our own lawn
    this.runs = {}; // survival: slot -> run state (guests report theirs)
    this.timeLeft = (Number(this.settings.duration) || 5) * 60;
    this.warned30 = false;
    this.sceneReady = false;
    this.sawIdle = false;
    this.coopLevel = this.mode === 'coop' ? MP.findLevel(this.settings.coopLevel) : null;
    var self = this;
    (roster || [{ slot: 0, name: '' }]).forEach(function (p) {
      self.addPlayer(p.slot, p.name, true);
    });
    this._onLocalPlant = function () {
      bump(self.stats.planted, 0);
    };
    this._onScene = function (name) {
      // Co-op on the game map: the host roams freely. A picked level ends
      // (back to the room) when the game leaves it.
      if ((self.mode === 'coop' && !self.coopLevel) || self.phase === 'over') return;
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

  // What a player does in this match: 'plants' | 'zombies' | 'own' (own
  // Survival lawn) | 'spectator' (joined a Survival match already running).
  Match.prototype.seatOf = function (slot) {
    var p = this.players[slot];
    if (this.mode === 'survival') return p && p.late ? 'spectator' : 'own';
    if (this.mode === 'versus') return MP.sideOf(this.settings, slot);
    return 'plants';
  };
  Match.prototype.guestSeat = Match.prototype.seatOf;

  Match.prototype.addPlayer = function (slot, name, initial) {
    var p = this.players[slot];
    if (p && !p.left) {
      p.name = name || p.name;
      return;
    }
    p = this.players[slot] = { slot: slot, name: name || '', left: false, late: !initial && this.mode === 'survival' };
    var seat = this.seatOf(slot);
    if (slot > 0 && seat === 'plants') this.seats[slot] = new PlantSeat(slot, this.stats);
    if (this.zombies && seat === 'zombies') this.zombies.join(slot);
    if (seat === 'own' && slot > 0) this.runs[slot] = emptyRun();
  };

  Match.prototype.removePlayer = function (slot) {
    var p = this.players[slot];
    if (!p || p.left) return;
    p.left = true;
    if (this.seats[slot]) {
      this.seats[slot].dispose();
      delete this.seats[slot];
    }
    if (this.zombies) this.zombies.leave(slot);
    if (this.phase === 'over') return;
    if (this.mode === 'versus') {
      // A side with nobody left loses by forfeit.
      var self = this;
      var left = { plants: 0, zombies: 0 };
      Object.keys(this.players).forEach(function (s) {
        var q = self.players[s];
        if (!q.left) left[self.seatOf(q.slot)]++;
      });
      if (!left.plants || !left.zombies) {
        G.freezeLevel();
        this.finish({ winner: left.plants ? 'plants' : 'zombies', forfeit: true });
      }
    } else if (this.mode === 'survival' && this.runs[slot] && this.runs[slot].phase !== 'done') {
      // Their run ends where it was.
      this.runs[slot] = Object.assign({}, this.runs[slot], { phase: 'done', result: 'lost' });
    }
  };

  Match.prototype.activeSlots = function () {
    var self = this;
    return Object.keys(this.players)
      .map(Number)
      .filter(function (s) {
        return !self.players[s].left;
      });
  };

  Match.prototype.start = function () {
    var s = this.settings;
    G.hooks.blockLocalPlantInput = false;
    if (this.mode === 'survival') {
      var app = this.app;
      this.run = new SoloRun(s, function () {
        app.sendHud(true);
      });
      return this.run.start();
    }
    if (this.mode === 'versus') {
      G.hooks.blockLocalPlantInput = s.hostSide === 'zombies';
      return G.startCustomLevel(MP.buildLevel.versus(s));
    }
    this.phase = 'playing';
    if (this.coopLevel) return G.goToLevel(this.coopLevel.level.ids);
    return G.goToWorldMap();
  };

  Match.prototype.restartLevel = function () {
    this.phase = 'loading';
    this.sawIdle = false;
    this.warned30 = false;
    this.timeLeft = (Number(this.settings.duration) || 5) * 60;
    this.stats.planted = {};
    this.stats.sent = {};
    this.stats.brains = {};
    this.stats.time = 0;
    var self = this;
    Object.keys(this.seats).forEach(function (s) {
      self.seats[s].sel = null;
    });
    if (this.zombies) {
      var team = new ZombieTeam(this.settings, this.stats);
      Object.keys(this.zombies.players).forEach(function (s) {
        team.join(Number(s));
      });
      this.zombies = team;
    }
  };

  Match.prototype.localZombies = function () {
    return this.mode === 'versus' && this.settings.hostSide === 'zombies';
  };

  // The native seed chooser is open and this guest may use it.
  Match.prototype.guestPicksSeeds = function (slot) {
    if (this.mode === 'survival' || !G.inLevel() || !G.seedChooserOpen()) return false;
    return this.seatOf(slot) === 'plants' && !!this.seats[slot];
  };

  // Only guests use the chooser (Versus with the host on the zombie side).
  Match.prototype.guestOwnsChooser = function () {
    if (this.mode !== 'versus' || this.settings.hostSide !== 'zombies' || !G.inLevel() || !G.seedChooserOpen()) return false;
    return Object.keys(this.seats).length > 0;
  };

  Match.prototype.remotePointer = function (slot, ui, norm) {
    if (this.guestPicksSeeds(slot) && norm) G.injectPointer('move', norm.x, norm.y, 0);
    var seat = this.seatOf(slot);
    if (this.seats[slot]) this.seats[slot].pointer(ui);
    else if (seat === 'zombies' && this.zombies) this.zombies.pointer(slot, ui);
  };

  Match.prototype.remoteDown = function (slot, ui, button, norm) {
    if (this.phase === 'over' || this.mode === 'survival') return;
    if (this.guestPicksSeeds(slot) && norm) {
      G.injectPointer('down', norm.x, norm.y, button);
      G.injectPointer('up', norm.x, norm.y, button);
      return;
    }
    if (this.seats[slot]) this.seats[slot].down(ui, button);
    else if (this.zombies && this.seatOf(slot) === 'zombies' && this.phase === 'playing') this.zombies.down(slot, ui, button);
  };

  Match.prototype.remoteKey = function (slot, k) {
    if (this.phase === 'over') return;
    if (this.seats[slot]) this.seats[slot].key(k);
    else if (this.zombies && this.seatOf(slot) === 'zombies' && this.phase === 'playing') this.zombies.key(slot, k);
  };

  Match.prototype.localDown = function (ui, button) {
    if (this.localZombies() && this.phase === 'playing') this.zombies.down(0, ui, button);
  };
  Match.prototype.localPointer = function (ui) {
    if (this.localZombies()) this.zombies.pointer(0, ui);
  };
  Match.prototype.localKey = function (k) {
    if (this.localZombies() && this.phase === 'playing') {
      this.zombies.key(0, k);
      return true;
    }
    return false;
  };

  Match.prototype.frame = function (dt) {
    var self = this;
    Object.keys(this.seats).forEach(function (s) {
      self.seats[s].frame(dt);
    });
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
      this.zombies.mount();
      this.app.toastAll(function (slot) {
        return { key: self.seatOf(slot) === 'zombies' ? 'versus_zombies_goal' : 'versus_plants_goal' };
      }, 'good');
    }
    if (this.phase !== 'playing') return;
    var paused = G.isPaused();
    if (!paused) this.stats.time += dt;
    this.zombies.frame(paused ? 0 : dt);
    if (lp.gameLost) return this.finish({ winner: 'zombies' });
    if (!paused) this.timeLeft -= dt;
    if (!this.warned30 && this.timeLeft <= 30) {
      this.warned30 = true;
      this.app.toastAll(function () {
        return { key: 'last_30' };
      }, 'warn');
    }
    if (this.timeLeft <= 0) {
      this.timeLeft = 0;
      G.freezeLevel();
      this.finish({ winner: 'plants' });
    }
  };

  Match.prototype.runStates = function () {
    var out = {};
    if (this.run) out[0] = this.run.state();
    var self = this;
    Object.keys(this.runs).forEach(function (s) {
      out[s] = self.runs[s];
    });
    return out;
  };

  Match.prototype.frameSurvival = function (dt) {
    this.run.frame(dt);
    var runs = this.runStates();
    var slots = Object.keys(runs);
    var mine = runs[0];
    if (
      this.phase === 'loading' &&
      slots.some(function (s) {
        return runs[s].phase !== 'loading';
      })
    )
      this.phase = 'playing';
    if (this.phase !== 'playing') return;
    var allDone = slots.every(function (s) {
      return runs[s].phase === 'done';
    });
    if (mine.phase === 'done' && !this._toldDone) {
      this._toldDone = true;
      if (!allDone) this.app.onLocalRunDone(mine);
    }
    if (allDone) this.finish({});
  };

  Match.prototype.partnerUpdate = function (slot, state) {
    if (!this.runs[slot] || !state) return;
    this.runs[slot] = cleanRun(state);
  };

  Match.prototype.finish = function (outcome) {
    if (this.phase === 'over') return;
    this.phase = 'over';
    var self = this;
    Object.keys(this.seats).forEach(function (s) {
      self.seats[s].sel = null;
    });
    if (this.zombies) {
      Object.keys(this.zombies.players).forEach(function (s) {
        self.zombies.players[s].sel = null;
      });
    }
    var runs = this.mode === 'survival' ? this.runStates() : null;
    var players = Object.keys(this.players)
      .map(Number)
      .sort()
      .filter(function (s) {
        return self.seatOf(s) !== 'spectator';
      })
      .map(function (s) {
        var p = self.players[s];
        var out = { slot: s, name: p.name, left: p.left, side: self.mode === 'versus' ? self.seatOf(s) : 'plants' };
        if (runs) out.run = runs[s] || emptyRun();
        return out;
      });
    var result = Object.assign(
      {
        mode: this.mode,
        stage: this.settings.stage,
        hostSide: this.settings.hostSide,
        waveTotal: Number(this.settings.waves) || 0,
        stats: JSON.parse(JSON.stringify(this.stats)),
        players: players,
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

  // HUD state sent to one guest (and parts of it reused by the host).
  Match.prototype.hud = function (slot) {
    var seat = this.seatOf(slot);
    var out = { mode: this.mode, phase: this.phase, seat: seat, paused: G.isPaused(), loading: G.loadingState() };
    if (this.seats[slot]) {
      var ps = this.seats[slot].state();
      out.sel = ps.sel;
      out.cell = ps.cell;
    }
    if (this.zombies) {
      var zs = this.zombies.state();
      out.brains = zs.brains;
      out.income = zs.income;
      out.cd = zs.cd;
      out.timeLeft = this.timeLeft;
      if (seat === 'zombies') {
        var zp = this.zombies.playerState(slot);
        out.sel = zp.sel;
        out.lane = zp.lane;
      }
    }
    if (this.mode !== 'survival') out.chooser = this.guestPicksSeeds(slot);
    else {
      out.runs = this.runStates();
      out.waveTotal = Number(this.settings.waves) || 0;
    }
    return out;
  };

  // Everyone's picks, for the host's own overlay.
  Match.prototype.overlay = function () {
    var self = this;
    var out = { mode: this.mode, phase: this.phase, picks: [] };
    Object.keys(this.seats).forEach(function (s) {
      var st = self.seats[s].state();
      if (st.sel) out.picks.push({ slot: Number(s), sel: st.sel, cell: st.cell });
    });
    if (this.zombies) {
      var zs = this.zombies.state();
      out.brains = zs.brains;
      out.income = zs.income;
      out.cd = zs.cd;
      out.timeLeft = this.timeLeft;
      Object.keys(this.zombies.players).forEach(function (s) {
        var zp = self.zombies.playerState(Number(s));
        if (zp.sel) out.picks.push({ slot: Number(s), sel: zp.sel, lane: zp.lane });
      });
    }
    return out;
  };

  Match.prototype.dispose = function () {
    var self = this;
    G.off('local-planted', this._onLocalPlant);
    G.off('scene', this._onScene);
    if (this.run) this.run.dispose();
    Object.keys(this.seats).forEach(function (s) {
      self.seats[s].dispose();
    });
    G.setRemotePointer(null);
    G.hooks.blockLocalPlantInput = false;
    G.hooks.managedZombieBar = false;
    G.hooks.lockSpeed = false;
    G.hooks.remoteChooser = false;
  };

  MP.Match = Match;

  /* ======================================================= result screen */

  function runText(x) {
    return x && x.result === 'won' ? t('survived') : t('fell');
  }

  // Turns a host-side result into texts for the player in `mySlot`.
  MP.describeResult = function (r, mySlot) {
    var players = r.players || [];
    var me = players.find(function (p) {
      return p.slot === mySlot;
    });
    var out = {
      win: false,
      title: '',
      sub: '',
      headers: players.map(function (p) {
        return p.name;
      }),
      slots: players.map(function (p) {
        return p.slot;
      }),
      stats: [],
    };
    function row(label, fn) {
      out.stats.push([label].concat(players.map(fn)));
    }
    if (r.mode === 'versus') {
      var s = r.stats || {};
      var time = ' • ' + t('stat_time') + ' ' + MP.util.formatTime(s.time || 0);
      out.win = !!me && r.winner === me.side;
      out.title = !me ? (r.winner === 'plants' ? t('result_plants_win') : t('result_zombies_win')) : out.win ? t('result_victory') : t('result_defeat');
      out.sub = (r.winner === 'plants' ? t('result_plants_win') : t('result_zombies_win')) + time;
      if (r.forfeit) out.sub = t('result_forfeit') + time;
      row(t('stat_side'), function (p) {
        return p.side === 'zombies' ? t('side_zombies') : t('side_plants');
      });
      row(t('stat_planted'), function (p) {
        return p.side === 'plants' ? (s.planted && s.planted[p.slot]) || 0 : '';
      });
      row(t('stat_zombies_sent'), function (p) {
        return p.side === 'zombies' ? (s.sent && s.sent[p.slot]) || 0 : '';
      });
      row(t('stat_brains_spent'), function (p) {
        return p.side === 'zombies' ? Math.round((s.brains && s.brains[p.slot]) || 0) : '';
      });
      return out;
    }
    // survival
    var total = r.waveTotal;
    var mine = me && me.run;
    var allWon =
      players.length > 0 &&
      players.every(function (p) {
        return p.run && p.run.result === 'won';
      });
    var best = players.reduce(function (a, p) {
      return !a || ((p.run && p.run.wave) || 0) > ((a.run && a.run.wave) || 0) ? p : a;
    }, null);
    out.win = !!mine && mine.result === 'won';
    out.title = allWon ? t('result_survived') : out.win ? t('result_victory') : mine ? t('result_overrun') : t('result_survival_over');
    if (best) out.sub = t('best_wave', { name: best.name, n: (best.run && best.run.wave) || 0, total: total });
    row(t('stat_wave'), function (p) {
      return ((p.run && p.run.wave) || 0) + '/' + total;
    });
    row(t('stat_result'), function (p) {
      return runText(p.run);
    });
    row(t('stat_time'), function (p) {
      return MP.util.formatTime((p.run && p.run.time) || 0);
    });
    row(t('stat_planted'), function (p) {
      return (p.run && p.run.planted) || 0;
    });
    return out;
  };

  // Summary sent to the server's match history.
  MP.matchRecord = function (r) {
    var players = r.players || [];
    if (r.mode === 'versus') {
      return {
        mode: 'versus',
        winner: r.winner,
        duration: Math.round((r.stats && r.stats.time) || 0),
        waves: 0,
        players: players.map(function (p) {
          return { slot: p.slot, name: p.name, side: p.side, win: p.side === r.winner, score: 0 };
        }),
      };
    }
    return {
      mode: 'survival',
      winner: '',
      duration: Math.round(
        players.reduce(function (m, p) {
          return Math.max(m, (p.run && p.run.time) || 0);
        }, 0),
      ),
      waves: r.waveTotal,
      players: players.map(function (p) {
        return { slot: p.slot, name: p.name, side: 'plants', win: !!p.run && p.run.result === 'won', score: (p.run && p.run.wave) || 0 };
      }),
    };
  };
})();
