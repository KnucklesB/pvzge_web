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

  // Plants that join the attack, by first wave (index) they can appear in.
  var PLANTS = [
    ['peashooter', 0], ['cabbagepult', 0], ['wallnut', 1], ['snowpea', 2], ['kernelpult', 2], ['bonkchoy', 3],
    ['repeater', 4], ['chomper', 5], ['tallnut', 6], ['threepeater', 7], ['melonpult', 8], ['gatlingpea', 10],
  ];
  var SLOW = { wallnut: 1.4, tallnut: 1.7 }; // walls walk slower

  inv.options = X.store.get('inverted', { stage: 'modern', difficulty: 'normal' });

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
    opts = Object.assign({}, inv.options, opts || {});
    inv.options = opts;
    X.store.set('inverted', opts);
    if (X.online()) return false;
    var deck = (MP.STAGES[opts.stage] || MP.STAGES.modern).zombies.filter(function (z) {
      return !/_flag$/.test(z);
    });
    run = {
      opts: opts,
      diff: DIFF[opts.difficulty] || DIFF.normal,
      deckTypes: deck.slice(0, 6),
      started: false,
      over: false,
    };
    X.modes.current = { kind: 'inverted', id: 'inverted', options: opts, mutators: [] };
    if (X.ui) X.ui.close();
    G.startCustomLevel(buildLevel(opts));
    return true;
  };

  inv.active = function () {
    return !!(run && X.modes.current && X.modes.current.kind === 'inverted' && G.inLevel());
  };

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

  function pickPlant(wave) {
    var pool = PLANTS.filter(function (p) {
      return p[1] <= wave;
    }).map(function (p) {
      return p[0];
    });
    return pool[Math.floor(Math.random() * pool.length)];
  }

  function spawnWave() {
    var r = run;
    r.wave++;
    var n = r.diff.count(r.wave - 1);
    var Sq = G.Sq();
    var lanes = [0, 1, 2, 3, 4].sort(function () {
      return Math.random() - 0.5;
    });
    for (var i = 0; i < n; i++) {
      var l = lanes[i % 5];
      var col = i < 5 ? 0 : 1;
      var lnc = Sq.getLnC(l, col);
      if (!lnc || lnc.getAllPlants().length) continue;
      var type = pickPlant(r.wave - 1);
      r.spawned++;
      (function (lnc, type) {
        Promise.resolve(lnc.SpawnPlantByType(type))
          .then(function () {
            var p = lnc.getAllPlants()[0];
            if (p && r.plants) r.plants.set(p, { next: r.diff.step * (SLOW[type] || 1) * (0.7 + Math.random() * 0.6), type: type });
          })
          .catch(function (e) {
            MP.warn('inverted: plant spawn failed', type, e);
          });
      })(lnc, type);
    }
    G.play('playHugeWave');
  }

  function advance(dt) {
    var r = run;
    var Sq = G.Sq();
    plants().forEach(function (p) {
      var st = r.plants && r.plants.get(p);
      if (!st) return;
      st.next -= dt;
      if (st.next > 0 || p.leapTween) return;
      st.next = r.diff.step * (SLOW[st.type] || 1) * (0.8 + Math.random() * 0.4);
      var cell = cellOf(p);
      if (!cell) return;
      if (cell.c >= Sq.ColumnCount - 1) {
        // Walked past the zombies' last line.
        finish('lost');
        return;
      }
      var target = Sq.getLnC(cell.l, cell.c + 1);
      if (!target || !target.isInLawn() || target.getAllPlants().length || zombieAt(cell.l, cell.c + 1)) return;
      try {
        p.leapTo(target, 0.55, 70, false, true, 'quadInOut');
      } catch (e) {
        MP.warn('inverted: leap failed', e);
      }
    });
  }

  // Zombie hold: walk in to the chosen square, then stand there unless a
  // plant is right in front (then step in and eat it).
  function plantInFront(z) {
    var Sq = G.Sq();
    var l = Sq.judgeLIndex(z.worldPositionY);
    var c = Sq.judgeCIndex(z.worldPositionX);
    for (var dc = 0; dc <= 1; dc++) {
      var lnc = Sq.getLnC(l, c - dc);
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
      if (this._xHoldX != null && this.worldPositionX <= this._xHoldX && !plantInFront(this)) return 0;
      return v;
    };
    var origEnable = Z.prototype.characterOnEnable;
    Z.prototype.characterOnEnable = function () {
      this._xHoldX = null;
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
    if (cell.c < 4) {
      G.play('playCardChooseFailed');
      return;
    }
    var d = r.deck[j];
    r.brains -= d.cost;
    r.cds[j] = d.cd;
    r.sel = -1;
    var holdX = G.Sq().getSquareWorldPosition(cell.l, cell.c).x;
    G.play('playPlantOnFloor');
    G.spawnZombie(cell.l, d.type).then(function (z) {
      if (z) z._xHoldX = holdX;
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

  function onPlantGone(p) {
    if (!inv.active() || !run.started || run.over) return;
    if (run.plants && run.plants.get(p) && !(p.health > 0)) {
      run.plants.delete(p);
      run.killed++;
      run.brains += 25 + run.wave * 2;
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
      s.mode = 'inverted';
    }
    X.play.finish(result, { noSummary: true });
    X.store.set('invertedBest', Math.max(X.store.get('invertedBest', 0), pts));
    if (X.api.available() && X.api.loggedIn()) {
      X.api
        .postScore('challenge:inverted', pts, { waves: r.wave, kills: r.killed, time: Math.round(r.time), stage: r.opts.stage })
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
    hud.querySelector('.pvzx-inv-wave').textContent = t('inv_wave', { n: run.wave, total: run.diff.waves }) + ' · ' + t('inv_killed', { n: run.killed });
    var grid = G.gridNorm();
    var cellNode = hud.querySelector('.pvzx-inv-cell');
    var zone = hud.querySelector('.pvzx-inv-zone');
    if (grid && run.sel >= 0) {
      zone.style.display = 'block';
      zone.style.left = (grid.x + grid.cw * 4) * rc.width + 'px';
      zone.style.top = grid.y * rc.height + 'px';
      zone.style.width = grid.cw * 5 * rc.width + 'px';
      zone.style.height = grid.ch * grid.rows * rc.height + 'px';
    } else zone.style.display = 'none';
    var h = run.hover;
    if (grid && h && run.sel >= 0) {
      cellNode.style.display = 'block';
      cellNode.classList.toggle('pvzx-bad', h.c < 4);
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
        } catch (e) {}
        return origDel.apply(this, arguments);
      };
      PP._xInv = true;
    }
    ['mousedown', 'mousemove'].forEach(function (type) {
      window.addEventListener(type, onPointer, true);
    });
    window.addEventListener('keydown', onKey, true);
    requestAnimationFrame(loop);
  };

  inv.best = function () {
    return X.store.get('invertedBest', 0);
  };
})();
