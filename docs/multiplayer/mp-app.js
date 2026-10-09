/*
 * PvZ2 Gardendless - Multiplayer application controller.
 *
 * Glues the network session, the lobby (with the online tabs: public rooms,
 * match history and account), the match controllers and the overlays.
 *
 *  - Co-op / Versus share one lawn: the host runs the real game and streams
 *    it; the guest watches the stream, sends inputs and draws local feedback.
 *  - Survival gives each player their own lawn: both run the level locally
 *    and stream it to the other, shown as a picture-in-picture.
 */
(function () {
  'use strict';

  var MP = window.PvZMP;
  var G = MP.game;
  var UI = MP.ui;
  var api = MP.api;
  var t = MP.t;

  var HUD_INTERVAL = 100;
  var LAYOUT_INTERVAL = 400;
  var POINTER_INTERVAL = 33;
  var PUBLISH_INTERVAL = 15000;
  var ROOMS_REFRESH = 6000;

  var App = (MP.app = {
    session: null,
    role: null,
    phase: 'idle', // idle | lobby | match
    settings: MP.normalizeSettings(MP.store.get('settings', {})),
    guestReady: false,
    lobbyError: null,
    match: null,
    // lobby tabs
    tab: 'play',
    rooms: { list: [], loading: false, error: null, at: 0 },
    history: { list: [], loading: false, error: null, mine: false },
    account: { mode: 'login', error: null, busy: false, notice: null },
    // guest side
    hud: null,
    layout: null,
    localPtr: null,
    ghost: null,
    guestRun: null,
    // host side
    remotePtr: null,
    roomKey: null,
    pendingJoinCode: null,
  });

  /* ================================================================ lobby */

  function playerName() {
    var u = api.user();
    if (u) return u.username;
    return MP.store.get('name', '') || G.localPlayerName() || 'Player';
  }

  // Which side the local player controls in Versus.
  App.mySide = function () {
    if (this.settings.mode !== 'versus') return 'plants';
    var hs = this.settings.hostSide;
    return this.role === 'host' ? hs : hs === 'plants' ? 'zombies' : 'plants';
  };

  App.lobbyState = function () {
    var s = this.session;
    if (!s) {
      return {
        view: 'home',
        tab: this.tab,
        name: playerName(),
        nameLocked: !!api.user(),
        code: this.pendingJoinCode || MP.store.get('lastCode', ''),
        error: this.lobbyError,
        online: api.available(),
        user: api.user(),
        rooms: this.rooms,
        history: this.history,
        account: this.account,
        cloud: { status: MP.cloud.status, lastSync: MP.cloud.lastSync, conflict: !!MP.cloud.conflict },
      };
    }
    if (!s.code || (this.role === 'guest' && !s.connected)) {
      return { view: 'busy', busyText: this.role === 'host' ? 'creating' : 'connecting' };
    }
    var players = [];
    var guestConnected = s.connected;
    if (this.role === 'host') {
      players.push({ name: s.localName, role: 'host', you: true, account: !!api.user() });
      players.push(guestConnected ? { name: s.remoteName, role: 'guest', ready: this.guestReady, account: !!(s.remoteInfo && s.remoteInfo.ticket) } : null);
    } else {
      players.push({ name: s.remoteName, role: 'host' });
      players.push({ name: s.localName, role: 'guest', ready: this.guestReady, you: true, account: !!api.user() });
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
      canEditDeck: this.settings.mode === 'versus' && this.mySide() === 'zombies',
      online: api.available(),
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
    this.onTabShown();
    if (!MP.cards.ready) {
      var self = this;
      MP.cards.load().then(function (ok) {
        if (ok) UI.refreshZombieArt();
      });
    }
  };

  App.refreshLobby = function () {
    if (UI.isLobbyOpen()) UI.renderLobby(this.lobbyState());
    this.syncZombieChooser();
  };

  /* zombie packet chooser (Versus, zombie player) */

  App.canEditDeck = function () {
    return !!this.session && this.phase === 'lobby' && this.settings.mode === 'versus' && this.mySide() === 'zombies';
  };

  App.openZombieChooser = function () {
    if (!this.canEditDeck()) return;
    this._chooserKey = this.settings.stage + '|' + this.settings.zombiePool;
    UI.openZombieChooser({ deck: this.settings.zdeck, choices: MP.zombieChoices(this.settings.stage, this.settings.zombiePool) });
  };

  App.syncZombieChooser = function () {
    if (!UI.isZombieChooserOpen()) return;
    if (!this.canEditDeck()) return UI.closeZombieChooser();
    if (this._chooserKey !== this.settings.stage + '|' + this.settings.zombiePool) return this.openZombieChooser();
    UI.updateZombieChooser(this.settings.zdeck);
  };

  App.rebuildLobby = function () {
    if (UI.isLobbyOpen()) UI.rebuildLobby(this.lobbyState());
  };

  App.broadcastLobby = function () {
    if (this.role !== 'host' || !this.session) return;
    this.session.send({ t: 'lobby', settings: this.settings, guestReady: this.guestReady, phase: this.phase });
    this.publishRoom();
  };

  App.setTab = function (tab) {
    this.tab = tab;
    this.lobbyError = null;
    this.rebuildLobby();
    this.onTabShown();
  };

  App.onTabShown = function () {
    if (this.session || !UI.isLobbyOpen()) return;
    if (this.tab === 'rooms') this.loadRooms();
    else if (this.tab === 'history') this.loadHistory();
    else if (this.tab === 'account' && api.loggedIn()) api.refreshMe().then(this.rebuildLobby.bind(this), function () {});
  };

  App.create = function (name) {
    if (!name) {
      this.lobbyError = 'err_name';
      return this.refreshLobby();
    }
    if (!api.user()) MP.store.set('name', name);
    this.lobbyError = null;
    this.role = 'host';
    this.phase = 'lobby';
    this.guestReady = false;
    this.roomKey = MP.util.randomCode(24);
    var s = (this.session = new MP.Session());
    G.setKeepAlive(true);
    bindSession(s);
    this.refreshLobby();
    var self = this;
    s.host(name).then(
      function () {
        if (self.session !== s) return;
        self.refreshLobby();
        self.publishRoom();
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
    if (!api.user()) MP.store.set('name', name);
    MP.store.set('lastCode', code);
    this.pendingJoinCode = null;
    this.lobbyError = null;
    this.role = 'guest';
    this.phase = 'lobby';
    this.guestReady = false;
    var s = (this.session = new MP.Session());
    G.setKeepAlive(true);
    bindSession(s);
    this.refreshLobby();
    var self = this;
    var user = api.user();
    api
      .ticket()
      .then(function (ticket) {
        return s.join(code, name, user ? { account: user.username, ticket: ticket } : null);
      })
      .then(
        function (welcome) {
          if (self.session !== s) return;
          if (welcome.settings) self.settings = MP.normalizeSettings(welcome.settings);
          if (welcome.guestReady != null) self.guestReady = !!welcome.guestReady;
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
    if (this.role === 'host') {
      if (this.match) this.endMatchCleanup();
      this.unpublishRoom();
    }
    if (this.session) this.session.close(true);
    this.teardown();
    if (wasGuestInMatch) this.guestExitMatch();
    UI.closeModal();
    if (G.sceneName() === 'mainScene') this.openLobby();
    else if (G.sceneName() === 'inGameScene') G.goToMain();
  };

  App.teardown = function () {
    G.setKeepAlive(false);
    UI.closeZombieChooser();
    UI.renderLoading(null);
    if (this.match) {
      this.match.dispose();
      this.match = null;
    }
    this.disposeGuestRun();
    this.session = null;
    this.role = null;
    this.phase = 'idle';
    this.guestReady = false;
    this.hud = null;
    this.layout = null;
    this.remotePtr = null;
    this.roomKey = null;
    UI.hidePip();
    UI.renderBadge(null);
    UI.renderVersusHud(null);
    UI.renderStage(null);
  };

  App.setting = function (key, value) {
    if (this.role !== 'host') return;
    if (key === 'quality' && this.session) this.session.applyQuality(value, G.canvas);
    this.settings[key] = value;
    if (key === 'stage') this.settings.zdeck = MP.defaultDeck(value);
    this.settings = MP.normalizeSettings(this.settings);
    MP.store.set('settings', this.settings);
    this.broadcastLobby();
    this.refreshLobby();
  };

  // The zombie player picks their deck in the lobby.
  App.setDeck = function (deck) {
    if (this.settings.mode !== 'versus' || this.mySide() !== 'zombies') return;
    deck = MP.validDeck(this.settings.stage, deck, this.settings.zombiePool);
    if (this.role === 'host') {
      this.settings.zdeck = deck;
      MP.store.set('settings', this.settings);
      this.broadcastLobby();
    } else if (this.session) {
      this.settings.zdeck = deck;
      this.session.send({ t: 'zdeck', deck: deck });
    }
    this.refreshLobby();
  };

  App.toggleDeckZombie = function (type) {
    var deck = (this.settings.zdeck || []).slice();
    var i = deck.indexOf(type);
    if (i >= 0) {
      if (deck.length <= 1) return;
      deck.splice(i, 1);
    } else {
      if (deck.length >= MP.DECK_SIZE) {
        UI.toast(t('deck_full', { n: MP.DECK_SIZE }), 'warn');
        return;
      }
      deck.push(type);
    }
    this.setDeck(deck);
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

  /* ===================================================== online features */

  App.loadRooms = function (silent) {
    var self = this;
    if (!api.available() || this.rooms.loading) return;
    this.rooms.loading = !silent;
    this.rooms.error = null;
    if (!silent) this.refreshLobby();
    api
      .rooms()
      .then(
        function (list) {
          self.rooms.list = list;
          self.rooms.at = Date.now();
        },
        function (e) {
          self.rooms.error = 'err_' + (e.code === 'offline' ? 'network' : 'generic');
        },
      )
      .then(function () {
        self.rooms.loading = false;
        self.refreshLobby();
      });
  };

  App.loadHistory = function (mine) {
    var self = this;
    if (!api.available()) return;
    if (mine != null) this.history.mine = !!mine && !!api.user();
    this.history.loading = true;
    this.history.error = null;
    this.refreshLobby();
    api
      .matches(this.history.mine && api.user() ? api.user().username : null)
      .then(
        function (list) {
          self.history.list = list;
        },
        function (e) {
          self.history.error = 'err_' + (e.code === 'offline' ? 'network' : 'generic');
        },
      )
      .then(function () {
        self.history.loading = false;
        self.refreshLobby();
      });
  };

  App.publishRoom = function () {
    var s = this.session;
    if (this.role !== 'host' || !s || !s.code || !api.available() || !this.roomKey) return;
    api
      .publishRoom(s.code, {
        key: this.roomKey,
        host: s.localName,
        mode: this.settings.mode,
        stage: this.settings.stage,
        players: s.connected ? 2 : 1,
        status: this.phase === 'match' ? 'playing' : 'waiting',
        public: this.settings.public !== false,
      })
      .catch(function () {});
  };

  App.unpublishRoom = function () {
    if (this.role === 'host' && this.session && this.session.code && this.roomKey && api.available()) {
      api.unpublishRoom(this.session.code, this.roomKey);
    }
  };

  App.accountSubmit = function (mode, username, password, password2) {
    var self = this;
    var acc = this.account;
    acc.error = null;
    acc.notice = null;
    if (!/^[A-Za-z0-9][A-Za-z0-9_\-.]{2,19}$/.test(username)) acc.error = 'err_bad_username';
    else if (password.length < 6) acc.error = 'err_bad_password';
    else if (mode === 'register' && password !== password2) acc.error = 'err_password_match';
    if (acc.error) return this.rebuildLobby();
    acc.busy = true;
    this.rebuildLobby();
    (mode === 'register' ? api.register(username, password) : api.login(username, password))
      .then(
        function () {
          acc.notice = mode === 'register' ? 'account_created' : null;
          return MP.cloud.sync().catch(function () {});
        },
        function (e) {
          acc.error = {
            username_taken: 'err_username_taken',
            bad_credentials: 'err_bad_credentials',
            bad_username: 'err_bad_username',
            bad_password: 'err_bad_password',
            rate_limited: 'err_rate_limited',
            offline: 'err_network',
          }[e.code] || 'err_generic';
        },
      )
      .then(function () {
        acc.busy = false;
        self.rebuildLobby();
      });
  };

  App.accountMode = function (mode) {
    this.account.mode = mode;
    this.account.error = null;
    this.rebuildLobby();
  };

  App.logout = function () {
    var self = this;
    api.logout().then(function () {
      self.rebuildLobby();
    });
  };

  App.cloudSync = function () {
    var self = this;
    MP.cloud
      .sync()
      .then(
        function (r) {
          if (r === 'uploaded' || r === 'in-sync') UI.toast(t('cloud_synced'), 'good');
        },
        function () {
          UI.toast(t('cloud_error'), 'warn');
        },
      )
      .then(function () {
        self.rebuildLobby();
      });
  };

  App.cloudDownload = function () {
    if (!window.confirm(t('cloud_download_confirm'))) return;
    MP.cloud.download().catch(function () {
      UI.toast(t('cloud_error'), 'warn');
    });
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
      App.publishRoom();
    });
    s.on('peer-left', function (p) {
      if (App.session !== s) return;
      if (App.role === 'host') {
        UI.toast(t('player_left', { name: p.name }), 'warn');
        App.guestReady = false;
        App.remotePtr = null;
        G.setRemotePointer(null);
        G.hooks.remoteChooser = false;
        UI.hidePip();
        // Versus can't go on alone: the remaining player wins by forfeit.
        if (App.match) App.match.forfeit();
        App.refreshLobby();
        App.updateBadge();
        App.publishRoom();
      } else {
        var inMatch = App.phase === 'match';
        App.session = null;
        try {
          s.close(true);
        } catch (e) {}
        App.teardown();
        if (inMatch) App.guestExitMatch();
        App.lobbyError = p.reason === 'bye' || p.reason === 'kicked' ? 'err_closed' : 'err_lost';
        UI.closeModal();
        if (G.sceneName() === 'mainScene') UI.openLobby(App.lobbyState());
        else G.goToMain();
      }
    });
    s.on('rtt', function () {
      App.updateBadge();
    });
    s.on('stream', function (stream) {
      if (App.settings.mode === 'survival') UI.showPip(stream);
      else if (App.role === 'guest') UI.setViewStream(stream);
    });
    s.on('stream-ended', function () {
      if (App.settings.mode === 'survival') UI.hidePip();
      else if (App.role === 'guest' && App.phase === 'match') UI.setViewWaiting();
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
    UI.hidePip();
    if (this.match) this.match.dispose();
    this.phase = 'match';
    this._toldChooser = false;
    this.match = new MP.Match(this, this.settings);
    this.session.send(Object.assign({ t: 'start' }, this.startPayload()));
    this.startStream(true);
    this.match.start();
    this.updateBadge();
    this.publishRoom();
    if (this.settings.mode === 'coop') {
      setTimeout(function () {
        UI.toast(t('coop_hint'), 'good', 4500);
      }, 1200);
    }
  };

  App.startStream = function (restart) {
    var s = this.session;
    if (!s || !s.connected) return;
    if (restart || !s.call) s.startStream(G.canvas, this.settings.quality);
  };

  App.onHostMessage = function (msg) {
    var m = this.match;
    var norm, ui;
    switch (msg.t) {
      case 'ready':
        this.guestReady = !!msg.v;
        if (this.guestReady) UI.toast(t('player_ready', { name: this.session.remoteName }), 'good');
        this.broadcastLobby();
        this.refreshLobby();
        break;
      case 'zdeck':
        if (this.settings.mode === 'versus' && this.settings.hostSide === 'plants' && this.phase === 'lobby') {
          this.settings.zdeck = MP.validDeck(this.settings.stage, msg.deck, this.settings.zombiePool);
          this.broadcastLobby();
          this.refreshLobby();
        }
        break;
      case 'ptr':
        if (msg.x < 0) {
          this.remotePtr = null;
          G.setRemotePointer(null);
          break;
        }
        this.remotePtr = { x: msg.x, y: msg.y };
        if (m && G.ready) m.remotePointer(G.normToUI(msg.x, msg.y), this.remotePtr);
        break;
      case 'down':
        norm = { x: msg.x, y: msg.y };
        this.remotePtr = norm;
        if (m && G.ready) {
          ui = G.normToUI(msg.x, msg.y);
          m.remotePointer(ui, norm);
          m.remoteDown(ui, msg.b, norm);
          this.sendHud(true);
        }
        break;
      case 'wheel':
        if (m && m.guestPicksSeeds()) G.injectPointer('wheel', msg.x, msg.y, 0, msg.dy);
        break;
      case 'key':
        if (m) {
          m.remoteKey(String(msg.k || '').toLowerCase());
          this.sendHud(true);
        }
        break;
      case 'sv':
        if (m && m.mode === 'survival') m.partnerUpdate(msg.state);
        this.updatePipLabel();
        this.updateBadge();
        break;
      case 'end-request':
      case 'to-room':
        if (this.phase === 'match') {
          UI.toast(t(msg.t === 'to-room' ? 'guest_back_to_room' : 'guest_ended', { name: this.session.remoteName }), 'warn');
          this.returnToLobby();
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
    if (this.match.mode !== 'survival' && (force || now - (this._layoutAt || 0) >= LAYOUT_INTERVAL)) {
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
    var names = this.names();
    if (this.session) this.session.send({ t: 'end', result: result, names: names });
    this.showResults(result, 'host');
    this.recordMatch(result, names);
  };

  App.recordMatch = function (result, names) {
    var s = this.session;
    if (!api.available() || !s || !this.roomKey) return;
    var rec = MP.matchRecord(result, names);
    rec.room = s.code;
    rec.key = this.roomKey;
    rec.stage = result.stage;
    rec.players[0].self = !!api.user();
    if (s.remoteInfo && s.remoteInfo.ticket) rec.players[1].ticket = s.remoteInfo.ticket;
    api.postMatch(rec);
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
        { label: t('back_to_room'), cls: 'mp-brown', fn: function () {
          self.returnToLobby();
        } },
        { label: t('rematch'), cls: 'mp-green', fn: function () {
          if (self.session && self.session.connected) self.startMatch();
          else self.returnToLobby();
        } },
      ];
    } else {
      d.actions = [
        { label: t('leave_room'), cls: 'mp-red', fn: function () {
          self.leave();
        } },
        { label: t('back_to_room'), cls: 'mp-brown', fn: function () {
          if (self.session) self.session.send({ t: 'to-room' });
        } },
      ];
      d.waitText = t('waiting_host_rematch');
    }
    UI.hidePipExpanded();
    G.play(d.win ? 'playPlantNodeUnlock' : 'playLevelTaskWarn');
    UI.showResults(d);
  };

  App.onHostLeftLevel = function () {
    if (this.role === 'host' && this.match) this.returnToLobby();
  };

  App.onLocalRunDone = function (state) {
    var other = this.role === 'host' ? this.session && this.session.remoteName : this.session && this.session.remoteName;
    UI.toast(t(state.result === 'won' ? 'you_survived' : 'you_fell', { n: state.wave, name: other }), state.result === 'won' ? 'good' : 'warn', 5000);
    UI.expandPip(true);
  };

  App.endMatchCleanup = function () {
    if (this.match) {
      this.match.dispose();
      this.match = null;
    }
    if (this.session) this.session.stopStream();
    G.hooks.remoteChooser = false;
    UI.hidePip();
    UI.renderVersusHud(null);
    UI.renderStage(null);
  };

  App.returnToLobby = function () {
    if (this.role !== 'host') return;
    this.endMatchCleanup();
    this.phase = 'lobby';
    if (this.session) this.session.send({ t: 'lobby-return' });
    this.broadcastLobby();
    UI.closeModal();
    if (G.sceneName() === 'mainScene') this.openLobby();
    else G.goToMain(); // the lobby reopens when the main menu loads
    this.updateBadge();
  };

  App.endMatch = function () {
    if (!window.confirm(t('end_match_confirm'))) return;
    if (this.role === 'host') this.returnToLobby();
    else if (this.session) this.session.send({ t: 'end-request' });
  };

  /* ======================================================== guest side */

  App.onGuestMessage = function (msg) {
    switch (msg.t) {
      case 'lobby':
        if (msg.settings) this.settings = MP.normalizeSettings(msg.settings);
        if (msg.guestReady != null) this.guestReady = msg.guestReady;
        this.refreshLobby();
        break;
      case 'start':
        this.guestEnterMatch(msg);
        break;
      case 'hud':
        this.hud = msg;
        if (msg.chooser && !this._toldChooser && this.seat === 'plants') {
          this._toldChooser = true;
          UI.toast(t('guest_pick_seeds'), 'good', 5000);
        }
        this.updateGhost();
        this.updateBadge();
        this.updatePipLabel();
        break;
      case 'layout':
        this.layout = msg.layout;
        break;
      case 'end':
        this.showResults(msg.result, 'guest', msg.names);
        break;
      case 'lobby-return':
        this.guestExitMatch();
        this.phase = 'lobby';
        UI.closeModal();
        if (G.sceneName() === 'mainScene') this.openLobby();
        else G.goToMain();
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
    if (msg.settings) this.settings = MP.normalizeSettings(msg.settings);
    this.seat = msg.seat || 'plants';
    this.phase = 'match';
    this.hud = null;
    this.layout = null;
    this.ghost = null;
    this._toldChooser = false;
    UI.closeModal();
    UI.closeLobby();
    if (this.settings.mode === 'survival') {
      // Own lawn: run the level here and stream it to the host.
      UI.hideView();
      UI.hidePip();
      this.resumeLocalGame();
      this.disposeGuestRun();
      var self = this;
      this.guestRun = new MP.SoloRun(this.settings, function (state) {
        self.sendRunState(state, true);
        if (state.phase === 'done') {
          var hostRun = self.hud && self.hud.run;
          if (!hostRun || hostRun.phase !== 'done') self.onLocalRunDone(state);
        }
      });
      this.guestRun.start();
      if (this.session) this.session.startStream(G.canvas, this.settings.quality);
    } else {
      UI.showView();
      MP.audio.setLocalMuted(true);
      try {
        if (G.cc && !G.cc.game.isPaused()) G.cc.game.pause();
      } catch (e) {}
    }
    this.updateBadge();
  };

  App.sendRunState = function (state, force) {
    var now = performance.now();
    if (!this.session || (!force && now - (this._svAt || 0) < 1000)) return;
    this._svAt = now;
    this.session.send({ t: 'sv', state: state });
  };

  App.disposeGuestRun = function () {
    if (this.guestRun) {
      this.guestRun.dispose();
      this.guestRun = null;
    }
  };

  App.resumeLocalGame = function () {
    MP.audio.setLocalMuted(false);
    try {
      if (G.cc && G.cc.game.isPaused()) G.cc.game.resume();
    } catch (e) {}
  };

  App.guestExitMatch = function () {
    UI.hideView();
    UI.hidePip();
    UI.renderVersusHud(null);
    UI.renderStage(null);
    this.disposeGuestRun();
    if (this.session) this.session.stopStream();
    this.resumeLocalGame();
    this.hud = null;
    this.layout = null;
    this.ghost = null;
    this.updateBadge();
  };

  App.viewPointer = function (type, x, y, button, dy) {
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
    } else if (type === 'wheel') {
      this.session.send({ t: 'wheel', x: x, y: y, dy: dy });
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
    if (this.role === 'guest' && this.settings.mode !== 'survival') return UI.viewContentRect();
    var r = G.canvas && G.canvas.getBoundingClientRect();
    return r ? { left: r.left, top: r.top, width: r.width, height: r.height } : null;
  };

  // Loading bar while a level/scene loads: our own, or the host's (shared lawn).
  App.renderLoading = function () {
    if (!this.session || this.phase !== 'match') return UI.renderLoading(null);
    var own = G.loadingState();
    var watching = this.role === 'guest' && this.settings.mode !== 'survival';
    var info = watching ? this.hud && this.hud.loading : own;
    var frame = info && this.frameRect();
    if (!info || !frame) {
      // The guest's video may not have its first frame yet: use the window.
      if (info && watching) frame = { left: 0, top: 0, width: window.innerWidth, height: window.innerHeight };
      else return UI.renderLoading(null);
    }
    var text = watching ? t('host_loading', { name: this.session.remoteName }) : t('loading_level');
    UI.renderLoading({ frame: frame, pct: info.pct, text: text + ' ' + info.pct + '%' });
  };

  App.renderOverlays = function () {
    this.renderLoading();
    if (!this.session || this.phase !== 'match' || this.settings.mode === 'survival') {
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
        income: hud.income || 0,
        timeLeft: hud.timeLeft || 0,
        barTop: barTop,
        timerTop: timerTop,
        goal: mySide === 'zombies' ? t('pick_zombie') : '',
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

  function runLine(run, total) {
    if (!run) return '';
    if (run.phase === 'done') return run.result === 'won' ? t('survived') : t('fell_at', { n: run.wave });
    if (run.phase === 'loading') return t('picking_seeds');
    return t('wave_of', { n: Math.max(1, run.wave), total: total });
  }

  // Survival: partner's lawn label in the picture-in-picture.
  App.updatePipLabel = function () {
    if (this.settings.mode !== 'survival' || !this.session) return;
    var total = Number(this.settings.waves) || 0;
    var run = this.role === 'host' ? this.match && this.match.partner : this.hud && this.hud.run;
    UI.setPipLabel(this.session.remoteName, runLine(run, total));
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
    var line = '';
    if (this.settings.mode === 'survival') {
      var total = Number(this.settings.waves) || 0;
      var mine = this.role === 'host' ? this.match && this.match.run && this.match.run.state() : this.guestRun && this.guestRun.state();
      var other = this.role === 'host' ? this.match && this.match.partner : this.hud && this.hud.run;
      players[0].info = runLine(this.role === 'host' ? mine : other, total);
      players[1].info = runLine(this.role === 'host' ? other : mine, total);
    }
    var actions = [{ label: t('end_match'), cls: 'mp-red', fn: function () {
      self.endMatch();
    } }];
    UI.renderBadge({ mode: this.settings.mode, players: players, line: line, actions: actions });
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
    App.rebuildLobby();
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
      } else if (App.session && App.phase === 'lobby' && !UI.isLobbyOpen()) {
        setTimeout(function () {
          App.openLobby();
        }, 300);
      }
      // Guest left their own Survival lawn from the pause menu.
      if (App.guestRun && App.guestRun.phase !== 'done' && App.phase === 'match') {
        App.guestRun.phase = 'done';
        App.guestRun.result = 'lost';
        App.sendRunState(App.guestRun.state(), true);
      }
    }
    if (App.role === 'host' && App.match) App.sendHud(true);
  }

  function onFrame(dt) {
    if (App.role === 'host' && App.match) {
      App.match.frame(dt);
      G.hooks.remoteChooser = App.match.guestOwnsChooser();
      if (G.hooks.remoteChooser && !App._toldChooser) {
        App._toldChooser = true;
        UI.toast(t('host_guest_picks_seeds', { name: App.session.remoteName }), 'good', 5000);
      }
      App.sendHud(false);
    } else if (App.guestRun) {
      App.guestRun.frame(dt);
      App.sendRunState(App.guestRun.state(), false);
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
    if (App.role === 'guest' && UI.viewVisible()) {
      if (k) App.session.send({ t: 'key', k: k });
      e.stopImmediatePropagation();
    } else if (App.role === 'host' && App.match && k && App.match.localKey(k)) {
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
      toggleDeck: function (type) {
        App.toggleDeckZombie(type);
      },
      openZombieChooser: function () {
        App.openZombieChooser();
      },
      resetDeck: function () {
        App.setDeck(MP.defaultDeck(App.settings.stage));
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
      viewPointer: function (type, x, y, b, dy) {
        App.viewPointer(type, x, y, b, dy);
      },
      chat: function (text) {
        App.chat(text);
      },
      lang: function (code) {
        App.setLang(code);
      },
      tab: function (tab) {
        App.setTab(tab);
      },
      refreshRooms: function () {
        App.loadRooms();
      },
      joinRoom: function (code) {
        App.join(code, playerName());
      },
      refreshHistory: function (mine) {
        App.loadHistory(mine);
      },
      accountMode: function (mode) {
        App.accountMode(mode);
      },
      accountSubmit: function (mode, u, p, p2) {
        App.accountSubmit(mode, u, p, p2);
      },
      logout: function () {
        App.logout();
      },
      cloudSync: function () {
        App.cloudSync();
      },
      cloudDownload: function () {
        App.cloudDownload();
      },
      cloudKeepCloud: function () {
        UI.closeCloudConflict();
        MP.cloud.keepCloud().catch(function () {
          UI.toast(t('cloud_error'), 'warn');
        });
      },
      cloudKeepLocal: function () {
        UI.closeCloudConflict();
        MP.cloud
          .keepLocal()
          .then(function () {
            UI.toast(t('cloud_synced'), 'good');
            App.rebuildLobby();
          })
          .catch(function () {
            UI.toast(t('cloud_error'), 'warn');
          });
      },
    });
    MP.bus.on('lang', onLang);
    api.on('auth', function () {
      App.rebuildLobby();
    });
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
      App.unpublishRoom();
      if (App.session) App.session.close(true);
    });

    // Keep the public room listing alive and the room browser fresh.
    setInterval(function () {
      App.publishRoom();
    }, PUBLISH_INTERVAL);
    setInterval(function () {
      if (!App.session && App.tab === 'rooms' && UI.isLobbyOpen()) App.loadRooms(true);
    }, ROOMS_REFRESH);

    G.init().then(function () {
      G.canvas.addEventListener('pointerdown', function (e) {
        hostPointer(e, 'down');
      }, true);
      G.canvas.addEventListener('pointermove', function (e) {
        hostPointer(e, 'move');
      }, true);
      G.on('scene', onScene);
      G.on('frame', onFrame);
      MP.cards.on('art', function (type, url) {
        UI.fillZombieArt(type, url);
      });
      MP.cloud.on('conflict', function (c) {
        UI.showCloudConflict(c);
      });
      MP.cloud.on('reloading', function () {
        UI.toast(t('cloud_reloading'), 'good', 5000);
      });
      MP.cloud.on('status', function () {
        if (App.tab === 'account') App.rebuildLobby();
      });
      MP.cloud.init();
      requestAnimationFrame(loop);
    });
  };
})();
