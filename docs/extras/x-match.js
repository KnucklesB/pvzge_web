/*
 * PvZ2 Gardendless - "Plant Match": a simulated dating-app mode.
 *
 * Discover: a stack of plant profiles is swiped right (like), left (pass)
 * or up (super like). A liked plant may like you back: pricier plants are
 * pickier, plants that fill a gap in your team are keener, a super like, a
 * plant that already liked you or your partner always matches. Undo and
 * Boost once per round; likes per day are limited and super likes, extra
 * likes and reveals are earned by playing.
 *
 * Profiles: a photo gallery (seed packet, the plant animated, in action,
 * with plant food, in the pool, on a bad day - rendered from the game's own
 * display prefab plants/<Name>DIS by an off-screen camera), age by world,
 * badges, headline, stats, the almanac's texts, family interests and a team
 * compatibility score.
 *
 * Messages: every match starts a scripted chat in the plant's personality
 * (3 exchanges; the second asks about her role, world, interests or price;
 * one sticker per chat). Chats are kept between rounds: plants remember you,
 * write after the levels you played together and partners get jealous.
 * Affinity gives extra starting sun in the level.
 * Likes: plants that liked you, blurred until you spend a reveal.
 * Dates: levels of several kinds (picnic, candlelight in the fog, speed
 * date, no-mower adventure, double date, wedding) with up to 3 stars;
 * winning one makes the plant your partner. Relationships grow (seeing each
 * other, dating, engaged, married) with dates, gifts and levels together,
 * and partners in the team bring sun and plant food.
 * Social: the week's theme family, the most liked plants of the server,
 * level/couple/week rankings and team codes to share.
 *
 * Files: x-match-text.js (texts), x-match.js (this one: state, helpers,
 * profiles, compatibility), -photos, -chat (chats and relationships),
 * -social (server, rankings, Social tab), -dates (dates and levels) and -ui
 * (swipe, tabs, open/close). They share X.matchI.
 *
 * The level: up to 8 matches become the seed bank of a 15-wave level in a
 * random arena, scored on the "challenge:match" leaderboard.
 */
(function () {
  'use strict';

  var MP = window.PvZMP;
  var X = window.PvZX;
  var G = MP.game;
  var t = X.t;
  var el = MP.util.el;

  var M = (X.match = {});
  // Internal state and functions shared by the x-match-*.js files.
  var I = (X.matchI = {});
  var DECK = 24; // profiles per round
  var SLOTS = 8;
  var LIKES_PER_DAY = 30;

  I.round = null;
  I.node = null;
  I.view = { tab: 'discover', photo: 0, expanded: false, prefs: false, viewing: null, chat: null };
  M.prefs = Object.assign({ families: [], maxCost: 0, sun: true, me: '', show: 'all' }, X.store.get('matchPrefs', {}));

  /* ------------------------------------------------------------ helpers */

  // Texts of this mode: {pt, en, zh} with {vars}.
  function fill(s, vars) {
    if (!vars) return s;
    return String(s).replace(/\{(\w+)\}/g, function (_, k) {
      return vars[k] != null ? vars[k] : '';
    });
  }
  function L(o, vars) {
    var s = (o && (o[MP.lang] || o.en)) || '';
    return typeof s === 'string' ? fill(s, vars) : s;
  }
  // A random line of a {pt: [...], en: [...]} list.
  function Lp(o, vars) {
    var list = (o && (o[MP.lang] || o.en)) || [''];
    return fill(list[Math.floor(Math.random() * list.length)], vars);
  }

  I.featureCache = {};
  I.plantFeature = function plantFeature(code) {
    if (code in I.featureCache) return I.featureCache[code];
    var P = G.m.Plants;
    var out = null;
    Object.keys(P.PlantEnum).some(function (k) {
      if (!isNaN(+k)) return false;
      var f = P.plants.getPlantFeature(P.PlantEnum[k]);
      if (f && f.CODENAME === code) out = f;
      return !!out;
    });
    I.featureCache[code] = out;
    return out;
  };

  function tr(obj) {
    if (!obj) return '';
    if (typeof obj === 'string') obj = { en: obj };
    if (MP.lang === 'zh' && obj.zh) return obj.zh;
    var en = obj.en || '';
    return MP.lang === 'pt' && MP.ptBR && MP.ptBR.translate ? MP.ptBR.translate(en) : en;
  }

  function shuffle(a) {
    for (var i = a.length - 1; i > 0; i--) {
      var j = Math.floor(Math.random() * (i + 1));
      var x = a[i];
      a[i] = a[j];
      a[j] = x;
    }
    return a;
  }

  function pick(arr) {
    return arr[Math.floor(Math.random() * arr.length)];
  }

  function today() {
    return new Date().toISOString().slice(0, 10);
  }

  var WORLD_KEY = { ice: 'iceage', modern: 'frontyard' };
  M.FAMILIES = ['Peashooter', 'Sun', 'Defence', 'Explosive', 'Lobber', 'Sharp', 'Cold', 'Melee', 'Poison', 'Slow', 'Fire', 'Shadow', 'Electricity', 'Magic', 'Nope'];

  // Made-up ages by the world the plant comes from (years).
  var WORLD_AGE = { frontyard: 2, egypt: 4500, pirate: 300, cowboy: 150, kongfu: 1200, future: -300, dark: 700, beach: 25, ice: 10000, lostcity: 90, eighties: 40, dino: 65000000, modern: 5, sky: 3 };
  var CLASSIC_WORLDS = { frontyard: 1, egypt: 1, pirate: 1, cowboy: 1 };
  var NEW_WORLDS = { eighties: 1, dino: 1, modern: 1, sky: 1, lostcity: 1, epic: 1 };
  var STAGE_OF_WORLD = { frontyard: 'modern', modern: 'modern', egypt: 'egypt', cowboy: 'west', future: 'future', dark: 'dark' };

  var MT = X.matchText;
  var TXT = MT.TXT;
  var CHAT = MT.CHAT;
  var PERS = MT.PERS;
  var DATES = MT.DATES;
  var STAGES = MT.STAGES;
  var TRAITS = MT.TRAITS;

  /* ---------------------------------------------- persistent counters */

  I.likesState = function likesState() {
    var s = X.store.get('matchLikes', null);
    if (!s || s.date !== today()) s = { date: today(), used: 0, bonus: 0 };
    return s;
  };
  I.likesLeft = function likesLeft() {
    var s = I.likesState();
    return Math.max(0, LIKES_PER_DAY + s.bonus - s.used);
  };
  I.useLike = function useLike(n) {
    var s = I.likesState();
    s.used = Math.max(0, s.used + n);
    X.store.set('matchLikes', s);
  };
  I.supersLeft = function supersLeft() {
    return (I.round && !I.round.superUsed ? 1 : 0) + X.store.get('matchSupers', 0);
  };
  I.reveals = function reveals() {
    return X.store.get('matchReveals', 2);
  };
  // Partners: {code: {since, xp, married, dates: {type: stars}, gifts}}.
  I.partners = function partners() {
    var ps = X.store.get('matchPartners', {});
    Object.keys(ps).forEach(function (c) {
      var r = ps[c];
      if (typeof r.xp !== 'number') r.xp = 0;
      if (!r.dates) r.dates = {};
    });
    return ps;
  };
  M.reward = function () {
    var s = I.likesState();
    s.bonus += 10;
    X.store.set('matchLikes', s);
    X.store.set('matchSupers', X.store.get('matchSupers', 0) + 1);
    X.store.set('matchReveals', I.reveals() + 1);
  };

  /* ------------------------------------------------------------ profiles */

  I.rechargeLabel = function rechargeLabel(cd) {
    return cd <= 7.5 ? t('match_fast') : cd <= 20 ? t('match_medium') : t('match_slow');
  };

  I.toughLabel = function toughLabel(v) {
    return v < 300 ? t('match_fragile') : v < 1000 ? t('match_normal') : v < 4000 ? t('match_tough') : t('match_wall');
  };

  I.rolesOf = function rolesOf(p) {
    var r = {};
    if (p.family === 'Sun' || p.sunprod) r.sun = 1;
    if (p.family === 'Defence' || p.toughness >= 2000) r.defense = 1;
    if (p.area || p.family === 'Explosive') r.area = 1;
    if (p.damage && !r.area) r.attack = 1;
    if (!Object.keys(r).length) r.support = 1;
    return r;
  };

  I.mainRole = function mainRole(p) {
    return ['sun', 'defense', 'area', 'attack', 'support'].find(function (r) {
      return p.roles[r];
    });
  };

  I.famKey = function famKey(p) {
    return 'family_' + p.family.toLowerCase();
  };

  I.profile = function profile(code) {
    var f = I.plantFeature(code);
    if (!f) return null;
    var P = G.m.Plants;
    var art = MP.cards && MP.cards.plantCanvas(code);
    if (!art) return null;
    var alm = {};
    var props = {};
    try {
      alm = P.plants.getPlantAlmanac(f.ID) || {};
    } catch (e) {}
    try {
      props = P.plants.getPlantProps(f.ID) || {};
    } catch (e) {}
    var elem = {};
    (alm.Elements || []).forEach(function (e) {
      elem[e.TYPE] = e;
    });
    var w = f.OBTAINWORLD || '';
    var world = WORLD_KEY[w] || w;
    var worldName = t('world_' + world);
    var cost = Number(props.SunCost) || 0;
    var p = {
      code: code,
      feature: f,
      name: X.plantName(code),
      packet: art.toDataURL(),
      photos: null,
      cost: cost,
      cooldown: Number(props.Cooldown) || 0,
      toughness: Number(props.Toughness) || 0,
      damage: elem.DAMAGE ? (elem.DAMAGE.VALUE != null ? String(elem.DAMAGE.VALUE) : tr(elem.DAMAGE.SORT)) : '',
      range: elem.RANGE ? tr(elem.RANGE.SORT) : '',
      area: elem.AREA ? tr(elem.AREA.SORT) : '',
      food: elem.PLANTFOOD ? tr(elem.PLANTFOOD.SORT) : '',
      sunprod: elem.SUNPRODUCTION ? tr(elem.SUNPRODUCTION.SORT) : '',
      arming: elem.ARMINGTIME && elem.ARMINGTIME.VALUE,
      duration: elem.DURATION && elem.DURATION.VALUE,
      family: props.Family || 'Nope',
      worldKey: w,
      world: worldName === 'world_' + world ? t('match_world_other') : worldName,
      bio: tr(alm.Chat),
      intro: tr(alm.Introduction),
      brief: tr(alm.BriefIntroduction),
      specials: (alm.Special || []).map(function (s) {
        return { name: tr(s.NAME), desc: tr(s.DESCRIPTION) };
      }),
      distance: 2 + Math.floor(Math.random() * 8),
      chance: Math.max(0.35, Math.min(0.9, 0.9 - cost / 900)),
      online: Math.random() < 0.4,
      likedYou: Math.random() < 0.25,
      partner: !!I.partners()[code],
    };
    p.roles = I.rolesOf(p);
    I.traits(p);
    var persKeys = Object.keys(PERS);
    p.pers = persKeys[X.hashSeed('pers:' + code) % persKeys.length];
    p.event = p.family === I.week().fam;
    if (p.event) p.chance = Math.min(0.97, p.chance * 1.25);
    var age = WORLD_AGE[w];
    p.age = age == null ? '' : age < 0 ? L(TXT.ageFuture) : L(TXT.age, { n: age.toLocaleString(MP.lang === 'pt' ? 'pt-BR' : MP.lang === 'zh' ? 'zh-CN' : 'en-US') });
    var likes = t(I.famKey(p) + '_likes').split('|');
    p.likes = likes;
    p.headline = L({ pt: pick(TXT.headlines.pt), en: pick(TXT.headlines.en), zh: pick(TXT.headlines.zh) }, { a: (likes[0] || '').toLowerCase(), b: (likes[1] || '').toLowerCase(), w: p.world });
    p.badges = [];
    if (p.partner) p.badges.push(L(TXT.badgePartner));
    if (p.event) p.badges.push(L(TXT.weekBadge));
    p.badges.push(PERS[p.pers].icon + ' ' + I.gfix(L(PERS[p.pers].name), p.gender));
    if (CLASSIC_WORLDS[w]) p.badges.push(I.gfix(L(TXT.badgeVerified), p.gender));
    if (cost >= 300) p.badges.push(I.gfix(L(TXT.badgeLegend), p.gender));
    if (NEW_WORLDS[w]) p.badges.push(I.gfix(L(TXT.badgeNew), p.gender));
    if (p.likedYou) p.badges.push(L(TXT.badgePopular));
    return p;
  };

  I.newRound = function newRound() {
    var prefs = M.prefs;
    var codes = shuffle(MP.allPlants().slice());
    var cards = [];
    var sunSeen = false;
    var sunSpare = null;
    for (var i = 0; i < codes.length && cards.length < DECK; i++) {
      var p = I.profile(codes[i]);
      if (!p) continue;
      var ok = (!prefs.families.length || prefs.families.indexOf(p.family) >= 0) && (!prefs.maxCost || p.cost <= prefs.maxCost) && (prefs.show === 'all' || !prefs.show || p.gender === prefs.show);
      if (p.roles.sun && !sunSpare && (prefs.show === 'all' || !prefs.show || p.gender === prefs.show)) sunSpare = p;
      if (!ok) continue;
      if (p.roles.sun) sunSeen = true;
      cards.push(p);
    }
    if (prefs.sun && !sunSeen && sunSpare) cards.splice(Math.min(3, cards.length), 0, sunSpare);
    else if (prefs.sun) {
      var at = cards.findIndex(function (c) {
        return c.roles.sun;
      });
      if (at > 4) cards.splice(2, 0, cards.splice(at, 1)[0]);
    }
    var has = function (code) {
      return cards.some(function (c) {
        return c.code === code;
      });
    };
    // Plants of the week's theme family: at least 5 in the deck.
    var fam = I.week().fam;
    var evCount = cards.filter(function (c) {
      return c.event;
    }).length;
    for (var k = 0; k < codes.length && evCount < 5; k++) {
      if (has(codes[k]) || I.famOf(codes[k]) !== fam || (prefs.show && prefs.show !== 'all' && I.genderOf(codes[k]) !== prefs.show)) continue;
      var ep = I.profile(codes[k]);
      if (!ep) continue;
      cards.splice(Math.floor(Math.random() * Math.min(16, cards.length + 1)), 0, ep);
      evCount++;
    }
    // Partners (dates won) always show up again early in the deck.
    shuffle(Object.keys(I.partners()))
      .slice(0, SLOTS)
      .forEach(function (code) {
        if (has(code)) return;
        var pp = I.profile(code);
        if (pp) cards.splice(Math.floor(Math.random() * Math.min(10, cards.length + 1)), 0, pp);
      });
    if (cards.length > DECK) cards.length = DECK;
    // Chats from earlier rounds stay, their sessions end.
    Object.keys(I.chats).forEach(function (c) {
      I.chats[c].s = null;
    });
    I.saveChats();
    I.round = { cards: cards, i: 0, matches: [], history: [], superUsed: false, undoUsed: false, boostUsed: false, boosted: false, revealed: {} };
    I.view.photo = 0;
    I.view.expanded = false;
    I.view.chat = null;
    I.view.viewing = null;
    I.queuePhotos();
  };

  /* -------------------------------------------------- team compatibility */

  I.ROLE_ORDER = ['sun', 'defense', 'attack', 'area', 'support'];

  /* ------------------------------------------------------------- traits */

  // Traits of a plant: fixed per plant (the same for every player), from
  // a hash of its code.
  I.trait = function trait(code, key, n) {
    return X.hashSeed('trait:' + key + ':' + code) % n;
  };

  I.genderOf = function genderOf(code) {
    var g = I.trait(code, 'gender', 20);
    return g < 9 ? 'f' : g < 18 ? 'm' : 'n';
  };

  I.traits = function traits(p) {
    var c = p.code;
    p.gender = I.genderOf(c);
    var it = I.trait(c, 'interest', 20);
    p.interest = it < 8 ? 'all' : it < 14 ? (p.gender === 'm' ? 'f' : 'm') : it < 19 ? p.gender === 'n' ? 'all' : p.gender : 'n';
    p.sign = I.trait(c, 'sign', 12);
    p.height = 12 + I.trait(c, 'height', 70) + Math.round(Math.min(40, p.toughness / 200));
    var jobs = TRAITS.jobs[I.mainRole(p)] || TRAITS.jobs.support;
    p.job = jobs[I.trait(c, 'job', jobs.length)];
    p.dish = TRAITS.foods[I.trait(c, 'food', TRAITS.foods.length)];
    p.music = TRAITS.music[I.trait(c, 'music', TRAITS.music.length)];
    p.pet = TRAITS.pets[I.trait(c, 'pet', TRAITS.pets.length)];
    p.kids = TRAITS.kids[I.trait(c, 'kids', TRAITS.kids.length)];
    var loves = Object.keys(TRAITS.love);
    p.love = loves[I.trait(c, 'love', loves.length)];
  };

  // Does the plant look for someone like the player (their gender, if set)?
  I.seeksYou = function seeksYou(p) {
    var me = M.prefs.me;
    return !me || !p.interest || p.interest === 'all' || p.interest === me;
  };

  // {g:fem|masc|neutral} by the plant's gender, {u:…} by the player's.
  I.gfix = function gfix(text, g) {
    var pick3 = function (who) {
      return function (_, a, b, c) {
        return who === 'f' ? a : who === 'n' ? c : b;
      };
    };
    return String(text == null ? '' : text)
      .replace(/\{g:([^|}]*)\|([^|}]*)\|([^}]*)\}/g, pick3(g || 'f'))
      .replace(/\{u:([^|}]*)\|([^|}]*)\|([^}]*)\}/g, pick3(M.prefs.me || 'm'));
  };

  // Rows of the "Basics" section: [icon, label, value].
  I.traitRows = function traitRows(p) {
    var T = TRAITS;
    var gx = function (o) {
      return I.gfix(L(o), p.gender);
    };
    var sign = T.signs[p.sign];
    var love = T.love[p.love];
    return [
      [T.gender[p.gender].icon, L(T.labels.gender), L(T.gender[p.gender])],
      ['🔎', L(T.labels.lookingFor), L(T.interest[p.interest])],
      [sign.icon, L(T.labels.sign), L(sign)],
      ['📏', L(T.labels.height), L(TXT.cm, { n: p.height })],
      ['💼', L(T.labels.job), gx(p.job)],
      ['🍽', L(T.labels.food), L(p.dish)],
      ['🎵', L(T.labels.music), L(p.music)],
      ['🐾', L(T.labels.pet), L(p.pet)],
      ['🌱', L(T.labels.kids), gx(p.kids)],
      ['🥤', L(T.labels.drinks), L(T.drinks)],
      ['🚭', L(T.labels.smokes), L(T.smokes)],
      [love.icon, L(T.labels.love), L(love) + ' (' + L(love.desc) + ')'],
    ];
  };

  // Short line on the card: gender, sign, height, job.
  I.traitLine = function traitLine(p) {
    var T = TRAITS;
    return [T.gender[p.gender].icon + ' ' + L(T.gender[p.gender]), T.signs[p.sign].icon + ' ' + L(T.signs[p.sign]), '📏 ' + L(TXT.cm, { n: p.height }), '💼 ' + I.gfix(L(p.job), p.gender)].join(' · ');
  };

  // A love language that matches what happened is worth one more point.
  I.loveBonus = function loveBonus(code, kind) {
    var p = I.profCache[code] || I.prof(code);
    return p && p.love === kind ? 1 : 0;
  };

  I.compatibility = function compatibility(p) {
    if (p._compat && p._compatFor === I.round.matches.length) return p._compat;
    var have = {};
    I.round.matches.forEach(function (m) {
      Object.keys(m.roles).forEach(function (r) {
        have[r] = (have[r] || 0) + 1;
      });
    });
    var score = 58 + ((p.code.length * 7) % 13);
    var reason = 'match_why_ok';
    var gap = I.ROLE_ORDER.find(function (r) {
      return p.roles[r] && !have[r] && r !== 'support';
    });
    if (gap) {
      score += 26;
      reason = 'match_why_' + gap;
    } else if (
      Object.keys(p.roles).some(function (r) {
        return (have[r] || 0) >= 3;
      })
    ) {
      score -= 18;
      reason = 'match_why_many';
    }
    var seeks = I.seeksYou(p);
    if (!seeks) score -= 20;
    if (p.partner) score = Math.max(score, 95);
    p._compat = { score: Math.max(12, Math.min(99, score)), reason: reason, seek: seeks ? '' : L(TRAITS.labels.notYou, { who: L(TRAITS.interest[p.interest]) }) };
    p._compatFor = I.round.matches.length;
    return p._compat;
  };

  // Helpers for the other files.
  I.fill = fill;
  I.L = L;
  I.Lp = Lp;
  I.shuffle = shuffle;
  I.pick = pick;
  I.today = today;
  I.tr = tr;
  I.DECK = DECK;
  I.SLOTS = SLOTS;
  I.LIKES_PER_DAY = LIKES_PER_DAY;
  I.WORLD_KEY = WORLD_KEY;
  I.WORLD_AGE = WORLD_AGE;
  I.CLASSIC_WORLDS = CLASSIC_WORLDS;
  I.NEW_WORLDS = NEW_WORLDS;
  I.STAGE_OF_WORLD = STAGE_OF_WORLD;
})();
