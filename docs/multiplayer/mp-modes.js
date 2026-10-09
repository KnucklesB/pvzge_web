/*
 * PvZ2 Gardendless - Multiplayer game modes.
 *
 *  coop     - the host plays any level of the game (campaign, endless zones,
 *             minigames...); the guest shares the seed bank, sun and plant food.
 *  versus   - one player defends with plants, the other spends brains on
 *             zombie packets. Plants win if they hold until the timer runs out,
 *             zombies win by reaching the house.
 *  survival - both players defend together against generated, ever-growing
 *             waves on the chosen arena.
 *
 * All match logic runs on the host. `Match` exposes HUD/overlay state that is
 * mirrored to the guest by mp-app.js.
 */
(function () {
  'use strict';

  var MP = window.PvZMP;
  var G = MP.game;
  var t = MP.t;

  MP.MODE_LIST = ['coop', 'versus', 'survival'];
  MP.VERSUS_DURATIONS = [3, 5, 7];
  MP.SURVIVAL_WAVES = [15, 30, 60];
  MP.DEFAULT_SETTINGS = {
    mode: 'coop',
    stage: 'modern',
    hostSide: 'plants',
    duration: 5,
    waves: 15,
    deck: 'kit',
    quality: 'medium',
  };

  // cost = brains, cd = recharge seconds
  function z(type, cost, cd) {
    return { type: type, cost: cost, cd: cd };
  }

  MP.STAGES = {
    modern: {
      label: 'stage_modern',
      img: 'frontyard',
      stage: 'ModernStage',
      mowers: 'ModernMowers',
      deck: [z('tutorial', 50, 4), z('tutorial_armor1', 75, 6), z('tutorial_armor2', 125, 12), z('modern_newspaper', 100, 9), z('modern_allstar', 175, 18), z('tutorial_gargantuar', 300, 40)],
      pool: ['tutorial', 'tutorial_armor1', 'tutorial_armor2', 'modern_newspaper', 'modern_balloon', 'modern_allstar', 'tutorial_imp', 'tutorial_gargantuar'],
    },
    egypt: {
      label: 'stage_egypt',
      img: 'egypt',
      stage: 'EgyptStage',
      mowers: 'EgyptMowers',
      deck: [z('mummy', 50, 4), z('mummy_armor1', 75, 6), z('mummy_armor2', 125, 12), z('explorer', 100, 9), z('pharaoh', 150, 15), z('egypt_gargantuar', 300, 40)],
      pool: ['mummy', 'mummy_armor1', 'mummy_armor2', 'explorer', 'ra', 'tomb_raiser', 'pharaoh', 'egypt_imp', 'egypt_gargantuar'],
    },
    west: {
      label: 'stage_west',
      img: 'cowboy',
      stage: 'WestStage',
      mowers: 'WestMowers',
      deck: [z('cowboy', 50, 4), z('cowboy_armor1', 75, 6), z('cowboy_armor2', 125, 12), z('prospector', 100, 10), z('poncho', 125, 12), z('cowboy_gargantuar', 300, 40)],
      pool: ['cowboy', 'cowboy_armor1', 'cowboy_armor2', 'prospector', 'poncho', 'piano', 'chicken_farmer', 'cowboy_gargantuar'],
    },
    future: {
      label: 'stage_future',
      img: 'future',
      stage: 'FutureStage',
      mowers: 'FutureMowers',
      deck: [z('future', 50, 4), z('future_armor1', 75, 6), z('future_armor2', 125, 12), z('future_jetpack', 100, 9), z('mech_cone', 175, 18), z('future_gargantuar', 325, 45)],
      pool: ['future', 'future_armor1', 'future_armor2', 'future_jetpack', 'future_protector', 'mech_cone', 'football_mech', 'future_imp', 'future_gargantuar'],
    },
    dark: {
      label: 'stage_dark',
      img: 'dark',
      stage: 'DarkStage',
      mowers: 'DarkMowers',
      deck: [z('dark', 50, 4), z('dark_armor1', 75, 6), z('dark_armor2', 125, 12), z('dark_juggler', 150, 14), z('dark_wizard', 200, 22), z('dark_gargantuar', 300, 40)],
      pool: ['dark', 'dark_armor1', 'dark_armor2', 'dark_juggler', 'dark_wizard', 'dark_king', 'dark_imp', 'dark_gargantuar'],
    },
  };

  var PLANT_KIT = ['sunflower', 'peashooter', 'wallnut', 'potatomine', 'cabbagepult', 'snowpea', 'repeater', 'cherry_bomb'];

  function rtid(name, where) {
    return 'RTID(' + name + '@' + where + ')';
  }

  function seedBank(deck) {
    if (deck === 'collection') return { objclass: 'SeedBankProperties', aliases: ['SeedBank'], objdata: { SelectionMethod: 'chooser' } };
    return {
      objclass: 'SeedBankProperties',
      aliases: ['SeedBank'],
      objdata: {
        SuppressObjectiveTip: true,
        SelectionMethod: 'preset',
        PresetPlantList: PLANT_KIT.map(function (p) {
          return { PlantType: p, Level: -1 };
        }),
      },
    };
  }

  MP.buildLevel = {
    versus: function (s) {
      var st = MP.STAGES[s.stage] || MP.STAGES.modern;
      var modules = [
        rtid('MPIntro', 'CurrentLevel'),
        rtid('DefaultSunDropper', 'LevelModules'),
        rtid(st.mowers, 'LevelModules'),
        rtid('SeedBank', 'CurrentLevel'),
        rtid('DefaultZombieWinCondition', 'LevelModules'),
      ];
      // The plant player isn't the host's mouse: sun must not depend on hovering.
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
            StartingSun: 150,
            SuppressAwardScreen: true,
            Modules: modules,
          },
        },
        {
          objclass: 'LevelIntroProperties',
          aliases: ['MPIntro'],
          objdata: { PanStartOffset: -40, PanStreetOffset: 440, PanEndOffset: 0, PanRightDuration: 0.5, PanLeftDuration: 1, PanMoveRightTime: 1.2, PanMoveLeftTime: 1.2, AdditionalStartingSun: 0, ZombiePreviewOff: true },
        },
        seedBank('kit'),
      ];
    },

    survival: function (s) {
      var st = MP.STAGES[s.stage] || MP.STAGES.modern;
      var waves = Number(s.waves) || 15;
      var inc = waves <= 15 ? 90 : waves <= 30 ? 70 : 55;
      var pool = st.pool.filter(G.zombieExists).map(function (zt) {
        return rtid(zt, 'ZombieTypes');
      });
      var dyn = { PointIncrementPerWave: inc, StartingPoints: 150, StartingWave: 0, ZombiePool: pool };
      var deck = s.deck === 'collection' ? 'collection' : 'kit';
      return [
        {
          objclass: 'LevelDefinition',
          objdata: {
            Name: t('level_name_survival'),
            Description: t('mode_survival_desc'),
            LevelNumber: 1,
            Loot: rtid('NoLoot', 'LevelModules'),
            StageModule: rtid(st.stage, 'LevelModules'),
            StartingSun: 150,
            SuppressAwardScreen: true,
            Modules: [
              rtid('StandardIntro', 'LevelModules'),
              rtid('DefaultSunDropper', 'LevelModules'),
              rtid('ZombiesDeadWinCon', 'LevelModules'),
              rtid(st.mowers, 'LevelModules'),
              rtid('SeedBank', 'CurrentLevel'),
              rtid('DefaultZombieWinCondition', 'LevelModules'),
              rtid('NewWaves', 'CurrentLevel'),
            ],
          },
        },
        seedBank(deck),
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
      ];
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
  function ZombieSeat(stage, stats) {
    this.deck = stage.deck.filter(function (d) {
      return G.zombieExists(d.type);
    });
    this.cds = this.deck.map(function () {
      return 0;
    });
    this.brains = 75;
    this.income = 4; // brains per second, grows over time
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
        return Math.min(d.cd, 6);
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
    this.income = 4 + Math.floor(this.elapsed / 60);
    this.brains = Math.min(2000, this.brains + this.income * dt);
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
      cd: this.cds.map(function (c, i) {
        return self.deck[i] ? c / self.deck[i].cd : 0;
      }),
    };
  };

  /* ================================================================ match */

  function Match(app, settings) {
    this.app = app;
    this.settings = Object.assign({}, settings);
    this.mode = settings.mode;
    this.phase = 'loading'; // loading -> playing -> over
    this.stats = { planted: [0, 0], sent: 0, brains: 0, time: 0, wave: 0 };
    this.plantSeat = null;
    this.zombieSeat = null;
    this.timeLeft = (Number(settings.duration) || 5) * 60;
    this.warned30 = false;
    this.levelSeen = false;
    // Level start is detected on the freshly launched scene only: static game
    // flags (e.g. LevelPlay.gameStarted) still describe the previous level
    // until the new one initialises.
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
        if (self.phase === 'playing') self.restartLevel();
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
    if (this.mode !== 'versus') return 'plants';
    return this.settings.hostSide === 'plants' ? 'zombies' : 'plants';
  };

  Match.prototype.start = function () {
    var s = this.settings;
    this.plantSeat = this.guestSeat() === 'plants' ? new PlantSeat(this.stats) : null;
    if (this.mode === 'versus') {
      this.zombieSeat = new ZombieSeat(MP.STAGES[s.stage] || MP.STAGES.modern, this.stats);
      G.hooks.blockLocalPlantInput = s.hostSide === 'zombies';
      return G.startCustomLevel(MP.buildLevel.versus(s));
    }
    G.hooks.blockLocalPlantInput = false;
    if (this.mode === 'survival') return G.startCustomLevel(MP.buildLevel.survival(s));
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
    if (this.zombieSeat) this.zombieSeat = new ZombieSeat(MP.STAGES[this.settings.stage] || MP.STAGES.modern, this.stats);
  };

  Match.prototype.remoteSeat = function () {
    return this.guestSeat() === 'plants' ? this.plantSeat : this.zombieSeat;
  };

  Match.prototype.localZombies = function () {
    return this.mode === 'versus' && this.settings.hostSide === 'zombies';
  };

  Match.prototype.remotePointer = function (ui) {
    var seat = this.remoteSeat();
    if (seat) seat.pointer(ui);
    else G.setRemotePointer(ui);
  };

  Match.prototype.remoteDown = function (ui, button) {
    if (this.phase === 'over') return;
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
    if (this.mode === 'coop') return this.frameCoop(dt);
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
      this.levelSeen = true;
      if (this.zombieSeat) {
        G.lockGameSpeed();
        this.zombieSeat.mount();
        this.app.toastBoth(this.settings.hostSide === 'plants' ? 'versus_plants_goal' : 'versus_zombies_goal', null, 'good', {
          host: this.settings.hostSide === 'plants' ? 'versus_plants_goal' : 'versus_zombies_goal',
          guest: this.guestSeat() === 'plants' ? 'versus_plants_goal' : 'versus_zombies_goal',
        });
      }
    }
    if (this.phase !== 'playing') return;
    var paused = G.isPaused();
    if (!paused) this.stats.time += dt;
    if (this.mode === 'survival') {
      this.stats.wave = Math.max(this.stats.wave, (lp.currentWave || 0) + 0);
      if (lp.gameLost) return this.finish({ survived: false });
      if (lp.gameWon) return this.finish({ survived: true });
      return;
    }
    // versus
    if (this.zombieSeat) this.zombieSeat.frame(paused ? 0 : dt);
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

  Match.prototype.frameCoop = function () {
    if (!G.inLevel()) {
      this.levelSeen = false;
      return;
    }
    if (!this.levelSeen && G.gameStarted()) this.levelSeen = true;
  };

  Match.prototype.finish = function (outcome) {
    if (this.phase === 'over') return;
    this.phase = 'over';
    if (this.plantSeat) this.plantSeat.sel = null;
    if (this.zombieSeat) this.zombieSeat.sel = null;
    var result = Object.assign(
      {
        mode: this.mode,
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
      outcome.winner === 'plants' ? 600 : 2600,
    );
  };

  Match.prototype.forfeit = function () {
    if (this.mode !== 'versus' || this.phase === 'over') return false;
    G.freezeLevel();
    this.finish({ winner: this.settings.hostSide, forfeit: true });
    return true;
  };

  // State mirrored to the guest (and used for the host's own overlay).
  Match.prototype.hud = function () {
    var out = { mode: this.mode, phase: this.phase, seat: this.guestSeat(), paused: G.isPaused() };
    if (this.plantSeat) {
      var ps = this.plantSeat.state();
      out.sel = ps.sel;
      out.cell = ps.cell;
    }
    if (this.zombieSeat) {
      var zs = this.zombieSeat.state();
      out.brains = zs.brains;
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
    if (this.mode === 'survival') {
      out.wave = this.stats.wave;
      out.waveTotal = Number(this.settings.waves) || 0;
    }
    return out;
  };

  Match.prototype.dispose = function () {
    G.off('local-planted', this._onLocalPlant);
    G.off('scene', this._onScene);
    G.setRemotePointer(null);
    G.hooks.blockLocalPlantInput = false;
    G.hooks.managedZombieBar = false;
    G.hooks.lockSpeed = false;
  };

  MP.Match = Match;

  /* ======================================================= result screen */

  // Turns a host-side result into texts for the given perspective.
  MP.describeResult = function (r, role, names) {
    var s = r.stats;
    var out = { win: false, title: '', sub: '', headers: [names[0], names[1]], stats: [] };
    var time = ' • ' + t('stat_time') + ' ' + MP.util.formatTime(s.time);
    if (r.mode === 'versus') {
      var mySide = role === 'host' ? r.hostSide : r.hostSide === 'plants' ? 'zombies' : 'plants';
      out.win = r.winner === mySide;
      out.title = out.win ? t('result_victory') : t('result_defeat');
      out.sub = (r.winner === 'plants' ? t('result_plants_win') : t('result_zombies_win')) + time;
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
    } else {
      out.win = !!r.survived;
      out.title = out.win ? t('result_survived') : t('result_overrun');
      out.sub = t('wave_of', { n: Math.max(0, s.wave), total: r.waveTotal }) + time;
      out.stats.push([t('stat_wave'), s.wave + '/' + r.waveTotal, '']);
      out.stats.push([t('stat_planted'), s.planted[0], s.planted[1]]);
    }
    return out;
  };
})();
