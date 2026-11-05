/*
 * PvZ2 Gardendless - Inverted mode: the zombies defend, the plants walk.
 *
 * A generated level without seed bank, sun or zombie waves:
 *   - waves of plants appear on the left columns and advance one square to
 *     the right every few seconds (Plant.leapTo, the hop used by the Beghouled
 *     minigame), shooting at the zombies as usual;
 *   - the player has a brain bank and the game's zombie packet bar
 *     (G.mountZombieBar, as in Versus): pick a zombie, click a square of the
 *     right half of the lawn and it walks in from the right edge and holds
 *     that square, eating the plants that come close;
 *   - a plant that walks past the last column wins for the plants; holding
 *     out through every wave wins for the zombies.
 * Score (waves held, plants defeated, win bonus) goes to the
 * "challenge:inverted" leaderboard.
 *
 * Mirrored variant (opts.mirror, "challenge:mirror" board): the plants come
 * in from the right and hop to the left, like zombies usually do, and the
 * zombies hold the left half, turned to face right (Zombie.reversed, the
 * game's own "walking backwards" zombies, teleported to the left edge).
 * The game has no turned-around plants, so this file adds them
 * (reversePlant): the sprite is mirrored, the shooter's detection rectangle
 * (setDetecter) points to the left edge and the direction vector given to
 * _shoot is flipped. It is applied to the plants verified to work that way
 * (REVERSIBLE); lobbers and a few others hit zombies on either side by
 * themselves. Walls, traps, close-combat plants and the plants that shoot
 * both ways (split pea, starfruit) complete the mirrored waves.
 */
(function () {
  'use strict';

  var MP = window.PvZMP;
  var X = window.PvZX;
  var G = MP.game;
  var t = X.t;
  var el = MP.util.el;

  var inv = (X.inverted = {});

  var DIFF = {
    easy: { waves: 8, every: 24, step: 9, count: function (w) { return 2 + Math.floor(w / 2); }, brains: 250, income: 9 },
    normal: { waves: 12, every: 22, step: 7, count: function (w) { return 2 + Math.floor(w * 0.7); }, brains: 200, income: 6.5 },
    hard: { waves: 16, every: 20, step: 5.5, count: function (w) { return 3 + w; }, brains: 175, income: 5.5 },
  };

  // Plants that join the attack in each arena: [codename, role, first wave
  // (index)]. Roles: shoot (straight shots), lob (over obstacles), wall,
  // melee (hits what is right in front), trap (hurts zombies that eat or step
  // on it). Every arena mixes its own world's plants with a few classics;
  // plants missing from the running game version are skipped.
  var BASE = [['peashooter', 'shoot', 0], ['cabbagepult', 'lob', 0], ['wallnut', 'wall', 1]];
  var ARENA_PLANTS = {
    modern: [['snowpea', 'shoot', 1], ['repeater', 'shoot', 2], ['kernelpult', 'lob', 2], ['bonkchoy', 'melee', 3], ['chomper', 'melee', 4], ['threepeater', 'shoot', 5], ['tallnut', 'wall', 5], ['melonpult', 'lob', 6], ['gatling', 'shoot', 9]],
    egypt: [['bloomerang', 'shoot', 0], ['bonkchoy', 'melee', 1], ['repeater', 'shoot', 2], ['kernelpult', 'lob', 2], ['iceburg', 'trap', 3], ['snapdragon', 'melee', 4], ['threepeater', 'shoot', 6], ['tallnut', 'wall', 6], ['melonpult', 'lob', 8]],
    west: [['peapod', 'shoot', 0], ['splitpea', 'shoot', 1], ['lightningreed', 'shoot', 2], ['chilibean', 'trap', 2], ['cactus', 'shoot', 3], ['melonpult', 'lob', 4], ['tallnut', 'wall', 4], ['wintermelon', 'lob', 8]],
    future: [['laser_bean', 'shoot', 0], ['starfruit', 'shoot', 1], ['holonut', 'wall', 2], ['homingthistle', 'shoot', 3], ['electricpeashooter', 'shoot', 4], ['citron', 'shoot', 5], ['coconutcannon', 'shoot', 7], ['infinut', 'wall', 6], ['megagatling', 'shoot', 10]],
    dark: [['puffshroom', 'shoot', 0], ['scaredyshroom', 'shoot', 0], ['fumeshroom', 'shoot', 1], ['magnetshroom', 'trap', 2], ['sporeshroom', 'shoot', 3], ['hypnoshroom', 'trap', 4], ['nightshade', 'shoot', 4], ['dusklobber', 'lob', 5], ['gloomshroom', 'melee', 6], ['grimrose', 'melee', 8]],
  };
  // Mirrored variant. Roles as above plus back (shoots both ways already).
  var MIRROR_BASE = [['peashooter', 'shoot', 0], ['cabbagepult', 'lob', 0], ['wallnut', 'wall', 1], ['splitpea', 'back', 1], ['chilibean', 'trap', 1], ['bonkchoy', 'melee', 2], ['potatomine', 'trap', 2], ['starfruit', 'back', 3], ['tallnut', 'wall', 5]];
  var MIRROR_PLANTS = {
    modern: [['snowpea', 'shoot', 1], ['repeater', 'shoot', 2], ['kernelpult', 'lob', 2], ['garlic', 'trap', 3], ['squash', 'melee', 4], ['melonpult', 'lob', 6], ['gatling', 'shoot', 9]],
    egypt: [['repeater', 'shoot', 1], ['iceburg', 'trap', 1], ['kernelpult', 'lob', 2], ['garlic', 'trap', 3], ['firepeashooter', 'shoot', 4], ['melonpult', 'lob', 7]],
    west: [['kernelpult', 'lob', 1], ['lightningreed', 'shoot', 2], ['explodeonut', 'wall', 5], ['melonpult', 'lob', 4], ['wintermelon', 'lob', 8], ['primalpeashooter', 'shoot', 3]],
    future: [['electricpeashooter', 'shoot', 1], ['holonut', 'wall', 1], ['homingthistle', 'shoot', 3], ['empea', 'trap', 3], ['magnetshroom', 'melee', 2], ['megagatling', 'shoot', 10]],
    dark: [['magnetshroom', 'melee', 0], ['nightshade', 'shoot', 1], ['gloomshroom', 'melee', 2], ['hypnoshroom', 'trap', 3], ['garlic', 'trap', 4], ['firepeashooter', 'shoot', 5]],
  };
  // Shooters that work turned around by reversePlant (checked in game).
  var REVERSIBLE = { peashooter: 1, repeater: 1, snowpea: 1, gatling: 1, firepeashooter: 1, electricpeashooter: 1, primalpeashooter: 1, megagatling: 1, homingthistle: 1 };
  // Already shoot both ways: keep their sprite as it is.
  var KEEP_FACING = { splitpea: 1, starfruit: 1, pinkstarfruit: 1 };
  var SLOW = { wallnut: 1.4, tallnut: 1.7, holonut: 1.4, infinut: 1.4, pumpkin: 1.4 }; // walls walk slower

  // Wave formations, picked at random (weights), named on screen.
  var FORMATIONS = [
    { id: 'advance', weight: 4, from: 0 },
    { id: 'wall', weight: 2, from: 2 },
    { id: 'rush', weight: 2, from: 1 },
    { id: 'artillery', weight: 2, from: 2 },
    { id: 'focus', weight: 2, from: 3 },
    { id: 'elite', weight: 1, from: 4 },
  ];

  inv.options = X.store.get('inverted', { stage: 'modern', difficulty: 'normal' });
  inv.mirrorOptions = X.store.get('mirror', { stage: 'modern', difficulty: 'normal', mirror: true });

  var run = null; // the match being played
  var pendingRestart = null; // "Play again": start once back on the menu

  /* ------------------------------------------------------------ level */

  function buildLevel(opts) {
    var s = MP.normalizeSettings({ mode: 'survival', stage: opts.stage, waves: 15, difficulty: 'normal', plantPool: 'all', seedSlots: 6, startSun: 50, sunRate: 'normal', plantCooldown: 1, mowers: 'off' });
    var objects = MP.buildLevel.survival(s);
    var d = objects.find(function (o) {
      return o.objclass === 'LevelDefinition';
    }).objdata;
    d.Name = t('mode_inverted');
    d.Description = t('mode_inverted_desc');
    // Intro only: no seed bank, sun, mowers, zombie waves or win conditions.
    d.Modules = d.Modules.filter(function (m) {
      return /MPIntro@/.test(m);
    });
    objects = objects.filter(function (o) {
      return !/^(SeedBankProperties|WaveManagerModuleProperties|WaveManagerProperties)$/.test(o.objclass);
    });
    return objects;
  }

  inv.start = function (opts) {
    var mirror = !!(opts && opts.mirror);
    opts = Object.assign({}, mirror ? inv.mirrorOptions : inv.options, opts || {});
    if (mirror) {
      inv.mirrorOptions = opts;
      X.store.set('mirror', opts);
    } else {
      inv.options = opts;
      X.store.set('inverted', opts);
    }
    if (X.online()) return false;
    var deck = (MP.STAGES[opts.stage] || MP.STAGES.modern).zombies.filter(function (z) {
      return !/_flag$/.test(z);
    });
    run = {
      mirror: !!opts.mirror,
      opts: opts,
      diff: DIFF[opts.difficulty] || DIFF.normal,
      deckTypes: deck.slice(0, 6),
      started: false,
      over: false,
    };
    X.modes.current = { kind: opts.mirror ? 'mirror' : 'inverted', id: opts.mirror ? 'mirror' : 'inverted', options: opts, mutators: [] };
    if (X.ui) X.ui.close();
    G.startCustomLevel(buildLevel(opts));
    return true;
  };

  inv.active = function () {
    return !!(run && X.modes.current && (X.modes.current.kind === 'inverted' || X.modes.current.kind === 'mirror') && G.inLevel());
  };

  // Direction helpers: plants walk +1 (to the right) or -1 (mirrored).
  function dir() {
    return run && run.mirror ? -1 : 1;
  }
  // Spawn column counted from the plants' side.
  function fromSide(c) {
    return run && run.mirror ? G.Sq().ColumnCount - 1 - c : c;
  }
  // Squares where the player may place zombies.
  function placeable(c) {
    return run && run.mirror ? c <= 4 : c >= 4;
  }

  /* --------------------------------------------------------- match */

  function setup() {
    var r = run;
    r.started = true;
    r.time = 0;
    r.wave = 0;
    r.nextWave = 8;
    r.spawned = 0;
    r.killed = 0;
    r.brains = r.diff.brains;
    r.sel = -1;
    r.hover = null;
    r.deck = r.deckTypes.filter(G.zombieExists).map(function (type) {
      var c = MP.zombieCost(type);
      return { type: type, cost: c.cost, cd: c.cd };
    });
    r.cds = r.deck.map(function () {
      return 0;
    });
    r.plants = typeof WeakMap === 'function' ? new WeakMap() : null;
    G.hooks.blockLocalPlantInput = true;
    try {
      G.m.SunCount.SunCount.hide();
    } catch (e) {}
    G.mountZombieBar(
      r.deck.map(function (d) {
        return d.type;
      }),
      r.deck.map(function (d) {
        return d.cost;
      }),
    ).then(function (sb) {
      r.bar = sb;
    });
  }

  function plants() {
    try {
      return G.m.CharacterManager.PlantPool.pool().filter(function (p) {
        return p && p.node && p.node.isValid && !p.dead && p.health > 0;
      });
    } catch (e) {
      return [];
    }
  }

  function zombies() {
    try {
      return G.m.CharacterManager.ZombiePool.pool().filter(function (z) {
        return z && z.isAlive() && !z.hypnotized;
      });
    } catch (e) {
      return [];
    }
  }

  function cellOf(p) {
    var lnc = p.plantInLnC || p.inLnC;
    return lnc ? { l: lnc.lIndex, c: lnc.cIndex, lnc: lnc } : null;
  }

  function zombieAt(l, c) {
    var Sq = G.Sq();
    return zombies().some(function (z) {
      return Sq.judgeLIndex(z.worldPositionY) === l && Sq.judgeCIndex(z.worldPositionX) === c;
    });
  }

  var available = null;
  function exists(code) {
    if (!available) {
      available = {};
      MP.allPlants().forEach(function (c) {
        available[c] = true;
      });
    }
    return !!available[code];
  }

  function rnd(arr) {
    return arr[Math.floor(Math.random() * arr.length)];
  }

  // Plants of this arena available at this wave, optionally of some roles.
  function plantPool(wave, roles) {
    var source = run.mirror ? MIRROR_BASE.concat(MIRROR_PLANTS[run.opts.stage] || MIRROR_PLANTS.modern) : BASE.concat(ARENA_PLANTS[run.opts.stage] || ARENA_PLANTS.modern);
    if (run.mirror && roles && roles.indexOf('shoot') >= 0 && roles.indexOf('back') < 0) roles = roles.concat(['back']);
    var list = source.filter(function (p) {
      return p[2] <= wave && exists(p[0]) && (!roles || roles.indexOf(p[1]) >= 0);
    });
    if (!list.length && roles) return plantPool(wave, null);
    return list.map(function (p) {
      return p[0];
    });
  }

  function pickFormation(wave) {
    var list = FORMATIONS.filter(function (f) {
      return f.from <= wave;
    });
    var total = list.reduce(function (a, f) {
      return a + f.weight;
    }, 0);
    var x = Math.random() * total;
    for (var i = 0; i < list.length; i++) {
      x -= list[i].weight;
      if (x <= 0) return list[i].id;
    }
    return 'advance';
  }

  // One plant to place: {l, c, type, step multiplier, energized, elite}.
  function plan(wave, kind, n) {
    var lanes = [0, 1, 2, 3, 4].sort(function () {
      return Math.random() - 0.5;
    });
    var out = [];
    var energizeChance = Math.min(0.4, 0.08 + wave * 0.025);
    var add = function (l, c, type, extra) {
      out.push(Object.assign({ l: l, c: fromSide(c), type: type, mul: Math.random() < 0.15 ? 0.6 : 1, energized: Math.random() < energizeChance, elite: false }, extra || {}));
    };
    var i;
    if (kind === 'wall') {
      // Walls in front, shooters right behind, all walking together.
      var walls = plantPool(wave, ['wall']);
      var back = plantPool(wave, ['shoot', 'lob']);
      var k = Math.min(5, Math.max(2, Math.ceil(n / 2)));
      for (i = 0; i < k; i++) {
        add(lanes[i], 1, rnd(walls), { mul: 1.3 });
        add(lanes[i], 0, rnd(back), { mul: 1.3 });
      }
    } else if (kind === 'rush') {
      // Many cheap plants, walking fast.
      var cheap = plantPool(wave, ['shoot', 'melee', 'trap']);
      for (i = 0; i < Math.min(10, n + 2); i++) add(lanes[i % 5], i < 5 ? 0 : 1, rnd(cheap), { mul: 0.55, energized: false });
    } else if (kind === 'artillery') {
      var lob = plantPool(wave, run.mirror ? ['trap'] : ['lob']);
      for (i = 0; i < Math.min(10, n); i++) add(lanes[i % 5], i < 5 ? 0 : 1, rnd(lob));
    } else if (kind === 'focus') {
      // Everything on one or two lanes, led by an elite plant.
      var few = lanes.slice(0, n > 4 ? 2 : 1);
      var all = plantPool(wave, null);
      for (i = 0; i < Math.min(few.length * 2, n); i++) add(few[i % few.length], Math.floor(i / few.length), rnd(all), i === 0 ? { elite: true, energized: true } : null);
    } else if (kind === 'elite') {
      // Few, but tough and energized.
      var strong = plantPool(wave, ['shoot', 'lob', 'melee']);
      for (i = 0; i < Math.max(1, Math.ceil(n / 3)); i++) add(lanes[i], 0, rnd(strong), { elite: true, energized: true, mul: 1.2 });
    } else {
      var mix = plantPool(wave, null);
      for (i = 0; i < Math.min(10, n); i++) add(lanes[i % 5], i < 5 ? 0 : 1, rnd(mix));
    }
    return out;
  }

  /* ------------------------------------------------- turned-around plants */

  function reversePlant(p, logic) {
    if (!p || !p.node || p._xRev) return;
    p._xRev = true;
    var sc = p.node.scale;
    p.node.setScale(-Math.abs(sc.x), sc.y, sc.z);
    if (!logic) return;
    var CM = G.m.CharacterManager;
    var Sq = G.Sq();
    var proto = Object.getPrototypeOf(p);
    if (typeof proto.setDetecter === 'function') {
      // From the plant to the left edge instead of the right one.
      p.setDetecter = function (t, lnc) {
        lnc = lnc || this.plantInLnC;
        if (!lnc || !lnc.node) return;
        this.detector = CM.Rectangle.createRectangleNodeSide(lnc.node, -Sq.SquareWidth * (lnc.cIndex + 1), Sq.SquareHeight * (this.detectorHeight || 1));
      };
      try {
        p.setDetecter(null, p.plantInLnC);
      } catch (e) {}
    }
    if (typeof proto._shoot === 'function') {
      // _shoot(..., direction = Vec2(1, 0), ...): fire the other way.
      var shoot = proto._shoot;
      p._shoot = function () {
        var args = Array.prototype.slice.call(arguments);
        var v = args[4] || new G.cc.Vec2(1, 0);
        while (args.length < 4) args.push(undefined);
        args[4] = new G.cc.Vec2(-v.x, v.y);
        return shoot.apply(this, args);
      };
    }
  }

  // Pooled plants are reused by later levels: undo everything.
  function unreversePlant(p) {
    if (!p || !p._xRev) return;
    p._xRev = false;
    delete p.setDetecter;
    delete p._shoot;
    try {
      var sc = p.node.scale;
      p.node.setScale(Math.abs(sc.x), sc.y, sc.z);
    } catch (e) {}
  }
  inv.reversePlant = reversePlant;
  inv.unreversePlant = unreversePlant;

  function spawnPlant(item) {
    var r = run;
    var lnc = G.Sq().getLnC(item.l, item.c);
    if (!lnc || lnc.getAllPlants().length) return;
    r.spawned++;
    Promise.resolve(lnc.SpawnPlantByType(item.type))
      .then(function () {
        var p = lnc.getAllPlants()[0];
        if (!p || !r.plants) return;
        if (r.mirror && !KEEP_FACING[item.type]) reversePlant(p, !!REVERSIBLE[item.type]);
        if (item.elite) {
          // Elite: triple health and bigger.
          p.toughness = (p.toughness || 300) * 3;
          p.health = p.toughness;
          try {
            p.node.setScale(p.node.scale.x * 1.3, p.node.scale.y * 1.3, 1);
          } catch (e) {}
        }
        r.plants.set(p, {
          type: item.type,
          mul: item.mul,
          energized: item.energized,
          elite: item.elite,
          fed: false,
          next: r.diff.step * (SLOW[item.type] || 1) * item.mul * (0.7 + Math.random() * 0.6),
        });
      })
      .catch(function (e) {
        MP.warn('inverted: plant spawn failed', item.type, e);
      });
  }

  function spawnWave() {
    var r = run;
    r.wave++;
    var w = r.wave - 1;
    var huge = r.wave % 5 === 0 || r.wave === r.diff.waves;
    var n = r.diff.count(w);
    var kind = huge ? 'advance' : pickFormation(w);
    var items = plan(w, kind, huge ? Math.round(n * 1.6) : n);
    if (huge && items.length) Object.assign(items[0], { elite: true, energized: true });
    items.forEach(spawnPlant);
    r.formation = huge ? 'huge' : kind;
    announce(t(huge ? 'inv_f_huge' : 'inv_f_' + kind));
    G.play('playHugeWave');
    // Special event: a jalapeno sweeps the most defended lane.
    var chance = { easy: 0, normal: 0.18, hard: 0.3 }[r.opts.difficulty] || 0;
    if (r.wave >= 3 && Math.random() < chance && exists('jalapeno')) jalapenoEvent();
  }

  function jalapenoEvent() {
    var r = run;
    var Sq = G.Sq();
    var count = [0, 0, 0, 0, 0];
    zombies().forEach(function (z) {
      var l = Sq.judgeLIndex(z.worldPositionY);
      if (l >= 0 && l < 5) count[l]++;
    });
    var lane = count.indexOf(Math.max.apply(null, count));
    if (count[lane] === 0) return;
    r.warnLane = { l: lane, until: r.time + 3 };
    announce(t('inv_jalapeno', { n: lane + 1 }));
    setTimeout(function () {
      if (!run || run !== r || r.over) return;
      // First free square from the left (the jalapeno burns the whole lane).
      for (var k = 0; k < Sq.ColumnCount; k++) {
        var c = fromSide(k);
        var lnc = Sq.getLnC(lane, c);
        if (lnc && !lnc.getAllPlants().length && !zombieAt(lane, c)) {
          Promise.resolve(lnc.SpawnPlantByType('jalapeno')).catch(function () {});
          break;
        }
      }
      r.warnLane = null;
    }, 3000 / Math.max(0.5, G.cc.director.gameSpeed || 1));
  }

  // Energized plants use their plant food once, when a zombie gets close.
  function feedIfClose(p, st, cell) {
    if (!st.energized || st.fed || p.leapTween) return;
    var Sq = G.Sq();
    var near = zombies().some(function (z) {
      if (Sq.judgeLIndex(z.worldPositionY) !== cell.l) return false;
      var c = Sq.judgeCIndex(z.worldPositionX);
      var ahead = (c - cell.c) * dir();
      return ahead > 0 && ahead <= 2;
    });
    if (!near) return;
    st.fed = true;
    try {
      p.food(true);
    } catch (e) {}
  }

  function advance(dt) {
    var r = run;
    var Sq = G.Sq();
    plants().forEach(function (p) {
      var st = r.plants && r.plants.get(p);
      if (!st) return;
      var cell = cellOf(p);
      if (!cell) return;
      feedIfClose(p, st, cell);
      st.next -= dt;
      if (st.next > 0 || p.leapTween || p.fooding) return;
      st.next = r.diff.step * (SLOW[st.type] || 1) * st.mul * (0.8 + Math.random() * 0.4);
      // A plant sharing its square with a zombie fights it there.
      if (zombieAt(cell.l, cell.c)) return;
      var next = cell.c + dir();
      if (next < 0 || next >= Sq.ColumnCount) {
        // Walked past the zombies' last line.
        finish('lost');
        return;
      }
      var target = Sq.getLnC(cell.l, next);
      if (!target || !target.isInLawn() || target.getAllPlants().length || zombieAt(cell.l, next)) return;
      try {
        p.leapTo(target, 0.55, 70, false, true, 'quadInOut');
      } catch (e) {
        MP.warn('inverted: leap failed', e);
      }
    });
  }

  // Zombie hold: walk in to the chosen square, then stand there unless a
  // plant is right in front (then step in and eat it). A zombie never goes
  // more than one square past its square nor past the first column: in this
  // mode the house is behind the zombies, and reaching it would end the game.
  function plantInFront(z) {
    var Sq = G.Sq();
    var l = Sq.judgeLIndex(z.worldPositionY);
    var c = Sq.judgeCIndex(z.worldPositionX);
    var face = z._xDir === 1 ? 1 : -1;
    for (var dc = 0; dc <= 1; dc++) {
      var lnc = Sq.getLnC(l, c + face * dc);
      if (lnc && lnc.isInLawn && lnc.isInLawn() && lnc.getAllPlants().length) return true;
    }
    return false;
  }

  function installHold() {
    var Z = G.m.Zombie && G.m.Zombie.Zombie;
    if (!Z || Z.prototype._xHold) return;
    var orig = Z.prototype.walkSpeedScaleExtra;
    Z.prototype.walkSpeedScaleExtra = function () {
      var v = orig.apply(this, arguments);
      if (!inv.active() || this.hypnotized) return v;
      var Sq = G.Sq();
      var x = this.worldPositionX;
      // Zombies the player did not place (imps thrown by a gargantuar...)
      // hold where they are once on the lawn.
      var col = Sq.judgeCIndex(x);
      if (this._xHoldX == null && col >= 0 && col <= Sq.ColumnCount - 1 && !this._xIncoming) this._xHoldX = x;
      if (this._xHoldX == null) return v;
      if (this._xDir === 1) {
        // Facing right (mirrored): stop at the square, at most one further.
        var ceil = Math.min(Sq.getSquareWorldPosition(0, Sq.ColumnCount - 1).x, this._xHoldX + Sq.SquareWidth);
        if (x >= ceil) return 0;
        if (x >= this._xHoldX && !plantInFront(this)) return 0;
        return v;
      }
      var floor = Sq.getSquareWorldPosition(0, 0).x;
      var limit = Math.max(floor, this._xHoldX - Sq.SquareWidth);
      if (x <= limit) return 0;
      if (x <= this._xHoldX && !plantInFront(this)) return 0;
      return v;
    };
    // Plants teach the player how to use them when they appear ("Spikeweeds
    // destroy..."): meaningless here, the player does not plant.
    var KL = G.KL && G.KL();
    if (KL && !KL._xInvTips) {
      ['gameTip', 'gameTipString'].forEach(function (name) {
        var orig = KL[name];
        if (typeof orig !== 'function') return;
        KL[name] = function () {
          if (inv.active()) return;
          return orig.apply(this, arguments);
        };
      });
      KL._xInvTips = true;
    }
    // Safety net: "a zombie reached the house" never ends this mode.
    var UIInGame = G.m.UI && G.m.UI.UIInGame;
    if (UIInGame && !UIInGame.prototype._xInvLose) {
      var origLose = UIInGame.prototype.loseDarken;
      UIInGame.prototype.loseDarken = function (who) {
        if (inv.active()) {
          try {
            if (who && who.worldPositionX != null) who._xHoldX = G.Sq().getSquareWorldPosition(0, 0).x;
          } catch (e) {}
          return;
        }
        return origLose.apply(this, arguments);
      };
      UIInGame.prototype._xInvLose = true;
    }
    var origEnable = Z.prototype.characterOnEnable;
    Z.prototype.characterOnEnable = function () {
      this._xHoldX = null;
      this._xIncoming = false;
      if (this._xDir === 1) {
        this._xDir = null;
        try {
          this.reversed = false;
        } catch (e) {}
      }
      return origEnable.apply(this, arguments);
    };
    Z.prototype._xHold = true;
  }

  function canUse(j) {
    var d = run.deck[j];
    return !!d && run.cds[j] <= 0 && run.brains >= d.cost;
  }

  function select(j) {
    if (run.sel === j) {
      run.sel = -1;
      G.play('playCardCancel');
      return;
    }
    if (!canUse(j)) {
      G.play('playCardChooseFailed');
      return;
    }
    run.sel = j;
    G.play('playCardChosen');
  }

  function place(cell) {
    var r = run;
    var j = r.sel;
    if (j < 0 || !canUse(j)) return;
    if (!placeable(cell.c)) {
      G.play('playCardChooseFailed');
      return;
    }
    var d = r.deck[j];
    r.brains -= d.cost;
    r.cds[j] = d.cd;
    r.sel = -1;
    var holdX = G.Sq().getSquareWorldPosition(cell.l, cell.c).x;
    G.play('playPlantOnFloor');
    var mirror = r.mirror;
    G.spawnZombie(cell.l, d.type).then(function (z) {
      if (!z) return;
      if (mirror) {
        // Walk in from the left edge, facing right.
        var Sq = G.Sq();
        z._xIncoming = true;
        z._xDir = 1;
        z.worldPositionX = Sq.getSquareWorldPosition(cell.l, 0).x - Sq.SquareWidth;
        try {
          z.reversed = true;
        } catch (e) {}
      }
      z._xHoldX = holdX;
    });
  }

  function onPointer(e) {
    if (!inv.active() || !run.started || run.over || e.target !== G.canvas) return;
    var rc = G.canvas.getBoundingClientRect();
    var ui = G.normToUI((e.clientX - rc.left) / rc.width, (e.clientY - rc.top) / rc.height);
    if (e.type === 'mousemove') {
      run.hover = run.sel >= 0 ? G.cellAt(ui) : null;
      return;
    }
    if (G.isPaused() || G.levelOver()) return;
    if (e.button === 2) {
      run.sel = -1;
      return;
    }
    var j = G.hitZombieCard(ui);
    if (j >= 0) return select(j);
    var cell = G.cellAt(ui);
    if (cell && run.sel >= 0) place(cell);
  }

  function onKey(e) {
    if (!inv.active() || !run.started || run.over) return;
    var k = String(e.key).toLowerCase();
    var idx = { 1: 0, 2: 1, 3: 2, 4: 3, 5: 4, 6: 5 }[k];
    if (idx != null && run.deck[idx]) select(idx);
    else if (k === 'escape') run.sel = -1;
  }

  /* ----------------------------------------------------------- frame */

  function announce(text) {
    if (run) run.banner = { text: text, until: performance.now() + 2600 };
  }

  function onPlantGone(p) {
    if (!inv.active() || !run.started || run.over) return;
    var st = run.plants && run.plants.get(p);
    if (st && !(p.health > 0)) {
      run.plants.delete(p);
      run.killed++;
      run.brains += (25 + run.wave * 2) * (st.elite ? 3 : 1);
    }
  }

  function frame(dt) {
    if (!inv.active()) return;
    var r = run;
    if (!r.started) {
      if (G.gameStarted()) setup();
      return;
    }
    if (r.over || G.isPaused() || G.levelOver()) return;
    var gdt = dt * (G.cc.director.gameSpeed || 1);
    r.time += gdt;
    r.brains = Math.min(5000, r.brains + (r.diff.income + Math.floor(r.time / 60)) * gdt);
    for (var i = 0; i < r.cds.length; i++) if (r.cds[i] > 0) r.cds[i] = Math.max(0, r.cds[i] - gdt);
    if (r.sel >= 0 && !canUse(r.sel)) r.sel = -1;
    if (r.wave < r.diff.waves) {
      r.nextWave -= gdt;
      if (r.nextWave <= 0) {
        spawnWave();
        r.nextWave = r.diff.every;
      }
    }
    advance(gdt);
    if (r.wave >= r.diff.waves && r.nextWave < r.diff.every - 6 && !plants().length && !r.over) finish('won');
    var sb = r.bar;
    if (G.isValid(sb)) {
      sb.index = r.sel;
      sb.zombieCards.forEach(function (card, k) {
        if (!r.deck[k]) return;
        card.ca.affordable = r.brains >= r.deck[k].cost;
        card.ca.cooling = r.cds[k] > 0;
      });
    }
  }

  function score(result) {
    var r = run;
    var held = result === 'won' ? r.diff.waves : Math.max(0, r.wave - 1);
    return held * 100 + r.killed * 10 + (result === 'won' ? 1000 : 0);
  }

  function finish(result) {
    var r = run;
    if (r.over) return;
    r.over = true;
    G.freezeLevel();
    G.play(result === 'won' ? 'playWinMusic' : 'playLoseMusic');
    var s = X.play.stats();
    var pts = score(result);
    if (s) {
      s.kills = r.killed;
      s.wave = r.wave;
      s.waveCount = r.diff.waves;
      s.score = pts;
      s.mode = r.mirror ? 'mirror' : 'inverted';
    }
    X.play.finish(result, { noSummary: true });
    var bestKey = r.mirror ? 'mirrorBest' : 'invertedBest';
    X.store.set(bestKey, Math.max(X.store.get(bestKey, 0), pts));
    if (X.api.available() && X.api.loggedIn()) {
      X.api
        .postScore(r.mirror ? 'challenge:mirror' : 'challenge:inverted', pts, { waves: r.wave, kills: r.killed, time: Math.round(r.time), stage: r.opts.stage })
        .then(function (res) {
          setTimeout(function () {
            if (res.rank && resultBox) resultBox.querySelector('.pvzx-inv-sub').textContent += ' · ' + t('summary_rank', { n: res.rank });
          }, 1300);
        })
        .catch(function () {});
    }
    showResult(result, pts);
  }

  /* ------------------------------------------------------------- HTML */

  var hud = null;
  var resultBox = null;

  function showResult(result, pts) {
    if (resultBox) resultBox.remove();
    resultBox = el('div#pvzx-inv-result.pvzx-' + result, null, [
      el('div.pvzx-inv-title', { text: t(result === 'won' ? 'inv_won' : 'inv_lost') }),
      el('div.pvzx-inv-sub', { text: t('points', { n: pts }) }),
      el('div.pvzx-file-actions', null, [
        el('button.mp-btn.mp-green', { text: t('inv_again'), onclick: function () {
          hideResult();
          pendingRestart = run.opts;
          G.goToMain();
        } }),
        el('button.mp-btn.mp-brown', { text: t('inv_menu'), onclick: function () {
          hideResult();
          G.goToMain();
        } }),
      ]),
    ]);
    resultBox.addEventListener('mousedown', function (e) {
      e.stopPropagation();
    });
    document.body.appendChild(resultBox);
  }

  function hideResult() {
    if (resultBox) resultBox.remove();
    resultBox = null;
  }

  function render() {
    var show = inv.active() && run.started;
    if (!show) {
      if (hud) hud.style.display = 'none';
      return;
    }
    if (!hud) {
      hud = el('div#pvzx-inv-hud', null, [
        el('div.pvzx-inv-brains', null, [el('span.pvzx-inv-brain'), el('b')]),
        el('div.pvzx-inv-wave'),
        el('div.pvzx-inv-banner'),
        el('div.pvzx-inv-warn'),
        el('div.pvzx-inv-cell'),
        el('div.pvzx-inv-zone'),
      ]);
      hud.querySelector('.pvzx-inv-brain').innerHTML = (MP.ui && MP.ui.ICONS && MP.ui.ICONS.brain) || '🧠';
      document.body.appendChild(hud);
    }
    var rc = G.canvas.getBoundingClientRect();
    var scale = rc.height / 720;
    var st = hud.style;
    st.display = 'block';
    st.left = rc.left + 'px';
    st.top = rc.top + 'px';
    st.width = rc.width + 'px';
    st.height = rc.height + 'px';
    st.setProperty('--x-s', String(scale));
    hud.querySelector('.pvzx-inv-brains b').textContent = String(Math.floor(run.brains));
    hud.querySelector('.pvzx-inv-wave').textContent =
      t('inv_wave', { n: run.wave, total: run.diff.waves }) + (run.formation ? ' · ' + t(run.formation === 'huge' ? 'inv_f_huge' : 'inv_f_' + run.formation) : '') + ' · ' + t('inv_killed', { n: run.killed });
    var banner = hud.querySelector('.pvzx-inv-banner');
    var shown = run.banner && performance.now() < run.banner.until;
    banner.style.display = shown ? 'block' : 'none';
    if (shown && banner.textContent !== run.banner.text) banner.textContent = run.banner.text;
    var warn = hud.querySelector('.pvzx-inv-warn');
    var gridW = G.gridNorm();
    if (gridW && run.warnLane) {
      warn.style.display = 'block';
      warn.style.left = gridW.x * rc.width + 'px';
      warn.style.top = (gridW.y + gridW.ch * run.warnLane.l) * rc.height + 'px';
      warn.style.width = gridW.cw * gridW.cols * rc.width + 'px';
      warn.style.height = gridW.ch * rc.height + 'px';
    } else warn.style.display = 'none';
    var grid = G.gridNorm();
    var cellNode = hud.querySelector('.pvzx-inv-cell');
    var zone = hud.querySelector('.pvzx-inv-zone');
    if (grid && run.sel >= 0) {
      zone.style.display = 'block';
      zone.style.left = (grid.x + grid.cw * (run.mirror ? 0 : 4)) * rc.width + 'px';
      zone.classList.toggle('pvzx-mirror', !!run.mirror);
      zone.style.top = grid.y * rc.height + 'px';
      zone.style.width = grid.cw * 5 * rc.width + 'px';
      zone.style.height = grid.ch * grid.rows * rc.height + 'px';
    } else zone.style.display = 'none';
    var h = run.hover;
    if (grid && h && run.sel >= 0) {
      cellNode.style.display = 'block';
      cellNode.classList.toggle('pvzx-bad', !placeable(h.c));
      cellNode.style.left = (grid.x + grid.cw * h.c) * rc.width + 'px';
      cellNode.style.top = (grid.y + grid.ch * h.l) * rc.height + 'px';
      cellNode.style.width = grid.cw * rc.width + 'px';
      cellNode.style.height = grid.ch * rc.height + 'px';
    } else cellNode.style.display = 'none';
    // Recharge shades over the zombie packets.
    var lay = G.layout();
    var zc = (lay && lay.zcards) || [];
    hud.querySelectorAll('.pvzx-inv-cd').forEach(function (n) {
      n.remove();
    });
    zc.forEach(function (r, i) {
      if (!r || !run.deck[i]) return;
      var frac = run.cds[i] / run.deck[i].cd;
      var poor = run.brains < run.deck[i].cost;
      if (!(frac > 0) && !poor) return;
      var n = el('div.pvzx-inv-cd' + (poor && !(frac > 0) ? '.pvzx-poor' : ''));
      n.style.left = r.x * rc.width + 'px';
      n.style.top = r.y * rc.height + 'px';
      n.style.width = r.w * rc.width + 'px';
      n.style.height = (frac > 0 ? r.h * frac : r.h) * rc.height + 'px';
      hud.appendChild(n);
    });
  }

  function loop() {
    try {
      render();
    } catch (e) {}
    requestAnimationFrame(loop);
  }

  inv.init = function () {
    installHold();
    G.on('frame', frame);
    G.on('scene', function (name) {
      if (name === 'mainScene' && pendingRestart) {
        var again = pendingRestart;
        pendingRestart = null;
        setTimeout(function () {
          inv.start(again);
        }, 400);
      }
      if (name !== 'inGameScene') {
        hideResult();
        if (run) {
          run = null;
          G.hooks.blockLocalPlantInput = false;
          G.hooks.managedZombieBar = false;
        }
      }
    });
    var PP = G.m.CharacterManager && G.m.CharacterManager.PlantPool;
    if (PP && !PP._xInv) {
      var origDel = PP.deletePlant;
      PP.deletePlant = function (p) {
        try {
          onPlantGone(p);
          unreversePlant(p);
        } catch (e) {}
        return origDel.apply(this, arguments);
      };
      var origRegP = PP.registerPlant;
      PP.registerPlant = function (p) {
        try {
          if (p && p._xRev) unreversePlant(p);
        } catch (e) {}
        return origRegP.apply(this, arguments);
      };
      PP._xInv = true;
    }
    ['mousedown', 'mousemove'].forEach(function (type) {
      window.addEventListener(type, onPointer, true);
    });
    window.addEventListener('keydown', onKey, true);
    requestAnimationFrame(loop);
  };

  // For tests and debugging from the console.
  inv.state = function () {
    return run;
  };

  inv.best = function (mirror) {
    return X.store.get(mirror ? 'mirrorBest' : 'invertedBest', 0);
  };
})();
