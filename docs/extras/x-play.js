/*
 * PvZ2 Gardendless - Extras during a level.
 *
 *   - extra game speed (0.5x, 2x, 3x on top of the game's own 1.5x button)
 *   - auto-collect of sun, coins/gems/sprouts/tickets and plant food
 *   - health bars over zombies and damaged plants, optional damage numbers
 *   - level statistics (time, zombies defeated, sun, plants, plant food,
 *     mowers) shown in a summary card when the level ends and handed to the
 *     achievements and modes ("level-start" / "level-end" events)
 *   - a preview of the zombies of the level while the seed chooser is open
 *   - a small shortcut bar (speed, auto-collect, health bars, preview)
 *
 * Hooks wrap the game's own prototypes (UIInGame.update, dropping, the
 * character pools, SunCount.SunAdd); the bundle itself is untouched.
 */
(function () {
  'use strict';

  var MP = window.PvZMP;
  var X = window.PvZX;
  var G = MP.game;
  var t = X.t;
  var el = MP.util.el;

  var play = (X.play = {});
  var mods = {};

  /* ----------------------------------------------------------- helpers */

  function zombieType(z) {
    try {
      var E = G.m.Zombies.ZombieEnum;
      var n = E && E[z.ID];
      if (typeof n === 'string') return n;
    } catch (e) {}
    return 'zombie';
  }

  function plantCode(p) {
    try {
      var f = G.m.Plants.plants.getPlantFeature(p.ID);
      if (f && f.CODENAME) return f.CODENAME;
    } catch (e) {}
    return String(p && p.ID);
  }

  // CODENAME ("sunflower") -> plant feature; PlantEnum keys are CamelCase.
  var featureByCode = null;
  function plantFeature(code) {
    if (!featureByCode) {
      featureByCode = {};
      try {
        var P = G.m.Plants;
        Object.keys(P.PlantEnum).forEach(function (k) {
          if (!isNaN(+k)) return;
          var f = P.plants.getPlantFeature(P.PlantEnum[k]);
          if (f && f.CODENAME && !featureByCode[f.CODENAME]) featureByCode[f.CODENAME] = f;
        });
      } catch (e) {}
    }
    return featureByCode[code] || null;
  }

  X.plantName = function (code) {
    try {
      var f = plantFeature(code);
      var n = f && f.NAME;
      if (n) {
        var en = n.en || code;
        if (MP.lang === 'pt' && MP.ptBR && MP.ptBR.translate) return MP.ptBR.translate(en) || en;
        if (MP.lang === 'zh' && n.zh) return n.zh;
        return en;
      }
    } catch (e) {}
    return code;
  };

  X.zombieName = function (type) {
    var en = MP.zombieName ? MP.zombieName(type) : type;
    if (MP.lang === 'pt' && MP.ptBR && MP.ptBR.translate) return MP.ptBR.translate(en) || en;
    return en;
  };

  function zombiesAll() {
    try {
      var ZP = G.m.CharacterManager.ZombiePool;
      return (ZP.pool() || []).concat(ZP.hypnoPool() || []);
    } catch (e) {
      return [];
    }
  }

  function plantsAll() {
    try {
      return G.m.CharacterManager.PlantPool.pool() || [];
    } catch (e) {
      return [];
    }
  }

  function armorHealth(z, key) {
    var a = z._armors;
    if (!a || !a.length) return 0;
    var s = 0;
    for (var i = 0; i < a.length; i++) {
      var v = a[i] && a[i][key];
      if (typeof v === 'number' && v > 0) s += v;
    }
    return s;
  }

  function lanesWithMower() {
    try {
      return G.Sq()
        .getAllLane()
        .filter(function (l) {
          return !!l.mower;
        }).length;
    } catch (e) {
      return 0;
    }
  }

  function solo() {
    return !X.online();
  }

  /* ------------------------------------------------------ level stats */

  var stats = null; // stats of the level being played
  play.stats = function () {
    return stats;
  };

  function levelId() {
    try {
      var LP = G.LP();
      return (LP.thisLevelsID && LP.thisLevelsID[0]) || (X.modes && X.modes.current && X.modes.current.id) || 'custom';
    } catch (e) {
      return 'custom';
    }
  }

  function levelName() {
    try {
      var lp = G.lp();
      return (lp && lp.levelNameString) || '';
    } catch (e) {
      return '';
    }
  }

  function newStats() {
    var lp = G.lp();
    var wm = lp && lp.waveManagerProps;
    return {
      id: levelId(),
      name: levelName(),
      mode: (X.modes && X.modes.current && X.modes.current.kind) || 'campaign',
      startedAt: Date.now(),
      time: 0,
      kills: 0,
      killsByType: {},
      sun: 0,
      planted: 0,
      plantedByType: {},
      lost: 0,
      food: 0,
      mowersStart: lanesWithMower(),
      mowersUsed: 0,
      wave: 0,
      waveCount: (wm && wm.WaveCount) || 0,
      maxSpeed: 1,
      mutators: X.mutators ? X.mutators.active() : [],
      online: X.online(),
      result: null,
    };
  }

  var tracked = { lastFood: 0, started: false, over: false };

  function onFrame(dt) {
    if (!G.inLevel()) {
      if (stats && !stats.result) stats = null;
      tracked.started = false;
      tracked.over = false;
      return;
    }
    var lp = G.lp();
    var started = G.gameStarted();
    if (started && !tracked.started) {
      tracked.started = true;
      tracked.over = false;
      stats = newStats();
      tracked.lastFood = G.plantFoodCount();
      X.emit('level-start', stats);
    }
    if (!stats || stats.result) return;
    var speed = (G.cc.director.gameSpeed || 0);
    if (!G.isPaused()) stats.time += dt * speed;
    if (speed > stats.maxSpeed) stats.maxSpeed = speed;
    stats.wave = Math.max(stats.wave, (lp && lp.currentWave) || 0);
    var pf = G.plantFoodCount();
    if (pf < tracked.lastFood) stats.food += tracked.lastFood - pf;
    tracked.lastFood = pf;
    if (!tracked.over && lp && (lp.gameWon || lp.gameLost)) {
      tracked.over = true;
      stats.result = lp.gameWon ? 'won' : 'lost';
      stats.mowersUsed = Math.max(0, stats.mowersStart - lanesWithMower());
      stats.endedAt = Date.now();
      X.emit('level-end', stats);
      if (X.settings.summary) setTimeout(showSummary, 1200, stats);
    }
  }

  /* ------------------------------------------------------------ hooks */

  function installHooks() {
    var cc = G.cc;

    // Speed: the game sets director.gameSpeed in UIInGame.update.
    var UIInGame = G.m.UI.UIInGame;
    if (UIInGame && !UIInGame.prototype._xSpeed) {
      var origUpdate = UIInGame.prototype.update;
      UIInGame.prototype.update = function () {
        var r = origUpdate.apply(this, arguments);
        var m = X.settings.speed;
        if (m !== 1 && solo() && !G.hooks.lockSpeed && cc.director.gameSpeed > 0) cc.director.gameSpeed *= m;
        return r;
      };
      UIInGame.prototype._xSpeed = true;
    }

    // Auto-collect.
    var Dropping = G.m.dropping && G.m.dropping.dropping;
    if (Dropping && !Dropping.prototype._xAuto) {
      var origDrop = Dropping.prototype.characterUpdate;
      Dropping.prototype.characterUpdate = function (dt) {
        origDrop.call(this, dt);
        try {
          var type = this.DroppingType;
          var s = X.settings;
          var want = (type === 'sun' && s.autoSun) || (type === 'plantfood' && s.autoFood) || ((type === 'coin' || type === 'gem' || type === 'sprout' || type === 'ticket') && s.autoCoins);
          if (!want || !solo()) return;
          if (!this.node || !this.node.isValid || !this.mouseListen) return;
          if (this.collectable() && this.collectable_after() && G.LP().gameStarted) this.collect();
        } catch (e) {}
      };
      Dropping.prototype._xAuto = true;
    }

    // Sun collected.
    var SC = G.m.SunCount && G.m.SunCount.SunCount;
    if (SC && !SC.prototype._xSun) {
      var origAdd = SC.prototype.SunAdd;
      SC.prototype.SunAdd = function (n) {
        if (stats && !stats.result && n > 0 && !X._sunTopUp) stats.sun += n;
        return origAdd.apply(this, arguments);
      };
      SC.prototype._xSun = true;
    }

    // Zombies defeated / plants planted and lost.
    var CM = G.m.CharacterManager;
    var ZP = CM && CM.ZombiePool;
    if (ZP && !ZP._xKill) {
      var origDel = ZP.deleteZombie;
      ZP.deleteZombie = function (z) {
        try {
          if (stats && !stats.result && z && !z.hypnotized && ZP.pool().indexOf(z) >= 0) {
            stats.kills++;
            var ty = zombieType(z);
            stats.killsByType[ty] = (stats.killsByType[ty] || 0) + 1;
          }
        } catch (e) {}
        return origDel.apply(this, arguments);
      };
      var origReg = ZP.registerZombie;
      ZP.registerZombie = function (z) {
        var r = origReg.apply(this, arguments);
        X.emit('zombie', z);
        return r;
      };
      ZP._xKill = true;
    }
    var PP = CM && CM.PlantPool;
    if (PP && !PP._xPlant) {
      var origRegP = PP.registerPlant;
      PP.registerPlant = function (p) {
        var fresh = PP.pool().indexOf(p) < 0;
        var r = origRegP.apply(this, arguments);
        try {
          if (fresh && stats && !stats.result && G.LP().gameStarted) {
            stats.planted++;
            var code = plantCode(p);
            stats.plantedByType[code] = (stats.plantedByType[code] || 0) + 1;
          }
        } catch (e) {}
        return r;
      };
      var origDelP = PP.deletePlant;
      PP.deletePlant = function (p) {
        try {
          if (stats && !stats.result && p && PP.pool().indexOf(p) >= 0 && !(p.health > 0)) stats.lost++;
        } catch (e) {}
        return origDelP.apply(this, arguments);
      };
      PP._xPlant = true;
    }
  }

  /* --------------------------------------------------- overlay canvas */

  var overlay = null;
  var ctx = null;
  var floaters = [];
  var lastHealth = typeof WeakMap === 'function' ? new WeakMap() : null;

  function ensureOverlay() {
    if (overlay) return;
    overlay = el('canvas#pvzx-overlay');
    document.body.appendChild(overlay);
    ctx = overlay.getContext('2d');
  }

  function frameRect() {
    var r = G.canvas.getBoundingClientRect();
    return r;
  }

  // World (lawn) coordinates -> CSS pixels inside the canvas.
  function worldToPx(wx, wy, r) {
    var o = G.worldOffset();
    var n = G.uiToNorm(wx - o.x, wy - o.y);
    return { x: n.x * r.width, y: n.y * r.height };
  }

  function barColor(f) {
    return f > 0.6 ? '#4fd13a' : f > 0.3 ? '#ffc61a' : '#ff4b33';
  }

  function drawBar(x, y, w, h, f, color, armor) {
    ctx.fillStyle = 'rgba(20,10,4,0.75)';
    ctx.fillRect(x - 1, y - 1, w + 2, h + 2);
    ctx.fillStyle = color;
    ctx.fillRect(x, y, Math.max(0, Math.min(1, f)) * w, h);
    if (armor) {
      ctx.fillStyle = 'rgba(255,255,255,0.25)';
      ctx.fillRect(x, y, Math.max(0, Math.min(1, f)) * w, h / 2);
    }
  }

  function renderOverlay() {
    var show = G.inLevel() && (X.settings.hpZombies || X.settings.hpPlants || X.settings.dmgNumbers) && !G.isPaused() && !G.levelOver();
    if (!show) {
      if (overlay && overlay.style.display !== 'none') overlay.style.display = 'none';
      floaters.length = 0;
      return;
    }
    ensureOverlay();
    var r = frameRect();
    var dpr = window.devicePixelRatio || 1;
    var W = Math.round(r.width * dpr);
    var H = Math.round(r.height * dpr);
    if (overlay.width !== W || overlay.height !== H) {
      overlay.width = W;
      overlay.height = H;
    }
    var st = overlay.style;
    st.display = 'block';
    st.left = r.left + 'px';
    st.top = r.top + 'px';
    st.width = r.width + 'px';
    st.height = r.height + 'px';
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, r.width, r.height);
    var scale = r.height / 720;
    var bw = Math.max(26, 46 * scale);
    var bh = Math.max(3, 5 * scale);

    // Zombies hidden in fog keep their secret.
    var Sq = G.Sq();
    var hasFog = false;
    try {
      hasFog = !!(Sq.getFogs && Sq.getFogs().length);
    } catch (e) {}
    var fogged = function (z) {
      if (!hasFog) return false;
      try {
        var l = z.inLnC && z.inLnC.lIndex != null ? z.inLnC.lIndex : Sq.judgeLIndex(z.worldPositionY);
        var f = Sq.getFog(l, Sq.judgeCIndex(z.worldPositionX));
        return !!(f && f._currentAlpha > 0.4);
      } catch (e) {
        return false;
      }
    };

    zombiesAll().forEach(function (z) {
      try {
        if (!z || !z.node || !z.node.isValid || !z.node.activeInHierarchy || !z.isAlive || !z.isAlive() || fogged(z)) return;
        var body = Math.max(0, z.health || 0);
        var bodyMax = Math.max(body, z.toughness || 1, z._xMax || 0);
        var arm = armorHealth(z, 'health');
        var armMax = Math.max(arm, armorHealth(z, 'toughness'));
        var total = body + arm;
        if (lastHealth) {
          var prev = lastHealth.get(z);
          if (X.settings.dmgNumbers && prev != null && prev > total + 0.5) addFloater(z, prev - total);
          lastHealth.set(z, total);
        }
        if (!X.settings.hpZombies) return;
        var rec = z.bodyRec;
        var top, cx;
        if (rec && rec.prjY) {
          cx = (rec.prjX().x + rec.prjX().y) / 2;
          top = rec.prjY().y + (z.height_depth || 0);
        } else {
          cx = z.worldPositionX;
          top = z.worldPositionY + 100;
        }
        var p = worldToPx(cx, top, r);
        var x = p.x - bw / 2;
        var y = p.y - bh * 3;
        if (armMax > 0) {
          drawBar(x, y - bh - 2, bw, bh, arm / armMax, '#c9d3e6', true);
        }
        drawBar(x, y, bw, bh, body / bodyMax, z.hypnotized ? '#d46bff' : barColor(body / bodyMax));
      } catch (e) {}
    });

    if (X.settings.hpPlants) {
      plantsAll().forEach(function (pl) {
        try {
          if (!pl || !pl.node || !pl.node.isValid || !pl.node.activeInHierarchy) return;
          var h = pl.health;
          var m = pl.toughness;
          if (!(m > 0) || !(h >= 0) || h >= m) return;
          var wp = pl.node.worldPosition;
          var p = worldToPx(wp.x, wp.y, r);
          var w = bw * 0.8;
          drawBar(p.x - w / 2, p.y + 4 * scale, w, bh * 0.8, h / m, barColor(h / m));
        } catch (e) {}
      });
    }

    if (floaters.length) {
      var now = performance.now();
      ctx.textAlign = 'center';
      ctx.font = 'bold ' + Math.round(16 * scale + 4) + 'px "Brianne", "Comic Sans MS", sans-serif';
      ctx.lineWidth = 3;
      for (var i = floaters.length - 1; i >= 0; i--) {
        var f = floaters[i];
        var k = (now - f.at) / 800;
        if (k >= 1) {
          floaters.splice(i, 1);
          continue;
        }
        var fp = worldToPx(f.x, f.y, r);
        ctx.globalAlpha = 1 - k * k;
        ctx.strokeStyle = 'rgba(40,10,0,0.9)';
        ctx.fillStyle = f.big ? '#ffde3b' : '#ffffff';
        ctx.strokeText(f.text, fp.x, fp.y - k * 40 * scale);
        ctx.fillText(f.text, fp.x, fp.y - k * 40 * scale);
      }
      ctx.globalAlpha = 1;
    }
  }

  function addFloater(z, amount) {
    if (floaters.length > 60) floaters.shift();
    var rec = z.bodyRec;
    var x = rec && rec.prjX ? (rec.prjX().x + rec.prjX().y) / 2 : z.worldPositionX;
    var y = rec && rec.prjY ? rec.prjY().y : z.worldPositionY + 90;
    floaters.push({ x: x + (Math.random() - 0.5) * 20, y: y + 10, text: String(Math.round(amount)), big: amount >= 300, at: performance.now() });
  }

  /* --------------------------------------------------------------- HUD */

  var hud = null;

  function hudButton(key, icon, title, onclick) {
    var b = el('button.pvzx-hud-btn', { 'data-k': key, title: title, onclick: function (e) {
      e.stopPropagation();
      onclick();
      renderHud(true);
    } });
    b.innerHTML = icon;
    b.addEventListener('mousedown', function (e) {
      e.stopPropagation();
    });
    return b;
  }

  var ICON = {
    speed: '<svg viewBox="0 0 24 24"><path d="M3 5l8 7-8 7zM12 5l8 7-8 7z" fill="currentColor"/></svg>',
    auto: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="5" fill="#ffd21a" stroke="#7a4a00" stroke-width="1.5"/><path d="M12 1v4M12 19v4M1 12h4M19 12h4M4.2 4.2l2.8 2.8M17 17l2.8 2.8M4.2 19.8L7 17M17 7l2.8-2.8" stroke="#ffd21a" stroke-width="2" stroke-linecap="round"/></svg>',
    hp: '<svg viewBox="0 0 24 24"><path d="M12 21s-8-5-8-11a4.5 4.5 0 0 1 8-2.8A4.5 4.5 0 0 1 20 10c0 6-8 11-8 11z" fill="#ff4b5c" stroke="#5a0b14" stroke-width="1.5"/></svg>',
    eye: '<svg viewBox="0 0 24 24"><path d="M1 12s4-7 11-7 11 7 11 7-4 7-11 7S1 12 1 12z" fill="#fff8e6" stroke="#2b1608" stroke-width="1.5"/><circle cx="12" cy="12" r="3.5" fill="#2b1608"/></svg>',
  };

  function renderHud(force) {
    var show = X.settings.hud && G.inLevel() && !G.isPaused() && !G.levelOver() && !(MP.ui && MP.ui.isLobbyOpen && MP.ui.isLobbyOpen());
    if (!show) {
      if (hud) hud.style.display = 'none';
      return;
    }
    if (!hud) {
      hud = el('div#pvzx-hud');
      hud.appendChild(hudButton('speed', ICON.speed + '<span></span>', t('hud_speed'), function () {
        play.cycleSpeed(1);
      }));
      hud.appendChild(hudButton('auto', ICON.auto, t('hud_auto'), function () {
        var on = !(X.settings.autoSun || X.settings.autoCoins || X.settings.autoFood);
        X.set('autoSun', on);
        X.set('autoCoins', on);
        X.set('autoFood', on);
      }));
      hud.appendChild(hudButton('hp', ICON.hp, t('hud_hp'), function () {
        X.toggle('hpZombies');
      }));
      hud.appendChild(hudButton('preview', ICON.eye, t('hud_preview'), function () {
        var visible = preview && preview.style.display !== 'none';
        previewOpen = !visible;
        previewManual = previewOpen;
        renderPreview(true);
      }));
      document.body.appendChild(hud);
    }
    var r = frameRect();
    var scale = r.height / 720;
    hud.style.display = 'flex';
    hud.style.left = r.left + 8 * scale + 'px';
    hud.style.top = r.top + r.height - 52 * scale + 'px';
    hud.style.setProperty('--x-s', String(Math.max(0.6, scale)));
    var s = X.settings;
    var off = X.online();
    var speedBtn = hud.querySelector('[data-k=speed]');
    speedBtn.querySelector('span').textContent = (s.speed === 0.5 ? '½' : s.speed) + 'x';
    speedBtn.classList.toggle('pvzx-on', s.speed !== 1 && !off);
    speedBtn.disabled = off;
    var autoBtn = hud.querySelector('[data-k=auto]');
    autoBtn.classList.toggle('pvzx-on', (s.autoSun || s.autoCoins || s.autoFood) && !off);
    autoBtn.disabled = off;
    hud.querySelector('[data-k=hp]').classList.toggle('pvzx-on', !!s.hpZombies);
    hud.querySelector('[data-k=preview]').classList.toggle('pvzx-on', !!(preview && preview.style.display !== 'none'));
    if (force) hud.querySelectorAll('button').forEach(function (b) {
      b.blur();
    });
  }

  play.cycleSpeed = function (dir) {
    var i = X.SPEEDS.indexOf(X.settings.speed);
    if (i < 0) i = 1;
    i = Math.max(0, Math.min(X.SPEEDS.length - 1, i + dir));
    if (dir > 0 && X.SPEEDS[i] === X.settings.speed) i = 0; // wrap from the top on click
    X.set('speed', X.SPEEDS[i]);
  };

  /* ----------------------------------------------------------- preview */

  var preview = null;
  var previewOpen = true;
  var previewManual = false; // opened with the shortcut bar during the level
  var previewKey = '';

  // Zombie types of the level: from the wave list (first wave each appears
  // in) and the dynamic pools.
  play.levelZombies = function (objects) {
    objects = objects || (G.lp() && G.lp().currentLevelObjects) || G.LP().levelData || [];
    var byAlias = {};
    objects.forEach(function (o) {
      (o.aliases || []).forEach(function (a) {
        byAlias[a] = o;
      });
    });
    var RT = /RTID\(([A-Za-z0-9_]+)@ZombieTypes\)/g;
    var first = {};
    var dynamic = {};
    var ld = objects.find(function (o) {
      return o.objclass === 'LevelDefinition';
    });
    var mods = (ld && ld.objdata && ld.objdata.Modules) || [];
    var wavesOn = mods.some(function (m) {
      var mm = /RTID\(([^@]+)@CurrentLevel\)/.exec(m);
      return mm && byAlias[mm[1]] && byAlias[mm[1]].objclass === 'WaveManagerModuleProperties';
    });
    if (!wavesOn) return { zombies: [], waves: 0, flags: 0, none: true };
    var wm = objects.find(function (o) {
      return o.objclass === 'WaveManagerProperties';
    });
    var waves = (wm && wm.objdata && wm.objdata.Waves) || [];
    var flagEvery = (wm && wm.objdata && wm.objdata.FlagWaveInterval) || 0;
    var waveCount = (wm && wm.objdata && wm.objdata.WaveCount) || waves.length;
    waves.forEach(function (list, i) {
      (list || []).forEach(function (ref) {
        var m = /RTID\(([^@]+)@CurrentLevel\)/.exec(ref);
        var o = m && byAlias[m[1]];
        if (!o) return;
        var s = JSON.stringify(o.objdata || {});
        var mm;
        RT.lastIndex = 0;
        while ((mm = RT.exec(s))) if (first[mm[1]] == null) first[mm[1]] = i + 1;
      });
    });
    objects.forEach(function (o) {
      if (o.objclass === 'WaveManagerModuleProperties') {
        var s = JSON.stringify((o.objdata && o.objdata.DynamicZombies) || []);
        var mm;
        RT.lastIndex = 0;
        while ((mm = RT.exec(s))) if (first[mm[1]] == null) dynamic[mm[1]] = true;
      } else if (/^(InitialZombieProperties|GravestoneProperties|ZombiePotionModuleProperties)$/.test(o.objclass)) {
        var s2 = JSON.stringify(o.objdata || {});
        var m2;
        RT.lastIndex = 0;
        while ((m2 = RT.exec(s2))) if (first[m2[1]] == null) first[m2[1]] = 0;
      }
    });
    var list = Object.keys(first)
      .map(function (k) {
        return { type: k, wave: first[k] };
      })
      .sort(function (a, b) {
        return a.wave - b.wave;
      })
      .concat(
        Object.keys(dynamic)
          .filter(function (k) {
            return first[k] == null;
          })
          .map(function (k) {
            return { type: k, wave: null };
          }),
      );
    return { zombies: list, waves: waveCount, flags: flagEvery ? Math.floor(waveCount / flagEvery) : 0 };
  };

  function renderPreview(force) {
    var show = X.settings.preview && previewOpen && G.inLevel() && (previewManual || G.seedChooserOpen() || !G.gameStarted()) && !G.isPaused() && !G.levelOver();
    if (!show) {
      if (preview) preview.style.display = 'none';
      if (!G.inLevel()) previewKey = '';
      return;
    }
    var info;
    try {
      info = play.levelZombies();
    } catch (e) {
      info = { zombies: [], waves: 0, flags: 0 };
    }
    if (info.none) {
      if (preview) preview.style.display = 'none';
      return;
    }
    if (MP.cards && !MP.cards.ready && !play._cardsAsked) {
      play._cardsAsked = true;
      MP.cards.load();
    }
    var key = MP.lang + '|' + (MP.cards && MP.cards.ready) + '|' + JSON.stringify(info);
    if (!preview) {
      preview = el('div#pvzx-preview');
      preview.addEventListener('mousedown', function (e) {
        e.stopPropagation();
      });
      preview.addEventListener('wheel', function (e) {
        e.stopPropagation();
      });
      document.body.appendChild(preview);
    }
    var r = frameRect();
    var scale = r.height / 720;
    preview.style.display = 'block';
    preview.style.left = r.left + 10 * scale + 'px';
    preview.style.top = r.top + 150 * scale + 'px';
    preview.style.maxHeight = 330 * scale + 'px';
    preview.style.width = 270 * scale + 'px';
    preview.style.fontSize = Math.max(11, 15 * scale) + 'px';
    if (!force && key === previewKey) return;
    previewKey = key;
    preview.innerHTML = '';
    preview.appendChild(
      el('div.pvzx-preview-head', null, [
        el('b', { text: t('preview_title') }),
        el('button.pvzx-x', { text: '×', title: t('close'), onclick: function () {
          previewOpen = false;
          previewManual = false;
          renderPreview();
          renderHud(true);
        } }),
      ]),
    );
    if (info.waves) {
      preview.appendChild(el('div.pvzx-preview-sub', { text: t('preview_waves', { n: info.waves }) + (info.flags ? ' · ' + t('preview_flags', { n: info.flags }) : '') }));
    }
    if (!info.zombies.length) {
      preview.appendChild(el('div.pvzx-preview-sub', { text: t('preview_unknown') }));
      return;
    }
    var grid = el('div.pvzx-preview-grid');
    info.zombies.forEach(function (z) {
      var art = MP.cards && MP.cards.zombie(z.type);
      grid.appendChild(
        el('div.pvzx-zchip' + (art ? '' : '.pvzx-noart'), { title: X.zombieName(z.type), 'data-type': z.type }, [
          el('img', { src: art || null, alt: '' }),
          el('span.pvzx-zname', { text: X.zombieName(z.type) }),
          el('span.pvzx-zwave', { text: z.wave == null ? t('preview_dynamic') : z.wave === 0 ? '★' : t('preview_from', { n: z.wave }) }),
        ]),
      );
    });
    preview.appendChild(grid);
  }

  /* ----------------------------------------------------------- summary */

  var summary = null;

  function topPlant(s) {
    var best = null;
    Object.keys(s.plantedByType).forEach(function (k) {
      if (!best || s.plantedByType[k] > s.plantedByType[best]) best = k;
    });
    return best;
  }

  function showSummary(s) {
    if (summary) summary.remove();
    var rows = [
      ['summary_time', X.formatTime(s.time)],
      ['summary_kills', s.kills],
      ['summary_sun', s.sun],
      ['summary_planted', s.planted],
      ['summary_lost', s.lost],
      ['summary_food', s.food],
      ['summary_mowers', s.mowersUsed],
    ];
    if (s.waveCount) rows.push(['summary_waves', s.wave + ' / ' + s.waveCount]);
    var tp = topPlant(s);
    if (tp) rows.push(['summary_top', X.plantName(tp) + ' ×' + s.plantedByType[tp]]);
    if (s.survived != null) rows.push(['summary_survived', s.survived]);
    else if (s.score != null) rows.push(['summary_score', t('points', { n: s.score })]);
    var card = el('div#pvzx-summary.pvzx-' + s.result, null, [
      el('button.pvzx-x', { text: '×', title: t('close'), onclick: function () {
        card.remove();
        summary = null;
      } }),
      el('div.pvzx-summary-title', { text: t(s.result === 'won' ? 'summary_title_won' : 'summary_title_lost') }),
      s.name ? el('div.pvzx-summary-sub', { text: s.name }) : null,
      el(
        'table',
        null,
        rows.map(function (r) {
          return el('tr', null, [el('td', { text: t(r[0]) }), el('td', { text: String(r[1]) })]);
        }),
      ),
      el('div.pvzx-summary-extra'),
    ]);
    card.addEventListener('mousedown', function (e) {
      e.stopPropagation();
    });
    document.body.appendChild(card);
    summary = card;
    X.emit('summary', s, card.querySelector('.pvzx-summary-extra'));
  }

  // Ends the level from a mode that decides the result itself (inverted).
  play.finish = function (result, opts) {
    if (!stats || stats.result) return;
    tracked.over = true;
    stats.result = result;
    stats.mowersUsed = 0;
    stats.endedAt = Date.now();
    X.emit('level-end', stats);
    if (X.settings.summary && !(opts && opts.noSummary)) setTimeout(showSummary, 1200, stats);
  };

  play.summaryNote = function (text, cls) {
    var box = summary && summary.querySelector('.pvzx-summary-extra');
    if (box) box.appendChild(el('div' + (cls ? '.' + cls : ''), { text: text }));
  };

  play.hideSummary = function () {
    if (summary) summary.remove();
    summary = null;
  };

  /* --------------------------------------------------------- keyboard */

  function onKey(e) {
    if (!G.inLevel() || e.ctrlKey || e.metaKey || e.altKey) return;
    var tag = (e.target && e.target.tagName) || '';
    if (/INPUT|TEXTAREA|SELECT/.test(tag)) return;
    if (e.key === '=' || e.key === '+') {
      play.cycleSpeed(1);
      if (X.settings.speed === X.SPEEDS[0]) X.set('speed', X.SPEEDS[X.SPEEDS.length - 1]);
    } else if (e.key === '-' || e.key === '_') {
      var i = X.SPEEDS.indexOf(X.settings.speed);
      X.set('speed', X.SPEEDS[Math.max(0, i - 1)]);
    } else if (e.key === 'v' || e.key === 'V') X.toggle('hpZombies');
    else return;
    renderHud(true);
  }

  /* -------------------------------------------------------------- init */

  function loop() {
    try {
      renderOverlay();
      renderHud(false);
      renderPreview(false);
    } catch (e) {
      MP.warn('extras overlay', e);
    }
    requestAnimationFrame(loop);
  }

  play.init = function () {
    installHooks();
    G.on('frame', onFrame);
    G.on('scene', function () {
      previewOpen = true;
      previewManual = false;
      previewKey = '';
      if (G.sceneName() !== 'inGameScene') play.hideSummary();
    });
    window.addEventListener('keydown', onKey, true);
    X.on('settings', function () {
      renderHud(true);
    });
    MP.bus.on('lang', function () {
      if (hud) {
        hud.remove();
        hud = null;
      }
      previewKey = '';
    });
    if (MP.cards) {
      MP.cards.on('art', function () {
        previewKey = '';
      });
      MP.cards.on('ready', function () {
        previewKey = '';
      });
    }
    requestAnimationFrame(loop);
  };

  play.modules = mods;
})();
