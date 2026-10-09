/*
 * PvZ2 Gardendless - Multiplayer HTML interface.
 *
 * Pure view code: it renders state handed over by mp-app.js and reports user
 * intent through the `handlers` object. Layers (bottom to top): guest stream
 * viewer, in-game overlay stage, HUD, session badge, chat, toasts, windows.
 */
(function () {
  'use strict';

  var MP = window.PvZMP;
  var t = MP.t;
  var el = MP.util.el;

  var UI = (MP.ui = {});
  var handlers = {};
  var root, layers;

  UI.setHandlers = function (h) {
    handlers = h || {};
  };

  function call(name) {
    var fn = handlers[name];
    if (typeof fn === 'function') return fn.apply(null, Array.prototype.slice.call(arguments, 1));
  }

  UI.mount = function () {
    if (root) return;
    root = el('div#pvzmp-root');
    layers = {
      view: null,
      stage: el('div#pvzmp-stage'),
      hud: el('div#pvzmp-hud'),
      badge: null,
      chat: el('div#pvzmp-chat'),
      toasts: el('div#pvzmp-toasts'),
      modal: el('div#pvzmp-modal'),
      menu: el('div#pvzmp-menu'),
    };
    root.appendChild(layers.stage);
    root.appendChild(layers.hud);
    root.appendChild(layers.chat);
    root.appendChild(layers.menu);
    root.appendChild(layers.toasts);
    root.appendChild(layers.modal);
    document.body.appendChild(root);
  };

  /* ------------------------------------------------------------- icons */

  var ICONS = {
    coop:
      '<svg viewBox="0 0 48 48"><path fill="#5fd12e" stroke="#1d3a0b" stroke-width="2.5" d="M24 44c-1-9 0-15 0-15s-9 2-15-5c8-4 13 0 15 3 0-6-6-9-6-16 7 1 9 8 8 13 2-6 7-11 14-11-1 9-8 13-14 14 2 5 1 10-2 17z"/><circle cx="17" cy="12" r="4" fill="#ffd21a" stroke="#6b4a00" stroke-width="2"/></svg>',
    versus:
      '<svg viewBox="0 0 48 48"><path fill="#ffd21a" stroke="#4a2c00" stroke-width="2.5" d="M8 6l14 14-4 4L4 10zM40 6L26 20l4 4L44 10z"/><path fill="#c0c0c0" stroke="#333" stroke-width="2.5" d="M6 38l10-10 4 4-10 10zM42 38L32 28l-4 4 10 10z"/></svg>',
    survival:
      '<svg viewBox="0 0 48 48"><path fill="#e94b3c" stroke="#4a0c06" stroke-width="2.5" d="M24 4l17 6v12c0 11-8 19-17 22C15 41 7 33 7 22V10z"/><path fill="#fff" d="M24 12l3.3 6.8 7.5 1.1-5.4 5.3 1.3 7.4L24 29l-6.7 3.6 1.3-7.4-5.4-5.3 7.5-1.1z"/></svg>',
    brain:
      '<svg class="mp-brain" viewBox="0 0 64 54"><path fill="#ff9ad9" stroke="#5a1446" stroke-width="3" d="M32 6c-4-4-12-4-15 1-6-1-11 4-10 10-5 3-6 11-1 15-2 6 3 12 9 12 2 5 9 7 14 3 2 2 4 2 6 0 5 4 12 2 14-3 6 0 11-6 9-12 5-4 4-12-1-15 1-6-4-11-10-10-3-5-11-5-15-1z"/><path fill="none" stroke="#c1489b" stroke-width="2.5" stroke-linecap="round" d="M32 8v38M20 14c4 2 4 7 0 9M44 14c-4 2-4 7 0 9M16 30c5-1 8 2 7 6M48 30c-5-1-8 2-7 6"/></svg>',
    cursor:
      '<svg viewBox="0 0 30 34"><path d="M3 2l22 17-10 1.5 6 11-4.5 2.2-6-11L3 29z" fill="var(--mp-p2)" stroke="#fff" stroke-width="2.5" stroke-linejoin="round"/></svg>',
    clock:
      '<svg viewBox="0 0 24 24" width="26" height="26"><circle cx="12" cy="12" r="10" fill="#fff8e6" stroke="#2b1608" stroke-width="2.5"/><path d="M12 6v6l4 3" stroke="#2b1608" stroke-width="2.5" fill="none" stroke-linecap="round"/></svg>',
  };
  UI.ICONS = ICONS;

  function iconEl(name, cls) {
    var span = el('span' + (cls ? '.' + cls : ''));
    span.innerHTML = ICONS[name] || '';
    var svg = span.firstChild;
    if (!svg) return span;
    if (cls) svg.classList.add(cls);
    return svg;
  }

  /* ------------------------------------------------------------ toasts */

  UI.toast = function (text, kind, ms) {
    if (!root) return;
    var node = el('div.mp-toast' + (kind ? '.mp-' + kind : ''), { text: text });
    layers.toasts.appendChild(node);
    while (layers.toasts.children.length > 4) layers.toasts.removeChild(layers.toasts.firstChild);
    setTimeout(function () {
      node.classList.add('mp-out');
      setTimeout(function () {
        node.remove();
      }, 400);
    }, ms || 3200);
  };

  /* -------------------------------------------------------------- chat */

  var chatInput = null;
  UI.chatLine = function (name, text, color) {
    if (!root) return;
    var line = el('div.mp-chat-line', null, [el('b', { text: name + ': ', style: { color: color || '#ffd84a' } }), text]);
    layers.chat.insertBefore(line, chatInput && chatInput.parentNode === layers.chat ? chatInput : null);
    var lines = layers.chat.querySelectorAll('.mp-chat-line');
    if (lines.length > 6) lines[0].remove();
    setTimeout(function () {
      line.classList.add('mp-out');
      setTimeout(function () {
        line.remove();
      }, 700);
    }, 9000);
  };

  UI.chatOpen = function () {
    return !!chatInput;
  };

  UI.openChat = function () {
    if (chatInput) {
      chatInput.focus();
      return;
    }
    chatInput = el('input.mp-input.mp-chat-input', { maxlength: 120, placeholder: t('chat_ph') });
    MP.util.shieldInput(chatInput);
    chatInput.addEventListener('keydown', function (e) {
      if (e.key === 'Enter') {
        var v = chatInput.value.trim();
        if (v) call('chat', v);
        UI.closeChat();
      } else if (e.key === 'Escape') {
        UI.closeChat();
      }
    });
    chatInput.addEventListener('blur', function () {
      setTimeout(UI.closeChat, 100);
    });
    layers.chat.appendChild(chatInput);
    chatInput.focus();
  };

  UI.closeChat = function () {
    if (!chatInput) return;
    var i = chatInput;
    chatInput = null;
    i.remove();
  };

  /* ------------------------------------------------------------- modal */

  function openModal(content) {
    layers.modal.innerHTML = '';
    var bd = el('div.mp-backdrop', null, content);
    layers.modal.appendChild(bd);
    return bd;
  }
  function closeModal() {
    if (layers && layers.modal) layers.modal.innerHTML = '';
  }
  UI.closeModal = closeModal;

  /* ------------------------------------------------------------- lobby */

  var lobbyState = null;
  var lobbyOpen = false;

  UI.isLobbyOpen = function () {
    return lobbyOpen;
  };

  UI.openLobby = function (state) {
    lobbyOpen = true;
    lobbyState = null;
    lobbyKey = null;
    UI.renderLobby(state);
  };

  UI.closeLobby = function () {
    lobbyOpen = false;
    lobbyState = null;
    lobbyKey = null;
    lobbyBackdrop = null;
    UI.closeZombieChooser();
    closeModal();
  };

  UI.rebuildLobby = function (state) {
    if (lobbyOpen) UI.renderLobby(state, true);
  };

  // Re-rendering keeps what the player typed, the focus and scroll positions:
  // inputs carry data-k, scrollable areas data-scroll.
  function snapshot() {
    var snap = { values: {}, scroll: {}, focus: null };
    if (!layers || !layers.modal) return snap;
    layers.modal.querySelectorAll('[data-k]').forEach(function (i) {
      snap.values[i.getAttribute('data-k')] = i.value;
      if (document.activeElement === i) snap.focus = i.getAttribute('data-k');
    });
    layers.modal.querySelectorAll('[data-scroll]').forEach(function (s) {
      snap.scroll[s.getAttribute('data-scroll')] = s.scrollTop;
    });
    return snap;
  }

  function restore(snap) {
    layers.modal.querySelectorAll('[data-k]').forEach(function (i) {
      var k = i.getAttribute('data-k');
      if (snap.values[k] != null && !i.readOnly) i.value = snap.values[k];
      if (snap.focus === k) i.focus();
    });
    layers.modal.querySelectorAll('[data-scroll]').forEach(function (s) {
      var k = s.getAttribute('data-scroll');
      if (snap.scroll[k] != null) s.scrollTop = snap.scroll[k];
    });
  }

  var lobbyKey = null;
  var lobbyBackdrop = null;

  UI.renderLobby = function (state, force) {
    if (!lobbyOpen || !root) return;
    // Nothing visible changed (e.g. a room list refresh with the same rooms):
    // keep the DOM as is, so nothing flickers.
    var key = MP.lang + '|' + (MP.cards && MP.cards.ready) + '|' + JSON.stringify(state);
    var mounted = lobbyBackdrop && lobbyBackdrop.isConnected;
    if (!force && mounted && key === lobbyKey) return;
    lobbyKey = key;
    var sameView = lobbyState && lobbyState.view === state.view && lobbyState.tab === state.tab;
    var snap = sameView ? snapshot() : null;
    lobbyState = state;
    var win = el('div.mp-window.mp-interactive' + (state.view === 'home' ? '.mp-home-window' : ''));
    var close = el('button.mp-close', { title: t('close'), 'aria-label': t('close'), onclick: function () {
      call('closeLobby');
    } });
    win.appendChild(close);
    var langs = el('div.mp-lang', { title: t('language'), 'aria-label': t('language') });
    MP.LANGUAGES.forEach(function (l) {
      langs.appendChild(
        el('button' + (l.code === MP.lang ? '.mp-on' : ''), {
          text: l.label,
          lang: l.code,
          onclick: function () {
            if (l.code !== MP.lang) call('lang', l.code);
          },
        }),
      );
    });
    win.appendChild(langs);
    win.appendChild(el('div.mp-window-title', { text: t('lobby_title') }));
    if (state.view === 'home') renderHome(win, state);
    else if (state.view === 'busy') renderBusy(win, state);
    else renderRoom(win, state);
    if (mounted && lobbyBackdrop.parentNode === layers.modal) {
      // Update in place: same backdrop, no open animation, no flash.
      lobbyBackdrop.classList.add('mp-steady');
      lobbyBackdrop.replaceChildren(win);
    } else {
      var bd = openModal(win);
      bd.addEventListener('mousedown', function (e) {
        e.stopPropagation();
      });
      bd.addEventListener('wheel', function (e) {
        e.stopPropagation();
      });
      lobbyBackdrop = bd;
    }
    if (snap) restore(snap);
  };

  function input(cls, attrs) {
    var i = el('input.mp-input' + (cls ? '.' + cls : ''), attrs);
    MP.util.shieldInput(i);
    return i;
  }

  var TABS = ['play', 'rooms', 'history', 'account'];

  function renderHome(win, state) {
    var tabs = el('div.mp-tabs');
    TABS.forEach(function (k) {
      tabs.appendChild(
        el('button.mp-tab' + (state.tab === k ? '.mp-on' : ''), {
          text: t('tab_' + k),
          onclick: function () {
            if (state.tab !== k) call('tab', k);
          },
        }),
      );
    });
    win.appendChild(tabs);
    var body = el('div.mp-tab-body');
    win.appendChild(body);
    if (state.tab === 'rooms') renderRoomsTab(body, state);
    else if (state.tab === 'history') renderHistoryTab(body, state);
    else if (state.tab === 'account') renderAccountTab(body, state);
    else renderPlayTab(body, state);
  }

  function renderPlayTab(body, state) {
    body.appendChild(el('div.mp-window-sub', { text: t('lobby_subtitle') }));
    var name = input(null, { 'data-k': 'name', maxlength: 20, placeholder: t('your_name'), value: state.name || '', 'aria-label': t('your_name'), readonly: state.nameLocked });
    var row = el('div.mp-name-row', null, [el('div.mp-avatar'), name]);
    if (state.nameLocked) row.appendChild(el('span.mp-verified', { title: t('account_verified'), text: '✓' }));
    body.appendChild(row);

    var code = input('mp-code', { 'data-k': 'code', maxlength: 5, placeholder: t('room_code_ph'), value: state.code || '', 'aria-label': t('room_code') });
    code.addEventListener('input', function () {
      code.value = code.value.toUpperCase().replace(/[^A-Z0-9]/g, '');
    });
    var create = el('button.mp-btn.mp-green.mp-big', { text: t('create_room'), onclick: function () {
      call('create', name.value.trim());
    } });
    var join = el('button.mp-btn.mp-big', { text: t('join_room'), onclick: function () {
      call('join', code.value.trim(), name.value.trim());
    } });
    code.addEventListener('keydown', function (e) {
      if (e.key === 'Enter') join.click();
    });
    var left = el('div.mp-panel', null, [el('div.mp-panel-title', { text: t('create_room') }), el('div.mp-home-desc', { text: t('share_code') }), create]);
    var right = el('div.mp-panel', null, [el('div.mp-panel-title', { text: t('room_code') }), code, join]);
    body.appendChild(el('div.mp-home', null, [left, el('div.mp-home-or', { text: t('or') }), right]));
    body.appendChild(el('div.mp-error', { text: state.error ? t(state.error) : '' }));
    if (!state.nameLocked && state.online) {
      body.appendChild(
        el('div.mp-note.mp-center', null, [
          t('login_hint') + ' ',
          el('a.mp-link', { href: '#', text: t('tab_account'), onclick: function (e) {
            e.preventDefault();
            call('tab', 'account');
          } }),
        ]),
      );
    }
    setTimeout(function () {
      if (!document.activeElement || document.activeElement === document.body) (state.code ? code : name).focus();
    }, 50);
  }

  function offlineNotice(body) {
    body.appendChild(
      el('div.mp-panel.mp-empty-state', null, [el('div.mp-empty-title', { text: t('online_unavailable') }), el('div.mp-note', { text: t('online_unavailable_desc') })]),
    );
  }

  function timeAgo(ts) {
    var s = Math.max(0, Math.round((Date.now() - ts) / 1000));
    if (s < 60) return t('ago_s', { n: s });
    if (s < 3600) return t('ago_m', { n: Math.floor(s / 60) });
    if (s < 86400) return t('ago_h', { n: Math.floor(s / 3600) });
    return t('ago_d', { n: Math.floor(s / 86400) });
  }

  function stageLabel(k) {
    return MP.STAGES[k] ? t(MP.STAGES[k].label) : '';
  }

  function renderRoomsTab(body, state) {
    if (!state.online) return offlineNotice(body);
    var r = state.rooms;
    var head = el('div.mp-list-head', null, [
      el('div.mp-panel-title', { text: t('public_rooms') }),
      el('button.mp-btn.mp-small.mp-brown', { text: r.loading ? t('loading') : t('refresh'), disabled: r.loading, onclick: function () {
        call('refreshRooms');
      } }),
    ]);
    var list = el('div.mp-list.mp-scroll', { 'data-scroll': 'rooms' });
    if (r.error) list.appendChild(el('div.mp-error', { text: t(r.error) }));
    else if (!r.list.length) list.appendChild(el('div.mp-empty-state', null, [el('div.mp-empty-title', { text: r.loading ? t('loading') : t('no_rooms') }), el('div.mp-note', { text: t('no_rooms_desc') })]));
    r.list.forEach(function (room) {
      var full = room.players >= room.max || room.status === 'playing';
      var item = el('div.mp-list-item', null, [
        iconEl(room.mode || 'coop', 'mp-list-icon'),
        el('div.mp-list-main', null, [
          el('div.mp-list-title', null, [room.host + ' ', room.hasAccount ? el('span.mp-verified', { text: '✓', title: t('account_verified') }) : null]),
          el('div.mp-list-sub', { text: t('mode_' + room.mode) + (room.mode !== 'coop' && room.stage ? ' • ' + stageLabel(room.stage) : '') + ' • ' + room.code }),
        ]),
        el('div.mp-list-meta', null, [
          el('span.mp-player-tag' + (room.status === 'playing' ? '' : '.mp-ok'), { text: room.status === 'playing' ? t('status_playing') : t('status_waiting') }),
          el('div.mp-list-sub', { text: room.players + '/' + room.max }),
        ]),
        el('button.mp-btn.mp-small' + (full ? '.mp-brown' : '.mp-green'), {
          text: t('join_room'),
          disabled: full,
          onclick: function () {
            call('joinRoom', room.code);
          },
        }),
      ]);
      list.appendChild(item);
    });
    body.appendChild(el('div.mp-panel.mp-list-panel', null, [head, list]));
    body.appendChild(el('div.mp-error', { text: state.error ? t(state.error) : '' }));
  }

  function renderHistoryTab(body, state) {
    if (!state.online) return offlineNotice(body);
    var h = state.history;
    var filters = el('div.mp-seg', null, [
      el('button' + (!h.mine ? '.mp-on' : ''), { text: t('history_all'), onclick: function () {
        call('refreshHistory', false);
      } }),
      el('button' + (h.mine ? '.mp-on' : ''), { text: t('history_mine'), disabled: !state.user, title: state.user ? null : t('login_needed'), onclick: function () {
        call('refreshHistory', true);
      } }),
    ]);
    var head = el('div.mp-list-head', null, [el('div.mp-panel-title', { text: t('recent_matches') }), filters]);
    var list = el('div.mp-list.mp-scroll', { 'data-scroll': 'history' });
    if (h.error) list.appendChild(el('div.mp-error', { text: t(h.error) }));
    else if (!h.list.length) list.appendChild(el('div.mp-empty-state', null, [el('div.mp-empty-title', { text: h.loading ? t('loading') : t('no_matches') })]));
    h.list.forEach(function (m) {
      var players = el('div.mp-match-players');
      m.players.forEach(function (p, i) {
        if (i) players.appendChild(el('span.mp-vs', { text: m.mode === 'versus' ? t('vs') : '+' }));
        var detail = m.mode === 'versus' ? t('side_' + p.side) : m.mode === 'survival' ? t('wave_short', { n: p.score }) : '';
        players.appendChild(
          el('span.mp-match-player' + (p.win ? '.mp-winner' : ''), null, [
            p.win ? '🏆 ' : '',
            p.name,
            p.account ? el('span.mp-verified', { text: '✓' }) : null,
            detail ? el('small', { text: ' (' + detail + ')' }) : null,
          ]),
        );
      });
      list.appendChild(
        el('div.mp-list-item', null, [
          iconEl(m.mode || 'coop', 'mp-list-icon'),
          el('div.mp-list-main', null, [players, el('div.mp-list-sub', { text: t('mode_' + m.mode) + (m.stage ? ' • ' + stageLabel(m.stage) : '') + ' • ' + MP.util.formatTime(m.duration) })]),
          el('div.mp-list-meta', null, [el('div.mp-list-sub', { text: timeAgo(m.at) })]),
        ]),
      );
    });
    body.appendChild(el('div.mp-panel.mp-list-panel', null, [head, list]));
  }

  function renderAccountTab(body, state) {
    if (!state.online) return offlineNotice(body);
    var acc = state.account;
    var user = state.user;
    if (!user) {
      var reg = acc.mode === 'register';
      var u = input(null, { 'data-k': 'acc-user', maxlength: 20, placeholder: t('username'), autocomplete: 'username' });
      var p = input(null, { 'data-k': 'acc-pass', type: 'password', maxlength: 128, placeholder: t('password'), autocomplete: reg ? 'new-password' : 'current-password' });
      var p2 = reg ? input(null, { 'data-k': 'acc-pass2', type: 'password', maxlength: 128, placeholder: t('password_repeat'), autocomplete: 'new-password' }) : null;
      var submit = el('button.mp-btn.mp-big' + (reg ? '.mp-green' : ''), {
        text: acc.busy ? t('loading') : reg ? t('register') : t('login'),
        disabled: acc.busy,
        onclick: function () {
          call('accountSubmit', reg ? 'register' : 'login', u.value.trim(), p.value, p2 ? p2.value : '');
        },
      });
      [u, p, p2].forEach(function (i) {
        if (i)
          i.addEventListener('keydown', function (e) {
            if (e.key === 'Enter') submit.click();
          });
      });
      var form = el('div.mp-panel.mp-account-form', null, [
        el('div.mp-seg.mp-account-switch', null, [
          el('button' + (!reg ? '.mp-on' : ''), { text: t('login'), onclick: function () {
            call('accountMode', 'login');
          } }),
          el('button' + (reg ? '.mp-on' : ''), { text: t('register'), onclick: function () {
            call('accountMode', 'register');
          } }),
        ]),
        el('div.mp-field', null, [el('label.mp-label', { text: t('username') }), u]),
        el('div.mp-field', null, [el('label.mp-label', { text: t('password') }), p]),
        p2 ? el('div.mp-field', null, [el('label.mp-label', { text: t('password_repeat') }), p2]) : null,
        submit,
        el('div.mp-error', { text: acc.error ? t(acc.error) : '' }),
      ]);
      var why = el('div.mp-panel.mp-account-why', null, [
        el('div.mp-panel-title', { text: t('account_why') }),
        el('ul.mp-bullets', null, [el('li', { text: t('account_why_1') }), el('li', { text: t('account_why_2') }), el('li', { text: t('account_why_3') })]),
      ]);
      body.appendChild(el('div.mp-account', null, [form, why]));
      setTimeout(function () {
        if (!document.activeElement || document.activeElement === document.body) u.focus();
      }, 50);
      return;
    }
    var st = user.stats || {};
    var stat = function (label, value) {
      return el('div.mp-stat', null, [el('div.mp-stat-v', { text: String(value || 0) }), el('div.mp-stat-l', { text: label })]);
    };
    var profile = el('div.mp-panel', null, [
      el('div.mp-account-name', null, [el('div.mp-avatar'), el('span', { text: user.username }), el('span.mp-verified', { text: '✓' })]),
      el('div.mp-note', { text: t('member_since', { date: new Date(user.createdAt).toLocaleDateString() }) }),
      el('div.mp-stats-grid', null, [stat(t('stat_matches'), st.matches), stat(t('stat_wins'), st.wins), stat(t('stat_versus_wins'), st.versusWins), stat(t('stat_best_wave'), st.bestWave)]),
      el('div.mp-account-actions', null, [el('button.mp-btn.mp-small.mp-red', { text: t('logout'), onclick: function () {
        call('logout');
      } })]),
    ]);
    var c = state.cloud;
    var statusText = c.status === 'syncing' ? t('cloud_syncing') : c.status === 'conflict' ? t('cloud_conflict_short') : c.status === 'error' || c.status === 'offline' ? t('cloud_error') : c.lastSync ? t('cloud_synced_at', { when: timeAgo(c.lastSync) }) : t('cloud_never');
    var cloud = el('div.mp-panel', null, [
      el('div.mp-panel-title', { text: t('cloud_title') }),
      el('div.mp-cloud-status.mp-cloud-' + c.status, { text: statusText }),
      el('div.mp-note', { text: t('cloud_desc') }),
      el('div.mp-account-actions', null, [
        el('button.mp-btn.mp-small.mp-green', { text: t('cloud_sync_now'), disabled: c.status === 'syncing', onclick: function () {
          call('cloudSync');
        } }),
        el('button.mp-btn.mp-small.mp-brown', { text: t('cloud_download'), disabled: c.status === 'syncing', onclick: function () {
          call('cloudDownload');
        } }),
      ]),
    ]);
    body.appendChild(el('div.mp-account', null, [profile, cloud]));
    if (acc.notice) body.appendChild(el('div.mp-status', { text: t(acc.notice) }));
  }

  function renderBusy(win, state) {
    win.appendChild(
      el('div.mp-panel', { style: { display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '16px', minHeight: '160px', fontSize: '26px' } }, [
        el('span.mp-spinner'),
        el('span.mp-outline', { text: t(state.busyText || 'connecting') }),
      ]),
    );
    win.appendChild(
      el('div.mp-room-footer', null, [
        el('div.mp-status'),
        el('button.mp-btn.mp-red', { text: t('back'), onclick: function () {
          call('leave');
        } }),
      ]),
    );
  }

  function segment(options, value, disabled, onPick, extraCls) {
    var box = el('div.mp-seg' + (extraCls ? '.' + extraCls : ''));
    options.forEach(function (o) {
      var b = el('button' + (String(o.value) === String(value) ? '.mp-on' : ''), {
        disabled: disabled || o.disabled,
        title: o.title || null,
        onclick: function () {
          if (!disabled) onPick(o.value);
        },
      });
      if (o.img) {
        b.style.backgroundImage = 'var(--mp-img-' + o.img + ')';
        b.appendChild(el('span', { text: o.label }));
      } else b.textContent = o.label;
      box.appendChild(b);
    });
    return box;
  }

  function optionLabel(def, v) {
    if (def.fmt === 'minutes') return t('minutes', { n: v });
    if (def.fmt === 'waves_n') return t('waves_n', { n: v });
    if (def.fmt === 'mult') return v + 'x';
    if (def.fmt) return t(def.fmt + v);
    return String(v);
  }

  // One zombie seed packet: the game's own artwork plus brain cost.
  function zombiePacket(type, opts) {
    opts = opts || {};
    var c = MP.zombieCost(type);
    var art = MP.cards && MP.cards.zombie(type);
    var node = el(
      (opts.button ? 'button' : 'div') + '.mp-zpacket' + (opts.cls ? '.' + opts.cls : '') + (art ? '' : '.mp-noart'),
      { title: MP.zombieName(type), 'data-type': type, disabled: opts.disabled, onclick: opts.onclick || null },
      [
        el('img.mp-zpacket-art', { src: art || null, alt: '', draggable: 'false' }),
        el('span.mp-zpacket-name', { text: MP.zombieName(type) }),
        el('span.mp-zpacket-cost', null, [iconEl('brain', 'mp-zchip-brain'), String(c.cost)]),
        opts.n ? el('span.mp-zchip-n', { text: String(opts.n) }) : null,
      ],
    );
    return node;
  }
  UI.zombiePacket = zombiePacket;

  // Artwork finished drawing: fill every packet of that zombie on screen.
  UI.fillZombieArt = function (type, url) {
    if (!root) return;
    root.querySelectorAll('.mp-zpacket.mp-noart[data-type="' + type + '"]').forEach(function (p) {
      var img = p.querySelector('.mp-zpacket-art');
      if (img) img.src = url;
      p.classList.remove('mp-noart');
    });
  };

  // The current deck as a row of packets (read-only in the room).
  function renderDeck(state, s) {
    var deck = s.zdeck || [];
    var row = el('div.mp-zdeck-row');
    for (var i = 0; i < MP.DECK_SIZE; i++) {
      row.appendChild(deck[i] ? zombiePacket(deck[i], { n: i + 1 }) : el('div.mp-zpacket.mp-empty-slot'));
    }
    var box = el('div.mp-zdeck', null, [row]);
    if (state.canEditDeck) {
      box.appendChild(
        el('button.mp-btn.mp-small.mp-green', {
          text: t('choose_zombies'),
          onclick: function () {
            call('openZombieChooser');
          },
        }),
      );
    }
    return box;
  }

  /* ------------------------------------------------ zombie seed chooser */

  // Big window like the game's seed chooser: chosen packets on top, every
  // available zombie below, filtered by world.
  var chooser = null;
  var chooserWorld = 'all';

  UI.isZombieChooserOpen = function () {
    return !!chooser;
  };

  UI.openZombieChooser = function (opts) {
    UI.closeZombieChooser();
    chooser = { opts: opts };
    var win = el('div.mp-window.mp-zchooser.mp-interactive');
    win.appendChild(el('button.mp-close', { title: t('close'), onclick: function () {
      UI.closeZombieChooser();
    } }));
    win.appendChild(el('div.mp-window-title', { text: t('choose_zombies') }));
    win.appendChild(el('div.mp-window-sub', { text: t('choose_zombies_desc', { n: MP.DECK_SIZE }) }));
    var bank = el('div.mp-zbank');
    var tabs = el('div.mp-seg.mp-ztabs');
    var grid = el('div.mp-zgrid.mp-scroll');
    var footer = el('div.mp-results-actions', null, [
      el('button.mp-btn.mp-brown', { text: t('reset_deck'), onclick: function () {
        call('resetDeck');
      } }),
      el('button.mp-btn.mp-green.mp-big', { text: t('done'), onclick: function () {
        UI.closeZombieChooser();
      } }),
    ]);
    win.appendChild(el('div.mp-panel', null, [bank]));
    win.appendChild(el('div.mp-panel.mp-zgrid-panel', null, [tabs, grid]));
    win.appendChild(footer);
    var bd = el('div.mp-backdrop.mp-dialog-layer', null, win);
    bd.addEventListener('mousedown', function (e) {
      e.stopPropagation();
    });
    bd.addEventListener('wheel', function (e) {
      e.stopPropagation();
    });
    root.appendChild(bd);
    chooser.node = bd;
    chooser.bank = bank;
    chooser.tabs = tabs;
    chooser.grid = grid;
    renderChooserTabs();
    renderChooserGrid();
    UI.updateZombieChooser(opts.deck);
  };

  function worldLabel(w) {
    var key = 'world_' + w;
    var s = t(key);
    return s === key ? w : s;
  }

  function renderChooserTabs() {
    var c = chooser;
    var worlds = [];
    c.opts.choices.forEach(function (z) {
      if (worlds.indexOf(z.world) < 0) worlds.push(z.world);
    });
    if (worlds.indexOf(chooserWorld) < 0) chooserWorld = 'all';
    c.tabs.innerHTML = '';
    ['all'].concat(worlds).forEach(function (w) {
      c.tabs.appendChild(
        el('button' + (w === chooserWorld ? '.mp-on' : ''), {
          text: w === 'all' ? t('world_all') : worldLabel(w),
          onclick: function () {
            chooserWorld = w;
            renderChooserTabs();
            renderChooserGrid();
          },
        }),
      );
    });
  }

  function renderChooserGrid() {
    var c = chooser;
    c.grid.innerHTML = '';
    c.grid.scrollTop = 0;
    var shown = [];
    c.opts.choices.forEach(function (z) {
      if (chooserWorld !== 'all' && z.world !== chooserWorld) return;
      shown.push(z.type);
      c.grid.appendChild(
        zombiePacket(z.type, {
          button: true,
          onclick: function () {
            call('toggleDeck', z.type);
          },
        }),
      );
    });
    if (MP.cards && MP.cards.prioritize) MP.cards.prioritize(shown);
    markChosen();
  }

  function markChosen() {
    var deck = chooser.deck || [];
    chooser.grid.querySelectorAll('.mp-zpacket').forEach(function (p) {
      p.classList.toggle('mp-chosen', deck.indexOf(p.getAttribute('data-type')) >= 0);
    });
  }

  UI.updateZombieChooser = function (deck) {
    if (!chooser) return;
    chooser.deck = (deck || []).slice();
    chooser.bank.innerHTML = '';
    for (var i = 0; i < MP.DECK_SIZE; i++) {
      var type = chooser.deck[i];
      chooser.bank.appendChild(
        type
          ? zombiePacket(type, {
              button: true,
              n: i + 1,
              onclick: (function (ty) {
                return function () {
                  call('toggleDeck', ty);
                };
              })(type),
            })
          : el('div.mp-zpacket.mp-empty-slot'),
      );
    }
    markChosen();
  };

  // New packet artwork became available (lazy load): redraw in place.
  UI.refreshZombieArt = function () {
    if (!chooser) return;
    renderChooserGrid();
    UI.updateZombieChooser(chooser.deck);
  };

  UI.closeZombieChooser = function () {
    if (chooser && chooser.node) chooser.node.remove();
    chooser = null;
  };

  function renderRoom(win, state) {
    var s = state.settings;
    var edit = state.role === 'host';

    // Left: room code, players, room/stream settings.
    var codeBox = el('div.mp-panel.mp-code-box', null, [
      el('div.mp-panel-title', { text: t('room_code') }),
      el('div.mp-code-value', { text: state.code || '-----' }),
      el('div.mp-code-actions', null, [
        el('button.mp-btn.mp-small.mp-brown', { text: t('copy'), onclick: function (e) {
          call('copy', 'code', e.currentTarget);
        } }),
        el('button.mp-btn.mp-small.mp-blue', { text: t('copy_link'), onclick: function (e) {
          call('copy', 'link', e.currentTarget);
        } }),
      ]),
    ]);
    var players = el('div.mp-players');
    state.players.forEach(function (p) {
      if (!p) {
        players.appendChild(el('div.mp-player.mp-empty', null, [el('span.mp-spinner', { style: { width: '22px', height: '22px' } }), el('span.mp-player-name', { text: t('empty_slot') })]));
        return;
      }
      var tag = p.role === 'host' ? el('span.mp-player-tag.mp-host', { text: t('host') }) : el('span.mp-player-tag' + (p.ready ? '.mp-ok' : ''), { text: p.ready ? t('is_ready') : t('waiting') });
      players.appendChild(
        el('div.mp-player' + (p.you ? '.mp-me' : ''), { title: p.you ? p.name + ' (' + t('you') + ')' : p.name }, [
          el('span.mp-player-dot', { style: { background: p.role === 'host' ? 'var(--mp-p1)' : 'var(--mp-p2)' } }),
          el('span.mp-player-name', { text: p.name }),
          p.account ? el('span.mp-verified', { text: '✓', title: t('account_verified') }) : null,
          tag,
        ]),
      );
    });
    var side = el('div.mp-room-side', null, [codeBox, el('div.mp-panel', null, [el('div.mp-panel-title', { text: t('players') }), players])]);
    var extra = el('div.mp-panel.mp-extra.mp-scroll', { 'data-scroll': 'extra' });
    if (edit) {
      extra.appendChild(el('div.mp-panel-title', { text: t('quality') }));
      extra.appendChild(
        segment(
          ['low', 'medium', 'high'].map(function (q) {
            return { value: q, label: t('quality_' + q) };
          }),
          s.quality,
          false,
          function (v) {
            call('setting', 'quality', v);
          },
        ),
      );
      if (state.online) {
        extra.appendChild(el('div.mp-panel-title', { text: t('room_visibility'), style: { marginTop: '10px' } }));
        extra.appendChild(
          segment(
            [
              { value: true, label: t('room_public') },
              { value: false, label: t('room_private') },
            ],
            s.public !== false,
            false,
            function (v) {
              call('setting', 'public', v);
            },
          ),
        );
      }
    } else {
      extra.appendChild(el('div.mp-note', { text: t('only_host_changes') }));
    }
    extra.appendChild(el('div.mp-note', { text: t('controls_hint'), style: { marginTop: '10px' } }));
    side.appendChild(extra);

    // Right: modes + options.
    var modes = el('div.mp-modes');
    MP.MODE_LIST.forEach(function (m) {
      var card = el('div.mp-mode' + (s.mode === m ? '.mp-selected' : '') + (edit ? '' : '.mp-locked'), {
        'data-mode': m,
        role: 'button',
        tabindex: edit ? 0 : -1,
        onclick: function () {
          if (edit) call('setting', 'mode', m);
        },
      });
      card.appendChild(iconEl(m, 'mp-mode-icon'));
      card.appendChild(el('div.mp-mode-name', { text: t('mode_' + m) }));
      card.appendChild(el('div.mp-mode-desc', { text: t('mode_' + m + '_desc') }));
      card.appendChild(el('div.mp-check', { text: '✓' }));
      modes.appendChild(card);
    });

    var opts = el('div.mp-options');
    function opt(label, control) {
      opts.appendChild(el('div.mp-opt', null, [el('div.mp-opt-label', { text: label }), control]));
    }
    function set(key) {
      return function (v) {
        call('setting', key, v);
      };
    }
    if (s.mode === 'coop') {
      opts.appendChild(el('div.mp-note', { text: t('coop_options_note') }));
    } else {
      var stageOptions = Object.keys(MP.STAGES).map(function (k) {
        return { value: k, label: t(MP.STAGES[k].label), img: MP.STAGES[k].img };
      });
      opt(t('arena'), segment(stageOptions, s.stage, !edit, set('stage'), 'mp-stages'));
      if (s.mode === 'versus') {
        opt(
          t('your_side'),
          segment(
            [
              { value: 'plants', label: t('side_plants') },
              { value: 'zombies', label: t('side_zombies') },
            ],
            state.role === 'host' ? s.hostSide : s.hostSide === 'plants' ? 'zombies' : 'plants',
            !edit,
            function (v) {
              // Shown from the viewer's perspective; stored as the host's side.
              call('setting', 'hostSide', v);
            },
          ),
        );
      }
      Object.keys(MP.OPTIONS).forEach(function (key) {
        var def = MP.OPTIONS[key];
        if (def.modes.indexOf(s.mode) < 0) return;
        opt(
          t(def.label),
          segment(
            def.values.map(function (v) {
              return { value: v, label: optionLabel(def, v) };
            }),
            s[key],
            !edit,
            set(key),
          ),
        );
      });
      if (s.mode === 'versus') {
        var deckTitle = el('div.mp-panel-title', { text: t('zombie_deck', { n: (s.zdeck || []).length, max: MP.DECK_SIZE }), style: { marginTop: '6px' } });
        opts.appendChild(deckTitle);
        opts.appendChild(el('div.mp-note', { text: state.canEditDeck ? t('zombie_deck_you') : t('zombie_deck_other') }));
        opts.appendChild(renderDeck(state, s));
        opts.appendChild(el('div.mp-note', { text: t('plants_pick_note') }));
      } else {
        opts.appendChild(el('div.mp-note', { text: t('survival_note') }));
      }
    }

    var main = el('div.mp-room-main', null, [
      el('div.mp-panel', null, [el('div.mp-panel-title', { text: t('mode') }), modes]),
      el('div.mp-panel.mp-scroll', { style: { flex: '1' }, 'data-scroll': 'options' }, [el('div.mp-panel-title', { text: t('options') }), opts]),
    ]);
    win.appendChild(el('div.mp-room', null, [side, main]));

    var footer = el('div.mp-room-footer', null, [
      el('button.mp-btn.mp-red', { text: t('leave'), onclick: function () {
        call('leave');
      } }),
      el('div.mp-status', { text: state.status ? t(state.status) : '' }),
    ]);
    if (state.role === 'host') {
      footer.appendChild(
        el('button.mp-btn.mp-green.mp-big', {
          text: t('start'),
          disabled: !state.canStart,
          onclick: function () {
            call('start');
          },
        }),
      );
    } else {
      footer.appendChild(
        el('button.mp-btn.mp-big' + (state.ready ? '.mp-brown' : '.mp-green'), {
          text: state.ready ? t('not_ready') : t('ready'),
          onclick: function () {
            call('ready', !state.ready);
          },
        }),
      );
    }
    win.appendChild(footer);
    if (state.error) win.appendChild(el('div.mp-error', { text: t(state.error) }));
  }

  UI.flashCopied = function (button) {
    if (!button) return;
    var old = button.textContent;
    button.textContent = t('copied');
    setTimeout(function () {
      button.textContent = old;
    }, 1400);
  };

  /* ----------------------------------------------------- session badge */

  var badge = null;
  UI.renderBadge = function (info) {
    if (!root) return;
    if (!info) {
      if (badge) badge.remove();
      badge = null;
      return;
    }
    if (!badge) {
      badge = el('div#pvzmp-badge.mp-interactive');
      badge.addEventListener('mousedown', function (e) {
        e.stopPropagation();
      });
      root.insertBefore(badge, layers.chat);
      badge._collapsed = MP.store.get('badgeCollapsed', false);
    }
    var key = JSON.stringify(info) + badge._collapsed;
    if (badge._key === key) return;
    badge._key = key;
    badge.classList.toggle('mp-collapsed', !!badge._collapsed);
    badge.innerHTML = '';
    var head = el('div.mp-badge-head', { onclick: function () {
      badge._collapsed = !badge._collapsed;
      MP.store.set('badgeCollapsed', badge._collapsed);
      badge._key = null;
      UI.renderBadge(info);
    } }, [iconEl(info.mode, 'mp-mode-icon'), el('span', { text: t('mode_' + info.mode) }), el('span.mp-badge-toggle', { text: badge._collapsed ? '▶' : '◀' })]);
    head.firstChild.style.width = head.firstChild.style.height = '24px';
    badge.appendChild(head);
    info.players.forEach(function (p) {
      var ping = p.ping != null ? el('span.mp-ping' + (p.ping > 180 ? '.mp-bad' : ''), { text: t('ping', { ms: p.ping }) }) : null;
      badge.appendChild(el('div.mp-badge-row', null, [el('span.mp-player-dot', { style: { background: p.color } }), el('span', { text: p.name }), ping]));
      if (p.info) badge.appendChild(el('div.mp-badge-info', { text: p.info }));
    });
    if (info.line) badge.appendChild(el('div.mp-badge-info', { text: info.line }));
    badge.appendChild(el('div.mp-note', { text: t('chat_hint') }));
    (info.actions || []).forEach(function (a) {
      badge.appendChild(el('button.mp-btn.mp-small.' + (a.cls || 'mp-red'), { text: a.label, onclick: a.fn }));
    });
  };

  /* --------------------------------------------- survival: partner's lawn */

  var pip = null;
  UI.showPip = function (stream) {
    if (!root) return;
    if (!pip) {
      var video = el('video', { autoplay: true, playsinline: true });
      video.muted = true;
      var name = el('span.mp-pip-name');
      var info = el('span.mp-pip-info');
      var sound = el('button.mp-pip-btn', { title: t('pip_sound'), text: '🔇' });
      var expand = el('button.mp-pip-btn', { title: t('pip_expand'), text: '⤢' });
      var back = el('button.mp-btn.mp-small.mp-green.mp-pip-back', { text: t('pip_back') });
      pip = el('div#pvzmp-pip.mp-interactive', null, [video, el('div.mp-pip-bar', null, [el('span.mp-player-dot', { style: { background: 'var(--mp-p2)' } }), name, info, sound, expand]), back]);
      pip._video = video;
      pip._name = name;
      pip._info = info;
      sound.onclick = function (e) {
        e.stopPropagation();
        video.muted = !video.muted;
        sound.textContent = video.muted ? '🔇' : '🔊';
        if (!video.muted) video.play().catch(function () {});
      };
      expand.onclick = function (e) {
        e.stopPropagation();
        UI.expandPip(!pip.classList.contains('mp-pip-expanded'));
      };
      back.onclick = function (e) {
        e.stopPropagation();
        UI.expandPip(false);
      };
      video.ondblclick = function () {
        UI.expandPip(!pip.classList.contains('mp-pip-expanded'));
      };
      pip.addEventListener('mousedown', function (e) {
        e.stopPropagation();
      });
      enablePipDrag(pip, pip.querySelector('.mp-pip-bar'));
      root.insertBefore(pip, layers.chat);
    }
    pip._video.srcObject = stream;
    pip._video.play().catch(function () {});
  };

  // The window can be dragged by its title bar; the position is remembered.
  function enablePipDrag(box, handle) {
    var saved = MP.store.get('pipPos', null);
    if (saved) {
      box.style.left = saved.x + 'px';
      box.style.top = saved.y + 'px';
      box.style.bottom = 'auto';
    }
    var drag = null;
    handle.addEventListener('pointerdown', function (e) {
      if (box.classList.contains('mp-pip-expanded') || e.target.tagName === 'BUTTON') return;
      var r = box.getBoundingClientRect();
      drag = { dx: e.clientX - r.left, dy: e.clientY - r.top };
      handle.setPointerCapture(e.pointerId);
      e.preventDefault();
    });
    handle.addEventListener('pointermove', function (e) {
      if (!drag) return;
      var x = MP.util.clamp(e.clientX - drag.dx, 0, window.innerWidth - box.offsetWidth);
      var y = MP.util.clamp(e.clientY - drag.dy, 0, window.innerHeight - box.offsetHeight);
      box.style.left = x + 'px';
      box.style.top = y + 'px';
      box.style.bottom = 'auto';
    });
    handle.addEventListener('pointerup', function () {
      if (!drag) return;
      drag = null;
      MP.store.set('pipPos', { x: parseFloat(box.style.left) || 0, y: parseFloat(box.style.top) || 0 });
    });
  }

  UI.setPipLabel = function (name, info) {
    if (!pip) return;
    pip._name.textContent = name || '';
    pip._info.textContent = info ? ' • ' + info : '';
  };

  UI.expandPip = function (on) {
    if (pip) pip.classList.toggle('mp-pip-expanded', !!on);
  };

  UI.hidePipExpanded = function () {
    UI.expandPip(false);
  };

  UI.hidePip = function () {
    if (!pip) return;
    try {
      pip._video.srcObject = null;
    } catch (e) {}
    pip.remove();
    pip = null;
  };

  /* ------------------------------------------------- cloud save conflict */

  var dialog = null;
  UI.showCloudConflict = function (c) {
    if (!root) return;
    UI.closeCloudConflict();
    var when = c && c.cloud && c.cloud.updatedAt ? new Date(c.cloud.updatedAt).toLocaleString() : '';
    var win = el('div.mp-window.mp-dialog.mp-interactive', null, [
      el('div.mp-window-title', { text: t('cloud_title') }),
      el('div.mp-panel', null, [el('div.mp-dialog-text', { text: t('cloud_conflict', { when: when }) })]),
      el('div.mp-results-actions', null, [
        el('button.mp-btn.mp-brown', { text: t('cloud_keep_local'), onclick: function () {
          call('cloudKeepLocal');
        } }),
        el('button.mp-btn.mp-green', { text: t('cloud_keep_cloud'), onclick: function () {
          call('cloudKeepCloud');
        } }),
      ]),
    ]);
    dialog = el('div.mp-backdrop.mp-dialog-layer', null, win);
    dialog.addEventListener('mousedown', function (e) {
      e.stopPropagation();
    });
    root.appendChild(dialog);
  };

  UI.closeCloudConflict = function () {
    if (dialog) dialog.remove();
    dialog = null;
  };

  /* ----------------------------------------------------------- versus HUD */

  var hudNodes = null;
  UI.renderVersusHud = function (frame, data) {
    if (!root) return;
    if (!data || !frame) {
      layers.hud.innerHTML = '';
      hudNodes = null;
      return;
    }
    if (!hudNodes) {
      layers.hud.innerHTML = '';
      hudNodes = {
        brains: el('div.mp-vs-hud', null, [iconEl('brain'), el('span.mp-brain-count', { text: '0' })]),
        timer: el('div.mp-vs-timer', null, [iconEl('clock'), el('span', { text: '0:00' })]),
        goal: el('div.mp-goal'),
      };
      layers.hud.appendChild(hudNodes.brains);
      layers.hud.appendChild(hudNodes.timer);
      layers.hud.appendChild(hudNodes.goal);
    }
    var hud = layers.hud.style;
    hud.left = frame.left + 'px';
    hud.top = frame.top + 'px';
    hud.width = frame.width + 'px';
    hud.height = frame.height + 'px';
    var scale = Math.max(0.6, Math.min(1.2, frame.height / 720));
    var b = hudNodes.brains;
    b.style.right = 14 * scale + 'px';
    b.style.bottom = (data.barTop != null ? (1 - data.barTop) * frame.height + 6 : 90 * scale) + 'px';
    b.style.transform = 'scale(' + scale + ')';
    b.style.transformOrigin = 'right bottom';
    b.lastChild.textContent = String(Math.floor(data.brains));
    b.title = data.income ? '+' + data.income.toFixed(1) + '/s' : '';
    var tm = hudNodes.timer;
    tm.style.left = '50%';
    tm.style.top = (data.timerTop != null ? data.timerTop * frame.height : 90 * scale) + 'px';
    tm.style.transform = 'translateX(-50%) scale(' + scale + ')';
    tm.style.transformOrigin = 'center top';
    tm.lastChild.textContent = MP.util.formatTime(data.timeLeft);
    tm.classList.toggle('mp-hurry', data.timeLeft <= 30);
    var g = hudNodes.goal;
    g.style.left = '50%';
    g.style.top = (data.timerTop != null ? data.timerTop * frame.height : 90 * scale) + 44 * scale + 'px';
    g.style.fontSize = 17 * scale + 'px';
    g.textContent = data.goal || '';
  };

  /* ------------------------------------------------------- overlay stage */

  var stageNodes = {};
  function stageNode(key, cls, build) {
    var n = stageNodes[key];
    if (!n) {
      n = build ? build() : el('div.' + cls);
      stageNodes[key] = n;
      layers.stage.appendChild(n);
    }
    n._used = true;
    return n;
  }
  function place(node, frame, r) {
    node.style.left = r.x * frame.width + 'px';
    node.style.top = r.y * frame.height + 'px';
    node.style.width = r.w * frame.width + 'px';
    node.style.height = r.h * frame.height + 'px';
  }

  // scene: {frame, layout, cursor, cells:[{l,c,kind,local}], lanes:[{l,local}],
  //         sel:{kind,i}, cd:[...], ghost:{src,x,y,w,h}}
  UI.renderStage = function (scene) {
    if (!root) return;
    Object.keys(stageNodes).forEach(function (k) {
      stageNodes[k]._used = false;
    });
    if (scene && scene.frame) {
      var f = scene.frame;
      var st = layers.stage.style;
      st.left = f.left + 'px';
      st.top = f.top + 'px';
      st.width = f.width + 'px';
      st.height = f.height + 'px';
      var lay = scene.layout || {};
      var grid = lay.grid;

      (scene.lanes || []).forEach(function (ln, i) {
        if (!grid || ln.l < 0) return;
        var n = stageNode('lane' + i, 'mp-lane');
        place(n, f, { x: grid.x, y: grid.y + grid.ch * ln.l, w: grid.cw * grid.cols + grid.cw * 0.6, h: grid.ch });
      });
      (scene.cells || []).forEach(function (c, i) {
        if (!grid || !c) return;
        var n = stageNode('cell' + i, 'mp-cell');
        n.className = 'mp-cell' + (c.local ? ' mp-local' : '') + (c.kind === 'shovel' ? ' mp-shovel' : '');
        place(n, f, { x: grid.x + grid.cw * c.c + 2 / f.width, y: grid.y + grid.ch * c.l + 2 / f.height, w: grid.cw - 4 / f.width, h: grid.ch - 4 / f.height });
      });
      if (scene.sel) {
        var r = scene.sel.kind === 'card' ? lay.cards && lay.cards[scene.sel.i] : scene.sel.kind === 'zcard' ? lay.zcards && lay.zcards[scene.sel.i] : scene.sel.kind === 'shovel' ? lay.shovel : scene.sel.kind === 'food' ? lay.food : null;
        if (r) {
          var sn = stageNode('sel', 'mp-sel', function () {
            return el('div.mp-sel', null, [el('div.mp-sel-tag')]);
          });
          sn.firstChild.textContent = scene.sel.tag || t('p2_label');
          place(sn, f, r);
        }
      }
      (scene.cd || []).forEach(function (frac, i) {
        var zr = lay.zcards && lay.zcards[i];
        if (!zr || !(frac > 0)) return;
        var n = stageNode('cd' + i, 'mp-cd');
        place(n, f, { x: zr.x, y: zr.y, w: zr.w, h: zr.h * frac });
      });
      if (scene.cursor) {
        var cur = stageNode('cursor', 'mp-cursor', function () {
          var c = el('div.mp-cursor');
          c.innerHTML = ICONS.cursor;
          c.appendChild(el('div.mp-cursor-held'));
          c.appendChild(el('div.mp-cursor-name'));
          return c;
        });
        cur.style.left = scene.cursor.x * f.width + 'px';
        cur.style.top = scene.cursor.y * f.height + 'px';
        cur.lastChild.textContent = scene.cursor.name || '';
        var held = cur.children[1];
        held.style.display = scene.cursor.held ? 'flex' : 'none';
        held.textContent = scene.cursor.held || '';
      }
      if (scene.ghost && scene.ghost.src) {
        var g = stageNode('ghost', 'mp-ghost', function () {
          return el('img.mp-ghost', { alt: '' });
        });
        if (g.getAttribute('src') !== scene.ghost.src) g.setAttribute('src', scene.ghost.src);
        g.style.left = scene.ghost.x * f.width + 'px';
        g.style.top = scene.ghost.y * f.height + 'px';
        g.style.width = scene.ghost.w * f.width + 'px';
      }
    }
    Object.keys(stageNodes).forEach(function (k) {
      if (!stageNodes[k]._used) {
        stageNodes[k].remove();
        delete stageNodes[k];
      }
    });
  };

  /* -------------------------------------------------- guest stream viewer */

  var view = null;
  UI.showView = function () {
    if (view) return view;
    var video = el('video', { autoplay: true, playsinline: true });
    var wait = el('div.mp-view-wait', null, [el('span.mp-spinner'), el('div', { text: t('stream_waiting') }), el('div.mp-view-tip', { text: t('chat_hint') })]);
    view = el('div#pvzmp-view', null, [video, wait]);
    view._video = video;
    view._wait = wait;
    root.insertBefore(view, root.firstChild);

    function norm(e) {
      var r = UI.viewContentRect();
      if (!r) return null;
      return { x: (e.clientX - r.left) / r.width, y: (e.clientY - r.top) / r.height };
    }
    view.addEventListener('pointermove', function (e) {
      var p = norm(e);
      if (p) call('viewPointer', 'move', p.x, p.y, e.button);
    });
    view.addEventListener('pointerdown', function (e) {
      var p = norm(e);
      if (video.paused) video.play().catch(function () {});
      if (p) call('viewPointer', 'down', p.x, p.y, e.button);
      e.preventDefault();
    });
    view.addEventListener('pointerleave', function () {
      call('viewPointer', 'leave', -1, -1, 0);
    });
    view.addEventListener('contextmenu', function (e) {
      e.preventDefault();
    });
    view.addEventListener('wheel', function (e) {
      e.preventDefault();
      var p = norm(e);
      if (p) call('viewPointer', 'wheel', p.x, p.y, 0, e.deltaY);
    }, { passive: false });
    return view;
  };

  UI.setViewStream = function (stream) {
    if (!view) UI.showView();
    var video = view._video;
    video.srcObject = stream;
    video.muted = false;
    var p = video.play();
    if (p && p.catch) {
      p.catch(function () {
        // Autoplay with sound blocked: wait for a click.
        view._wait.querySelector('div').textContent = t('click_to_play');
      });
    }
    video.onplaying = function () {
      view._wait.style.display = 'none';
    };
  };

  UI.setViewWaiting = function (text) {
    if (!view) return;
    view._wait.style.display = '';
    view._wait.querySelector('div').textContent = text || t('stream_waiting');
  };

  UI.hideView = function () {
    if (!view) return;
    try {
      view._video.srcObject = null;
    } catch (e) {}
    view.remove();
    view = null;
  };

  UI.viewVisible = function () {
    return !!view;
  };

  UI.viewVideo = function () {
    return view && view._video;
  };

  // Rectangle of the actual picture inside the letterboxed <video>.
  UI.viewContentRect = function () {
    if (!view) return null;
    var v = view._video;
    var box = v.getBoundingClientRect();
    var vw = v.videoWidth;
    var vh = v.videoHeight;
    if (!vw || !vh) return null;
    var scale = Math.min(box.width / vw, box.height / vh);
    var w = vw * scale;
    var h = vh * scale;
    return { left: box.left + (box.width - w) / 2, top: box.top + (box.height - h) / 2, width: w, height: h };
  };

  /* --------------------------------------------------------- loading bar */

  var loadingBar = null;
  // info: {frame:{left,top,width,height}, pct, text} or null to hide.
  UI.renderLoading = function (info) {
    if (!root) return;
    if (!info || !info.frame) {
      if (loadingBar) loadingBar.remove();
      loadingBar = null;
      return;
    }
    if (!loadingBar) {
      loadingBar = el('div.mp-loading', null, [
        el('div.mp-loading-text'),
        el('div.mp-loading-track', null, [el('div.mp-loading-fill'), el('div.mp-loading-sprout')]),
      ]);
      root.insertBefore(loadingBar, layers.toasts);
    }
    var f = info.frame;
    loadingBar.style.left = f.left + f.width / 2 + 'px';
    loadingBar.style.top = f.top + f.height * 0.82 + 'px';
    loadingBar.style.width = Math.min(560, f.width * 0.6) + 'px';
    loadingBar.firstChild.textContent = info.text || t('loading');
    var pct = Math.max(0, Math.min(100, info.pct || 0));
    loadingBar.querySelector('.mp-loading-fill').style.width = pct + '%';
    loadingBar.querySelector('.mp-loading-sprout').style.left = pct + '%';
  };

  /* -------------------------------------------------------------- results */

  UI.showResults = function (r) {
    var win = el('div.mp-window.mp-results.mp-interactive');
    win.appendChild(el('div.mp-result-title.' + (r.win ? 'mp-win' : 'mp-lose'), { text: r.title }));
    if (r.sub) win.appendChild(el('div.mp-result-sub', { text: r.sub }));
    if (r.stats && r.stats.length) {
      var grid = el('div.mp-panel.mp-stats');
      grid.appendChild(el('div.mp-h', { text: '' }));
      (r.headers || []).forEach(function (h) {
        grid.appendChild(el('div.mp-h', { text: h, style: { textAlign: 'right' } }));
      });
      r.stats.forEach(function (row) {
        grid.appendChild(el('div', { text: row[0], style: { textShadow: 'var(--mp-outline)' } }));
        for (var i = 1; i < row.length; i++) grid.appendChild(el('div.mp-v', { text: row[i] == null ? '' : String(row[i]) }));
      });
      win.appendChild(grid);
    }
    var actions = el('div.mp-results-actions');
    (r.actions || []).forEach(function (a) {
      actions.appendChild(el('button.mp-btn' + (a.cls ? '.' + a.cls : ''), { text: a.label, onclick: a.fn }));
    });
    if (r.waitText) actions.appendChild(el('div.mp-status', { text: r.waitText }));
    win.appendChild(actions);
    var bd = openModal(win);
    bd.addEventListener('mousedown', function (e) {
      e.stopPropagation();
    });
  };
})();
