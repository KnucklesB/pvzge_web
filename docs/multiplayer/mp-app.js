/*
 * PvZ2 Gardendless - Multiplayer application controller.
 *
 * Glues the network session, the lobby (with the online tabs: public rooms,
 * match history and account), the match controllers and the overlays.
 *
 *  - Up to 4 players: the host (slot 0) and up to 3 guests (slots 1-3).
 *  - Co-op / Versus share one lawn: the host runs the real game and streams
 *    it; guests watch the stream, send inputs and draw local feedback.
 *  - Survival gives each player their own lawn: everyone runs the level
 *    locally and streams it to the host, who relays the lawn each player
 *    wants to watch (picture-in-picture).
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
    mySlot: 0,
    roster: [], // guest side: [{slot, name, account, ready, ping}] from the host
    watchSlot: null, // survival: whose lawn the picture-in-picture shows
    // host side
    readyMap: {}, // slot -> ready (host)
    remotePtrs: {}, // slot -> {x, y} normalized
    hostPtr: null,
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
    return MP.sideOf(this.settings, this.role === 'host' ? 0 : this.mySlot);
  };

  // Everyone in the room, host first: [{slot, name, account, ready, ping}].
  App.currentRoster = function () {
    var s = this.session;
    if (!s) return [];
    if (this.role !== 'host') return this.roster;
    var self = this;
    return [{ slot: 0, name: s.localName, account: !!api.user(), ready: true, ping: null }].concat(
      s.guests().map(function (g) {
        return { slot: g.slot, name: g.name, account: !!(g.info && g.info.ticket), ready: !!self.readyMap[g.slot], ping: g.rtt };
      }),
    );
  };

  App.playerName = function (slot) {
    var p = this.currentRoster().find(function (x) {
      return x.slot === slot;
    });
    return p ? p.name : '';
  };

  // Versus: both sides need someone.
  App.teamsValid = function () {
    if (this.settings.mode !== 'versus') return true;
    var self = this;
    var count = { plants: 0, zombies: 0 };
    this.currentRoster().forEach(function (p) {
      count[MP.sideOf(self.settings, p.slot)]++;
    });
    return count.plants > 0 && count.zombies > 0;
  };

  // Puts a guest without a side on the smaller team (host decides).
  App.assignSide = function (slot) {
    if (this.role !== 'host' || !slot) return;
    var self = this;
    var count = { plants: 0, zombies: 0 };
    this.currentRoster().forEach(function (p) {
      if (p.slot !== slot) count[MP.sideOf(self.settings, p.slot)]++;
    });
    this.settings.sides[slot] = count.zombies < count.plants ? 'zombies' : count.plants < count.zombies ? 'plants' : this.settings.hostSide === 'plants' ? 'zombies' : 'plants';
  };

  App.lobbyState = function () {
    var s = this.session;
    if (!s) {
      return {
        view: this.accountOnly ? 'account' : 'home',
        tab: this.accountOnly ? 'account' : this.tab,
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
        saves: { canImport: api.can('importSave'), canEdit: api.can('editSave'), profiles: MP.saves.profileNames(MP.saves.readLocal()) },
        adminList: api.isAdmin() ? this.adminList : null,
      };
    }
    if (!s.code || (this.role === 'guest' && !s.connected)) {
      return { view: 'busy', busyText: this.role === 'host' ? 'creating' : 'connecting' };
    }
    var self = this;
    var me = this.role === 'host' ? 0 : this.mySlot;
    var roster = this.currentRoster();
    var players = roster.map(function (p) {
      return {
        slot: p.slot,
        name: p.name,
        role: p.slot === 0 ? 'host' : 'guest',
        ready: p.ready,
        you: p.slot === me,
        account: p.account,
        side: self.settings.mode === 'versus' ? MP.sideOf(self.settings, p.slot) : null,
      };
    });
    while (players.length < this.settings.maxPlayers) players.push(null);
    var guests = roster.filter(function (p) {
      return p.slot > 0;
    });
    var allReady =
      guests.length > 0 &&
      guests.every(function (p) {
        return p.ready;
      });
    var status = '';
    if (this.role === 'host') status = !guests.length ? 'need_player' : !allReady ? 'guests_must_ready' : !this.teamsValid() ? 'teams_invalid' : '';
    else status = this.guestReady ? 'waiting_host' : '';
    return {
      view: 'room',
      role: this.role,
      mySlot: me,
      code: s.code,
      players: players,
      playerCount: roster.length,
      settings: this.settings,
      ready: this.guestReady,
      canStart: this.role === 'host' && allReady && this.teamsValid(),
      canEditDeck: this.settings.mode === 'versus' && this.mySide() === 'zombies',
      mapLocked: this.role === 'host' && !G.mapUnlocked(),
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
    this.session.send({ t: 'lobby', settings: this.settings, roster: this.currentRoster(), phase: this.phase });
    this.publishRoom();
  };

  // Pings change all the time: refresh the others' player lists now and then.
  App.broadcastRoster = function (force) {
    if (this.role !== 'host' || !this.session) return;
    var now = performance.now();
    if (!force && now - (this._rosterAt || 0) < 2000) return;
    this._rosterAt = now;
    this.session.send({ t: 'roster', roster: this.currentRoster() });
  };

  App.setTab = function (tab) {
    this.tab = tab;
    this.lobbyError = null;
    this.rebuildLobby();
    this.onTabShown();
  };

  App.onTabShown = function () {
    if (this.session || !UI.isLobbyOpen()) return;
    var self = this;
    if (this.accountOnly || this.tab === 'account') {
      if (!api.loggedIn()) return;
      api.refreshMe().then(function () {
        self.rebuildLobby();
        if (api.isAdmin()) self.adminSearch(self.adminList.q);
      }, function () {});
    } else if (this.tab === 'rooms') this.loadRooms();
    else if (this.tab === 'history') this.loadHistory();
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
    this.readyMap = {};
    this.settings.sides = {}; // teams are per room
    // A profile still in the tutorial has nothing to pick on the map.
    if (!G.mapUnlocked() && this.settings.coopLevel === 'map') this.settings.coopLevel = 'egypt:1';
    var s = (this.session = new MP.Session());
    G.setKeepAlive(true);
    bindSession(s);
    this.refreshLobby();
    var self = this;
    s.host(name, this.settings.maxPlayers).then(
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
          self.mySlot = s.slot;
          self.roster = welcome.roster || [];
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
    this.readyMap = {};
    this.roster = [];
    this.mySlot = 0;
    this.watchSlot = null;
    this.hud = null;
    this.layout = null;
    this.remotePtrs = {};
    this.roomKey = null;
    UI.hidePip();
    UI.renderBadge(null);
    UI.renderVersusHud(null);
    UI.renderStage(null);
  };

  App.setting = function (key, value) {
    if (this.role !== 'host') return;
    if (key === 'quality' && this.session) this.session.applyQuality(value, G.canvas);
    if (key === 'maxPlayers') {
      // Never below the players already in the room.
      value = Math.max(Number(value) || 4, this.currentRoster().length);
      if (this.session) this.session.setMaxPlayers(value);
    }
    var oldHostSide = this.settings.hostSide;
    this.settings[key] = value;
    if (key === 'stage') this.settings.zdeck = MP.defaultDeck(value);
    if (key === 'hostSide' && value !== oldHostSide && this.session) {
      // 1 vs 1: switching sides swaps the guest too.
      var guests = this.session.guests();
      if (guests.length === 1) this.settings.sides[guests[0].slot] = value === 'plants' ? 'zombies' : 'plants';
    }
    this.settings = MP.normalizeSettings(this.settings);
    if (key === 'mode' && value === 'versus' && this.session) {
      // Balance the teams for players who haven't picked a side.
      var self = this;
      this.session.guests().forEach(function (g) {
        if (!self.settings.sides[g.slot]) self.assignSide(g.slot);
      });
    }
    MP.store.set('settings', this.settings);
    this.broadcastLobby();
    this.refreshLobby();
  };

  // Versus teams: the host moves anyone; a guest moves only themselves.
  App.setSide = function (slot, side) {
    if (this.settings.mode !== 'versus' || this.phase !== 'lobby' || (side !== 'plants' && side !== 'zombies')) return;
    if (this.role === 'host') {
      if (slot === 0) return this.setting('hostSide', side);
      this.settings.sides[slot] = side;
      this.settings = MP.normalizeSettings(this.settings);
      MP.store.set('settings', this.settings);
      this.broadcastLobby();
      this.refreshLobby();
    } else if (this.session && slot === this.mySlot) {
      this.session.send({ t: 'side', v: side });
    }
  };

  App.kick = function (slot) {
    if (this.role !== 'host' || !this.session || !slot) return;
    var name = this.playerName(slot);
    if (!window.confirm(t('kick_confirm', { name: name }))) return;
    this.session.kick(slot);
  };

  // A zombie player picks the team's deck in the lobby.
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
    this.accountOnly = false;
    UI.closeSaveEditor();
    UI.closeLobby();
  };

  // The account window on its own (main menu), for solo players.
  App.openAccount = function () {
    if (!G.ready || G.sceneName() !== 'mainScene') return;
    if (this.session) return this.openLobby();
    this.accountOnly = true;
    this.openLobby();
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
        players: 1 + s.guests().length,
        max: this.settings.maxPlayers,
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

  // Turns an API failure into a message; unexpected server answers name
  // the HTTP status so a broken server can be told from a wrong password.
  function setAccountError(acc, e) {
    var known = {
      username_taken: 'err_username_taken',
      bad_credentials: 'err_bad_credentials',
      bad_username: 'err_bad_username',
      bad_password: 'err_bad_password',
      rate_limited: 'err_rate_limited',
      offline: 'err_network',
    }[e && e.code];
    acc.errorVars = null;
    if (known) acc.error = known;
    else if (e && e.status >= 502 && e.status <= 504) {
      acc.error = 'err_server_down';
      acc.errorVars = { status: e.status };
    } else if (e && e.status) {
      acc.error = 'err_server';
      acc.errorVars = { status: e.status, code: e.code && e.code !== 'server_error' ? ', ' + e.code : '' };
    } else acc.error = 'err_generic';
    if (e && !known) MP.warn('account request failed', e.status, e.code, e);
  }

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
          setAccountError(acc, e);
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

  App.passwordMode = function (on) {
    this.account.changing = !!on;
    this.account.error = null;
    this.account.notice = null;
    this.rebuildLobby();
  };

  App.changePassword = function (current, next, next2) {
    var self = this;
    var acc = this.account;
    var user = api.user();
    acc.error = null;
    if (next.length < 6) acc.error = 'err_bad_password';
    else if (next !== next2) acc.error = 'err_password_match';
    if (acc.error || !user) return this.rebuildLobby();
    acc.busy = true;
    this.rebuildLobby();
    api
      .changePassword(current, next)
      // The server ends every session of the account: log in again.
      .then(function () {
        return api.login(user.username, next);
      })
      .then(
        function () {
          acc.changing = false;
          acc.notice = 'password_changed';
        },
        function (e) {
          setAccountError(acc, e);
        },
      )
      .then(function () {
        acc.busy = false;
        self.rebuildLobby();
      });
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

  /* ========================================================== save files */

  function apiErrorKey(e) {
    return { forbidden: 'err_forbidden', offline: 'err_network', rate_limited: 'err_rate_limited', save_too_large: 'save_bad', bad_save: 'save_bad' }[e && e.code] || 'err_generic';
  }

  App.exportSave = function () {
    var blob = MP.saves.readLocal();
    if (!blob.players) return UI.toast(t('editor_no_profiles'), 'warn');
    MP.saves.download(blob, api.user() ? api.user().username : '');
    UI.toast(t('save_exported'), 'good');
  };

  function applyLocalSave(blob) {
    if (!MP.saves.canApply()) {
      UI.toast(t('save_only_menu'), 'warn');
      return true; // keep the editor open
    }
    MP.saves.applyLocal(blob);
    UI.toast(t('save_applied'), 'good', 5000);
    return false;
  }

  App.importSave = function () {
    if (!api.can('importSave')) return UI.toast(t('err_forbidden'), 'warn');
    var picker = document.createElement('input');
    picker.type = 'file';
    picker.accept = '.json,application/json,text/plain';
    picker.onchange = function () {
      var file = picker.files && picker.files[0];
      if (!file) return;
      file.text().then(function (text) {
        var blob;
        try {
          blob = MP.saves.parse(text);
        } catch (e) {
          return UI.toast(t('save_bad'), 'warn');
        }
        if (!window.confirm(t('save_import_confirm', { name: file.name }))) return;
        applyLocalSave(blob);
      });
    };
    picker.click();
  };

  App.editSave = function () {
    if (!api.can('editSave')) return UI.toast(t('err_forbidden'), 'warn');
    UI.openSaveEditor({ source: t('editor_source_local'), blob: MP.saves.readLocal(), onSave: applyLocalSave });
  };

  App.adminList = { q: '', list: [], loading: false, error: null };

  App.adminSearch = function (q) {
    var self = this;
    var a = this.adminList;
    a.q = q || '';
    a.loading = true;
    a.error = null;
    var mine = (this._adminReq = (this._adminReq || 0) + 1);
    api.adminUsers(a.q).then(
      function (list) {
        if (mine !== self._adminReq) return;
        a.list = list;
        a.loading = false;
        self.refreshLobby();
      },
      function (e) {
        if (mine !== self._adminReq) return;
        a.loading = false;
        a.error = apiErrorKey(e);
        self.refreshLobby();
      },
    );
  };

  function loadUserSave(name) {
    return api.adminGetSave(name).then(function (save) {
      if (!save || !save.data) throw { code: 'bad_save' };
      return MP.saves.parse(save.data);
    });
  }

  App.adminEdit = function (name) {
    var self = this;
    loadUserSave(name).then(
      function (blob) {
        UI.openSaveEditor({
          source: t('editor_source_user', { name: name }),
          blob: blob,
          saveLabel: t('editor_save_user'),
          onSave: function (b) {
            return api.adminPutSave(name, JSON.stringify({ v: 1, players: b.players, settings: b.settings })).then(
              function () {
                UI.toast(t('editor_saved_user', { name: name }), 'good', 5000);
                self.adminSearch(self.adminList.q);
                // Our own account edited: bring this browser up to date.
                if (api.user() && api.user().username.toLowerCase() === name.toLowerCase()) MP.cloud.sync().catch(function () {});
                return false;
              },
              function (e) {
                UI.toast(t(apiErrorKey(e)), 'warn');
                return true;
              },
            );
          },
        });
      },
      function (e) {
        UI.toast(t(apiErrorKey(e)), 'warn');
      },
    );
  };

  App.adminPassword = function (name) {
    var pass = window.prompt(t('admin_password_prompt', { name: name }), '');
    if (pass == null) return;
    if (pass.length < 6) return UI.toast(t('err_bad_password'), 'warn');
    api.adminSetPassword(name, pass).then(
      function () {
        UI.toast(t('admin_password_done', { name: name }), 'good', 6000);
      },
      function (e) {
        UI.toast(t(apiErrorKey(e)), 'warn');
      },
    );
  };

  App.adminExport = function (name) {
    loadUserSave(name).then(
      function (blob) {
        MP.saves.download(blob, name);
      },
      function (e) {
        UI.toast(t(apiErrorKey(e)), 'warn');
      },
    );
  };

  /* ============================================================ session */

  function bindSession(s) {
    s.on('peer-joined', function (link) {
      if (App.session !== s) return;
      var slot = link.slot;
      App.readyMap[slot] = false;
      if (App.settings.mode === 'versus' && !App.settings.sides[slot]) App.assignSide(slot);
      if (App.match) App.match.addPlayer(slot, link.name, false);
      var payload = { settings: App.settings, phase: App.phase, roster: App.currentRoster() };
      if (App.phase === 'match' && App.match) payload.start = App.startPayload(slot);
      s.welcome(link, payload);
      App.toastAll(function () {
        return { key: 'player_joined', vars: { name: link.name } };
      }, 'good', slot);
      G.play('playCardChosen');
      // Joined (or came back) in the middle of a match: stream right away.
      if (App.phase === 'match' && App.match) s.streamTo(slot, App.settings.mode === 'survival' ? App.defaultWatch(slot) : 0, true);
      App.broadcastLobby();
      App.refreshLobby();
      App.updateBadge();
    });
    s.on('peer-left', function (link, reason) {
      if (App.session !== s) return;
      if (App.role === 'host') {
        var slot = link.slot;
        App.toastAll(function () {
          return { key: reason === 'kicked' ? 'player_kicked' : 'player_left', vars: { name: link.name } };
        }, 'warn');
        delete App.readyMap[slot];
        delete App.remotePtrs[slot];
        G.setRemotePointer(slot, null);
        if (App.match) App.match.removePlayer(slot);
        if (App.watchSlot === slot) App.watch(1);
        App.broadcastLobby();
        App.refreshLobby();
        App.updateBadge();
      } else {
        var inMatch = App.phase === 'match';
        App.session = null;
        try {
          s.close(true);
        } catch (e) {}
        App.teardown();
        if (inMatch) App.guestExitMatch();
        App.lobbyError = reason === 'kicked' ? 'err_kicked' : reason === 'bye' ? 'err_closed' : 'err_lost';
        UI.closeModal();
        if (G.sceneName() === 'mainScene') UI.openLobby(App.lobbyState());
        else G.goToMain();
      }
    });
    s.on('rtt', function () {
      App.updateBadge();
      App.broadcastRoster(false);
    });
    s.on('stream', function (stream, src) {
      if (App.settings.mode === 'survival') {
        if (App.role === 'host') {
          // A guest's own lawn: show it if nothing (or that lawn) is shown.
          if (App.watchSlot == null || App.watchSlot === src) App.showWatched(src, stream);
        } else App.showWatched(src, stream);
      } else if (App.role === 'guest') UI.setViewStream(stream);
    });
    s.on('stream-ended', function (src) {
      if (App.settings.mode === 'survival') {
        if (App.watchSlot === src) {
          if (App.role === 'host') App.watch(1);
          else UI.setPipWaiting();
        }
      } else if (App.role === 'guest' && App.phase === 'match') UI.setViewWaiting();
    });
    s.on('message', function (msg, link) {
      if (App.session !== s) return;
      if (App.role === 'host') App.onHostMessage(msg, link);
      else App.onGuestMessage(msg);
    });
  }

  /* ========================================================= host side */

  App.startPayload = function (slot) {
    var seat = this.match ? this.match.seatOf(slot) : MP.sideOf(this.settings, slot);
    return { settings: this.settings, seat: seat, roster: this.currentRoster() };
  };

  App.start = function () {
    var st = this.lobbyState();
    if (this.role !== 'host' || !st.canStart) return;
    this.startMatch();
  };

  App.startMatch = function () {
    var self = this;
    UI.closeModal();
    UI.closeLobby();
    UI.hidePip();
    if (this.match) this.match.dispose();
    this.phase = 'match';
    this._toldChooser = false;
    this.watchSlot = null;
    this.match = new MP.Match(this, this.settings, this.currentRoster());
    this.session.guests().forEach(function (g) {
      self.session.sendTo(g.slot, Object.assign({ t: 'start' }, self.startPayload(g.slot)));
    });
    this.startStream(true);
    this.match.start();
    this.updateBadge();
    this.publishRoom();
    if (this.settings.mode === 'coop') {
      var hint = MP.findLevel(this.settings.coopLevel) ? t('coop_hint_level', { level: UI.levelLabel(this.settings.coopLevel) }) : t('coop_hint');
      setTimeout(function () {
        UI.toast(hint, 'good', 4500);
      }, 1200);
    }
  };

  App.startStream = function (restart) {
    var s = this.session;
    if (!s || !s.connected) return;
    var self = this;
    if (this.settings.mode === 'survival') {
      // Each guest starts by watching the host's lawn.
      s.guests().forEach(function (g) {
        g.watch = self.defaultWatch(g.slot);
      });
    }
    if (restart || !s._local) s.startStream(G.canvas, this.settings.quality);
  };

  // Survival: the first lawn a player watches.
  App.defaultWatch = function (slot) {
    return slot === 0 ? (this.session && this.session.guests()[0] ? this.session.guests()[0].slot : null) : 0;
  };

  App.onHostMessage = function (msg, link) {
    var m = this.match;
    var slot = link.slot;
    var norm, ui;
    switch (msg.t) {
      case 'ready':
        this.readyMap[slot] = !!msg.v;
        if (this.readyMap[slot]) UI.toast(t('player_ready', { name: link.name }), 'good');
        this.broadcastLobby();
        this.refreshLobby();
        break;
      case 'side':
        if (this.phase === 'lobby' && this.settings.mode === 'versus' && (msg.v === 'plants' || msg.v === 'zombies')) {
          this.settings.sides[slot] = msg.v;
          this.broadcastLobby();
          this.refreshLobby();
        }
        break;
      case 'zdeck':
        if (this.settings.mode === 'versus' && MP.sideOf(this.settings, slot) === 'zombies' && this.phase === 'lobby') {
          this.settings.zdeck = MP.validDeck(this.settings.stage, msg.deck, this.settings.zombiePool);
          this.broadcastLobby();
          this.refreshLobby();
        }
        break;
      case 'ptr':
        if (msg.x < 0) {
          delete this.remotePtrs[slot];
          G.setRemotePointer(slot, null);
          break;
        }
        this.remotePtrs[slot] = { x: msg.x, y: msg.y };
        if (m && G.ready) m.remotePointer(slot, G.normToUI(msg.x, msg.y), this.remotePtrs[slot]);
        break;
      case 'down':
        norm = { x: msg.x, y: msg.y };
        this.remotePtrs[slot] = norm;
        if (m && G.ready) {
          ui = G.normToUI(msg.x, msg.y);
          m.remotePointer(slot, ui, norm);
          m.remoteDown(slot, ui, msg.b, norm);
          this.sendHud(true);
        }
        break;
      case 'wheel':
        if (m && m.guestPicksSeeds(slot)) G.injectPointer('wheel', msg.x, msg.y, 0, msg.dy);
        break;
      case 'key':
        if (m) {
          m.remoteKey(slot, String(msg.k || '').toLowerCase());
          this.sendHud(true);
        }
        break;
      case 'sv':
        if (m && m.mode === 'survival') m.partnerUpdate(slot, msg.state);
        this.updatePipLabel();
        this.updateBadge();
        break;
      case 'watch':
        if (m && m.mode === 'survival' && this.session) this.session.streamTo(slot, Number(msg.slot) || 0);
        break;
      case 'end-request':
      case 'to-room':
        if (this.phase === 'match') {
          var key = msg.t === 'to-room' ? 'guest_back_to_room' : 'guest_ended';
          this.toastAll(function () {
            return { key: key, vars: { name: link.name } };
          }, 'warn');
          this.returnToLobby();
        }
        break;
      case 'chat':
        var text = String(msg.text || '').slice(0, 120);
        UI.chatLine(link.name, text, MP.SLOT_COLORS[slot]);
        this.session.send({ t: 'chat', text: text, from: slot, name: link.name }, slot);
        break;
    }
  };

  // Other players' cursors as seen by `forSlot` (host's included).
  App.cursorsFor = function (forSlot) {
    var self = this;
    var out = [];
    var m = this.match;
    if (forSlot !== 0 && this.hostPtr && G.inLevel()) out.push({ slot: 0, x: this.hostPtr.x, y: this.hostPtr.y, name: this.session.localName });
    Object.keys(this.remotePtrs).forEach(function (k) {
      var slot = Number(k);
      if (slot === forSlot) return;
      var p = self.remotePtrs[slot];
      var hud = m ? m.hud(slot) : null;
      out.push({ slot: slot, x: p.x, y: p.y, name: self.playerName(slot), held: hud && hud.sel ? HELD[hud.sel.kind] : '' });
    });
    return out;
  };

  App.sendHud = function (force) {
    var s = this.session;
    if (!this.match || !s || !s.connected) return;
    var now = performance.now();
    if (!force && now - (this._hudAt || 0) < HUD_INTERVAL) return;
    this._hudAt = now;
    var self = this;
    s.guests().forEach(function (g) {
      var hud = self.match.hud(g.slot);
      if (self.match.mode !== 'survival') hud.cursors = self.cursorsFor(g.slot);
      s.sendTo(g.slot, Object.assign({ t: 'hud' }, hud));
    });
    if (this.match.mode !== 'survival' && (force || now - (this._layoutAt || 0) >= LAYOUT_INTERVAL)) {
      this._layoutAt = now;
      s.send({ t: 'layout', layout: this.hostLayout() });
    }
  };

  // Toast for everyone: fn(slot) -> {key, vars} (or null for nobody).
  App.toastAll = function (fn, kind, except) {
    var mine = fn(0);
    if (mine && except !== 0) UI.toast(t(mine.key, mine.vars), kind, 4000);
    if (!this.session) return;
    var s = this.session;
    s.guests().forEach(function (g) {
      if (g.slot === except) return;
      var x = fn(g.slot);
      if (x) s.sendTo(g.slot, { t: 'toast', key: x.key, vars: x.vars, kind: kind });
    });
  };

  App.onMatchFinished = function (result) {
    if (this.role !== 'host' || !this.match) return;
    this.lastResult = result;
    if (this.session) this.session.send({ t: 'end', result: result });
    this.showResults(result, 0);
    this.recordMatch(result);
  };

  App.recordMatch = function (result) {
    var s = this.session;
    if (!api.available() || !s || !this.roomKey) return;
    var rec = MP.matchRecord(result);
    rec.room = s.code;
    rec.key = this.roomKey;
    rec.stage = result.stage;
    rec.players.forEach(function (p) {
      if (p.slot === 0) p.self = !!api.user();
      else {
        var g = s.link(p.slot);
        if (g && g.info && g.info.ticket) p.ticket = g.info.ticket;
      }
      delete p.slot;
    });
    api.postMatch(rec);
  };

  App.showResults = function (result, mySlot) {
    var d = MP.describeResult(result, mySlot);
    var self = this;
    if (this.role === 'host') {
      d.actions = [
        { label: t('back_to_room'), cls: 'mp-brown', fn: function () {
          self.returnToLobby();
        } },
        { label: t('rematch'), cls: 'mp-green', fn: function () {
          if (self.session && self.session.connected && self.teamsValid()) self.startMatch();
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
    UI.toast(t(state.result === 'won' ? 'you_survived_all' : 'you_fell_all', { n: state.wave }), state.result === 'won' ? 'good' : 'warn', 5000);
    UI.expandPip(true);
  };

  App.endMatchCleanup = function () {
    if (this.match) {
      this.match.dispose();
      this.match = null;
    }
    if (this.session) this.session.stopStream();
    G.hooks.remoteChooser = false;
    this.remotePtrs = {};
    this.watchSlot = null;
    UI.hidePip();
    UI.renderVersusHud(null);
    UI.renderStage(null);
  };

  App.returnToLobby = function () {
    if (this.role !== 'host') return;
    this.endMatchCleanup();
    this.phase = 'lobby';
    var self = this;
    // Everyone gets ready again for the next match.
    Object.keys(this.readyMap).forEach(function (k) {
      self.readyMap[k] = false;
    });
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
        if (msg.roster) this.setRoster(msg.roster);
        this.refreshLobby();
        break;
      case 'roster':
        if (msg.roster) this.setRoster(msg.roster);
        if (this.phase === 'lobby') this.refreshLobby();
        this.updateBadge();
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
        this.showResults(msg.result, this.mySlot);
        break;
      case 'lobby-return':
        this.guestExitMatch();
        this.phase = 'lobby';
        this.guestReady = false;
        UI.closeModal();
        if (G.sceneName() === 'mainScene') this.openLobby();
        else G.goToMain();
        break;
      case 'chat':
        var from = msg.from == null ? 0 : Number(msg.from);
        UI.chatLine(msg.name || this.playerName(from) || this.session.remoteName, String(msg.text || '').slice(0, 120), MP.SLOT_COLORS[from] || 'var(--mp-p1)');
        break;
      case 'toast':
        UI.toast(t(msg.key, msg.vars), msg.kind, 4000);
        break;
    }
  };

  App.setRoster = function (roster) {
    var me = this.mySlot;
    this.roster = (roster || []).slice(0, MP.MAX_PLAYERS).map(function (p) {
      return { slot: Number(p.slot) || 0, name: String(p.name || '').slice(0, 20), account: !!p.account, ready: !!p.ready, ping: p.ping == null ? null : Number(p.ping) || 0 };
    });
    var mine = this.roster.find(function (p) {
      return p.slot === me;
    });
    if (mine && this.phase === 'lobby') this.guestReady = mine.ready;
  };

  App.guestEnterMatch = function (msg) {
    if (msg.settings) this.settings = MP.normalizeSettings(msg.settings);
    if (msg.roster) this.setRoster(msg.roster);
    this.seat = msg.seat || 'plants';
    this.phase = 'match';
    this.hud = null;
    this.layout = null;
    this.ghost = null;
    this.watchSlot = null;
    this._toldChooser = false;
    UI.closeModal();
    UI.closeLobby();
    if (this.settings.mode === 'survival' && this.seat === 'own') {
      // Own lawn: run the level here and stream it to the host.
      UI.hideView();
      UI.hidePip();
      this.resumeLocalGame();
      this.disposeGuestRun();
      var self = this;
      this.guestRun = new MP.SoloRun(this.settings, function (state) {
        self.sendRunState(state, true);
        if (state.phase === 'done') self.onLocalRunDone(state);
      });
      this.guestRun.start();
      if (this.session) this.session.startStream(G.canvas, this.settings.quality);
    } else {
      // Shared lawn (or watching a Survival match that already started).
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
    this.watchSlot = null;
    this.updateBadge();
  };

  /* survival: the other lawns, one at a time in the picture-in-picture */

  App.survivalRuns = function () {
    if (this.role === 'host') return this.match ? this.match.runStates() : {};
    return (this.hud && this.hud.runs) || {};
  };

  // Players whose lawn we can watch (not ourselves).
  App.watchable = function () {
    var me = this.role === 'host' ? 0 : this.mySlot;
    return Object.keys(this.survivalRuns())
      .map(Number)
      .filter(function (s) {
        return s !== me;
      })
      .sort();
  };

  App.showWatched = function (slot, stream) {
    this.watchSlot = slot;
    UI.showPip(stream, { nav: this.watchable().length > 1 });
    this.updatePipLabel();
  };

  // Next/previous lawn (dir = 1 / -1).
  App.watch = function (dir) {
    var list = this.watchable();
    var s = this.session;
    if (!s) return;
    if (!list.length) {
      this.watchSlot = null;
      UI.hidePip();
      return;
    }
    var i = list.indexOf(this.watchSlot);
    var next = list[(i < 0 ? 0 : i + (dir || 1) + list.length) % list.length];
    if (this.role === 'host') {
      var link = s.link(next);
      this.watchSlot = next;
      if (link && link.inStream) this.showWatched(next, link.inStream);
      else UI.setPipWaiting();
    } else {
      this.watchSlot = next;
      UI.setPipWaiting();
      s.send({ t: 'watch', slot: next });
    }
    this.updatePipLabel();
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
    if (this.seat === 'spectator') return;
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
    if (this.role === 'guest' && (this.settings.mode !== 'survival' || this.seat === 'spectator')) return UI.viewContentRect();
    var r = G.canvas && G.canvas.getBoundingClientRect();
    return r ? { left: r.left, top: r.top, width: r.width, height: r.height } : null;
  };

  // Loading bar while a level/scene loads: our own, or the host's (shared lawn).
  App.renderLoading = function () {
    if (!this.session || this.phase !== 'match') return UI.renderLoading(null);
    var own = G.loadingState();
    var watching = this.role === 'guest' && (this.settings.mode !== 'survival' || this.seat === 'spectator');
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
    var self = this;
    var scene = { frame: frame, cells: [], lanes: [], sels: [], cursors: [], cd: null };
    var hud;
    if (this.role === 'host') {
      var ov = this.match ? this.match.overlay() : null;
      hud = ov;
      scene.layout = this.hostLayout();
      scene.cursors = this.cursorsFor(0).map(function (c) {
        return Object.assign(c, { color: MP.SLOT_COLORS[c.slot] });
      });
      if (ov) {
        ov.picks.forEach(function (p) {
          var name = self.playerName(p.slot);
          if (p.slot !== 0) scene.sels.push({ kind: p.sel.kind, i: p.sel.i, tag: name, color: MP.SLOT_COLORS[p.slot] });
          if (p.cell) scene.cells.push({ l: p.cell.l, c: p.cell.c, kind: p.sel.kind, color: MP.SLOT_COLORS[p.slot] });
          if (p.lane >= 0) scene.lanes.push({ l: p.lane, local: p.slot === 0, color: MP.SLOT_COLORS[p.slot] });
        });
      }
    } else {
      hud = this.hud;
      scene.layout = this.layout;
      scene.cursors = ((hud && hud.cursors) || []).map(function (c) {
        return Object.assign({}, c, { color: MP.SLOT_COLORS[c.slot] });
      });
      var lp = this.localPtr;
      if (hud && hud.sel && lp && this.layout) {
        if (hud.seat === 'plants') {
          var g = this.layout.grid;
          if (g) {
            var c = Math.floor((lp.x - g.x) / g.cw);
            var l = Math.floor((lp.y - g.y) / g.ch);
            if (c >= 0 && c < g.cols && l >= 0 && l < g.rows) scene.cells.push({ l: l, c: c, kind: hud.sel.kind, local: true });
          }
          scene.sels.push({ kind: hud.sel.kind, i: hud.sel.i, tag: t('you'), color: MP.SLOT_COLORS[this.mySlot] });
        } else if (this.layout.grid) {
          var gz = this.layout.grid;
          var lane = Math.floor((lp.y - gz.y) / gz.ch);
          if (lp.x >= gz.x && lane >= 0 && lane < gz.rows) scene.lanes.push({ l: lane, local: true });
          scene.sels.push({ kind: hud.sel.kind, i: hud.sel.i, tag: t('you'), color: MP.SLOT_COLORS[this.mySlot] });
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
      var mySide = this.mySide();
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

  // Survival: the watched lawn's label in the picture-in-picture.
  App.updatePipLabel = function () {
    if (this.settings.mode !== 'survival' || !this.session || this.watchSlot == null) return;
    var total = Number(this.settings.waves) || 0;
    var run = this.survivalRuns()[this.watchSlot];
    UI.setPipLabel(this.playerName(this.watchSlot), runLine(run, total), MP.SLOT_COLORS[this.watchSlot], this.watchable().length > 1);
  };

  App.updateBadge = function () {
    var s = this.session;
    if (!s || this.phase !== 'match') {
      UI.renderBadge(null);
      return;
    }
    var self = this;
    var me = this.role === 'host' ? 0 : this.mySlot;
    var total = Number(this.settings.waves) || 0;
    var runs = this.settings.mode === 'survival' ? this.survivalRuns() : null;
    if (runs && this.role === 'guest' && this.guestRun) {
      runs = Object.assign({}, runs);
      runs[me] = this.guestRun.state();
    }
    var players = this.currentRoster().map(function (p) {
      // Host: each guest's ping. Guest: ours to the host on the host's row,
      // the others' as reported by the host.
      var ping = self.role === 'host' ? (p.slot === 0 ? null : p.ping) : p.slot === 0 ? s.rtt : p.slot === me ? null : p.ping;
      var out = { name: p.name + (p.slot === me ? ' (' + t('you') + ')' : ''), color: MP.SLOT_COLORS[p.slot], ping: ping };
      if (self.settings.mode === 'versus') out.side = MP.sideOf(self.settings, p.slot);
      if (runs) out.info = runLine(runs[p.slot], total);
      return out;
    });
    var actions = [{ label: t('end_match'), cls: 'mp-red', fn: function () {
      self.endMatch();
    } }];
    UI.renderBadge({ mode: this.settings.mode, players: players, line: '', actions: actions });
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
        UI.toast(t('host_guests_pick_seeds'), 'good', 5000);
      }
      App.sendHud(false);
    } else if (App.guestRun) {
      App.guestRun.frame(dt);
      App.sendRunState(App.guestRun.state(), false);
    }
  }

  // The game darkens the screen (with its loading flower) while it loads or
  // switches scenes: keep our menu chip hidden meanwhile.
  function screenCovered() {
    try {
      var cc = G.cc;
      var shown = function (path) {
        var node = cc.find(path);
        return !!(node && node.activeInHierarchy);
      };
      if (shown('Canvas/LoaderFlower') || shown('Canvas/Camera/ScreenSplash')) return true;
      // A game window (settings, profiles, info...) is open over the menu.
      var canvas = cc.find('Canvas');
      if (
        canvas &&
        canvas.children.some(function (n) {
          return n.active && /Window|Panel|Dialog|Popup/.test(n.name) && !/Button$/.test(n.name);
        })
      )
        return true;
      return ['Canvas/ScreenCover', 'Canvas/ScreenSlash'].some(function (path) {
        var node = cc.find(path);
        var sprite = node && node.active && node.getComponent(cc.Sprite);
        return !!(sprite && sprite.color && sprite.color.a > 10);
      });
    } catch (e) {
      return false;
    }
  }

  // Account chip next to the profile name on the main menu.
  App.renderMenuAccount = function () {
    var show = G.ready && !this.session && !UI.isLobbyOpen() && G.sceneName() === 'mainScene' && !screenCovered();
    var node = show && G.cc.find('Canvas/PlayerSelectorButton');
    var r = node && G.nodeRectNorm(node);
    var c = r && G.canvas.getBoundingClientRect();
    if (!c) return UI.renderMenuAccount(null);
    var u = api.user();
    UI.renderMenuAccount({
      left: c.left + (r.x + r.w) * c.width + c.width * 0.012,
      top: c.top + r.y * c.height,
      height: r.h * c.height,
      text: u ? u.username : t('account_button'),
      status: u ? MP.cloud.status : 'none',
    });
  };

  function loop() {
    try {
      App.renderOverlays();
      App.renderMenuAccount();
    } catch (e) {
      MP.warn('overlay error', e);
    }
    requestAnimationFrame(loop);
  }

  // Host: when playing the zombies, the mouse drives the zombie packets.
  function hostPointer(e, type) {
    if (App.role !== 'host' || !App.match || !G.inLevel()) return;
    var r = G.canvas.getBoundingClientRect();
    var nx = (e.clientX - r.left) / r.width;
    var ny = (e.clientY - r.top) / r.height;
    // The guests see where the host points.
    App.hostPtr = nx >= 0 && nx <= 1 && ny >= 0 && ny <= 1 ? { x: nx, y: ny } : null;
    if (!App.match.localZombies()) return;
    var ui = G.normToUI(nx, ny);
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
    var me = this.role === 'host' ? 0 : this.mySlot;
    this.session.send({ t: 'chat', text: text, from: me, name: this.session.localName });
    UI.chatLine(this.session.localName, text, MP.SLOT_COLORS[me]);
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
      kick: function (slot) {
        App.kick(slot);
      },
      setSide: function (slot, side) {
        App.setSide(slot, side);
      },
      watch: function (dir) {
        App.watch(dir);
      },
      exportSave: function () {
        App.exportSave();
      },
      importSave: function () {
        App.importSave();
      },
      editSave: function () {
        App.editSave();
      },
      adminSearch: function (q) {
        App.adminSearch(q);
      },
      adminEdit: function (name) {
        App.adminEdit(name);
      },
      adminExport: function (name) {
        App.adminExport(name);
      },
      adminPassword: function (name) {
        App.adminPassword(name);
      },
      passwordMode: function (on) {
        App.passwordMode(on);
      },
      changePassword: function (cur, a, b) {
        App.changePassword(cur, a, b);
      },
      openAccount: function () {
        App.openAccount();
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
      G.canvas.addEventListener('pointerleave', function () {
        App.hostPtr = null;
      });
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
        if (App.tab === 'account' || App.accountOnly) App.rebuildLobby();
      });
      // Logged in/out (not a profile refresh): load the admin list if needed.
      var lastUser = api.user() && api.user().id;
      api.on('auth', function (user) {
        var id = user && user.id;
        if (id === lastUser) return;
        lastUser = id;
        App.adminList.list = [];
        if (api.isAdmin() && UI.isLobbyOpen() && (App.accountOnly || App.tab === 'account')) App.adminSearch('');
      });
      MP.cloud.init();
      requestAnimationFrame(loop);
    });
  };
})();
