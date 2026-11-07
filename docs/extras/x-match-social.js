/*
 * PvZ2 Gardendless - Plant Match: server, rankings and the Social tab
 *
 * Theme week, anonymous counters, couple and weekly rankings, team codes.
 *
 * Shared state and functions of the mode live in X.matchI (see
 * x-match.js); the files load in order: text, core, photos, chat,
 * social, dates, ui.
 */
(function () {
  'use strict';

  var MP = window.PvZMP;
  var X = window.PvZX;
  var G = MP.game;
  var t = X.t;
  var el = MP.util.el;
  var M = X.match;
  var I = X.matchI;
  var MT = X.matchText;
  var TXT = MT.TXT;
  var CHAT = MT.CHAT;
  var PERS = MT.PERS;
  var DATES = MT.DATES;
  var STAGES = MT.STAGES;
  var TRAITS = MT.TRAITS;
  var fill = I.fill;
  var L = I.L;
  var Lp = I.Lp;
  var shuffle = I.shuffle;
  var pick = I.pick;
  var today = I.today;
  var tr = I.tr;
  var DECK = I.DECK;
  var SLOTS = I.SLOTS;
  var LIKES_PER_DAY = I.LIKES_PER_DAY;
  var WORLD_KEY = I.WORLD_KEY;
  var WORLD_AGE = I.WORLD_AGE;
  var CLASSIC_WORLDS = I.CLASSIC_WORLDS;
  var NEW_WORLDS = I.NEW_WORLDS;
  var STAGE_OF_WORLD = I.STAGE_OF_WORLD;

  /* ----------------------------------------------- server and rankings */

  // The week's theme family: shows up more, matches more easily, doubles
  // the rewards with 3 of them in the team (weeks start on Monday).
  I.EVENT_FAMILIES = ['Peashooter', 'Sun', 'Defence', 'Explosive', 'Lobber', 'Sharp', 'Cold', 'Melee', 'Poison', 'Fire', 'Shadow', 'Electricity', 'Magic'];

  I.week = function week() {
    var n = Math.floor((Date.now() / 86400000 + 3) / 7);
    return { n: n, fam: I.EVENT_FAMILIES[X.hashSeed('pvzx-week-' + n) % I.EVENT_FAMILIES.length] };
  };
  M.week = I.week;

  // Counters sent to the server (anonymous) and kept locally.
  I.statQ = {};
  I.statTimer = null;

  I.statEvent = function statEvent(code, kind) {
    var q = (I.statQ[code] = I.statQ[code] || {});
    q[kind] = (q[kind] || 0) + 1;
    var mine = X.store.get('matchMine', {});
    var m = (mine[code] = mine[code] || {});
    m[kind] = (m[kind] || 0) + 1;
    X.store.set('matchMine', mine);
    if (!I.statTimer) I.statTimer = setTimeout(I.flushStats, 15000);
  };

  I.flushStats = function flushStats() {
    if (I.statTimer) clearTimeout(I.statTimer);
    I.statTimer = null;
    var ev = I.statQ;
    I.statQ = {};
    if (!Object.keys(ev).length || !X.api.available()) return;
    X.api.postMatchStats(ev).catch(function () {});
  };

  /* ------------------------------------------------------- cloud sync */

  // The progress of this mode (the pvzx.match* keys: partners, chats, likes,
  // preferences…) follows the account when logged in. The newer copy wins
  // (matchAt); the server checks the partners and computes the couples
  // ranking from them.
  I.cloud = { busy: false, timer: null, applying: false, at: 0 };

  I.cloudOn = function cloudOn() {
    return !!(X.api.available() && X.api.loggedIn() && I.cloud.unsupported !== MP.config.api);
  };

  // An older server without this API: stop trying (until the server changes).
  I.cloudError = function cloudError(e) {
    if (e && /not_found/.test(String(e.message || e.code || e))) I.cloud.unsupported = MP.config.api;
    else MP.warn('match sync', e);
  };

  I.stateKeys = function stateKeys() {
    var keys = [];
    try {
      for (var i = 0; i < localStorage.length; i++) {
        var k = localStorage.key(i);
        if (k && k.indexOf('pvzx.match') === 0) keys.push(k.slice(5));
      }
    } catch (e) {}
    return keys;
  };

  I.localState = function localState() {
    var st = {};
    I.stateKeys().forEach(function (k) {
      st[k] = X.store.get(k);
    });
    return st;
  };

  X.store.listeners.push(function (key) {
    if (I.cloud.applying || key.indexOf('match') !== 0 || key === 'matchAt') return;
    X.store.set('matchAt', Date.now());
    I.schedulePush();
  });

  I.schedulePush = function schedulePush(delay) {
    if (!I.cloudOn()) return;
    clearTimeout(I.cloud.timer);
    I.cloud.timer = setTimeout(I.pushState, delay == null ? 4000 : delay);
  };

  I.applyState = function applyState(st) {
    I.cloud.applying = true;
    try {
      I.stateKeys().forEach(function (k) {
        if (!(k in st)) {
          try {
            localStorage.removeItem('pvzx.' + k);
          } catch (e) {}
        }
      });
      Object.keys(st).forEach(function (k) {
        if (/^match[A-Za-z]{1,24}$/.test(k)) X.store.set(k, st[k]);
      });
    } finally {
      I.cloud.applying = false;
    }
    I.chats = X.store.get('matchChats', {});
    M.prefs = X.store.get('matchPrefs', M.prefs);
    I.profCache = {};
    if (I.round && !I.round.matches.length) I.round = null;
    I.refreshPartnerFlags(I.partners());
    if (I.node) {
      if (!I.round) I.newRound();
      I.render();
    }
  };

  I.pushState = function pushState() {
    clearTimeout(I.cloud.timer);
    if (!I.cloudOn() || I.cloud.busy) return Promise.resolve();
    I.cloud.busy = true;
    return X.api
      .putMatchState(I.localState())
      .then(function (r) {
        I.cloud.at = Date.now();
        // The server may have trimmed the partners (points a day, weddings).
        var mine = I.partners();
        var theirs = (r && r.partners) || {};
        var same =
          Object.keys(mine).length === Object.keys(theirs).length &&
          Object.keys(theirs).every(function (c) {
            return mine[c] && mine[c].xp === theirs[c].xp && !!mine[c].married === !!theirs[c].married;
          });
        if (!same) {
          I.cloud.applying = true;
          X.store.set('matchPartners', theirs);
          I.cloud.applying = false;
          I.refreshPartnerFlags(theirs);
          if (I.node) I.render();
        }
      })
      .catch(I.cloudError)
      .then(function () {
        I.cloud.busy = false;
      });
  };

  // Downloads the account's progress when it is newer than this browser's.
  I.pullState = function pullState() {
    if (!I.cloudOn()) return Promise.resolve(false);
    return X.api
      .matchState()
      .then(function (r) {
        var remote = r && r.state;
        var localAt = X.store.get('matchAt', 0);
        var remoteAt = (remote && remote.matchAt) || 0;
        if (remote && remoteAt > localAt) {
          I.applyState(remote);
          return true;
        }
        if (localAt > remoteAt || !remote) I.schedulePush(0);
        return false;
      })
      .catch(function (e) {
        I.cloudError(e);
        return false;
      });
  };

  if (MP.api && MP.api.on) {
    MP.api.on('auth', function (user) {
      if (user) I.pullState();
    });
  }

  I.social = { pop: null, popAt: 0, ranks: {}, rank: 'couple' };

  I.loadPopular = function loadPopular() {
    if (!X.api.available() || I.social.popLoading || Date.now() - I.social.popAt < 60000) return;
    I.social.popLoading = true;
    X.api
      .matchStats()
      .then(function (top) {
        I.social.pop = top;
      })
      .catch(function () {
        I.social.pop = I.social.pop || {};
      })
      .then(function () {
        I.social.popLoading = false;
        I.social.popAt = Date.now();
        if (I.node && I.view.tab === 'social') I.render();
      });
  };

  I.rankBoard = function rankBoard(id) {
    return id === 'week' ? 'challenge:week-' + I.week().n : id === 'couple' ? 'challenge:couple' : 'challenge:match';
  };

  I.loadRank = function loadRank(id) {
    var board = I.rankBoard(id);
    var r = (I.social.ranks[board] = I.social.ranks[board] || { at: 0 });
    if (!X.api.available() || r.loading || Date.now() - r.at < 60000) return;
    r.loading = true;
    X.api
      .scores(board, 10)
      .then(function (res) {
        r.list = res.scores || [];
        r.me = res.me;
      })
      .catch(function () {
        r.list = r.list || [];
      })
      .then(function () {
        r.loading = false;
        r.at = Date.now();
        if (I.node && I.view.tab === 'social') I.render();
      });
  };

  I.copyText = function copyText(text) {
    var done = function () {
      if (MP.ui) MP.ui.toast(L(TXT.shareCopied), 'good');
    };
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(done, function () {
        I.fallbackCopy(text);
        done();
      });
    } else {
      I.fallbackCopy(text);
      done();
    }
  };

  I.fallbackCopy = function fallbackCopy(text) {
    var ta = el('textarea', { value: text });
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    try {
      document.execCommand('copy');
    } catch (e) {}
    ta.remove();
  };

  I.teamCode = function teamCode(codes) {
    return 'PM1:' + codes.join('.');
  };

  I.parseTeamCode = function parseTeamCode(text) {
    var m = /PM1:([a-z0-9_.]+)/i.exec(String(text || ''));
    if (!m) return null;
    var all = MP.allPlants();
    var out = [];
    m[1]
      .toLowerCase()
      .split('.')
      .forEach(function (c) {
        if (c && all.indexOf(c) >= 0 && out.indexOf(c) < 0 && out.length < SLOTS) out.push(c);
      });
    return out.length ? out : null;
  };

  // Profiles of plants outside the current deck (chats, partners).
  I.profCache = {};
  I.prof = function prof(code) {
    var inDeck = I.round && I.round.cards.find(function (c) {
      return c.code === code;
    });
    if (inDeck) return inDeck;
    if (!(code in I.profCache)) I.profCache[code] = I.profile(code);
    return I.profCache[code];
  };

  I.famOf = function famOf(code) {
    var f = I.plantFeature(code);
    if (!f) return '';
    try {
      return G.m.Plants.plants.getPlantProps(f.ID).Family || '';
    } catch (e) {
      return '';
    }
  };


  /* ------------------------------------------------------------ social */

  I.plantRows = function plantRows(list, unit) {
    return el(
      'div.pvzx-poplist',
      null,
      list.map(function (e, i) {
        var art = MP.cards && MP.cards.plantCanvas(e.code);
        return el('div.pvzx-poprow', null, [
          el('span.pvzx-poprank', { text: '#' + (i + 1) }),
          art ? el('img', { src: art.toDataURL(), alt: '' }) : el('span'),
          el('b', { text: X.plantName(e.code) }),
          el('span', { text: e.n + ' ' + unit }),
        ]);
      }),
    );
  };

  I.socialTab = function socialTab(body) {
    var wk = I.week();
    var famName = t('family_' + wk.fam.toLowerCase());
    var box = el('div.pvzx-mlikes.pvzx-social');
    var evTeam = I.round.matches.filter(function (m) {
      return m.event;
    }).length;
    box.appendChild(
      el('div.pvzx-event', null, [
        el('b', { text: '🎉 ' + L(TXT.weekTitle, { fam: famName }) }),
        el('p', { text: L(TXT.weekDesc, { fam: famName }) }),
        I.round.matches.length ? el('small', { text: L(TXT.weekTeam, { n: evTeam }) }) : null,
      ]),
    );

    // Most popular plants of every player on the server.
    if (!X.api.available()) box.appendChild(el('p.pvzx-small', { text: L(TXT.popOffline) }));
    else {
      I.loadPopular();
      var pop = I.social.pop || {};
      box.appendChild(el('h4', { text: L(TXT.popLikes) }));
      box.appendChild(pop.like && pop.like.length ? I.plantRows(pop.like.slice(0, 5), '♥') : el('p.pvzx-small', { text: I.social.pop ? L(TXT.popNone) : '…' }));
      if (pop.partner && pop.partner.length) {
        box.appendChild(el('h4', { text: L(TXT.popPartners) }));
        box.appendChild(I.plantRows(pop.partner.slice(0, 5), '💍'));
      }
    }
    var mine = X.store.get('matchMine', {});
    var mineList = Object.keys(mine)
      .map(function (c) {
        return { code: c, n: (mine[c].like || 0) + (mine[c].super || 0) };
      })
      .filter(function (e) {
        return e.n > 0;
      })
      .sort(function (a, b) {
        return b.n - a.n;
      })
      .slice(0, 5);
    if (mineList.length) {
      box.appendChild(el('h4', { text: L(TXT.popMine) }));
      box.appendChild(I.plantRows(mineList, '♥'));
    }

    // Rankings: levels, couples, this week's theme.
    if (X.api.available()) {
      box.appendChild(el('h4', { text: L(TXT.rankings) }));
      box.appendChild(
        el(
          'div.pvzx-chips',
          null,
          [
            ['couple', L(TXT.rankCouple)],
            ['match', L(TXT.rankMatch)],
            ['week', L(TXT.rankWeek)],
          ].map(function (b) {
            return el('button.pvzx-chip.pvzx-chip-btn' + (I.social.rank === b[0] ? '.pvzx-on' : ''), { text: b[1], onclick: function () {
              I.social.rank = b[0];
              I.render();
            } });
          }),
        ),
      );
      I.loadRank(I.social.rank);
      var rk = I.social.ranks[I.rankBoard(I.social.rank)] || {};
      if (!rk.list) box.appendChild(el('p.pvzx-small', { text: '…' }));
      else if (!rk.list.length) box.appendChild(el('p.pvzx-small', { text: L(TXT.rankEmpty) }));
      else {
        box.appendChild(
          el(
            'div.pvzx-poplist',
            null,
            rk.list.map(function (e) {
              var d = e.details || {};
              var extra = d.plant ? X.plantName(d.plant) + (d.rel !== '' && d.rel != null && STAGES[+d.rel] ? ' ' + STAGES[+d.rel].icon : '') : d.waves ? d.waves + ' 🌊' : '';
              return el('div.pvzx-poprow', null, [el('span.pvzx-poprank', { text: '#' + e.rank }), el('b', { text: e.name }), el('span', { text: extra }), el('span', { text: String(e.score) })]);
            }),
          ),
        );
      }
      if (rk.me) box.appendChild(el('p.pvzx-small', { text: L(TXT.rankYou, { n: rk.me.rank }) }));
      if (!X.api.loggedIn()) box.appendChild(el('p.pvzx-small', { text: L(TXT.rankLogin) }));
    }

    // Share the team / play a friend's.
    var team = I.round.matches.length
      ? I.round.matches.map(function (m) {
          return m.code;
        })
      : X.store.get('matchLastTeam', []);
    box.appendChild(el('h4', { text: L(TXT.shareTitle) }));
    if (team.length) {
      var names = team.map(function (c) {
        return X.plantName(c);
      }).join(', ');
      box.appendChild(el('p.pvzx-small', { text: L(TXT.lastTeam, { names: names }) }));
      box.appendChild(
        el('button.mp-btn.mp-small.mp-blue', { text: L(TXT.shareTeam), onclick: function () {
          I.copyText(L(TXT.shareText, { names: names, code: I.teamCode(team) }));
        } }),
      );
    } else box.appendChild(el('p.pvzx-small', { text: L(TXT.shareNone) }));
    var input = el('input.pvzx-import', { type: 'text', placeholder: L(TXT.importPh), spellcheck: false });
    input.addEventListener('keydown', function (e) {
      e.stopPropagation();
    });
    box.appendChild(el('h4', { text: L(TXT.importTitle) }));
    box.appendChild(
      el('div.pvzx-import-row', null, [
        input,
        el('button.mp-btn.mp-small.mp-green', { text: L(TXT.importGo), onclick: function () {
          var codes = I.parseTeamCode(input.value);
          if (!codes) {
            if (MP.ui) MP.ui.toast(L(TXT.importBad), 'bad');
            return;
          }
          I.playTeam(codes, { sun: 0, food: 0 }, { shared: true });
        } }),
      ]),
    );
    box.addEventListener('wheel', function (e) {
      e.stopPropagation();
    });
    body.appendChild(box);
  };
})();
