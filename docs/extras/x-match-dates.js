/*
 * PvZ2 Gardendless - Plant Match: dates and levels
 *
 * Kinds of date, their stars, the Plant Match level and what happens
 * when they end.
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

  /* ------------------------------------------------------------- dates */

  // need: -1 anyone you matched, 0 partners, 1 dating, 2 engaged (wedding).
  I.DATE_TYPES = [
    { id: 'picnic', icon: '🧺', waves: 6, sun: 300, rate: 'fast', mut: [], need: -1, obj: ['nomower', 'nolost'] },
    { id: 'candle', icon: '🕯️', stage: 'dark', waves: 6, sun: 300, rate: 'fast', mut: ['fog'], need: -1, obj: ['nolost', 'fast4'] },
    { id: 'race', icon: '⏱️', waves: 5, sun: 350, rate: 'fast', mut: ['rush'], need: -1, obj: ['fast3', 'nomower'] },
    { id: 'adventure', icon: '🤠', stage: 'west', waves: 8, sun: 250, rate: 'normal', mut: ['nomowers'], need: 0, obj: ['nolost', 'fast6'] },
    { id: 'double', icon: '👯', waves: 7, sun: 300, rate: 'fast', mut: [], need: 1, friend: true, obj: ['nomower', 'nolost'] },
    { id: 'wedding', icon: '💒', waves: 10, sun: 400, rate: 'fast', mut: ['horde'], need: 2, guests: true, obj: ['nomower', 'nolost'] },
  ];

  I.secs = function secs(s) {
    return ((s.endedAt || Date.now()) - (s.startedAt || Date.now())) / 1000;
  };

  I.OBJ = {
    nomower: { text: function () { return L(TXT.objNoMower); }, ok: function (s) { return !s.mowersUsed; } },
    nolost: { text: function () { return L(TXT.objNoLost); }, ok: function (s) { return !s.lost; } },
    fast3: { text: function () { return L(TXT.objFast, { m: 3 }); }, ok: function (s) { return I.secs(s) < 180; } },
    fast4: { text: function () { return L(TXT.objFast, { m: 4 }); }, ok: function (s) { return I.secs(s) < 240; } },
    fast6: { text: function () { return L(TXT.objFast, { m: 6 }); }, ok: function (s) { return I.secs(s) < 360; } },
  };

  I.starsText = function starsText(n) {
    return '⭐'.repeat(n) + '☆'.repeat(3 - n);
  };

  I.dateLock = function dateLock(dt, r) {
    if (!r && Object.keys(I.partners()).length >= I.MAX_PARTNERS) return L(TXT.maxPartners, { n: I.MAX_PARTNERS });
    if (dt.need < 0) return '';
    if (!r) return L(TXT.dateNeedPartner);
    if (dt.id === 'wedding' && r.married) return I.stageLabel(3);
    if (I.relStage(r) < dt.need) return L(TXT.dateNeed, { stage: I.stageLabel(dt.need) });
    return '';
  };

  I.openDates = function openDates(p) {
    I.view.datePick = p;
    I.render();
  };

  I.datePicker = function datePicker(p) {
    var r = I.partners()[p.code];
    var sheet = el('div.pvzx-mview.pvzx-dates', null, [
      el('button.pvzx-x', { text: '←', title: t('close'), onclick: function () {
        I.view.datePick = null;
        I.render();
      } }),
      el('h3', { text: '💐 ' + L(TXT.dateTitle) }),
      el('p.pvzx-small', { text: L(TXT.inviteDesc, { name: p.name }) }),
    ]);
    I.DATE_TYPES.forEach(function (dt) {
      var lock = I.dateLock(dt, r);
      var best = r && r.dates[dt.id];
      sheet.appendChild(
        el('button.pvzx-date' + (lock ? '.pvzx-locked' : ''), { disabled: !!lock, onclick: function () {
          I.view.datePick = null;
          I.date(p, dt);
        } }, [
          el('span.pvzx-date-icon', { text: dt.icon }),
          el('span.pvzx-date-text', null, [
            el('b', { text: L(DATES[dt.id].name) }),
            el('span', { text: L(DATES[dt.id].desc) + ' · ' + L(TXT.dateWaves, { n: dt.waves }) }),
            el('small', {
              text: lock || '⭐ ' + [L(TXT.objWin)].concat(dt.obj.map(function (o) {
                return I.OBJ[o].text();
              })).join(' · ') + (best ? '  —  ' + L(TXT.dateBest, { stars: I.starsText(best) }) : ''),
            }),
          ]),
        ]),
      );
    });
    sheet.addEventListener('wheel', function (e) {
      e.stopPropagation();
    });
    return sheet;
  };


  /* ------------------------------------------------------------- levels */

  I.baseLevel = function baseLevel(stage, waves, startSun, sunRate) {
    var s = MP.normalizeSettings({ mode: 'survival', stage: stage, waves: waves, difficulty: 'normal', plantPool: 'all', seedSlots: SLOTS, startSun: 50, sunRate: sunRate || 'normal', plantCooldown: 1, mowers: 'on' });
    var objects = MP.buildLevel.survival(s);
    var d = objects.find(function (o) {
      return o.objclass === 'LevelDefinition';
    }).objdata;
    d.StartingSun = startSun;
    // The generator only makes 15/30/60 waves: dates are shorter.
    var wm = objects.find(function (o) {
      return o.objclass === 'WaveManagerProperties';
    });
    if (wm && wm.objdata.WaveCount !== waves) {
      wm.objdata.WaveCount = waves;
      wm.objdata.Waves = wm.objdata.Waves.slice(0, waves);
      while (wm.objdata.Waves.length < waves) wm.objdata.Waves.push([]);
    }
    return { objects: objects, def: d };
  };

  I.setSeeds = function setSeeds(objects, codes) {
    objects.find(function (o) {
      return o.objclass === 'SeedBankProperties';
    }).objdata = {
      SuppressObjectiveTip: true,
      SelectionMethod: 'preset',
      PresetPlantList: codes.map(function (c) {
        return { PlantType: c, Level: -1 };
      }),
    };
  };

  I.play = function play() {
    if (!I.round || !I.round.matches.length) return;
    var b = I.levelBonus();
    var team = I.round.matches.map(function (m) {
      return m.code;
    });
    I.jealousy(team);
    X.store.set('matchGiftFood', 0);
    X.store.set('matchLastTeam', team);
    I.playTeam(team, b, {});
  };

  // A Plant Match level with this team (also a friend's shared team).
  I.playTeam = function playTeam(team, b, extra) {
    var stage = X.STAGE_IDS[Math.floor(Math.random() * X.STAGE_IDS.length)];
    var lv = I.baseLevel(stage, 15, 150 + b.sun);
    lv.def.Name = t('mode_match');
    lv.def.Description = t('mode_match_desc');
    I.setSeeds(lv.objects, team);
    var fam = I.week().fam;
    var evCount = team.filter(function (c) {
      return I.famOf(c) === fam;
    }).length;
    I.flushStats();
    M.close();
    X.modes.current = { kind: 'match', id: 'match', options: { stage: stage, team: team, food: b.food, shared: !!extra.shared, event: evCount }, mutators: X.mutators ? X.mutators.chosen() : [] };
    G.startCustomLevel(lv.objects);
    I.round = null;
  };

  // A friend for the double date: another plant of the same family.
  I.friendOf = function friendOf(p) {
    var same = shuffle(MP.allPlants().slice()).find(function (c) {
      return c !== p.code && I.famOf(c) === p.family && MP.cards.plantCanvas(c);
    });
    return same || pick(MP.allPlants().filter(function (c) {
      return c !== p.code;
    }));
  };

  // A short level with one match: the kind of date sets the arena, waves
  // and modifiers; up to 3 stars from its objectives.
  I.date = function date(p, dt) {
    dt = dt || I.DATE_TYPES[0];
    var stage = dt.stage || STAGE_OF_WORLD[p.worldKey] || pick(X.STAGE_IDS);
    var lv = I.baseLevel(stage, dt.waves, dt.sun, dt.rate);
    lv.def.Name = dt.icon + ' ' + L(TXT.dateName, { name: p.name });
    lv.def.Description = L(DATES[dt.id].desc);
    var wm = lv.objects.find(function (o) {
      return o.objclass === 'WaveManagerProperties';
    });
    wm.objdata.FlagWaveInterval = dt.waves >= 10 ? 5 : dt.waves >= 8 ? 4 : 3;
    var dyn = lv.objects.find(function (o) {
      return o.objclass === 'WaveManagerModuleProperties';
    });
    (dyn.objdata.DynamicZombies || []).forEach(function (z) {
      z.PointIncrementPerWave = Math.round(z.PointIncrementPerWave * 0.6);
      z.StartingPoints = Math.round(z.StartingPoints * 0.6);
    });
    var team = [p.code];
    if (dt.friend) team.push(I.friendOf(p));
    if (dt.guests) {
      shuffle(Object.keys(I.partners()))
        .filter(function (c) {
          return c !== p.code;
        })
        .slice(0, 4)
        .forEach(function (c) {
          team.push(c);
        });
    }
    I.setSeeds(lv.objects, team);
    I.flushStats();
    M.close();
    X.modes.current = { kind: 'matchdate', id: 'matchdate', options: { stage: stage, plant: p.code, name: p.name, type: dt.id, team: team }, mutators: dt.mut.slice() };
    G.startCustomLevel(lv.objects);
  };

  I.onLevelStart = function onLevelStart() {
    var cur = X.modes.current;
    if (!cur || cur.kind !== 'match' || !cur.options.food) return;
    try {
      var P = G.m.PlantFoodCount.PlantFoodCount;
      if (P && P.component) P.component.setPlantFoodNum(cur.options.food);
    } catch (e) {}
  };

  I.note = function note(text, cls, delay) {
    setTimeout(function () {
      if (X.play && X.play.summaryNote) X.play.summaryNote(text, cls);
    }, delay || 1300);
  };

  I.dateEnded = function dateEnded(cur, s) {
    s.mode = 'matchdate';
    var dt =
      I.DATE_TYPES.find(function (d) {
        return d.id === cur.options.type;
      }) || I.DATE_TYPES[0];
    var code = cur.options.plant;
    var name = cur.options.name;
    if (s.result !== 'won') {
      I.later(code, Lp(CHAT.dateLostMsg), 4000 + Math.random() * 6000);
      I.note(L(TXT.dateLost));
      return;
    }
    var stars = 1;
    dt.obj.forEach(function (o) {
      if (I.OBJ[o].ok(s)) stars++;
    });
    var ps = I.partners();
    var fresh = !ps[code];
    if (fresh) ps[code] = { since: Date.now(), xp: 0, dates: {} };
    var r = ps[code];
    var before = fresh ? -1 : I.relStage(r);
    r.dates[dt.id] = Math.max(r.dates[dt.id] || 0, stars);
    if (dt.id === 'wedding') r.married = true;
    I.savePartners(ps);
    I.later(code, Lp(CHAT.dateWonMsg), 3000 + Math.random() * 5000);
    I.statEvent(code, 'date');
    if (fresh) I.statEvent(code, 'partner');
    if (dt.id === 'wedding') {
      I.statEvent(code, 'wed');
      I.unlock(['match_married']);
    }
    // xp after the wedding flag: the stage messages come from the change.
    // A first date starts the relationship (seeing each other) whatever the
    // stars; later dates add one point per star.
    I.addXp(code, fresh ? Math.min(stars, 2) : stars);
    if (dt.id === 'wedding' && !fresh) I.stageMessages(code, before, 3);
    X.store.set('matchReveals', I.reveals() + 1);
    if (stars === 3) {
      X.store.set('matchSupers', X.store.get('matchSupers', 0) + 1);
      I.unlock(['match_stars']);
    }
    I.note(L(TXT.dateResult, { icon: dt.icon, date: L(DATES[dt.id].name), stars: I.starsText(stars) }), 'pvzx-good');
    I.note(
      [L(TXT.objWin)]
        .concat(dt.obj.map(function (o) {
          return (I.OBJ[o].ok(s) ? '✔ ' : '✘ ') + I.OBJ[o].text();
        }))
        .join(' · '),
      '',
      1400,
    );
    if (fresh) I.note(L(TXT.dateWon, { name: name }), 'pvzx-good', 1500);
  };

  I.matchEnded = function matchEnded(cur, s) {
    s.mode = 'match';
    var team = cur.options.team;
    s.matchTeam = team.length;
    s.score = X.modes.score(s);
    X.store.set('matchBest', Math.max(X.store.get('matchBest', 0), s.score));
    var won = s.result === 'won';
    var ps = I.partners();
    // Messages after the level: partners in the team and a couple more.
    var others = shuffle(
      team.filter(function (c) {
        return !ps[c];
      }),
    ).slice(0, 2);
    team.forEach(function (code) {
      var c = I.getChat(code);
      c.mem.levels++;
      if (won) c.mem.wins++;
      if (ps[code] || others.indexOf(code) >= 0) I.later(code, Lp(won ? CHAT.afterWin : CHAT.afterLoss, { kills: s.kills || 0 }), 4000 + Math.random() * 25000);
      if (ps[code] && won) I.addXp(code, 1);
    });
    I.saveChats();
    var wk = I.week();
    var themed = won && !cur.options.shared && cur.options.event >= 3;
    if (won && !cur.options.shared) {
      M.reward();
      if (themed) {
        M.reward();
        I.unlock(['match_event']);
        I.note(L(TXT.weekReward), 'pvzx-good');
      }
      I.note(L(TXT.reward), 'pvzx-good');
    }
    if (X.api.available() && X.api.loggedIn()) {
      var details = { waves: s.wave, kills: s.kills, time: Math.round(s.time), plants: s.matchTeam, stage: cur.options.stage, team: team.join('.').slice(0, 80) };
      X.api
        .postScore('challenge:match', s.score, details)
        .then(function (r) {
          if (r.rank) I.note(t('summary_rank', { n: r.rank }), 'pvzx-good', 1500);
        })
        .catch(function () {});
      if (themed) X.api.postScore('challenge:week-' + wk.n, s.score, details).catch(function () {});
    }
  };

  I.onLevelEnd = function onLevelEnd(s) {
    var cur = X.modes.current;
    if (!cur || s.online) return;
    if (cur.kind === 'matchdate') I.dateEnded(cur, s);
    else if (cur.kind === 'match') I.matchEnded(cur, s);
    else return;
    I.flushStats();
  };

  // For tests and the console.
  M.debug = {
    chats: function () {
      return I.chats;
    },
    round: function () {
      return I.round;
    },
  };

  M.best = function () {
    return X.store.get('matchBest', 0);
  };

  M.init = function () {
    setTimeout(I.pullState, 4000);
    X.on('level-start', I.onLevelStart);
    X.on('level-end', I.onLevelEnd);
    G.on('scene', function (name) {
      if (name !== 'mainScene') M.close();
    });
  };
})();
