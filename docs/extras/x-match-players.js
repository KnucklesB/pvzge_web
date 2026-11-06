/*
 * PvZ2 Gardendless - Plant Match: other players.
 *
 * Players with an account create a profile (gender, who they look for, a
 * bio, a favorite plant; the partner shown comes from their synced
 * progress) and appear to each other in Messages → Players. Private
 * messages live on the server and are polled: every few seconds while the
 * phone shows them, less often otherwise (notifications on the menu).
 * Messages show times and ✓ / ✓✓ when read. Players can block or report.
 */
(function () {
  'use strict';

  var MP = window.PvZMP;
  var X = window.PvZX;
  var G = MP.game;
  var el = MP.util.el;
  var M = X.match;
  var I = X.matchI;
  var MT = X.matchText;
  var TXT = MT.TXT;
  var STAGES = MT.STAGES;
  var TRAITS = MT.TRAITS;
  var L = I.L;

  // name -> [{id, from, to, text, at, read}]
  var pm = (I.pm = {
    me: null,
    meName: '',
    loaded: false,
    players: [],
    playersAt: 0,
    msgs: {},
    lastId: 0,
    reads: {},
    profiles: {},
    timer: null,
    busy: false,
    editing: false,
    viewing: null,
    error: '',
    draft: {},
    account: '',
  });

  function seenMap() {
    return X.store.get('pmSeen', {})[pm.meName] || {};
  }

  function setSeen(name, id) {
    var all = X.store.get('pmSeen', {});
    var mine = (all[pm.meName] = all[pm.meName] || {});
    if ((mine[name] || 0) >= id) return;
    mine[name] = id;
    X.store.set('pmSeen', all);
  }

  I.pmOn = function pmOn() {
    return !!(X.api.available() && X.api.loggedIn() && I.cloud.unsupported !== MP.config.api && pm.unsupported !== MP.config.api);
  };

  I.pmUnread = function pmUnread(name) {
    var seen = seenMap();
    var count = function (n) {
      return (pm.msgs[n] || []).filter(function (m) {
        // Read on any device (server) or seen here.
        return m.from === n && !m.read && m.id > (seen[n] || 0);
      }).length;
    };
    if (name) return count(name);
    return Object.keys(pm.msgs).reduce(function (s, n) {
      return s + count(n);
    }, 0);
  };

  // A change of account (or logout) starts over.
  function checkAccount() {
    var u = MP.api.user && MP.api.user();
    var name = (u && u.username) || '';
    if (name !== pm.account) {
      pm.account = name;
      pm.me = null;
      pm.loaded = false;
      pm.msgs = {};
      pm.lastId = 0;
      pm.polled = false;
      pm.reads = {};
      pm.players = [];
      pm.playersAt = 0;
    }
  }

  I.pmLoadMe = function pmLoadMe() {
    checkAccount();
    if (!I.pmOn() || pm.loaded) return Promise.resolve(pm.me);
    return X.api
      .matchMe()
      .then(function (p) {
        pm.me = p;
        pm.loaded = true;
        if (p) pm.meName = p.name;
        return p;
      })
      .catch(function (e) {
        if (/not_found/.test(String(e && (e.message || e.code)))) pm.unsupported = MP.config.api;
        return null;
      });
  };

  I.pmLoadPlayers = function pmLoadPlayers(force) {
    if (!I.pmOn() || !pm.me || (!force && Date.now() - pm.playersAt < 20000)) return;
    pm.playersAt = Date.now();
    X.api
      .matchPlayers()
      .then(function (list) {
        pm.players = list;
        I.pmRender();
      })
      .catch(function () {});
  };

  function merge(r) {
    if (r.me) pm.meName = r.me;
    var fresh = [];
    (r.messages || []).forEach(function (m) {
      var other = m.from === pm.meName ? m.to : m.from;
      var list = (pm.msgs[other] = pm.msgs[other] || []);
      if (list.some(function (x) {
        return x.id === m.id;
      })) return;
      list.push(m);
      if (m.id > pm.lastId) pm.lastId = m.id;
      if (m.from !== pm.meName) fresh.push(m);
    });
    Object.keys(r.profiles || {}).forEach(function (n) {
      if (r.profiles[n]) pm.profiles[n] = r.profiles[n];
    });
    pm.reads = r.reads || pm.reads;
    return fresh;
  }

  function chatOpen(name) {
    return !!(I.node && I.view.tab === 'messages' && I.view.msgSub === 'players' && pm.chat === name);
  }

  I.pmPoll = function pmPoll() {
    clearTimeout(pm.timer);
    if (!I.pmOn()) {
      pm.timer = setTimeout(I.pmPoll, 30000);
      return;
    }
    I.pmLoadMe().then(function (me) {
      if (!me || pm.busy) return I.pmSchedule();
      pm.busy = true;
      var first = !pm.polled;
      X.api
        .dms(pm.lastId)
        .then(function (r) {
          var readsBefore = JSON.stringify(pm.reads);
          var countBefore = pm.lastId;
          var fresh = merge(r);
          var changed = !pm.polled || pm.lastId !== countBefore || JSON.stringify(pm.reads) !== readsBefore;
          pm.polled = true;
          if (!first) {
            fresh.forEach(function (m) {
              if (!chatOpen(m.from)) I.pmNotify(m.from, m.text);
            });
          }
          if (pm.chat && fresh.some(function (m) {
            return m.from === pm.chat;
          }) && chatOpen(pm.chat)) I.pmMarkRead(pm.chat);
          if (changed) I.pmRender();
        })
        .catch(function () {})
        .then(function () {
          pm.busy = false;
          I.pmSchedule();
        });
    });
  };

  I.pmSchedule = function pmSchedule() {
    clearTimeout(pm.timer);
    var open = I.node && I.view.tab === 'messages';
    var delay = open && I.view.msgSub === 'players' ? 3000 : open || I.node ? 12000 : 40000;
    pm.timer = setTimeout(I.pmPoll, delay);
  };

  I.pmMarkRead = function pmMarkRead(name) {
    var list = pm.msgs[name] || [];
    var last = 0;
    list.forEach(function (m) {
      if (m.from === name && m.id > last) last = m.id;
    });
    if (!last || (seenMap()[name] || 0) >= last) return;
    setSeen(name, last);
    X.api.readDms(name).catch(function () {});
  };

  I.pmNotify = function pmNotify(name, text) {
    if (!MP.ui || G.sceneName() === 'inGameScene') return;
    MP.ui.toast('👤 ' + name + ': ' + String(text).slice(0, 80), 'good');
  };

  // Re-render only the phone, keeping the text being typed.
  I.pmRender = function pmRender() {
    if (I.node && I.view.tab === 'messages') I.render();
  };

  I.pmSend = function pmSend(name, text) {
    text = String(text || '').trim();
    if (!text) return;
    pm.draft[name] = '';
    var tmp = { id: 0, tmp: true, from: pm.meName, to: name, text: text, at: Date.now(), read: 0 };
    (pm.msgs[name] = pm.msgs[name] || []).push(tmp);
    I.render();
    X.api
      .sendDm(name, text)
      .then(function (m) {
        Object.assign(tmp, m, { tmp: false });
        if (m.id > pm.lastId) pm.lastId = m.id;
      })
      .catch(function (e) {
        tmp.failed = true;
        var code = String((e && (e.message || e.code)) || '');
        var key = ['blocked', 'hidden', 'no_profile', 'no_player', 'rate_limited'].find(function (k) {
          return code.indexOf(k) >= 0;
        });
        pm.error = L(TXT.pmErr[key || 'other']);
      })
      .then(function () {
        I.render();
        clearTimeout(pm.timer);
        pm.timer = setTimeout(I.pmPoll, 1500);
      });
  };

  /* ------------------------------------------------------------ views */

  function plantImg(code) {
    var art = code && MP.cards && MP.cards.plantCanvas(code);
    return art ? el('img', { src: art.toDataURL(), alt: '' }) : el('span', { text: '👤' });
  }

  function genderIcon(g) {
    return g && TRAITS.gender[g] ? TRAITS.gender[g].icon : '';
  }

  function statusOf(p) {
    if (!p) return '';
    if (p.online) return t2('match_online');
    if (!p.lastSeen) return '';
    return L(TXT.lastSeen, { day: I.dayLabel(p.lastSeen).toLowerCase(), time: I.hhmm(p.lastSeen) });
  }

  function t2(k) {
    return X.t(k);
  }

  function profileOf(name) {
    return (
      pm.profiles[name] ||
      pm.players.find(function (p) {
        return p.name === name;
      }) ||
      null
    );
  }

  I.subSwitch = function subSwitch() {
    var unread = I.pmUnread();
    return el('div.pvzx-msub', null, [
      el('button' + (I.view.msgSub !== 'players' ? '.pvzx-on' : ''), { text: '🌱 ' + L(TXT.pmPlants), onclick: function () {
        I.view.msgSub = 'plants';
        I.render();
      } }),
      el('button' + (I.view.msgSub === 'players' ? '.pvzx-on' : ''), { onclick: function () {
        I.view.msgSub = 'players';
        pm.chat = null;
        I.pmLoadPlayers(true);
        I.pmPoll();
        I.render();
      } }, ['👥 ' + L(TXT.pmPlayers), unread ? el('i', { text: String(unread) }) : null]),
    ]);
  };

  I.playersView = function playersView(body) {
    body.appendChild(I.subSwitch());
    var box = el('div.pvzx-mlist.pvzx-players');
    box.addEventListener('wheel', function (e) {
      e.stopPropagation();
    });
    body.appendChild(box);
    if (!I.pmOn()) {
      box.appendChild(el('p.pvzx-mempty', { text: L(TXT.pmLogin) }));
      return;
    }
    if (!pm.loaded) {
      box.appendChild(el('p.pvzx-mempty', { text: '…' }));
      I.pmLoadMe().then(I.render);
      return;
    }
    if (!pm.me || pm.editing) {
      box.appendChild(I.profileEditor());
      return;
    }
    if (pm.viewing) {
      box.appendChild(I.playerSheet(pm.viewing));
      return;
    }
    I.pmLoadPlayers();
    var mine = pm.me;
    box.appendChild(
      el('button.pvzx-mrow.pvzx-me', { onclick: function () {
        pm.editing = true;
        I.render();
      } }, [
        el('span.pvzx-mavatar', null, [plantImg(mine.plant)]),
        el('span.pvzx-mrow-text', null, [el('b', { text: mine.name + ' ' + genderIcon(mine.gender) + ' · ' + L(TXT.pmYou) }), el('span', { text: (mine.visible ? '' : '🙈 ' + L(TXT.pmHidden) + ' · ') + (mine.bio || L(TXT.pmEdit)) })]),
        el('span.pvzx-mrow-aff', { text: '✏️' }),
      ]),
    );
    // Conversations, the newest first.
    var names = Object.keys(pm.msgs).sort(function (a, b) {
      var la = pm.msgs[a][pm.msgs[a].length - 1];
      var lb = pm.msgs[b][pm.msgs[b].length - 1];
      return (lb ? lb.at : 0) - (la ? la.at : 0);
    });
    if (names.length) box.appendChild(el('h4.pvzx-msec-title', { text: L(TXT.pmChats) }));
    names.forEach(function (n) {
      var list = pm.msgs[n];
      var last = list[list.length - 1];
      var p = profileOf(n);
      var unread = I.pmUnread(n);
      box.appendChild(
        el('button.pvzx-mrow' + (unread ? '.pvzx-unread' : ''), { onclick: function () {
          pm.chat = n;
          I.pmMarkRead(n);
          I.render();
        } }, [
          el('span.pvzx-mavatar', null, [plantImg(p && p.plant)]),
          p && p.online ? el('i.pvzx-dot') : null,
          el('span.pvzx-mrow-text', null, [el('b', { text: n + ' ' + genderIcon(p && p.gender) }), el('span', { text: (last.from === pm.meName ? '↪ ' : '') + last.text })]),
          el('span.pvzx-mrow-aff', null, [el('small', { text: I.hhmm(last.at) }), unread ? el('i.pvzx-badge-n', { text: String(unread) }) : null]),
        ]),
      );
    });
    // Everyone visible in the app.
    box.appendChild(el('h4.pvzx-msec-title', { text: L(TXT.pmInApp, { n: pm.players.length }) }));
    if (!pm.players.length) box.appendChild(el('p.pvzx-small', { text: L(TXT.pmNobody) }));
    pm.players.forEach(function (p) {
      box.appendChild(
        el('button.pvzx-mrow', { onclick: function () {
          pm.viewing = p.name;
          I.render();
        } }, [
          el('span.pvzx-mavatar', null, [plantImg(p.plant)]),
          p.online ? el('i.pvzx-dot') : null,
          el('span.pvzx-mrow-text', null, [
            el('b', { text: p.name + ' ' + genderIcon(p.gender) + (p.partner ? '  ' + (STAGES[p.rel] ? STAGES[p.rel].icon : '💍') + ' ' + X.plantName(p.partner) : '') }),
            el('span', { text: p.bio || statusOf(p) }),
          ]),
          el('span.pvzx-mrow-aff', null, [el('small', { text: p.online ? '🟢' : I.hhmm(p.lastSeen) })]),
        ]),
      );
    });
  };

  I.playerSheet = function playerSheet(name) {
    var p = profileOf(name) || { name: name };
    var rows = [];
    if (p.gender) rows.push([genderIcon(p.gender), L(TRAITS.labels.gender), L(TRAITS.gender[p.gender])]);
    if (p.interest) rows.push(['🔎', L(TRAITS.labels.lookingFor), L(TRAITS.interest[p.interest])]);
    if (p.partner) rows.push([STAGES[p.rel] ? STAGES[p.rel].icon : '💍', L(TXT.tabPartners), X.plantName(p.partner) + (STAGES[p.rel] ? ' · ' + L(STAGES[p.rel].name) : '')]);
    if (p.points) rows.push(['💞', L(TXT.rankCouple), String(p.points)]);
    return el('div.pvzx-psheet', null, [
      el('button.pvzx-x', { text: '←', onclick: function () {
        pm.viewing = null;
        I.render();
      } }),
      el('div.pvzx-psheet-pic', null, [plantImg(p.plant)]),
      el('h3', { text: p.name + ' ' + genderIcon(p.gender) }),
      el('p.pvzx-small', { text: statusOf(p) }),
      p.bio ? el('p.pvzx-hand', { text: '“' + p.bio + '”' }) : null,
      el(
        'table.pvzx-sheet',
        null,
        rows.map(function (r) {
          return el('tr', null, [el('td', { text: r[0] + ' ' + r[1] }), el('td', { text: r[2] })]);
        }),
      ),
      p.team && p.team.length
        ? el(
            'div.pvzx-pteam',
            null,
            p.team.map(function (c) {
              return plantImg(c);
            }),
          )
        : null,
      el('div.pvzx-file-actions', null, [
        el('button.mp-btn.mp-small.mp-green', { text: '💬 ' + L(TXT.pmMessage), onclick: function () {
          pm.viewing = null;
          pm.chat = name;
          I.render();
        } }),
        el('button.mp-btn.mp-small.mp-brown', { text: '🚫 ' + L(TXT.pmBlock), onclick: function () {
          I.pmBlock(name);
        } }),
        el('button.mp-btn.mp-small.mp-red', { text: '⚠️ ' + L(TXT.pmReport), onclick: function () {
          I.pmReport(name);
        } }),
      ]),
    ]);
  };

  I.pmBlock = function pmBlock(name) {
    if (!window.confirm(L(TXT.pmBlockAsk, { name: name }))) return;
    X.api.blockPlayer(name, true).then(function () {
      delete pm.msgs[name];
      pm.players = pm.players.filter(function (p) {
        return p.name !== name;
      });
      pm.chat = null;
      pm.viewing = null;
      if (pm.me) pm.me.blocked = (pm.me.blocked || []).concat([name]);
      if (MP.ui) MP.ui.toast(L(TXT.pmBlocked, { name: name }), 'good');
      I.render();
    });
  };

  I.pmReport = function pmReport(name) {
    var reason = window.prompt(L(TXT.pmReportAsk, { name: name }), '');
    if (reason == null) return;
    var excerpt = (pm.msgs[name] || [])
      .filter(function (m) {
        return m.from === name;
      })
      .slice(-10)
      .map(function (m) {
        return m.text;
      })
      .join('\n');
    X.api.reportPlayer(name, reason || 'report', excerpt).then(function () {
      if (MP.ui) MP.ui.toast(L(TXT.pmReported), 'good');
    });
  };

  I.profileEditor = function profileEditor() {
    var me = pm.me || {};
    var f = (pm.form = pm.form || {
      visible: me.visible !== false,
      gender: me.gender || M.prefs.me || '',
      interest: me.interest || 'all',
      bio: me.bio || '',
      plant: me.plant || Object.keys(I.partners())[0] || 'sunflower',
    });
    var bio = el('textarea.pvzx-input', { maxlength: 160, rows: 3, placeholder: L(TXT.pmBioPh), 'data-keep': 'bio' });
    bio.value = f.bio;
    bio.addEventListener('input', function () {
      f.bio = bio.value;
    });
    bio.addEventListener('keydown', function (e) {
      e.stopPropagation();
    });
    var all = MP.allPlants()
      .map(function (c) {
        return [c, X.plantName(c)];
      })
      .sort(function (a, b) {
        return a[1].localeCompare(b[1]);
      });
    var sel = el(
      'select.pvzx-input',
      { onchange: function () {
        f.plant = sel.value;
        I.render();
      } },
      all.map(function (x) {
        return el('option', { value: x[0], text: x[1], selected: x[0] === f.plant });
      }),
    );
    return el('div.pvzx-peditor', null, [
      el('h3', { text: '👤 ' + L(TXT.pmProfile) }),
      el('p.pvzx-small', { text: L(TXT.pmProfileDesc) }),
      el('div.pvzx-psheet-pic', null, [plantImg(f.plant)]),
      el('h4', { text: L(TXT.pmFavPlant) }),
      sel,
      el('h4', { text: L(TXT.prefMe) }),
      I.choiceChips(['f', 'm', 'n', ''], f.gender, function (v) {
        f.gender = v;
        I.render();
      }, function (v) {
        return v ? TRAITS.gender[v].icon + ' ' + L(TRAITS.gender[v]) : L(TXT.prefUnset);
      }),
      el('h4', { text: L(TRAITS.labels.lookingFor) }),
      I.choiceChips(['all', 'f', 'm', 'n'], f.interest, function (v) {
        f.interest = v;
        I.render();
      }, function (v) {
        return L(TRAITS.interest[v]);
      }),
      el('h4', { text: L(TXT.pmBio) }),
      bio,
      el('label.pvzx-check', null, [
        el('input', { type: 'checkbox', checked: f.visible, onchange: function (e) {
          f.visible = e.target.checked;
        } }),
        L(TXT.pmVisible),
      ]),
      el('p.pvzx-small', { text: L(TXT.pmRules) }),
      me.blocked && me.blocked.length
        ? el('div', null, [el('h4', { text: L(TXT.pmBlockedList) })].concat(
            me.blocked.map(function (n) {
              return el('div.pvzx-blocked', null, [
                el('span', { text: '🚫 ' + n }),
                el('button.mp-btn.mp-small.mp-blue', { text: L(TXT.pmUnblock), onclick: function () {
                  X.api.blockPlayer(n, false).then(function (r) {
                    me.blocked = (r && r.blocked) || [];
                    pm.playersAt = 0;
                    I.render();
                  });
                } }),
              ]);
            }),
          ))
        : null,
      el('div.pvzx-file-actions', null, [
        el('button.mp-btn.mp-green', { text: L(TXT.pmSave), onclick: function () {
          X.api
            .putMatchProfile({ visible: f.visible, gender: f.gender, interest: f.interest, bio: f.bio, plant: f.plant, team: X.store.get('matchLastTeam', []) })
            .then(function (p) {
              p.blocked = (pm.me && pm.me.blocked) || [];
              pm.me = p;
              pm.editing = false;
              pm.form = null;
              if (f.gender && !M.prefs.me) {
                M.prefs.me = f.gender;
                X.store.set('matchPrefs', M.prefs);
              }
              I.pmLoadPlayers(true);
              I.pmPoll();
              I.render();
            })
            .catch(function () {
              if (MP.ui) MP.ui.toast(L(TXT.pmErr.other), 'bad');
            });
        } }),
        pm.me
          ? el('button.mp-btn.mp-small.mp-brown', { text: X.t('close'), onclick: function () {
              pm.editing = false;
              pm.form = null;
              I.render();
            } })
          : null,
      ]),
    ]);
  };

  I.playerChat = function playerChat(body, name) {
    var p = profileOf(name) || { name: name };
    var list = pm.msgs[name] || [];
    var readUpTo = pm.reads[name] || 0;
    var head = el('div.pvzx-chat-head', null, [
      el('button.pvzx-x', { text: '←', onclick: function () {
        pm.chat = null;
        I.render();
      } }),
      el('span.pvzx-mavatar', null, [plantImg(p.plant)]),
      el('span.pvzx-mrow-text', null, [el('b', { text: name + ' ' + genderIcon(p.gender) }), el('span.pvzx-status' + (p.online ? '.pvzx-online' : ''), { text: statusOf(p) })]),
      el('button.pvzx-chip.pvzx-chip-btn', { text: L(TXT.viewProfile), onclick: function () {
        pm.viewing = name;
        pm.chat = null;
        I.render();
      } }),
    ]);
    var log = el('div.pvzx-chat-log');
    var lastDay = '';
    if (!list.length) log.appendChild(el('div.pvzx-bubble.pvzx-from-sys', { text: L(TXT.pmFirst, { name: name }) }));
    list.forEach(function (m) {
      var mine = m.from === pm.meName;
      var day = I.dayLabel(m.at);
      if (day !== lastDay) log.appendChild(el('div.pvzx-day', { text: day }));
      lastDay = day;
      var tick = mine ? (m.failed ? ' ⚠️' : m.tmp ? ' 🕓' : m.id <= readUpTo ? ' ✓✓' : ' ✓') : '';
      var meta = el('small.pvzx-time', { text: I.hhmm(m.at) }, mine ? [el('i' + (m.id <= readUpTo && !m.tmp ? '.pvzx-read' : ''), { text: tick })] : []);
      log.appendChild(el('div.pvzx-bubble.pvzx-from-' + (mine ? 'me' : 'them'), null, [m.text, meta]));
    });
    log.addEventListener('wheel', function (e) {
      e.stopPropagation();
    });
    var input = el('input.pvzx-input.pvzx-pm-input', { type: 'text', maxlength: 500, placeholder: L(TXT.pmTypePh), 'data-keep': 'pm-' + name, enterkeyhint: 'send' });
    input.value = pm.draft[name] || '';
    input.addEventListener('input', function () {
      pm.draft[name] = input.value;
    });
    input.addEventListener('keydown', function (e) {
      e.stopPropagation();
      if (e.key === 'Enter') {
        e.preventDefault();
        I.pmSend(name, input.value);
      }
    });
    var send = el('button.mp-btn.mp-small.mp-green', { text: '➤', title: L(TXT.pmSend), onclick: function () {
      I.pmSend(name, input.value);
    } });
    var foot = el('div.pvzx-pm-foot', null, [input, send]);
    var err = pm.error ? el('div.pvzx-bubble.pvzx-from-sys', { text: pm.error }) : null;
    pm.error = '';
    if (err) log.appendChild(err);
    body.appendChild(el('div.pvzx-chat', null, [head, log, foot]));
    setTimeout(function () {
      log.scrollTop = log.scrollHeight;
    }, 0);
    I.pmMarkRead(name);
  };

  // Polls start with the game and after logging in.
  if (MP.api && MP.api.on) {
    MP.api.on('auth', function () {
      checkAccount();
      I.pmPoll();
    });
  }
  setTimeout(I.pmPoll, 6000);
})();
