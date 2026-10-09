/*
 * PvZ2 Gardendless - Multiplayer application controller.
 *
 * Glues the network session, the lobby, the match controller and the
 * overlays together. The host runs the real game and streams it; the guest
 * watches the stream, sends its inputs and draws its local feedback (selected
 * packet ghost, hovered tile...) on top of the video.
 */
(function () {
  'use strict';

  var MP = window.PvZMP;
  var G = MP.game;
  var UI = MP.ui;
  var t = MP.t;

  var HUD_INTERVAL = 100;
  var LAYOUT_INTERVAL = 400;
  var POINTER_INTERVAL = 33;

  var App = (MP.app = {
    session: null,
    role: null,
    phase: 'idle', // idle | lobby | match
    settings: Object.assign({}, MP.DEFAULT_SETTINGS, MP.store.get('settings', {})),
    guestReady: false,
    lobbyError: null,
    match: null,
    // guest side
    hud: null,
    layout: null,
    localPtr: null,
    ghost: null,
    // host side
    remotePtr: null,
    localHostPtr: null,
    pendingJoinCode: null,
  });

  /* ================================================================ lobby */

  function playerName() {
    return MP.store.get('name', '') || G.localPlayerName() || 'Player';
  }

  App.lobbyState = function () {
    var s = this.session;
    if (!s) {
      return { view: 'home', name: playerName(), code: this.pendingJoinCode || MP.store.get('lastCode', ''), error: this.lobbyError };
    }
    if (!s.code || (this.role === 'guest' && !s.connected)) {
      return { view: 'busy', busyText: this.role === 'host' ? 'creating' : 'connecting' };
    }
    var players = [];
    var guestConnected = s.connected;
    if (this.role === 'host') {
      players.push({ name: s.localName, role: 'host', you: true });
      players.push(guestConnected ? { name: s.remoteName, role: 'guest', ready: this.guestReady } : null);
    } else {
      players.push({ name: s.remoteName, role: 'host' });
      players.push({ name: s.localName, role: 'guest', ready: this.guestReady, you: true });
    }
    var status = '';
    if (this.role === 'host') status = !guestConnected ? 'need_player' : !this.guestReady ? 'guest_must_ready' : '';
    else status = this.guestReady ? 'waiting_host' : '';
    return {
      view: 'room',
      role: this.role,
      code: s.code,
      players: players,
      settings: this.settings,
      ready: this.guestReady,
      canStart: this.role === 'host' && guestConnected && this.guestReady,
      status: status,
      error: this.lobbyError,
    };
  };

  App.openLobby = function () {
    if (!G.ready) return;
    MP.skin.build();
    if (G.sceneName() !== 'mainScene' && this.phase !== 'match') return;
    this.lobbyError = null;
    UI.openLobby(this.lobbyState());
  };

  App.refreshLobby = function () {
    if (UI.isLobbyOpen()) UI.renderLobby(this.lobbyState());
  };

  App.broadcastLobby = function () {
    if (this.role !== 'host' || !this.session) return;
    this.session.send({ t: 'lobby', settings: this.settings, guestReady: this.guestReady, phase: this.phase });
  };

  App.create = function (name) {
    if (!name) {
      this.lobbyError = 'err_name';
      return this.refreshLobby();
    }
    MP.store.set('name', name);
    this.lobbyError = null;
    this.role = 'host';
    this.phase = 'lobby';
    var s = (this.session = new MP.Session());
    bindSession(s);
    this.refreshLobby();
    var self = this;
    s.host(name).then(
      function () {
        if (self.session === s) self.refreshLobby();
      },
      function (err) {
        if (self.session !== s) return;
        self.teardown();
        self.lobbyError = MP.errorKey(err);
        self.refreshLobby();
      },
    );
  };

  App.join = function (code, name) {
    if (!name) {
      this.lobbyError = 'err_name';
      return this.refreshLobby();
    }
    code = (code || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
    if (code.length !== 5) {
      this.lobbyError = 'err_code';
      return this.refreshLobby();
    }
    MP.store.set('name', name);
    MP.store.set('lastCode', code);
    this.pendingJoinCode = null;
    this.lobbyError = null;
    this.role = 'guest';
    this.phase = 'lobby';
    this.guestReady = false;
    var s = (this.session = new MP.Session());
    bindSession(s);
    this.refreshLobby();
    var self = this;
    s.join(code, name).then(
      function (welcome) {
        if (self.session !== s) return;
        if (welcome.settings) self.settings = welcome.settings;
        self.refreshLobby();
        if (welcome.phase === 'match' && welcome.start) self.guestEnterMatch(welcome.start);
      },
      function (err) {
        if (self.session !== s) return;
        self.teardown();
        self.lobbyError = MP.errorKey(err);
        self.refreshLobby();
      },
    );
  };

  App.leave = function () {
    var wasGuestInMatch = this.role === 'guest' && this.phase === 'match';
    if (this.role === 'host' && this.match) this.endMatchCleanup();
    if (this.session) this.session.close(true);
    this.teardown();
    if (wasGuestInMatch) this.guestExitView();
    this.refreshLobby();
  };

  App.teardown = function () {
    if (this.match) {
      this.match.dispose();
      this.match = null;
    }
    this.session = null;
    this.role = null;
    this.phase = 'idle';
    this.guestReady = false;
    this.hud = null;
    this.layout = null;
    this.remotePtr = null;
    UI.renderBadge(null);
    UI.renderVersusHud(null);
    UI.renderStage(null);
  };

  App.setting = function (key, value) {
    if (this.role !== 'host') return;
    if (key === 'quality' && this.session) this.session.applyQuality(value, G.canvas);
    this.settings[key] = value;
    MP.store.set('settings', this.settings);
    this.broadcastLobby();
    this.refreshLobby();
  };

  App.ready = function (value) {
    if (this.role !== 'guest' || !this.session) return;
    this.guestReady = !!value;
    this.session.send({ t: 'ready', v: this.guestReady });
    this.refreshLobby();
  };

  App.copy = function (what, button) {
    if (!this.session) return;
    var text = this.session.code;
    if (what === 'link') {
      var u = new URL(location.href);
      u.search = '';
      u.hash = '';
      u.searchParams.set('mp_join', this.session.code);
      if (MP.params.get('mp_server')) u.searchParams.set('mp_server', MP.params.get('mp_server'));
      text = u.toString();
    }
    var done = function () {
      UI.flashCopied(button);
    };
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text).then(done, fallback);
    else fallback();
    function fallback() {
      var ta = document.createElement('textarea');
      ta.value = text;
      document.body.appendChild(ta);
      ta.select();
      try {
        document.execCommand('copy');
      } catch (e) {}
      ta.remove();
      done();
    }
  };

  App.closeLobby = function () {
    UI.closeLobby();
  };

  /* ============================================================ session */

  function bindSession(s) {
    s.on('peer-joined', function (p) {
      if (App.session !== s) return;
      App.guestReady = false;
      var payload = { settings: App.settings, phase: App.phase };
      if (App.phase === 'match' && App.match) payload.start = App.startPayload();
      s.welcome(payload);
      UI.toast(t('player_joined', { name: p.name }), 'good');
      G.play('playCardChosen');
      if (App.phase === 'match' && App.match) {
        // Rejoin in the middle of a match: resume streaming right away.
        App.startStream();
      }
      App.refreshLobby();
      App.updateBadge();
    });
    s.on('peer-left', function (p) {
      if (App.session !== s) return;
      if (App.role === 'host') {
        UI.toast(t('player_left', { name: p.name }), 'warn');
        App.guestReady = false;
        App.remotePtr = null;
        G.setRemotePointer(null);
        s.stopStream();
        // Versus can't go on alone: the remaining player wins by forfeit.
        if (App.match) App.match.forfeit();
        App.refreshLobby();
        App.updateBadge();
      } else {
        var inMatch = App.phase === 'match';
        App.session = null;
        try {
          s.close(true);
        } catch (e) {}
        App.teardown();
        if (inMatch) App.guestExitView();
        App.lobbyError = p.reason === 'bye' || p.reason === 'kicked' ? 'err_closed' : 'err_lost';
        UI.closeModal();
        UI.openLobby(App.lobbyState());
      }
    });
    s.on('rtt', function () {
      App.updateBadge();
    });
    s.on('stream', function (stream) {
      if (App.role === 'guest') UI.setViewStream(stream);
    });
    s.on('stream-ended', function () {
      if (App.role === 'guest' && App.phase === 'match') UI.setViewWaiting();
    });
    s.on('message', function (msg) {
      if (App.session !== s) return;
      if (App.role === 'host') App.onHostMessage(msg);
      else App.onGuestMessage(msg);
    });
  }

  /* ========================================================= host side */

  App.startPayload = function () {
    var seat = this.match ? this.match.guestSeat() : 'plants';
    return { settings: this.settings, seat: seat };
  };

  App.start = function () {
    if (this.role !== 'host' || !this.session || !this.session.connected || !this.guestReady) return;
    this.startMatch();
  };

  App.startMatch = function () {
    UI.closeModal();
    UI.closeLobby();
    if (this.match) this.match.dispose();
    this.phase = 'match';
    this.match = new MP.Match(this, this.settings);
    this.session.send(Object.assign({ t: 'start' }, this.startPayload()));
    this.startStream();
    this.match.start();
    this.updateBadge();
    if (this.settings.mode === 'coop') setTimeout(function () {
      UI.toast(t('coop_hint'), 'good', 4500);
    }, 1200);
  };

  App.startStream = function () {
    var s = this.session;
    if (!s || !s.connected) return;
    if (!s.call) s.startStream(G.canvas, this.settings.quality);
  };

  App.onHostMessage = function (msg) {
    var m = this.match;
    switch (msg.t) {
      case 'ready':
        this.guestReady = !!msg.v;
        if (this.guestReady) UI.toast(t('player_ready', { name: this.session.remoteName }), 'good');
        this.broadcastLobby();
        this.refreshLobby();
        break;
      case 'ptr':
        if (msg.x < 0) {
          this.remotePtr = null;
          G.setRemotePointer(null);
          break;
        }
        this.remotePtr = { x: msg.x, y: msg.y };
        if (m && G.ready) m.remotePointer(G.normToUI(msg.x, msg.y));
        break;
      case 'down':
        this.remotePtr = { x: msg.x, y: msg.y };
        if (m && G.ready) {
          var ui = G.normToUI(msg.x, msg.y);
          m.remotePointer(ui);
          m.remoteDown(ui, msg.b);
          this.sendHud(true);
        }
        break;
      case 'key':
        if (m) {
          m.remoteKey(String(msg.k || '').toLowerCase());
          this.sendHud(true);
        }
        break;
      case 'chat':
        UI.chatLine(this.session.remoteName, String(msg.text || '').slice(0, 120), 'var(--mp-p2)');
        break;
    }
  };

  App.sendHud = function (force) {
    if (!this.match || !this.session || !this.session.connected) return;
    var now = performance.now();
    if (!force && now - (this._hudAt || 0) < HUD_INTERVAL) return;
    this._hudAt = now;
    this.session.send(Object.assign({ t: 'hud' }, this.match.hud()));
    if (force || now - (this._layoutAt || 0) >= LAYOUT_INTERVAL) {
      this._layoutAt = now;
      this.session.send({ t: 'layout', layout: this.hostLayout() });
    }
  };

  App.toastBoth = function (key, vars, kind, perRole) {
    UI.toast(t(perRole ? perRole.host : key, vars), kind, 4000);
    if (this.session) this.session.send({ t: 'toast', key: perRole ? perRole.guest : key, vars: vars, kind: kind });
  };

  App.onMatchFinished = function (result) {
    if (this.role !== 'host' || !this.match) return;
    this.lastResult = result;
    if (this.session) this.session.send({ t: 'end', result: result, names: this.names() });
    this.showResults(result, 'host');
  };

  App.names = function () {
    var s = this.session;
    if (!s) return ['', ''];
    return this.role === 'host' ? [s.localName, s.remoteName] : [s.remoteName, s.localName];
  };

  App.showResults = function (result, role, names) {
    var d = MP.describeResult(result, role, names || this.names());
    var self = this;
    if (role === 'host') {
      d.actions = [
        { label: t('to_lobby'), cls: 'mp-red', fn: function () {
          self.returnToLobby();
        } },
        { label: t('rematch'), cls: 'mp-green', fn: function () {
          if (self.session && self.session.connected) self.startMatch();
          else self.returnToLobby();
        } },
      ];
    } else {
      d.actions = [{ label: t('leave'), cls: 'mp-red', fn: function () {
        self.leave();
      } }];
      d.waitText = t('waiting_host');
    }
    G.play(d.win ? 'playPlantNodeUnlock' : 'playLevelTaskWarn');
    UI.showResults(d);
  };

  App.onHostLeftLevel = function () {
    if (this.role === 'host' && this.match) this.returnToLobby();
  };

  App.endMatchCleanup = function () {
    if (this.match) {
      this.match.dispose();
      this.match = null;
    }
    if (this.session) this.session.stopStream();
    UI.renderVersusHud(null);
    UI.renderStage(null);
  };

  App.returnToLobby = function () {
    if (this.role !== 'host') return;
    this.endMatchCleanup();
    this.phase = 'lobby';
    this.guestReady = false;
    if (this.session) this.session.send({ t: 'lobby-return' });
    this.broadcastLobby();
    UI.closeModal();
    var self = this;
    var go = G.sceneName() === 'mainScene' ? Promise.resolve() : G.goToMain();
    Promise.resolve(go).then(function () {
      setTimeout(function () {
        if (self.session) self.openLobby();
      }, 300);
    });
    this.updateBadge();
  };

  /* ======================================================== guest side */

  App.onGuestMessage = function (msg) {
    switch (msg.t) {
      case 'lobby':
        if (msg.settings) this.settings = msg.settings;
        if (msg.guestReady != null) this.guestReady = msg.guestReady;
        this.refreshLobby();
        break;
      case 'start':
        this.guestEnterMatch(msg);
        break;
      case 'hud':
        this.hud = msg;
        this.updateGhost();
        this.updateBadge();
        break;
      case 'layout':
        this.layout = msg.layout;
        break;
      case 'end':
        this.showResults(msg.result, 'guest', msg.names);
        break;
      case 'lobby-return':
        this.guestExitView();
        this.phase = 'lobby';
        this.guestReady = false;
        UI.closeModal();
        this.openLobby();
        break;
      case 'chat':
        UI.chatLine(this.session.remoteName, String(msg.text || '').slice(0, 120), 'var(--mp-p1)');
        break;
      case 'toast':
        UI.toast(t(msg.key, msg.vars), msg.kind, 4000);
        break;
    }
  };

  App.guestEnterMatch = function (msg) {
    if (msg.settings) this.settings = msg.settings;
    this.seat = msg.seat || 'plants';
    this.phase = 'match';
    this.hud = null;
    this.layout = null;
    this.ghost = null;
    UI.closeModal();
    UI.closeLobby();
    UI.showView();
    MP.audio.setLocalMuted(true);
    try {
      if (G.cc && !G.cc.game.isPaused()) G.cc.game.pause();
    } catch (e) {}
    this.updateBadge();
  };

  App.guestExitView = function () {
    UI.hideView();
    UI.renderVersusHud(null);
    UI.renderStage(null);
    MP.audio.setLocalMuted(false);
    try {
      if (G.cc && G.cc.game.isPaused()) G.cc.game.resume();
    } catch (e) {}
    this.hud = null;
    this.layout = null;
    this.ghost = null;
    this.updateBadge();
  };

  App.viewPointer = function (type, x, y, button) {
    if (this.role !== 'guest' || !this.session) return;
    if (type === 'leave') {
      this.localPtr = null;
      this.session.send({ t: 'ptr', x: -1, y: -1 });
      return;
    }
    this.localPtr = { x: x, y: y };
    if (x < 0 || x > 1 || y < 0 || y > 1) return;
    if (type === 'down') {
      this.session.send({ t: 'down', x: x, y: y, b: button });
    } else {
      var now = performance.now();
      if (now - (this._ptrAt || 0) < POINTER_INTERVAL) return;
      this._ptrAt = now;
      this.session.send({ t: 'ptr', x: x, y: y });
    }
  };

  // Crop the selected packet from the video frame to use as a cursor ghost.
  App.updateGhost = function () {
    var h = this.hud;
    var sel = h && h.sel;
    var key = sel ? sel.kind + ':' + sel.i : '';
    if (key === (this.ghost && this.ghost.key)) return;
    if (!sel || !this.layout) {
      this.ghost = null;
      return;
    }
    var r = sel.kind === 'card' ? this.layout.cards[sel.i] : sel.kind === 'zcard' ? this.layout.zcards[sel.i] : sel.kind === 'shovel' ? this.layout.shovel : sel.kind === 'food' ? this.layout.food : null;
    var video = UI.viewVideo();
    if (!r || !video || !video.videoWidth) {
      this.ghost = null;
      return;
    }
    try {
      var c = document.createElement('canvas');
      var sw = r.w * video.videoWidth;
      var sh = r.h * video.videoHeight;
      c.width = Math.max(1, Math.round(sw));
      c.height = Math.max(1, Math.round(sh));
      c.getContext('2d').drawImage(video, r.x * video.videoWidth, r.y * video.videoHeight, sw, sh, 0, 0, c.width, c.height);
      this.ghost = { key: key, src: c.toDataURL('image/png'), w: r.w * 0.8 };
    } catch (e) {
      this.ghost = null;
    }
  };

  /* ============================================================ overlays */

  var HELD = { card: '🌱', shovel: '⛏', food: '⚡', zcard: '🧠' };

  App.frameRect = function () {
    if (this.role === 'guest') return UI.viewContentRect();
    var r = G.canvas && G.canvas.getBoundingClientRect();
    return r ? { left: r.left, top: r.top, width: r.width, height: r.height } : null;
  };

  App.renderOverlays = function () {
    if (!this.session || this.phase !== 'match') {
      UI.renderStage(null);
      UI.renderVersusHud(null);
      return;
    }
    var frame = this.frameRect();
    if (!frame) {
      UI.renderStage(null);
      return;
    }
    var scene = { frame: frame, cells: [], lanes: [], cd: null };
    var hud;
    if (this.role === 'host') {
      hud = this.match ? this.match.hud() : null;
      scene.layout = this.hostLayout();
      if (this.remotePtr && this.session.connected) {
        scene.cursor = { x: this.remotePtr.x, y: this.remotePtr.y, name: this.session.remoteName, held: hud && hud.sel ? HELD[hud.sel.kind] : '' };
      }
      if (hud) {
        if (hud.sel && hud.seat === 'plants') scene.sel = { kind: hud.sel.kind, i: hud.sel.i, tag: t('p2_label') };
        if (hud.cell) scene.cells.push({ l: hud.cell.l, c: hud.cell.c, kind: hud.sel && hud.sel.kind });
        if (hud.lane >= 0) scene.lanes.push({ l: hud.lane });
        if (hud.hostLane >= 0) scene.lanes.push({ l: hud.hostLane, local: true });
      }
    } else {
      hud = this.hud;
      scene.layout = this.layout;
      var lp = this.localPtr;
      if (hud && hud.sel && lp && this.layout) {
        if (hud.seat === 'plants') {
          var g = this.layout.grid;
          if (g) {
            var c = Math.floor((lp.x - g.x) / g.cw);
            var l = Math.floor((lp.y - g.y) / g.ch);
            if (c >= 0 && c < g.cols && l >= 0 && l < g.rows) scene.cells.push({ l: l, c: c, kind: hud.sel.kind, local: true });
          }
          scene.sel = { kind: hud.sel.kind, i: hud.sel.i, tag: t('you') };
        } else if (this.layout.grid) {
          var gz = this.layout.grid;
          var lane = Math.floor((lp.y - gz.y) / gz.ch);
          if (lp.x >= gz.x && lane >= 0 && lane < gz.rows) scene.lanes.push({ l: lane, local: true });
        }
        if (this.ghost) scene.ghost = { src: this.ghost.src, x: lp.x, y: lp.y, w: this.ghost.w };
      }
    }
    if (hud && hud.cd) scene.cd = hud.cd;
    UI.renderStage(scene);

    if (hud && hud.mode === 'versus' && hud.phase === 'playing') {
      var lay = scene.layout;
      var barTop = null;
      if (lay && lay.zcards && lay.zcards[0]) barTop = lay.zcards[0].y;
      var timerTop = null;
      ((lay && lay.cards) || []).forEach(function (r) {
        if (r) timerTop = Math.max(timerTop || 0, r.y + r.h + 0.012);
      });
      var mySide = this.role === 'host' ? this.settings.hostSide : hud.seat;
      UI.renderVersusHud(frame, {
        brains: hud.brains || 0,
        timeLeft: hud.timeLeft || 0,
        barTop: barTop,
        timerTop: timerTop,
        goal: hud.phase === 'playing' ? (mySide === 'zombies' ? t('pick_zombie') : '') : '',
      });
    } else {
      UI.renderVersusHud(null);
    }
  };

  // Packet/grid rectangles only move with camera pans and window resizes.
  App.hostLayout = function () {
    var now = performance.now();
    if (!this._layoutCache || now - this._layoutCache.at > 120) {
      this._layoutCache = { at: now, value: G.inLevel() ? G.layout() : null };
    }
    return this._layoutCache.value;
  };

  App.updateBadge = function () {
    var s = this.session;
    if (!s || this.phase !== 'match') {
      UI.renderBadge(null);
      return;
    }
    var self = this;
    var names = this.names();
    var players = [
      { name: names[0], color: 'var(--mp-p1)', ping: this.role === 'guest' ? s.rtt : null },
      { name: names[1] + (s.connected ? '' : ' …'), color: 'var(--mp-p2)', ping: this.role === 'host' && s.connected ? s.rtt : null },
    ];
    var hud = this.role === 'host' ? this.match && this.match.hud() : this.hud;
    var line = '';
    if (hud && hud.mode === 'survival' && hud.wave > 0) line = t('wave_of', { n: hud.wave, total: hud.waveTotal });
    var action =
      this.role === 'host'
        ? { label: t('end_session'), fn: function () {
            self.returnToLobby();
          } }
        : { label: t('leave'), fn: function () {
            if (window.confirm(t('quit_confirm'))) self.leave();
          } };
    UI.renderBadge({ mode: this.settings.mode, players: players, line: line, action: action });
  };

  /* ========================================================= main menu */

  function findSpriteFrame(name) {
    var found = null;
    G.cc.assetManager.assets.forEach(function (a) {
      if (!found && a instanceof G.cc.SpriteFrame && a.name === name) found = a;
    });
    return found;
  }

  App.injectMenuButton = function () {
    var cc = G.cc;
    var canvas = cc.find('Canvas');
    var play = canvas && canvas.getChildByName('PlayButton');
    if (!play || canvas.getChildByName('MultiplayerButton')) return;
    var btn = cc.instantiate(play);
    btn.name = 'MultiplayerButton';
    btn.parent = canvas;
    btn.setSiblingIndex(play.getSiblingIndex() + 1);
    var button = btn.getComponent(cc.Button);
    if (button) {
      button.clickEvents = [];
      var up = findSpriteFrame('BtnGreenBigUp');
      var down = findSpriteFrame('BtnGreenBigDown');
      if (up) {
        btn.getComponent(cc.Sprite).spriteFrame = up;
        button.normalSprite = up;
        button.hoverSprite = up;
        button.pressedSprite = down || up;
        button.disabledSprite = up;
      }
    }
    var label = btn.getChildByName('Label');
    if (label) {
      label.getComponent(cc.Label).string = t('multiplayer');
      App.menuLabel = label.getComponent(cc.Label);
    }
    // Play and Multiplayer side by side, centred where Play used to be. The
    // buttons' Layout components resize them to their labels, so re-centre
    // whenever either size changes.
    var x0 = play.position.x;
    var y = play.position.y;
    function relayout() {
      if (!btn.isValid || !play.isValid) return;
      var gap = 22;
      var pw = play.getComponent(cc.UITransform).width * play.scale.x;
      var bw = btn.getComponent(cc.UITransform).width * btn.scale.x;
      var left = x0 - (pw + gap + bw) / 2;
      play.setPosition(left + pw / 2, y, 0);
      btn.setPosition(left + pw + gap + bw / 2, y, 0);
    }
    btn.on(cc.Node.EventType.SIZE_CHANGED, relayout);
    play.on(cc.Node.EventType.SIZE_CHANGED, relayout);
    relayout();
    setTimeout(relayout, 100);
    btn.on(cc.Button.EventType.CLICK, function () {
      App.openLobby();
    });
    // Reuse the game's own click sounds on the HTML buttons.
    var bws = play.getComponents(cc.Component).find(function (c) {
      return c.touchStartSound !== undefined;
    });
    if (bws) MP.buttonSounds = { press: bws.touchStartSound, release: bws.touchEndSound };
  };

  function playButtonSound(which) {
    var snd = MP.buttonSounds && MP.buttonSounds[which];
    var sounds = G.sounds();
    if (snd && sounds && typeof sounds.playOneShot === 'function') {
      try {
        sounds.playOneShot(snd, 1, 0);
      } catch (e) {}
    }
  }

  /* ============================================================ wiring */

  App.setLang = function (code) {
    MP.setLang(code, true);
  };

  function onLang() {
    if (App.menuLabel && App.menuLabel.isValid) App.menuLabel.string = t('multiplayer');
    if (UI.isLobbyOpen()) UI.rebuildLobby(App.lobbyState());
    UI.renderBadge(null);
    App.updateBadge();
  }

  // Without an explicit choice, follow the game's language setting.
  function followGameLanguage() {
    if (!MP.langChosen && G.gameLanguage() !== MP.lang) MP.setLang(G.gameLanguage(), false);
  }

  function onScene(name) {
    followGameLanguage();
    if (name === 'mainScene') {
      MP.skin.build();
      App.injectMenuButton();
      if (App.pendingJoinCode && !App.session) {
        setTimeout(function () {
          App.openLobby();
        }, 600);
      } else if (App.session && App.role === 'host' && App.phase === 'lobby' && !UI.isLobbyOpen()) {
        setTimeout(function () {
          App.openLobby();
        }, 300);
      }
    }
    if (App.role === 'host' && App.match) App.sendHud(true);
  }

  function onFrame(dt) {
    if (App.role === 'host' && App.match) {
      App.match.frame(dt);
      App.sendHud(false);
    }
  }

  function loop() {
    try {
      App.renderOverlays();
    } catch (e) {
      MP.warn('overlay error', e);
    }
    requestAnimationFrame(loop);
  }

  // Host: when playing the zombies, the mouse drives the zombie packets.
  function hostPointer(e, type) {
    if (App.role !== 'host' || !App.match || !App.match.localZombies() || !G.inLevel()) return;
    var r = G.canvas.getBoundingClientRect();
    var ui = G.normToUI((e.clientX - r.left) / r.width, (e.clientY - r.top) / r.height);
    if (type === 'down') App.match.localDown(ui, e.button);
    else App.match.localPointer(ui);
  }

  function keyName(e) {
    var k = e.key || '';
    if (k === 'Escape') return 'escape';
    return k.length === 1 ? k.toLowerCase() : '';
  }

  function onKeyDown(e) {
    if (!App.session || App.phase !== 'match') return;
    var target = e.target;
    if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA')) return;
    if (e.key === 'Enter') {
      UI.openChat();
      e.preventDefault();
      e.stopImmediatePropagation();
      return;
    }
    var k = keyName(e);
    if (App.role === 'guest') {
      if (k) App.session.send({ t: 'key', k: k });
      e.stopImmediatePropagation();
    } else if (App.match && k && App.match.localKey(k)) {
      e.stopImmediatePropagation();
    }
  }

  App.chat = function (text) {
    if (!this.session) return;
    this.session.send({ t: 'chat', text: text });
    UI.chatLine(this.session.localName, text, this.role === 'host' ? 'var(--mp-p1)' : 'var(--mp-p2)');
  };

  App.init = function () {
    UI.mount();
    UI.setHandlers({
      closeLobby: function () {
        App.closeLobby();
      },
      create: function (name) {
        App.create(name);
      },
      join: function (code, name) {
        App.join(code, name);
      },
      leave: function () {
        App.leave();
      },
      setting: function (k, v) {
        App.setting(k, v);
      },
      ready: function (v) {
        App.ready(v);
      },
      start: function () {
        App.start();
      },
      copy: function (what, btn) {
        App.copy(what, btn);
      },
      viewPointer: function (type, x, y, b) {
        App.viewPointer(type, x, y, b);
      },
      chat: function (text) {
        App.chat(text);
      },
      lang: function (code) {
        App.setLang(code);
      },
    });
    MP.bus.on('lang', onLang);
    var join = MP.params.get('mp_join');
    if (join) App.pendingJoinCode = join.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 5);

    document.addEventListener('pointerdown', function (e) {
      if (e.target && e.target.closest && e.target.closest('.mp-btn')) playButtonSound('press');
    });
    document.addEventListener('pointerup', function (e) {
      if (e.target && e.target.closest && e.target.closest('.mp-btn')) playButtonSound('release');
    });
    window.addEventListener('keydown', onKeyDown, true);
    window.addEventListener('beforeunload', function () {
      if (App.session) App.session.close(true);
    });

    G.init().then(function () {
      G.canvas.addEventListener('pointerdown', function (e) {
        hostPointer(e, 'down');
      }, true);
      G.canvas.addEventListener('pointermove', function (e) {
        hostPointer(e, 'move');
      }, true);
      G.on('scene', onScene);
      G.on('frame', onFrame);
      requestAnimationFrame(loop);
    });
  };
})();
