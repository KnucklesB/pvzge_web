/*
 * PvZ2 Gardendless - Multiplayer game bridge.
 *
 * Everything that touches the game's (compiled) internals lives here: module
 * lookup, coordinate conversion between the canvas and the game's UI/world
 * spaces, executing actions for the remote player (planting, shoveling, plant
 * food, sun collection, spawning zombies) and scene/level helpers.
 *
 * Every action for the second player goes through the same code paths the
 * game uses for its own mouse input, so sun costs, cooldowns, placement rules
 * and sounds behave exactly as in single player.
 */
(function () {
  'use strict';

  var MP = window.PvZMP;

  var MODULES = [
    'KeyListener',
    'levelController',
    'UI',
    'LnC',
    'Cards',
    'SunCount',
    'Square',
    'Mouse',
    'Zombies',
    'Plants',
    'SandBoxZombieCards',
    'dropping',
    'PlantFoodCount',
    'ShovelUIController',
    'SoundRescourses',
    'CharacterManager',
    'MultiLanguage',
    'PlayerProperties',
  ];

  var G = (MP.game = new MP.Emitter());
  G.ready = false;
  G.cc = null;
  G.m = {};

  /* ------------------------------------------------------------------- setup */

  function sleep(ms) {
    return new Promise(function (r) {
      setTimeout(r, ms);
    });
  }

  G.init = function () {
    if (G._initPromise) return G._initPromise;
    G._initPromise = (async function () {
      while (!window.System || typeof System.import !== 'function') await sleep(200);
      G.cc = await System.import('cc');
      var probe = 'chunks:///_virtual/KeyListener.ts';
      while (!(System.has && System.has(probe))) await sleep(250);
      for (var i = 0; i < MODULES.length; i++) {
        var name = MODULES[i];
        try {
          G.m[name] = await System.import('chunks:///_virtual/' + name + '.ts');
        } catch (e) {
          MP.warn('module not available:', name, e);
          G.m[name] = {};
        }
      }
      G.canvas = document.getElementById('GameCanvas');
      installHooks();
      var cc = G.cc;
      cc.director.on(cc.Director.EVENT_AFTER_SCENE_LAUNCH, function () {
        G.emit('scene', G.sceneName());
      });
      cc.director.on(cc.Director.EVENT_AFTER_UPDATE, function () {
        G.emit('frame', cc.game.deltaTime || 0);
      });
      G.ready = true;
      G.emit('ready');
      if (G.sceneName()) G.emit('scene', G.sceneName());
    })();
    return G._initPromise;
  };

  /* --------------------------------------------------------- module getters */

  G.KL = function () {
    return G.m.KeyListener.KeyListener;
  };
  G.LP = function () {
    return G.m.levelController.LevelPlay;
  };
  G.lp = function () {
    var LP = G.LP();
    return LP && LP.component;
  };
  G.ui = function () {
    var U = G.m.UI.UIInGame;
    return U && U.component;
  };
  G.Sq = function () {
    return G.m.Square.Square;
  };
  G.sounds = function () {
    return (G.m.SoundRescourses && G.m.SoundRescourses.sounds) || {};
  };
  G.play = function (name) {
    try {
      var s = G.sounds();
      if (typeof s[name] === 'function') s[name]();
    } catch (e) {
      /* sound is cosmetic */
    }
  };
  G.sbCards = function () {
    var SB = G.m.SandBoxZombieCards.SandBoxZombieCards;
    return SB && SB.component;
  };

  G.sceneName = function () {
    var s = G.cc && G.cc.director.getScene();
    return s ? s.name : '';
  };
  G.isValid = function (obj) {
    return !!(obj && obj.node && obj.node.isValid);
  };
  G.inLevel = function () {
    return G.ready && G.sceneName() === 'inGameScene' && G.isValid(G.ui()) && G.isValid(G.lp());
  };
  G.gameStarted = function () {
    return G.inLevel() && !!G.LP().gameStarted;
  };
  G.levelOver = function () {
    var lp = G.lp();
    return !lp || lp.gameLost || lp.gameWon;
  };
  G.isPaused = function () {
    var ui = G.ui();
    return !!(ui && ui.paused);
  };

  /* ------------------------------------------------------------ coordinates */
  // "norm" = [0..1] relative to the game canvas (top-left origin).
  // "ui"   = Cocos UI space (design resolution, bottom-left origin).
  // "world"= lawn space (ui + camera offset), as used by Mouse.position.

  function viewInfo() {
    var cc = G.cc;
    var c = G.canvas;
    return {
      w: c.width,
      h: c.height,
      vr: cc.view.getViewportRect(),
      sx: cc.view.getScaleX(),
      sy: cc.view.getScaleY(),
    };
  }

  G.normToUI = function (nx, ny) {
    var v = viewInfo();
    return {
      x: (nx * v.w - v.vr.x) / v.sx,
      y: (v.h - ny * v.h - v.vr.y) / v.sy,
    };
  };

  G.uiToNorm = function (x, y) {
    var v = viewInfo();
    return {
      x: (x * v.sx + v.vr.x) / v.w,
      y: 1 - (y * v.sy + v.vr.y) / v.h,
    };
  };

  // Rect in UI space (x,y = bottom-left) -> normalized rect (x,y = top-left).
  G.uiRectToNorm = function (r) {
    var a = G.uiToNorm(r.x, r.y + r.height);
    var b = G.uiToNorm(r.x + r.width, r.y);
    return { x: a.x, y: a.y, w: b.x - a.x, h: b.y - a.y };
  };

  G.nodeRectUI = function (node) {
    if (!node || !node.isValid || !node.activeInHierarchy) return null;
    var ut = node.getComponent(G.cc.UITransform);
    return ut ? ut.getBoundingBoxToWorld() : null;
  };

  G.nodeRectNorm = function (node) {
    var r = G.nodeRectUI(node);
    return r ? G.uiRectToNorm(r) : null;
  };

  G.rectHas = function (r, p) {
    return !!r && p.x >= r.x && p.x <= r.x + r.width && p.y >= r.y && p.y <= r.y + r.height;
  };

  // Same offset the game applies in Mouse.position.
  G.worldOffset = function () {
    var off = { x: 0, y: 0 };
    var lp = G.lp();
    if (lp && lp.node && lp.node.isValid && lp.node.active) {
      if (lp.uiPos) {
        off.x += lp.uiPos.x;
        off.y += lp.uiPos.y;
      }
      var cam = lp.LawnCameraProp;
      if (cam && cam.Offset) {
        off.x += cam.Offset.x;
        off.y += cam.Offset.y;
      }
    }
    return off;
  };

  G.uiToWorld = function (p) {
    var o = G.worldOffset();
    return { x: p.x + o.x, y: p.y + o.y };
  };

  // Lawn grid in normalized coordinates (top-left of row 0 / column 0).
  G.gridNorm = function () {
    if (!G.inLevel()) return null;
    var Sq = G.Sq();
    var rec = Sq.lawnRec;
    if (!rec) return null;
    var o = G.worldOffset();
    var left = rec.prjX().x - o.x;
    var top = rec.prjY().y - o.y;
    var a = G.uiToNorm(left, top);
    var b = G.uiToNorm(left + Sq.SquareWidth, top - Sq.SquareHeight);
    return {
      x: a.x,
      y: a.y,
      cw: b.x - a.x,
      ch: b.y - a.y,
      cols: Sq.ColumnCount || 9,
      rows: Sq.LaneCount || 5,
    };
  };

  G.cellAt = function (ui) {
    if (!G.inLevel()) return null;
    var Sq = G.Sq();
    var w = G.uiToWorld(ui);
    if (!Sq.lawnRec || !Sq.lawnRec.judgeInRecP(new G.cc.Vec2(w.x, w.y))) return null;
    var l = Sq.judgeLIndex(w.y);
    var c = Sq.judgeCIndex(w.x);
    if (l < 0 || l > 4 || c < 0 || c > 8) return null;
    return { l: l, c: c };
  };

  G.laneAt = function (ui) {
    if (!G.inLevel()) return -1;
    var Sq = G.Sq();
    var w = G.uiToWorld(ui);
    var rec = Sq.lawnRec;
    if (!rec) return -1;
    var top = rec.prjY().y;
    var bottom = rec.prjY().x;
    var left = rec.prjX().x;
    if (w.y > top || w.y < bottom || w.x < left) return -1;
    var l = Sq.judgeLIndex(w.y);
    return l >= 0 && l <= 4 ? l : -1;
  };

  /* ---------------------------------------------------------------- layout */

  G.plantCards = function () {
    var ui = G.ui();
    return (ui && ui.cards && ui.cards.CFs) || [];
  };

  G.shovelNode = function () {
    var S = G.m.ShovelUIController.ShovelUIController;
    var s = S && S.shovelUI;
    return s && s.uiTransform ? s.uiTransform.node : null;
  };

  G.foodNode = function () {
    var P = G.m.PlantFoodCount.PlantFoodCount;
    if (!P || !P.component || !P.component.shown) return null;
    return G.cc.find('Canvas/UIInGame/PlantFoodSlot/Button');
  };

  G.plantFoodCount = function () {
    var P = G.m.PlantFoodCount.PlantFoodCount;
    return (P && P.plantFoodNum) || 0;
  };

  G.layout = function () {
    if (!G.inLevel()) return null;
    var out = { cards: [], shovel: null, food: null, zcards: [], grid: G.gridNorm() };
    G.plantCards().forEach(function (cf, i) {
      out.cards[i] = cf && cf.node ? G.nodeRectNorm(cf.node) : null;
    });
    out.shovel = G.nodeRectNorm(G.shovelNode());
    out.food = G.nodeRectNorm(G.foodNode());
    var sb = G.sbCards();
    if (G.isValid(sb)) {
      sb.zombieCards.forEach(function (zc, i) {
        out.zcards[i] = G.nodeRectNorm(zc.node);
      });
    }
    return out;
  };

  G.hitPlantCard = function (ui) {
    var cards = G.plantCards();
    for (var i = 0; i < cards.length; i++) {
      var cf = cards[i];
      if (cf && cf.node && G.rectHas(G.nodeRectUI(cf.node), ui)) return i;
    }
    return -1;
  };

  G.hitNode = function (node, ui) {
    return G.rectHas(G.nodeRectUI(node), ui);
  };

  /* ------------------------------------------------- remote player (plants) */

  // Runs `fn` with the UI temporarily holding the remote player's selection,
  // then restores the host's own selection untouched.
  function withSelection(state, fn) {
    var ui = G.ui();
    var saved = { index: ui.index, currentCF: ui.currentCF, willCostSun: ui.willCostSun };
    var noop = function () {};
    ui.tryChangingIndex = noop;
    ui.plantInHand = noop;
    ui.index = state.index;
    ui.currentCF = state.currentCF || null;
    ui.willCostSun = state.willCostSun || 0;
    var after;
    try {
      fn();
    } finally {
      after = ui.index;
      delete ui.tryChangingIndex;
      delete ui.plantInHand;
      ui.index = saved.index;
      ui.currentCF = saved.currentCF;
      ui.willCostSun = saved.willCostSun;
    }
    return after;
  }

  G.canAct = function () {
    var ui = G.ui();
    var lp = G.lp();
    if (!G.inLevel() || !ui || !lp) return false;
    if (ui.paused || ui.indexLocked || lp.gameLost || lp.gameWon) return false;
    return !!(G.LP().gameStarted || lp.lastStandPrepareStarted);
  };

  G.cardSelectable = function (i) {
    var cf = G.plantCards()[i];
    return !!(cf && cf.ca && cf.ca.getSelectable());
  };

  G.p2PlacePlant = function (i, cell) {
    if (!G.canAct() || !cell) return false;
    var cf = G.plantCards()[i];
    if (!cf || !cf.ca || !cf.ca.getSelectable()) {
      G.play('playCardChooseFailed');
      return false;
    }
    var lnc = G.Sq().getLnC(cell.l, cell.c);
    if (!lnc || !lnc.isInLawn()) return false;
    var after = withSelection({ index: i, currentCF: cf, willCostSun: cf.SUNCOST }, function () {
      lnc.PlaceUIPlant();
    });
    return after === -1;
  };

  G.p2Shovel = function (cell) {
    if (!G.canAct() || !cell) return false;
    var lnc = G.Sq().getLnC(cell.l, cell.c);
    if (!lnc || !lnc.isInLawn()) return false;
    var after = withSelection({ index: -2 }, function () {
      lnc.removePlant();
    });
    return after === -1;
  };

  G.p2PlantFood = function (cell) {
    if (!G.LP().gameStarted || !cell || !G.canAct()) return false;
    if (G.plantFoodCount() <= 0) return false;
    var lnc = G.Sq().getLnC(cell.l, cell.c);
    if (!lnc || !lnc.isInLawn()) return false;
    var after = withSelection({ index: -3 }, function () {
      lnc.plantfood();
    });
    return after === -1;
  };

  // Pointer of the remote player in world space, used to collect sun etc.
  G.remotePointer = { active: false, world: null, line: null };

  G.setRemotePointer = function (ui) {
    var rp = G.remotePointer;
    if (!ui || !G.inLevel()) {
      rp.active = false;
      rp.world = null;
      rp.line = null;
      return;
    }
    var w = G.uiToWorld(ui);
    var cc = G.cc;
    var CM = G.m.CharacterManager;
    if (rp.world && CM.LineSegment) {
      var dir = new cc.Vec2(w.x - rp.world.x, w.y - rp.world.y);
      try {
        rp.line = CM.LineSegment.createLineLenDir(new cc.Vec2(rp.world.x, rp.world.y), dir.length(), dir);
      } catch (e) {
        rp.line = null;
      }
    }
    rp.world = new cc.Vec2(w.x, w.y);
    rp.active = true;
  };

  /* ------------------------------------------------------------------ hooks */

  G.hooks = {
    // When set, the host's own mouse/keyboard can't use seed packets,
    // the shovel or plant food (host plays the zombies in Versus).
    blockLocalPlantInput: false,
    // When set, the sandbox zombie bar is driven by the multiplayer code.
    managedZombieBar: false,
    // When set, the 1.5x speed toggle is disabled (Versus is timed).
    lockSpeed: false,
    // When set, the host's real mouse can't touch the canvas (the guest is
    // using the native seed chooser through injected events).
    remoteChooser: false,
  };

  /* ------------------------------------------------------ keep running */
  // Browsers stop requestAnimationFrame in background tabs and Cocos pauses
  // itself when the page is hidden. During online play the host (and every
  // player in Survival) must keep simulating and streaming, so while
  // keep-alive is on the engine's auto-pause is disabled and a worker timer
  // (not throttled like page timers) drives frames whenever rAF has stalled.

  var keep = { on: false, worker: null, lastRaf: performance.now() };
  (function watchRaf() {
    keep.lastRaf = performance.now();
    requestAnimationFrame(watchRaf);
  })();

  function onKeepTick() {
    var game = G.cc && G.cc.game;
    // Only for real background tabs: a visible page always has rAF, and
    // extra frames on a slow machine would just starve the main thread.
    if (!keep.on || !game || game.isPaused() || !document.hidden) return;
    if (performance.now() - keep.lastRaf < 250) return; // rAF is alive
    try {
      game._updateCallback();
    } catch (e) {
      MP.warn('background frame failed', e);
    }
  }

  G.setKeepAlive = function (on) {
    on = !!on;
    var game = G.cc && G.cc.game;
    if (!game || on === keep.on) return;
    keep.on = on;
    if (on) {
      game.pauseByEngine = function () {};
      if (game._pausedByEngine) game.resumeByEngine();
      if (!keep.worker && window.Worker && window.Blob) {
        try {
          var url = URL.createObjectURL(new Blob(['setInterval(function(){postMessage(0)},33);'], { type: 'text/javascript' }));
          keep.worker = new Worker(url);
          keep.worker.onmessage = onKeepTick;
        } catch (e) {
          MP.warn('background worker unavailable', e);
        }
      }
    } else {
      delete game.pauseByEngine; // back to the prototype's behaviour
      if (keep.worker) {
        keep.worker.terminate();
        keep.worker = null;
      }
      if (document.hidden) game.pauseByEngine();
    }
  };

  G.keepAliveOn = function () {
    return keep.on;
  };

  /* ----------------------------------------------------------- loading */
  // Scene/level transitions go through KeyListener's static helpers; count
  // them and the files fetched meanwhile to drive a loading bar.

  var load = { depth: 0, files: 0, since: 0 };
  G.loadingState = function () {
    if (!load.depth) return null;
    // No total is known up front: approach 95% as files keep arriving.
    var pct = Math.min(95, Math.round(100 * (1 - Math.exp(-load.files / 120))));
    return { pct: Math.max(3, pct), files: load.files, ms: Math.round(performance.now() - load.since) };
  };

  function wrapLoading(KL, name) {
    var orig = KL[name];
    if (typeof orig !== 'function' || orig._mpWrapped) return;
    var wrapped = function () {
      if (!load.depth++) {
        load.files = 0;
        load.since = performance.now();
        G.emit('loading', true);
      }
      var done = function () {
        if (load.depth > 0 && !--load.depth) G.emit('loading', false);
      };
      var r;
      try {
        r = orig.apply(this, arguments);
      } catch (e) {
        done();
        throw e;
      }
      if (r && typeof r.then === 'function') r.then(done, done);
      else done();
      return r;
    };
    wrapped._mpWrapped = true;
    KL[name] = wrapped;
  }

  function installLoadingHooks() {
    var KL = G.KL();
    if (!KL) return;
    ['goToLevel', 'GoToGame', 'GoToScene'].forEach(function (n) {
      wrapLoading(KL, n);
    });
    if (window.PerformanceObserver) {
      try {
        new PerformanceObserver(function (list) {
          if (load.depth) load.files += list.getEntries().length;
        }).observe({ type: 'resource', buffered: false });
      } catch (e) {}
    }
  }

  function installHooks() {
    var cc = G.cc;
    installLoadingHooks();

    // 0. Let the guest drive the native seed chooser: their clicks are replayed
    //    as synthetic DOM events, and the host's real mouse is held back.
    ['mousedown', 'mouseup', 'mousemove', 'wheel'].forEach(function (type) {
      window.addEventListener(
        type,
        function (e) {
          if (G.hooks.remoteChooser && e.isTrusted && e.target === G.canvas) e.stopImmediatePropagation();
        },
        true,
      );
    });

    // 1. Sun / coins / drops are collected by hovering them, as in the game.
    var Dropping = G.m.dropping.dropping;
    var Rect = G.m.CharacterManager.Rectangle;
    if (Dropping && Rect) {
      var origUpdate = Dropping.prototype.characterUpdate;
      Dropping.prototype.characterUpdate = function (dt) {
        origUpdate.call(this, dt);
        var rp = G.remotePointer;
        if (!rp.active || !rp.world) return;
        try {
          if (!this.node || !this.node.isValid) return;
          if (!this.mouseListen || !this.collectable() || !this.collectable_after()) return;
          var ut = this.node.getComponent(cc.UITransform);
          var size = ut.width * this.originalScale * this.dpScale;
          var rec = Rect.createRectangleNodeCenter(this.node, size, size);
          if (rec.judgeInRecP(rp.world) || (rp.line && rec.judgeCrossLine(rp.line))) this.collect();
        } catch (e) {
          /* never break the game loop */
        }
      };
    }

    // 2. Optional lock of the host's plant controls (Versus as zombies).
    var UIInGame = G.m.UI.UIInGame;
    if (UIInGame) {
      var origTry = UIInGame.prototype.tryChangingIndex;
      UIInGame.prototype.tryChangingIndex = function (idx) {
        if (G.hooks.blockLocalPlantInput && idx !== -1) return;
        return origTry.apply(this, arguments);
      };
      var origSpeed = UIInGame.prototype.speedUp;
      UIInGame.prototype.speedUp = function () {
        if (G.hooks.lockSpeed) return;
        return origSpeed.apply(this, arguments);
      };
    }

    // 3. The sandbox zombie packet bar is reused for Versus; when managed by
    //    us its own mouse/scroll handlers must not run.
    var SB = G.m.SandBoxZombieCards.SandBoxZombieCards;
    if (SB) {
      var origStart = SB.prototype.start;
      SB.prototype.start = function () {
        // Managed bars are configured by mountZombieBar and take no mouse input.
        if (!G.hooks.managedZombieBar) return origStart.apply(this, arguments);
      };
      var origScroll = SB.prototype.onMouseScroll;
      SB.prototype.onMouseScroll = function () {
        if (G.hooks.managedZombieBar) return;
        return origScroll.apply(this, arguments);
      };
    }

    // 4. Statistics: count plants placed by the local player.
    var LnC = G.m.LnC.LnC;
    if (LnC) {
      var origPlace = LnC.prototype.PlaceUIPlant;
      LnC.prototype.PlaceUIPlant = function () {
        var ui = G.ui();
        var before = ui ? ui.index : 0;
        var r = origPlace.apply(this, arguments);
        if (ui && !ui.hasOwnProperty('tryChangingIndex') && before >= 0 && ui.index === -1) {
          G.emit('local-planted');
        }
        return r;
      };
    }
  }

  /* ------------------------------------------------------- seed chooser */

  G.seedChooserOpen = function () {
    var lp = G.lp();
    try {
      return !!(lp && lp.isSeedChooserMode && lp.isSeedChooserMode());
    } catch (e) {
      return false;
    }
  };

  // Replays a pointer action at a normalized canvas position as real DOM
  // events, exactly where the engine listens for them.
  G.injectPointer = function (type, nx, ny, button, deltaY) {
    var c = G.canvas;
    if (!c) return;
    var r = c.getBoundingClientRect();
    var init = {
      bubbles: true,
      cancelable: true,
      view: window,
      clientX: r.left + nx * r.width,
      clientY: r.top + ny * r.height,
      button: button || 0,
      buttons: type === 'down' ? 1 : 0,
    };
    if (type === 'wheel') {
      init.deltaY = deltaY || 0;
      c.dispatchEvent(new WheelEvent('wheel', init));
      return;
    }
    var name = type === 'down' ? 'mousedown' : type === 'up' ? 'mouseup' : 'mousemove';
    if (type !== 'move') c.dispatchEvent(new MouseEvent('mousemove', init));
    c.dispatchEvent(new MouseEvent(name, init));
  };

  /* ---------------------------------------------------------- zombie side */

  G.spawnZombie = function (lane, type) {
    var Z = G.m.Zombies.zombies;
    if (!Z || !G.inLevel()) return Promise.resolve(null);
    return Z.spawnZombieFromLaneByType(lane, type).catch(function (e) {
      MP.warn('spawn failed', type, e);
      return null;
    });
  };

  G.zombieExists = function (type) {
    var E = G.m.Zombies.ZombieEnum;
    return !!E && E[type] !== undefined;
  };

  // Shows the game's own zombie packet bar (from the sandbox mode).
  G.mountZombieBar = function (types, costs) {
    var ui = G.ui();
    if (!ui || !ui.SBZombieCards || !ui.SBZombieCardsSlot) return null;
    G.hooks.managedZombieBar = true;
    var slot = ui.SBZombieCardsSlot;
    slot.removeAllChildren();
    var node = G.cc.instantiate(ui.SBZombieCards);
    node.parent = slot;
    if (!slot._mpRaised) {
      slot._mpRaised = true;
      slot.setPosition(slot.position.x, slot.position.y + 16, slot.position.z);
    }
    return new Promise(function (resolve) {
      var tries = 0;
      (function wait() {
        var sb = G.sbCards();
        if (G.isValid(sb) && sb.node === node && sb.zombieCards && sb.zombieCards.length) {
          sb.zombieCards.forEach(function (card, i) {
            var type = types[i];
            if (!type) {
              card.node.active = false;
              return;
            }
            card.cardGrouperByType(type, true);
            card.ca.suncostShown = true;
            // The sandbox prefab ships the price label with a ~0 width (it
            // never shows prices); give it the same box as the plant packets.
            var lbt = card.ca._priceLB.node.getComponent(G.cc.UITransform);
            if (lbt && lbt.width < 100) lbt.width = 240;
            card.ca._priceLB.string = String(costs[i]);
            card.ca.affordable = false;
            card.ca.cooling = false;
          });
          sb.index = -1;
          if (MP.cards) MP.cards.learnFrom(sb.zombieCards[0]);
          resolve(sb);
        } else if (++tries < 100) setTimeout(wait, 50);
        else resolve(null);
      })();
    });
  };

  G.hitZombieCard = function (ui) {
    var sb = G.sbCards();
    if (!G.isValid(sb)) return -1;
    for (var i = 0; i < sb.zombieCards.length; i++) {
      var c = sb.zombieCards[i];
      if (c.node.active && G.rectHas(G.nodeRectUI(c.node), ui)) return i;
    }
    return -1;
  };

  /* ------------------------------------------------------------ navigation */

  G.goToMain = function () {
    G.hooks.blockLocalPlantInput = false;
    G.hooks.managedZombieBar = false;
    G.hooks.lockSpeed = false;
    return G.KL().GoToMain();
  };

  G.goToWorldMap = function () {
    return G.KL().GoToWorldmap();
  };

  G.startCustomLevel = function (objects) {
    var LP = G.LP();
    LP.levelData = objects;
    LP.thisLevelsID = [];
    LP.nextLevelsID = [];
    return G.KL().GoToGame([objects]);
  };

  // Back to normal speed and hide the speed toggle for timed matches.
  G.lockGameSpeed = function () {
    var ui = G.ui();
    if (!ui) return;
    G.hooks.lockSpeed = false;
    try {
      if (G.m.UI.gamingSpeed !== 1) ui.speedUp(false);
      if (ui.s2xButton && ui.s2xButton.node) ui.s2xButton.node.active = false;
    } catch (e) {}
    G.hooks.lockSpeed = true;
  };

  G.freezeLevel = function () {
    var ui = G.ui();
    if (ui) {
      try {
        ui.tryChangingIndex(-1);
      } catch (e) {}
      ui.paused = true;
    }
  };

  // The game itself ships English and Chinese.
  G.gameLanguage = function () {
    var ML = G.m.MultiLanguage && G.m.MultiLanguage.MultiLanguage;
    return ML && ML.currentLanguage === 1 ? 'zh' : 'en';
  };

  G.localPlayerName = function () {
    try {
      var lab = G.cc.find('Canvas/PlayerSelectorButton/Label');
      var s = lab && lab.getComponent(G.cc.Label).string;
      if (s) return s.trim();
    } catch (e) {}
    return '';
  };
})();
