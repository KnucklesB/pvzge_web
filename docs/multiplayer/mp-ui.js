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
    return span.firstChild || span;
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
  var homeNodes = null;

  UI.isLobbyOpen = function () {
    return lobbyOpen;
  };

  UI.openLobby = function (state) {
    lobbyOpen = true;
    homeNodes = null;
    UI.renderLobby(state);
  };

  UI.closeLobby = function () {
    lobbyOpen = false;
    homeNodes = null;
    lobbyState = null;
    closeModal();
  };

  // Full re-render (e.g. after a language change), keeping typed values.
  UI.rebuildLobby = function (state) {
    if (!lobbyOpen) return;
    if (homeNodes && state.view === 'home') {
      state.name = homeNodes.name.value;
      state.code = homeNodes.code.value;
    }
    homeNodes = null;
    lobbyState = null;
    UI.renderLobby(state);
  };

  UI.renderLobby = function (state) {
    if (!lobbyOpen || !root) return;
    var prevView = lobbyState && lobbyState.view;
    lobbyState = state;
    if (state.view === 'home' && prevView === 'home' && homeNodes) {
      homeNodes.error.textContent = state.error ? t(state.error) : '';
      return;
    }
    homeNodes = null;
    var win = el('div.mp-window.mp-interactive');
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
    var bd = openModal(win);
    bd.addEventListener('mousedown', function (e) {
      e.stopPropagation();
    });
    bd.addEventListener('wheel', function (e) {
      e.stopPropagation();
    });
  };

  function renderHome(win, state) {
    win.appendChild(el('div.mp-window-sub', { text: t('lobby_subtitle') }));
    var name = el('input.mp-input', { maxlength: 16, placeholder: t('your_name'), value: state.name || '', 'aria-label': t('your_name') });
    MP.util.shieldInput(name);
    win.appendChild(el('div.mp-name-row', null, [el('div.mp-avatar'), name]));

    var code = el('input.mp-input.mp-code', { maxlength: 5, placeholder: t('room_code_ph'), value: state.code || '', 'aria-label': t('room_code') });
    MP.util.shieldInput(code);
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

    var left = el('div.mp-panel', null, [
      el('div.mp-panel-title', { text: t('create_room') }),
      el('div.mp-home-desc', { text: t('share_code') }),
      create,
    ]);
    var right = el('div.mp-panel', null, [
      el('div.mp-panel-title', { text: t('room_code') }),
      code,
      join,
    ]);
    win.appendChild(el('div.mp-home', null, [left, el('div.mp-home-or', { text: t('or') }), right]));
    var error = el('div.mp-error', { text: state.error ? t(state.error) : '' });
    win.appendChild(error);
    homeNodes = { name: name, code: code, error: error };
    setTimeout(function () {
      (state.code ? code : name).focus();
    }, 50);
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

  function renderRoom(win, state) {
    var s = state.settings;
    var edit = state.role === 'host';

    // Left: room code + players.
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
        el('div.mp-player', null, [
          el('span.mp-player-dot', { style: { background: p.role === 'host' ? 'var(--mp-p1)' : 'var(--mp-p2)' } }),
          el('span.mp-player-name', { text: p.name, title: p.name }),
          p.you ? el('span.mp-player-you', { text: t('you') }) : null,
          tag,
        ]),
      );
    });
    var side = el('div.mp-room-side', null, [codeBox, el('div.mp-panel', null, [el('div.mp-panel-title', { text: t('players') }), players])]);

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
    var stageOptions = Object.keys(MP.STAGES).map(function (k) {
      return { value: k, label: t(MP.STAGES[k].label), img: MP.STAGES[k].img };
    });
    if (s.mode === 'versus') {
      opt(t('arena'), segment(stageOptions, s.stage, !edit, set('stage'), 'mp-stages'));
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
            call('setting', 'hostSide', v);
          },
        ),
      );
      opt(
        t('duration'),
        segment(
          MP.VERSUS_DURATIONS.map(function (n) {
            return { value: n, label: t('minutes', { n: n }) };
          }),
          s.duration,
          !edit,
          set('duration'),
        ),
      );
    } else if (s.mode === 'survival') {
      opt(t('arena'), segment(stageOptions, s.stage, !edit, set('stage'), 'mp-stages'));
      opt(
        t('waves'),
        segment(
          MP.SURVIVAL_WAVES.map(function (n) {
            return { value: n, label: t('waves_n', { n: n }) };
          }),
          s.waves,
          !edit,
          set('waves'),
        ),
      );
      opt(
        t('plant_deck'),
        segment(
          [
            { value: 'kit', label: t('deck_kit') },
            { value: 'collection', label: t('deck_collection') },
          ],
          s.deck,
          !edit,
          set('deck'),
        ),
      );
    }
    // Left column: stream quality (host) and the controls cheat sheet.
    var extra = el('div.mp-panel.mp-extra');
    if (state.role === 'host') {
      extra.appendChild(el('div.mp-panel-title', { text: t('quality') }));
      extra.appendChild(
        segment(
          ['low', 'medium', 'high'].map(function (q) {
            return { value: q, label: t('quality_' + q) };
          }),
          s.quality,
          false,
          set('quality'),
        ),
      );
    } else {
      extra.appendChild(el('div.mp-note', { text: t('only_host_changes') }));
    }
    extra.appendChild(el('div.mp-note', { text: t('controls_hint'), style: { marginTop: '10px' } }));
    side.appendChild(extra);

    var main = el('div.mp-room-main', null, [
      el('div.mp-panel', null, [el('div.mp-panel-title', { text: t('mode') }), modes]),
      el('div.mp-panel.mp-scroll', { style: { flex: '1' } }, [el('div.mp-panel-title', { text: t('options') }), opts]),
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
    });
    if (info.line) badge.appendChild(el('div.mp-badge-info', { text: info.line }));
    badge.appendChild(el('div.mp-note', { text: t('chat_hint') }));
    if (info.action) {
      badge.appendChild(el('button.mp-btn.mp-small.mp-red', { text: info.action.label, onclick: info.action.fn }));
    }
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
