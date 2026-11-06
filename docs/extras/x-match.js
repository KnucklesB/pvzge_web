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
  var DECK = 24; // profiles per round
  var SLOTS = 8;
  var LIKES_PER_DAY = 30;

  var round = null;
  var node = null;
  var view = { tab: 'discover', photo: 0, expanded: false, prefs: false, viewing: null, chat: null };
  M.prefs = X.store.get('matchPrefs', { families: [], maxCost: 0, sun: true });

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

  var featureCache = {};
  function plantFeature(code) {
    if (code in featureCache) return featureCache[code];
    var P = G.m.Plants;
    var out = null;
    Object.keys(P.PlantEnum).some(function (k) {
      if (!isNaN(+k)) return false;
      var f = P.plants.getPlantFeature(P.PlantEnum[k]);
      if (f && f.CODENAME === code) out = f;
      return !!out;
    });
    featureCache[code] = out;
    return out;
  }

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

  /* ---------------------------------------------- persistent counters */

  function likesState() {
    var s = X.store.get('matchLikes', null);
    if (!s || s.date !== today()) s = { date: today(), used: 0, bonus: 0 };
    return s;
  }
  function likesLeft() {
    var s = likesState();
    return Math.max(0, LIKES_PER_DAY + s.bonus - s.used);
  }
  function useLike(n) {
    var s = likesState();
    s.used = Math.max(0, s.used + n);
    X.store.set('matchLikes', s);
  }
  function supersLeft() {
    return (round && !round.superUsed ? 1 : 0) + X.store.get('matchSupers', 0);
  }
  function reveals() {
    return X.store.get('matchReveals', 2);
  }
  // Partners: {code: {since, xp, married, dates: {type: stars}, gifts}}.
  function partners() {
    var ps = X.store.get('matchPartners', {});
    Object.keys(ps).forEach(function (c) {
      var r = ps[c];
      if (typeof r.xp !== 'number') r.xp = 0;
      if (!r.dates) r.dates = {};
    });
    return ps;
  }
  M.reward = function () {
    var s = likesState();
    s.bonus += 10;
    X.store.set('matchLikes', s);
    X.store.set('matchSupers', X.store.get('matchSupers', 0) + 1);
    X.store.set('matchReveals', reveals() + 1);
  };

  /* ------------------------------------------------------------ profiles */

  function rechargeLabel(cd) {
    return cd <= 7.5 ? t('match_fast') : cd <= 20 ? t('match_medium') : t('match_slow');
  }

  function toughLabel(v) {
    return v < 300 ? t('match_fragile') : v < 1000 ? t('match_normal') : v < 4000 ? t('match_tough') : t('match_wall');
  }

  function rolesOf(p) {
    var r = {};
    if (p.family === 'Sun' || p.sunprod) r.sun = 1;
    if (p.family === 'Defence' || p.toughness >= 2000) r.defense = 1;
    if (p.area || p.family === 'Explosive') r.area = 1;
    if (p.damage && !r.area) r.attack = 1;
    if (!Object.keys(r).length) r.support = 1;
    return r;
  }

  function mainRole(p) {
    return ['sun', 'defense', 'area', 'attack', 'support'].find(function (r) {
      return p.roles[r];
    });
  }

  function famKey(p) {
    return 'family_' + p.family.toLowerCase();
  }

  function profile(code) {
    var f = plantFeature(code);
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
      partner: !!partners()[code],
    };
    p.roles = rolesOf(p);
    var persKeys = Object.keys(PERS);
    p.pers = persKeys[X.hashSeed('pers:' + code) % persKeys.length];
    p.event = p.family === week().fam;
    if (p.event) p.chance = Math.min(0.97, p.chance * 1.25);
    var age = WORLD_AGE[w];
    p.age = age == null ? '' : age < 0 ? L(TXT.ageFuture) : L(TXT.age, { n: age.toLocaleString(MP.lang === 'pt' ? 'pt-BR' : MP.lang === 'zh' ? 'zh-CN' : 'en-US') });
    var likes = t(famKey(p) + '_likes').split('|');
    p.likes = likes;
    p.headline = L({ pt: pick(TXT.headlines.pt), en: pick(TXT.headlines.en), zh: pick(TXT.headlines.zh) }, { a: (likes[0] || '').toLowerCase(), b: (likes[1] || '').toLowerCase(), w: p.world });
    p.badges = [];
    if (p.partner) p.badges.push(L(TXT.badgePartner));
    if (p.event) p.badges.push(L(TXT.weekBadge));
    p.badges.push(PERS[p.pers].icon + ' ' + L(PERS[p.pers].name));
    if (CLASSIC_WORLDS[w]) p.badges.push(L(TXT.badgeVerified));
    if (cost >= 300) p.badges.push(L(TXT.badgeLegend));
    if (NEW_WORLDS[w]) p.badges.push(L(TXT.badgeNew));
    if (p.likedYou) p.badges.push(L(TXT.badgePopular));
    return p;
  }

  function newRound() {
    var prefs = M.prefs;
    var codes = shuffle(MP.allPlants().slice());
    var cards = [];
    var sunSeen = false;
    var sunSpare = null;
    for (var i = 0; i < codes.length && cards.length < DECK; i++) {
      var p = profile(codes[i]);
      if (!p) continue;
      var ok = (!prefs.families.length || prefs.families.indexOf(p.family) >= 0) && (!prefs.maxCost || p.cost <= prefs.maxCost);
      if (p.roles.sun && !sunSpare) sunSpare = p;
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
    var fam = week().fam;
    var evCount = cards.filter(function (c) {
      return c.event;
    }).length;
    for (var k = 0; k < codes.length && evCount < 5; k++) {
      if (has(codes[k]) || famOf(codes[k]) !== fam) continue;
      var ep = profile(codes[k]);
      if (!ep) continue;
      cards.splice(Math.floor(Math.random() * Math.min(16, cards.length + 1)), 0, ep);
      evCount++;
    }
    // Partners (dates won) always show up again early in the deck.
    shuffle(Object.keys(partners()))
      .slice(0, SLOTS)
      .forEach(function (code) {
        if (has(code)) return;
        var pp = profile(code);
        if (pp) cards.splice(Math.floor(Math.random() * Math.min(10, cards.length + 1)), 0, pp);
      });
    if (cards.length > DECK) cards.length = DECK;
    // Chats from earlier rounds stay, their sessions end.
    Object.keys(chats).forEach(function (c) {
      chats[c].s = null;
    });
    saveChats();
    round = { cards: cards, i: 0, matches: [], history: [], superUsed: false, undoUsed: false, boostUsed: false, boosted: false, revealed: {} };
    view.photo = 0;
    view.expanded = false;
    view.chat = null;
    view.viewing = null;
    queuePhotos();
  }

  /* -------------------------------------------------- team compatibility */

  var ROLE_ORDER = ['sun', 'defense', 'attack', 'area', 'support'];

  function compatibility(p) {
    if (p._compat && p._compatFor === round.matches.length) return p._compat;
    var have = {};
    round.matches.forEach(function (m) {
      Object.keys(m.roles).forEach(function (r) {
        have[r] = (have[r] || 0) + 1;
      });
    });
    var score = 58 + ((p.code.length * 7) % 13);
    var reason = 'match_why_ok';
    var gap = ROLE_ORDER.find(function (r) {
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
    if (p.partner) score = Math.max(score, 95);
    p._compat = { score: Math.max(12, Math.min(99, score)), reason: reason };
    p._compatFor = round.matches.length;
    return p._compat;
  }

  /* --------------------------------------------------------- the camera */

  var LAYER = 1 << 19;
  var RT = 640;
  var cam = null;
  var ANIM_FRAMES = 8;

  function frames(n) {
    return new Promise(function (r) {
      var k = 0;
      (function f() {
        if (++k >= n) r();
        else requestAnimationFrame(f);
      })();
    });
  }

  function ensureCamera() {
    var cc = G.cc;
    if (cam && cam.root.isValid) return cam;
    var scene = cc.director.getScene();
    var root = new cc.Node('XMatchCamera');
    root.layer = LAYER;
    scene.addChild(root);
    root.setPosition(-20000, -20000, 0);
    root.addComponent(cc.RenderRoot2D);
    var camNode = new cc.Node('Cam');
    camNode.layer = LAYER;
    root.addChild(camNode);
    camNode.setPosition(0, 60, 1000);
    var c = camNode.addComponent(cc.Camera);
    c.projection = cc.Camera.ProjectionType.ORTHO;
    c.orthoHeight = 135;
    c.visibility = LAYER;
    c.clearFlags = cc.Camera.ClearFlag.SOLID_COLOR;
    c.clearColor = new cc.Color(0, 0, 0, 0);
    c.priority = -10;
    c.near = 1;
    c.far = 2000;
    var rt = new cc.RenderTexture();
    rt.reset({ width: RT, height: RT });
    c.targetTexture = rt;
    cam = { root: root, rt: rt };
    return cam;
  }

  // Pixels and their opaque bounds.
  function readRaw(rt) {
    var px = rt.readPixels(0, 0, RT, RT);
    var b = { minX: RT, minY: RT, maxX: -1, maxY: -1 };
    for (var y = 0; y < RT; y++) {
      for (var x = 0; x < RT; x++) {
        if (px[(y * RT + x) * 4 + 3] > 8) {
          if (x < b.minX) b.minX = x;
          if (x > b.maxX) b.maxX = x;
          if (y < b.minY) b.minY = y;
          if (y > b.maxY) b.maxY = y;
        }
      }
    }
    return { px: px, box: b.maxX < 0 ? null : b };
  }

  function unionBox(list) {
    var u = null;
    list.forEach(function (r) {
      var b = r.box;
      if (!b) return;
      if (!u) u = { minX: b.minX, minY: b.minY, maxX: b.maxX, maxY: b.maxY };
      else {
        u.minX = Math.min(u.minX, b.minX);
        u.minY = Math.min(u.minY, b.minY);
        u.maxX = Math.max(u.maxX, b.maxX);
        u.maxY = Math.max(u.maxY, b.maxY);
      }
    });
    return u;
  }

  // Crop to a box (the RenderTexture's rows go bottom-up) -> data URL.
  function crop(px, b) {
    var w = b.maxX - b.minX + 1;
    var h = b.maxY - b.minY + 1;
    var pad = Math.round(Math.max(w, h) * 0.08);
    var c = document.createElement('canvas');
    c.width = w + pad * 2;
    c.height = h + pad * 2;
    var tmp = document.createElement('canvas');
    tmp.width = w;
    tmp.height = h;
    var tctx = tmp.getContext('2d');
    var id = tctx.createImageData(w, h);
    for (var yy = 0; yy < h; yy++) {
      var src = ((b.maxY - yy) * RT + b.minX) * 4;
      id.data.set(px.subarray(src, src + w * 4), yy * w * 4);
    }
    tctx.putImageData(id, 0, 0);
    c.getContext('2d').drawImage(tmp, pad, pad);
    return c.toDataURL();
  }

  var POSES = {
    idle: /^idle1?$|idle/i,
    attack: /shoot|attack|lob|fire|bite|chomp|punch|throw|blow|spit|smash|zap|slap|explode|stab|produce/i,
    food: /^food$|plantfood|food/i,
    water: /^water$/i,
    death: /^death/i,
  };

  function animFor(names, kind) {
    return names.find(function (n) {
      return POSES[kind].test(n);
    });
  }

  function loadPrefab(path) {
    return new Promise(function (resolve) {
      G.cc.resources.load(path, G.cc.Prefab, function (err, prefab) {
        resolve(err ? null : prefab);
      });
    });
  }

  function setPose(dbs, anim, progress) {
    dbs.forEach(function (d) {
      try {
        var a = d.armature && d.armature();
        if (a && a.animation.hasAnimation(anim)) a.animation.gotoAndStopByProgress(anim, progress);
      } catch (e) {}
    });
  }

  // {idle: [frames], attack, food, water, death} (missing poses left out).
  function shoot(p) {
    var cc = G.cc;
    var res = p.feature.RES || {};
    var name = res.Disabled || res.Plant;
    if (!name || !cc.RenderRoot2D) return Promise.resolve({});
    return loadPrefab('plants/' + name + 'DIS').then(function (prefab) {
      if (!prefab || !node) return {};
      var c = ensureCamera();
      var n = cc.instantiate(prefab);
      c.root.addChild(n);
      n.walk(function (x) {
        x.layer = LAYER;
      });
      var dbs = n.getComponentsInChildren(cc.dragonBones.ArmatureDisplay);
      var main = dbs.find(function (d) {
        return d.armature && d.armature();
      });
      var names = [];
      try {
        names = main.armature().animation.animationNames.slice();
      } catch (e) {}
      var out = {};
      var snap = function (anim, progress) {
        setPose(dbs, anim, progress);
        return frames(3).then(function () {
          return readRaw(c.rt);
        });
      };
      // Animated pose: a loop of frames cropped to the same box.
      var idle = animFor(names, 'idle');
      var seq = Promise.resolve();
      var raws = [];
      if (idle) {
        for (var k = 0; k < ANIM_FRAMES; k++) {
          (function (k) {
            seq = seq.then(function () {
              return snap(idle, k / ANIM_FRAMES).then(function (r) {
                raws.push(r);
              });
            });
          })(k);
        }
        seq = seq.then(function () {
          var box = unionBox(raws);
          if (box) {
            out.idle = raws.map(function (r) {
              return crop(r.px, box);
            });
          }
        });
      }
      [
        ['attack', 0.55],
        ['food', 0.5],
        ['water', 0.4],
        ['death', 0.45],
      ].forEach(function (pose) {
        seq = seq.then(function () {
          var anim = animFor(names, pose[0]);
          if (!anim || anim === idle) return;
          return snap(anim, pose[1]).then(function (r) {
            if (r.box) out[pose[0]] = crop(r.px, r.box);
          });
        });
      });
      return frames(3)
        .then(function () {
          return seq;
        })
        .then(function () {
          n.destroy();
          return out;
        })
        .catch(function (e) {
          MP.warn('match: photo', p.code, e);
          if (n.isValid) n.destroy();
          return out;
        });
    });
  }

  var shooting = false;
  function queuePhotos() {
    if (shooting || !round || !node) return;
    var target = null;
    var wanted = [];
    for (var i = round.i; i < Math.min(round.cards.length, round.i + 3); i++) wanted.push(round.cards[i]);
    if (view.viewing) wanted.unshift(view.viewing);
    if (view.chat) wanted.unshift(view.chat);
    round.matches.forEach(function (m) {
      wanted.push(m);
    });
    target = wanted.find(function (p) {
      return p && !p.photos;
    });
    if (!target) return;
    shooting = true;
    shoot(target).then(function (photos) {
      target.photos = photos;
      shooting = false;
      if (node) render();
      queuePhotos();
    });
  }

  function photoList(p) {
    var list = [];
    var ph = p.photos || {};
    if (ph.idle) list.push({ frames: ph.idle, label: t('match_photo_idle') });
    list.push({ src: p.packet, label: t('match_photo_card'), packet: true });
    if (ph.attack) list.push({ src: ph.attack, label: t('match_photo_attack') });
    if (ph.food) list.push({ src: ph.food, label: t('match_photo_food') });
    if (ph.water) list.push({ src: ph.water, label: L(TXT.photoWater) });
    if (ph.death) list.push({ src: ph.death, label: L(TXT.photoDeath) });
    return list;
  }

  function avatar(p) {
    var ph = p.photos || {};
    return (ph.idle && ph.idle[0]) || p.packet;
  }

  // Animated photos: <img> with _frames, advanced by one timer.
  function animImg(framesList, cls) {
    var img = el('img' + (cls ? '.' + cls : '') + '.pvzx-anim', { src: framesList[0], alt: '', draggable: 'false' });
    img._frames = framesList;
    img._k = 0;
    return img;
  }
  setInterval(function () {
    if (!node) return;
    node.querySelectorAll('img.pvzx-anim').forEach(function (img) {
      var f = img._frames;
      if (!f || f.length < 2) return;
      img._k = (img._k + 1) % f.length;
      img.src = f[img._k];
    });
  }, 110);

  /* -------------------------------------------------------------- chat */

  // Chats are kept between rounds (memory, partners' messages): {code:
  // {msgs: [{from, text, k}], unread, at, s: session of this round, mem}}.
  var chats = X.store.get('matchChats', {});
  var typing = {};
  var MAX_CHATS = 40;
  var MAX_MSGS = 60;

  function saveChats() {
    var codes = Object.keys(chats);
    if (codes.length > MAX_CHATS) {
      var ps = partners();
      codes
        .filter(function (c) {
          return !ps[c] && !(round && round.matches.some(function (m) {
            return m.code === c;
          }));
        })
        .sort(function (a, b) {
          return chats[a].at - chats[b].at;
        })
        .slice(0, codes.length - MAX_CHATS)
        .forEach(function (c) {
          delete chats[c];
        });
    }
    Object.keys(chats).forEach(function (c) {
      var ch = chats[c];
      if (ch.msgs.length > MAX_MSGS) {
        var cut = ch.msgs.length - MAX_MSGS;
        ch.msgs = ch.msgs.slice(cut);
        if (ch.s) ch.s.start = Math.max(0, ch.s.start - cut);
      }
    });
    X.store.set('matchChats', chats);
  }

  function getChat(code) {
    var c = chats[code];
    if (!c) c = chats[code] = { msgs: [], unread: false, at: Date.now(), s: null, mem: { sessions: 0, wins: 0, levels: 0 } };
    return c;
  }

  function viewingChat(code) {
    return !!(node && view.tab === 'messages' && view.chat && view.chat.code === code);
  }

  function pushMsg(code, from, text, kind) {
    var c = getChat(code);
    c.msgs.push(kind ? { from: from, text: text, k: kind } : { from: from, text: text });
    if (from !== 'me' && !viewingChat(code)) c.unread = true;
    c.at = Date.now();
    saveChats();
  }

  function persOf(p) {
    return PERS[p.pers] || PERS.sweet;
  }

  function startChat(p) {
    var c = getChat(p.code);
    var mem = c.mem;
    var start = c.msgs.length;
    if (c.msgs.length) c.msgs.push({ from: 'sys', text: L(TXT.newSession) });
    var text;
    if (mem.sessions && mem.ghosted) text = Lp(CHAT.againGhost);
    else if (mem.sessions && mem.wins) text = Lp(CHAT.againWins, { wins: mem.wins });
    else if (mem.sessions && mem.role && CHAT.roles[mem.role]) text = Lp(CHAT.again, { role: L(CHAT.roles[mem.role]) });
    else if (mem.sessions) text = Lp(CHAT.again, { role: L(CHAT.roles.sun) });
    else text = Math.random() < 0.6 ? Lp(persOf(p).openers) : Lp(CHAT.openers, { like: (p.likes[0] || '').toLowerCase() });
    mem.sessions++;
    mem.ghosted = false;
    c.s = { step: 1, affinity: 0, ghost: false, done: false, sticker: false, start: start, q2: null };
    pushMsg(p.code, 'them', text);
    c.unread = true;
  }

  // Undo / unmatch: the session of this round disappears.
  function dropChat(code) {
    var c = chats[code];
    if (!c || !c.s) return;
    c.msgs.length = Math.min(c.msgs.length, c.s.start);
    c.s = null;
    c.mem.sessions = Math.max(0, c.mem.sessions - 1);
    c.unread = false;
    saveChats();
  }

  var WORLD_LIST = ['frontyard', 'egypt', 'pirate', 'cowboy', 'kongfu', 'future', 'dark', 'beach', 'iceage', 'lostcity', 'eighties', 'dino', 'sky'];

  function otherWorlds(p, n) {
    return shuffle(
      WORLD_LIST.map(function (w) {
        return t('world_' + w);
      }).filter(function (name) {
        return name !== p.world && name.indexOf('world_') !== 0;
      }),
    ).slice(0, n);
  }

  function otherLikes(p, n) {
    return shuffle(
      M.FAMILIES.filter(function (f) {
        return f !== p.family && f !== 'Nope';
      }),
    )
      .slice(0, n)
      .map(function (f) {
        return t('family_' + f.toLowerCase() + '_likes').split('|')[0];
      });
  }

  // Exchange 2: a question about the plant (role, world, interests, price).
  function makeQ2(p) {
    var types = ['role', 'role', 'like', 'cost'];
    if (p.world !== t('match_world_other')) types.push('world');
    var type = pick(types);
    var opts;
    var ask;
    if (type === 'role') {
      var right = mainRole(p);
      ask = L(CHAT.r2q);
      opts = [{ q: 'good', key: right }].concat(
        shuffle(
          Object.keys(CHAT.roles).filter(function (r) {
            return r !== right;
          }),
        )
          .slice(0, 2)
          .map(function (r) {
            return { q: 'meh', key: r };
          }),
      );
      opts.forEach(function (o) {
        o.text = L(CHAT.roles[o.key]);
        o.role = true;
      });
    } else if (type === 'world') {
      ask = L(CHAT.q.world.ask);
      opts = [{ q: 'good', text: p.world }].concat(
        otherWorlds(p, 2).map(function (w) {
          return { q: 'meh', text: w };
        }),
      );
    } else if (type === 'like') {
      ask = L(CHAT.q.like.ask);
      opts = [{ q: 'good', text: p.likes[0] || '?' }].concat(
        otherLikes(p, 2).map(function (x) {
          return { q: 'meh', text: x };
        }),
      );
    } else {
      ask = L(CHAT.q.cost.ask, { cost: p.cost });
      var pricey = p.cost >= 175;
      opts = [
        { q: pricey ? 'good' : 'meh', text: L(CHAT.q.cost.worth) },
        { q: pricey ? 'meh' : 'good', text: L(CHAT.q.cost.cheap) },
        { q: 'bad', text: L(CHAT.q.cost.pricey) },
      ];
    }
    return { type: type, ask: ask, opts: shuffle(opts) };
  }

  function chatOptions(p, c) {
    var s = c.s;
    if (!s || s.done || s.ghost || typing[p.code] || !inRound(p)) return [];
    if (s.step === 1) {
      return (s.o1 =
        s.o1 ||
        shuffle(
          CHAT.r1.map(function (r) {
            return { q: r.q, text: L(r, { name: p.name, like: (p.likes[0] || '').toLowerCase() }) };
          }),
        ));
    }
    if (s.step === 2) {
      if (!s.q2) s.q2 = makeQ2(p);
      return s.q2.opts;
    }
    if (s.step === 3) {
      return (s.o3 =
        s.o3 ||
        shuffle(
          CHAT.r3.map(function (r) {
            return { q: r.q, text: L(r) };
          }),
        ));
    }
    return [];
  }

  function inRound(p) {
    return !!(round && round.matches.some(function (m) {
      return m.code === p.code;
    }));
  }

  function reactionTo(p, s, opt) {
    var pers = persOf(p);
    if (s.step === 2 && s.q2 && s.q2.type !== 'role') {
      var q = CHAT.q[s.q2.type];
      if (opt.q === 'good') return L(q.right);
      if (opt.q === 'bad') return Lp(pers.bad);
      return q.wrong ? L(q.wrong, { world: p.world, like: (p.likes[0] || '').toLowerCase() }) : Lp(CHAT.react.meh);
    }
    if (opt.role) return opt.q === 'good' ? L(CHAT.roleGood) : L(CHAT.roleMeh);
    if (opt.q === 'good') return Math.random() < 0.6 ? Lp(pers.good) : Lp(CHAT.react.good);
    if (opt.q === 'bad') return Math.random() < 0.7 ? Lp(pers.bad) : Lp(CHAT.react.bad);
    return Lp(CHAT.react[s.step === 1 ? 'hello' : 'meh']);
  }

  function reply(p, opt) {
    var c = getChat(p.code);
    var s = c.s;
    if (!s || typing[p.code]) return;
    pushMsg(p.code, 'me', opt.text);
    if (opt.q === 'good') s.affinity = Math.min(3, s.affinity + 1);
    if (opt.role) c.mem.role = opt.key;
    typing[p.code] = true;
    render();
    setTimeout(function () {
      typing[p.code] = false;
      if (c.s !== s) return; // undone meanwhile
      var reaction = reactionTo(p, s, opt);
      // Some plants ghost after a bad first reply (or just because).
      if (s.step === 1 && Math.random() < (opt.q === 'bad' ? persOf(p).ghost : 0.05)) {
        s.ghost = true;
        c.mem.ghosted = true;
        pushMsg(p.code, 'sys', L(TXT.ghosted, { name: p.name }));
      } else {
        pushMsg(p.code, 'them', reaction);
        s.step++;
        if (s.step === 2) {
          s.q2 = makeQ2(p);
          pushMsg(p.code, 'them', s.q2.ask);
        } else if (s.step === 3) pushMsg(p.code, 'them', L(CHAT.r3q));
        else {
          s.done = true;
          pushMsg(p.code, 'them', L(CHAT.end[Math.min(3, s.affinity)]));
          if (s.affinity >= 3) unlock(['match_chat']);
        }
      }
      saveChats();
      if (node) render();
    }, 700 + Math.random() * 700);
  }

  function sendSticker(p, emoji) {
    var c = getChat(p.code);
    var s = c.s;
    if (!s || s.sticker || s.ghost || typing[p.code]) return;
    s.sticker = true;
    pushMsg(p.code, 'me', emoji, 'sticker');
    typing[p.code] = true;
    render();
    setTimeout(function () {
      typing[p.code] = false;
      if (c.s !== s) return;
      if (emoji === persOf(p).sticker) {
        s.affinity = Math.min(3, s.affinity + 1);
        pushMsg(p.code, 'them', Lp(CHAT.stickerLove));
      } else pushMsg(p.code, 'them', Lp(CHAT.stickerMeh));
      if (node) render();
    }, 600 + Math.random() * 500);
  }

  function affinityHearts(n) {
    return '❤'.repeat(n) + '♡'.repeat(Math.max(0, 3 - n));
  }

  function unlock(ids) {
    if (X.achievements && X.achievements.unlockExtra) X.achievements.unlockExtra(ids);
  }

  /* ------------------------------------------------------ relationships */

  // Stage: 0 seeing each other, 1 dating (3 xp), 2 engaged (8 xp), 3 married
  // (won the wedding date). Bonus each partner brings in the team.
  var STAGE_XP = [0, 3, 8];
  var STAGE_BONUS = [
    { sun: 25, food: 0 },
    { sun: 0, food: 1 },
    { sun: 50, food: 1 },
    { sun: 100, food: 2 },
  ];

  function relStage(r) {
    return r.married ? 3 : r.xp >= STAGE_XP[2] ? 2 : r.xp >= STAGE_XP[1] ? 1 : 0;
  }

  function stageLabel(i) {
    return STAGES[i].icon + ' ' + L(STAGES[i].name);
  }

  function couplePoints(ps) {
    return Object.keys(ps).reduce(function (n, c) {
      return n + Math.max(0, ps[c].xp) + (ps[c].married ? 10 : 0);
    }, 0);
  }

  function savePartners(ps) {
    X.store.set('matchPartners', ps);
    refreshPartnerFlags(ps);
    postCouple(ps);
  }

  function refreshPartnerFlags(ps) {
    var list = (round ? round.cards : []).concat(
      Object.keys(profCache).map(function (k) {
        return profCache[k];
      }),
    );
    list.forEach(function (p) {
      if (p) p.partner = !!ps[p.code];
    });
  }

  function stageMessages(code, before, after) {
    if (after <= before) return;
    pushMsg(code, 'them', L(CHAT.relUp[after]));
    pushMsg(code, 'sys', L(TXT.relUp, { icon: STAGES[after].icon, stage: L(STAGES[after].name) }));
    if (MP.ui) MP.ui.toast(X.plantName(code) + ': ' + stageLabel(after), 'good');
  }

  // Relationship points: dates, gifts, levels together; jealousy takes them
  // away, and a partner (not married) below 0 breaks up.
  function addXp(code, n) {
    var ps = partners();
    var r = ps[code];
    if (!r) return;
    var before = relStage(r);
    r.xp += n;
    if (r.xp < 0 && !r.married) {
      delete ps[code];
      savePartners(ps);
      pushMsg(code, 'them', L(CHAT.breakup));
      pushMsg(code, 'sys', L(TXT.breakup, { name: X.plantName(code) }));
      if (MP.ui) MP.ui.toast(L(TXT.breakup, { name: X.plantName(code) }), 'bad');
      return;
    }
    if (r.xp < 0) r.xp = 0;
    savePartners(ps);
    stageMessages(code, before, relStage(r));
  }

  function giftDone(r, kind) {
    return !!(r.gifts && r.gifts[kind] === today());
  }

  function gift(code, kind) {
    var ps = partners();
    var r = ps[code];
    if (!r || giftDone(r, kind)) return;
    if (kind === 'choc') {
      if (likesLeft() < 5) return;
      useLike(5);
    }
    r.gifts = r.gifts || {};
    r.gifts[kind] = today();
    X.store.set('matchPartners', ps);
    pushMsg(code, 'me', kind === 'water' ? '💧' : '🍫', 'sticker');
    pushMsg(code, 'them', Lp(CHAT.giftThanks));
    addXp(code, kind === 'water' ? 1 : 2);
    if (ps[code] && Math.random() < 0.3) {
      var name = X.plantName(code);
      if (Math.random() < 0.5 && X.store.get('matchGiftFood', 0) < 3) {
        X.store.set('matchGiftFood', X.store.get('matchGiftFood', 0) + 1);
        pushMsg(code, 'them', L(CHAT.giftBackFood));
        if (MP.ui) MP.ui.toast(L(TXT.giftFood, { name: name }), 'good');
      } else {
        var st = likesState();
        st.bonus += 5;
        X.store.set('matchLikes', st);
        pushMsg(code, 'them', L(CHAT.giftBackLikes));
        if (MP.ui) MP.ui.toast(L(TXT.giftLikes, { name: name }), 'good');
      }
    }
    render();
  }

  // Partners left out of a Plant Match level get jealous.
  function jealousy(team) {
    var ps = partners();
    Object.keys(ps).forEach(function (code) {
      if (team.indexOf(code) >= 0) return;
      pushMsg(code, 'them', Lp(CHAT.jealous));
      if (!ps[code].married) {
        pushMsg(code, 'sys', L(TXT.jealousSys, { name: X.plantName(code) }));
        addXp(code, -1);
      }
    });
  }

  // Bonus the matches bring to the level: chat affinity, partners, gifts.
  function levelBonus() {
    var sun = 0;
    var food = X.store.get('matchGiftFood', 0);
    var ps = partners();
    (round ? round.matches : []).forEach(function (m) {
      var c = chats[m.code];
      if (c && c.s && !c.s.ghost) sun += c.s.affinity * 25;
      if (ps[m.code]) {
        var b = STAGE_BONUS[relStage(ps[m.code])];
        sun += b.sun;
        food += b.food;
      }
    });
    return { sun: Math.min(sun, 400), food: Math.min(food, 3) };
  }

  /* ----------------------------------------------- server and rankings */

  // The week's theme family: shows up more, matches more easily, doubles
  // the rewards with 3 of them in the team (weeks start on Monday).
  var EVENT_FAMILIES = ['Peashooter', 'Sun', 'Defence', 'Explosive', 'Lobber', 'Sharp', 'Cold', 'Melee', 'Poison', 'Fire', 'Shadow', 'Electricity', 'Magic'];

  function week() {
    var n = Math.floor((Date.now() / 86400000 + 3) / 7);
    return { n: n, fam: EVENT_FAMILIES[X.hashSeed('pvzx-week-' + n) % EVENT_FAMILIES.length] };
  }
  M.week = week;

  // Counters sent to the server (anonymous) and kept locally.
  var statQ = {};
  var statTimer = null;

  function statEvent(code, kind) {
    var q = (statQ[code] = statQ[code] || {});
    q[kind] = (q[kind] || 0) + 1;
    var mine = X.store.get('matchMine', {});
    var m = (mine[code] = mine[code] || {});
    m[kind] = (m[kind] || 0) + 1;
    X.store.set('matchMine', mine);
    if (!statTimer) statTimer = setTimeout(flushStats, 15000);
  }

  function flushStats() {
    if (statTimer) clearTimeout(statTimer);
    statTimer = null;
    var ev = statQ;
    statQ = {};
    if (!Object.keys(ev).length || !X.api.available()) return;
    X.api.postMatchStats(ev).catch(function () {});
  }

  var coupleTimer = null;
  function postCouple(ps) {
    if (!X.api.available() || !X.api.loggedIn()) return;
    var points = couplePoints(ps);
    if (points <= X.store.get('matchCouplePosted', 0)) return;
    clearTimeout(coupleTimer);
    coupleTimer = setTimeout(function () {
      var best = Object.keys(ps).sort(function (a, b) {
        return ps[b].xp + (ps[b].married ? 10 : 0) - (ps[a].xp + (ps[a].married ? 10 : 0));
      })[0];
      X.api
        .postScore('challenge:couple', points, { plant: best || '', rel: best ? String(relStage(ps[best])) : '', plants: Object.keys(ps).length })
        .then(function () {
          X.store.set('matchCouplePosted', points);
        })
        .catch(function () {});
    }, 2000);
  }

  var social = { pop: null, popAt: 0, ranks: {}, rank: 'couple' };

  function loadPopular() {
    if (!X.api.available() || social.popLoading || Date.now() - social.popAt < 60000) return;
    social.popLoading = true;
    X.api
      .matchStats()
      .then(function (top) {
        social.pop = top;
      })
      .catch(function () {
        social.pop = social.pop || {};
      })
      .then(function () {
        social.popLoading = false;
        social.popAt = Date.now();
        if (node && view.tab === 'social') render();
      });
  }

  function rankBoard(id) {
    return id === 'week' ? 'challenge:week-' + week().n : id === 'couple' ? 'challenge:couple' : 'challenge:match';
  }

  function loadRank(id) {
    var board = rankBoard(id);
    var r = (social.ranks[board] = social.ranks[board] || { at: 0 });
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
        if (node && view.tab === 'social') render();
      });
  }

  function copyText(text) {
    var done = function () {
      if (MP.ui) MP.ui.toast(L(TXT.shareCopied), 'good');
    };
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(done, function () {
        fallbackCopy(text);
        done();
      });
    } else {
      fallbackCopy(text);
      done();
    }
  }

  function fallbackCopy(text) {
    var ta = el('textarea', { value: text });
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    try {
      document.execCommand('copy');
    } catch (e) {}
    ta.remove();
  }

  function teamCode(codes) {
    return 'PM1:' + codes.join('.');
  }

  function parseTeamCode(text) {
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
  }

  // Profiles of plants outside the current deck (chats, partners).
  var profCache = {};
  function prof(code) {
    var inDeck = round && round.cards.find(function (c) {
      return c.code === code;
    });
    if (inDeck) return inDeck;
    if (!(code in profCache)) profCache[code] = profile(code);
    return profCache[code];
  }

  function famOf(code) {
    var f = plantFeature(code);
    if (!f) return '';
    try {
      return G.m.Plants.plants.getPlantProps(f.ID).Family || '';
    } catch (e) {
      return '';
    }
  }

  /* ------------------------------------------------------------- swipe */

  function current() {
    return round && round.cards[round.i];
  }

  function canSwipe() {
    return !!current() && round.matches.length < SLOTS && view.tab === 'discover' && !view.prefs && !view.viewing && !view.datePick;
  }

  function decide(kind) {
    var p = current();
    if (!p || round.busy || !canSwipe()) return;
    if (kind === 'like' && !likesLeft()) {
      render();
      return;
    }
    if (kind === 'super' && !supersLeft()) return;
    round.busy = true;
    var card = node && node.querySelector('.pvzx-mcard.pvzx-top');
    var dx = kind === 'nope' ? -1 : kind === 'like' ? 1 : 0;
    if (card) {
      card.classList.add('pvzx-gone');
      card.style.transform = kind === 'super' ? 'translateY(-140%)' : 'translateX(' + dx * 150 + '%) rotate(' + dx * 24 + 'deg)';
      var stamp = card.querySelector('.pvzx-stamp-' + kind);
      if (stamp) stamp.style.opacity = 1;
    }
    var matched = false;
    var usedSuperExtra = false;
    if (kind === 'like') useLike(1);
    if (kind === 'super') {
      if (!round.superUsed) round.superUsed = true;
      else {
        X.store.set('matchSupers', Math.max(0, X.store.get('matchSupers', 0) - 1));
        usedSuperExtra = true;
      }
    }
    if (kind !== 'nope') {
      statEvent(p.code, kind === 'super' ? 'super' : 'like');
      var chance = Math.min(0.97, p.chance * (0.7 + compatibility(p).score / 160));
      matched = kind === 'super' || p.likedYou || p.partner || Math.random() < chance;
      if (matched) {
        round.matches.push(p);
        startChat(p);
        statEvent(p.code, 'match');
        // A partner of the same family (not matched this round) notices.
        var ps = partners();
        Object.keys(ps).forEach(function (code) {
          if (code === p.code || inRound({ code: code }) || famOf(code) !== p.family || Math.random() > 0.35) return;
          pushMsg(code, 'them', Lp(CHAT.jealousMatch, { name: p.name }));
        });
      }
    }
    round.history.push({ card: p, kind: kind, matched: matched, superExtra: usedSuperExtra });
    setTimeout(function () {
      round.i++;
      round.busy = false;
      view.photo = 0;
      view.expanded = false;
      queuePhotos();
      if (matched) showMatch(p);
      else render();
    }, 320);
  }

  function undo() {
    if (!round || round.undoUsed || !round.history.length || round.busy) return;
    var h = round.history.pop();
    round.undoUsed = true;
    round.i--;
    if (h.kind === 'like') useLike(-1);
    if (h.kind === 'super') {
      if (h.superExtra) X.store.set('matchSupers', X.store.get('matchSupers', 0) + 1);
      else round.superUsed = false;
    }
    if (h.matched) {
      round.matches.splice(round.matches.indexOf(h.card), 1);
      dropChat(h.card.code);
    }
    view.photo = 0;
    render();
  }

  function boost() {
    if (!round || round.boostUsed) return;
    round.boostUsed = true;
    round.boosted = true;
    var rest = round.cards.slice(round.i + 1);
    rest.sort(function (a, b) {
      return compatibility(b).score - compatibility(a).score;
    });
    round.cards = round.cards.slice(0, round.i + 1).concat(rest);
    queuePhotos();
    render();
  }

  function attachDrag(card) {
    var start = null;
    var dx = 0;
    var dy = 0;
    var moved = false;
    var down = function (e) {
      if (round.busy || view.expanded) return;
      var pt = e.touches ? e.touches[0] : e;
      start = { x: pt.clientX, y: pt.clientY };
      moved = false;
      card.style.transition = 'none';
    };
    var move = function (e) {
      if (!start) return;
      var pt = e.touches ? e.touches[0] : e;
      dx = pt.clientX - start.x;
      dy = pt.clientY - start.y;
      if (Math.abs(dx) + Math.abs(dy) > 6) moved = true;
      card.style.transform = 'translate(' + dx + 'px,' + dy + 'px) rotate(' + dx / 14 + 'deg)';
      card.querySelector('.pvzx-stamp-like').style.opacity = Math.max(0, Math.min(1, dx / 90));
      card.querySelector('.pvzx-stamp-nope').style.opacity = Math.max(0, Math.min(1, -dx / 90));
      card.querySelector('.pvzx-stamp-super').style.opacity = supersLeft() ? Math.max(0, Math.min(1, -dy / 90 - Math.abs(dx) / 120)) : 0;
    };
    var up = function () {
      if (!start) return;
      var s = start;
      start = null;
      card.style.transition = '';
      if (dx > 100 && likesLeft()) decide('like');
      else if (dx < -100) decide('nope');
      else if (dy < -110 && supersLeft()) decide('super');
      else {
        card.style.transform = '';
        card.querySelectorAll('.pvzx-stamp').forEach(function (x) {
          x.style.opacity = 0;
        });
        if (!moved) {
          var photo = card.querySelector('.pvzx-mcard-art');
          var r = photo.getBoundingClientRect();
          if (s.y >= r.top && s.y <= r.bottom) {
            var n = photoList(current()).length;
            view.photo = s.x < r.left + r.width / 2 ? Math.max(0, view.photo - 1) : Math.min(n - 1, view.photo + 1);
            render();
          }
        }
      }
      dx = dy = 0;
    };
    card.addEventListener('mousedown', down);
    card.addEventListener('touchstart', down, { passive: true });
    window.addEventListener('mousemove', move);
    window.addEventListener('touchmove', move, { passive: true });
    window.addEventListener('mouseup', up);
    window.addEventListener('touchend', up);
    card._cleanup = function () {
      window.removeEventListener('mousemove', move);
      window.removeEventListener('touchmove', move);
      window.removeEventListener('mouseup', up);
      window.removeEventListener('touchend', up);
    };
  }

  /* ------------------------------------------------------- profile view */

  function chips(p) {
    var list = [
      ['☀', p.cost, t('match_stat_cost')],
      ['⏱', rechargeLabel(p.cooldown), t('match_stat_recharge')],
    ];
    if (p.toughness) list.push(['🛡', toughLabel(p.toughness), t('match_stat_tough')]);
    if (p.damage) list.push(['⚔', p.damage, t('match_stat_damage')]);
    if (p.range) list.push(['🎯', p.range, t('match_stat_range')]);
    if (p.area) list.push(['💥', p.area, t('match_stat_area')]);
    if (p.sunprod) list.push(['🌞', p.sunprod, t('match_stat_sun')]);
    if (p.food) list.push(['🌱', p.food, t('match_stat_food')]);
    return el(
      'div.pvzx-chips',
      null,
      list.map(function (c) {
        return el('span.pvzx-chip', { title: c[2] }, [c[0] + ' ' + c[1]]);
      }),
    );
  }

  function badges(p) {
    if (!p.badges.length) return null;
    return el(
      'div.pvzx-badges',
      null,
      p.badges.map(function (b) {
        return el('span.pvzx-badge', { text: b });
      }),
    );
  }

  function photoNode(p, idx) {
    var list = photoList(p);
    idx = Math.min(idx, list.length - 1);
    var ph = list[idx];
    var bars = el(
      'div.pvzx-photo-bars',
      null,
      list.map(function (x, i) {
        return el('span' + (i === idx ? '.pvzx-on' : ''));
      }),
    );
    if (!p.photos) bars.appendChild(el('span.pvzx-loading'));
    var img = ph.frames ? animImg(ph.frames) : el('img', { src: ph.src, alt: '', draggable: 'false' });
    return el('div.pvzx-mcard-art.pvzx-fam-' + p.family.toLowerCase() + (ph.packet ? '.pvzx-packet' : ''), null, [
      img,
      bars,
      el('span.pvzx-photo-label', { text: ph.label + (p.online ? ' · ' + t('match_online') : '') }),
      p.likedYou && round.revealed[p.code] ? el('span.pvzx-liked-tag', { text: L(TXT.likedYou) }) : null,
    ]);
  }

  function details(p, opts) {
    var compat = compatibility(p);
    var fam = famKey(p);
    var specials = p.specials.filter(function (s) {
      return s.desc;
    });
    var sheet = [
      [t('match_stat_cost'), '☀ ' + p.cost],
      [t('match_stat_recharge'), rechargeLabel(p.cooldown) + (p.cooldown ? ' (' + p.cooldown + 's)' : '')],
    ];
    if (p.toughness) sheet.push([t('match_stat_tough'), toughLabel(p.toughness) + ' (' + p.toughness + ')']);
    if (p.damage) sheet.push([t('match_stat_damage'), p.damage]);
    if (p.range) sheet.push([t('match_stat_range'), p.range]);
    if (p.area) sheet.push([t('match_stat_area'), p.area]);
    if (p.sunprod) sheet.push([t('match_stat_sun'), p.sunprod]);
    if (p.food) sheet.push([t('match_stat_food'), p.food]);
    if (p.arming) sheet.push([t('match_stat_arming'), p.arming + 's']);
    if (p.duration) sheet.push([t('match_stat_duration'), p.duration + 's']);
    return el('div.pvzx-mdetails', null, [
      el('div.pvzx-compat', null, [el('b', { text: '💚 ' + t('match_compat', { n: compat.score }) }), el('span', { text: t(compat.reason) })]),
      el('p.pvzx-headline', { text: '“' + p.headline + '”' }),
      p.bio ? el('div.pvzx-msec', null, [el('h4', { text: t('match_about') }), el('p.pvzx-hand', { text: '“' + p.bio + '”' })]) : null,
      p.intro ? el('div.pvzx-msec', null, [el('h4', { text: t('match_ability') }), el('p', { text: p.intro })]) : null,
      specials.length
        ? el(
            'div.pvzx-msec',
            null,
            [el('h4', { text: t('match_special') })].concat(
              specials.map(function (s) {
                return el('p', null, [el('b', { text: s.name + ': ' }), s.desc]);
              }),
            ),
          )
        : null,
      el('div.pvzx-msec', null, [
        el('h4', { text: t('match_sheet') }),
        el(
          'table.pvzx-sheet',
          null,
          sheet.map(function (r) {
            return el('tr', null, [el('td', { text: r[0] }), el('td', { text: String(r[1]) })]);
          }),
        ),
      ]),
      el('div.pvzx-msec', null, [
        el('h4', { text: t('match_interests') }),
        el(
          'div.pvzx-chips',
          null,
          p.likes.map(function (x) {
            return el('span.pvzx-chip.pvzx-chip-like', { text: x });
          }),
        ),
      ]),
      el('div.pvzx-msec', null, [el('h4', { text: t('match_looking') }), el('p', { text: t(fam + '_wants') })]),
      el('div.pvzx-msec', null, [el('h4', { text: L(TXT.personality) }), el('p', { text: PERS[p.pers].icon + ' ' + L(PERS[p.pers].name) })]),
      opts && opts.undo
        ? el('div.pvzx-file-actions', null, [
            el('button.mp-btn.mp-small.mp-green', { text: p.partner ? L(TXT.dateBtn) : L(TXT.invite), onclick: function () {
              openDates(p);
            } }),
            el('button.mp-btn.mp-small.mp-red', { text: t('match_unmatch'), onclick: function () {
              round.matches.splice(round.matches.indexOf(p), 1);
              dropChat(p.code);
              view.viewing = null;
              view.chat = null;
              render();
            } }),
          ])
        : null,
    ]);
  }

  function nameRow(p, withMore) {
    return el('div.pvzx-mcard-name', null, [
      el('b', { text: p.name }),
      p.age ? el('span.pvzx-age', { text: p.age }) : null,
      el('span.pvzx-fam', { text: t(famKey(p)) }),
      withMore
        ? el('button.pvzx-more', { text: view.expanded ? '▾' : 'ⓘ', title: t('match_more'), onclick: function (e) {
            e.stopPropagation();
            view.expanded = !view.expanded;
            render();
          } })
        : null,
    ]);
  }

  function cardNode(p, top) {
    var info = el('div.pvzx-mcard-info', null, [
      nameRow(p, top),
      badges(p),
      el('div.pvzx-mcard-meta', { text: '📍 ' + p.world + ' · ' + t('match_distance', { n: p.distance }) }),
      top ? el('div.pvzx-compat-mini', { text: '💚 ' + t('match_compat', { n: compatibility(p).score }) + ' · ' + t(compatibility(p).reason) }) : null,
      chips(p),
      !view.expanded ? el('div.pvzx-mcard-brief', { text: '“' + p.headline + '”' }) : null,
    ]);
    var card = el('div.pvzx-mcard' + (top ? '.pvzx-top' : '') + (top && view.expanded ? '.pvzx-expanded' : ''), null, [
      photoNode(p, top ? view.photo : 0),
      el('div.pvzx-stamp.pvzx-stamp-like', { text: t('match_like') }),
      el('div.pvzx-stamp.pvzx-stamp-nope', { text: t('match_nope') }),
      el('div.pvzx-stamp.pvzx-stamp-super', { text: t('match_super') }),
      info,
    ]);
    if (top && view.expanded) {
      var d = details(p);
      d.addEventListener('wheel', function (e) {
        e.stopPropagation();
      });
      card.appendChild(d);
    }
    return card;
  }

  function fullProfile(p) {
    var sheet = el('div.pvzx-mview', null, [
      el('button.pvzx-x', { text: '←', title: t('close'), onclick: function () {
        view.viewing = null;
        render();
      } }),
      el(
        'div.pvzx-mview-photos',
        null,
        photoList(p).map(function (x) {
          return x.frames ? animImg(x.frames) : el('img', { src: x.src, alt: x.label, title: x.label });
        }),
      ),
      nameRow(p, false),
      badges(p),
      chips(p),
      details(p, { undo: round.matches.indexOf(p) >= 0 }),
      relationBox(p),
      el('div.pvzx-file-actions', null, [
        el('button.mp-btn.mp-small.mp-blue', { text: L(TXT.shareProfile), onclick: function () {
          copyText(
            L(TXT.shareProfileText, { name: p.name, age: p.age || '?', fam: t(famKey(p)), cost: p.cost, pers: PERS[p.pers].icon + ' ' + L(PERS[p.pers].name), headline: p.headline }),
          );
        } }),
      ]),
    ]);
    sheet.addEventListener('wheel', function (e) {
      e.stopPropagation();
    });
    return sheet;
  }

  /* --------------------------------------------------------- the tabs */

  function prefsPanel() {
    var pr = M.prefs;
    var save = function () {
      X.store.set('matchPrefs', M.prefs);
    };
    var famBox = el(
      'div.pvzx-chips',
      null,
      M.FAMILIES.map(function (f) {
        var on = pr.families.indexOf(f) >= 0;
        return el('button.pvzx-chip.pvzx-chip-btn' + (on ? '.pvzx-on' : ''), {
          text: t('family_' + f.toLowerCase()),
          onclick: function () {
            if (on) pr.families.splice(pr.families.indexOf(f), 1);
            else pr.families.push(f);
            save();
            render();
          },
        });
      }),
    );
    var costs = [0, 100, 150, 200, 300];
    return el('div.pvzx-mprefs', null, [
      el('h3', { text: '⚙ ' + t('match_prefs') }),
      el('h4', { text: t('match_pref_family') }),
      el('p.pvzx-small', { text: t('match_pref_family_tip') }),
      famBox,
      el('h4', { text: t('match_pref_cost') }),
      el(
        'div.pvzx-chips',
        null,
        costs.map(function (c) {
          return el('button.pvzx-chip.pvzx-chip-btn' + (pr.maxCost === c ? '.pvzx-on' : ''), {
            text: c ? '☀ ≤ ' + c : t('match_pref_any'),
            onclick: function () {
              pr.maxCost = c;
              save();
              render();
            },
          });
        }),
      ),
      el('label.pvzx-check', null, [
        el('input', { type: 'checkbox', checked: pr.sun, onchange: function (e) {
          pr.sun = e.target.checked;
          save();
        } }),
        t('match_pref_sun'),
      ]),
      el('div.pvzx-mfoot', null, [
        el('button.mp-btn.mp-green', { text: t('match_pref_apply'), onclick: function () {
          view.prefs = false;
          newRound();
          render();
        } }),
        el('button.mp-btn.mp-small.mp-brown', { text: t('close'), onclick: function () {
          view.prefs = false;
          render();
        } }),
      ]),
    ]);
  }

  function discoverTab(body) {
    var stack = el('div.pvzx-stack');
    var p = current();
    if (view.prefs) stack.appendChild(prefsPanel());
    else if (view.viewing) stack.appendChild(fullProfile(view.viewing));
    else if (!p || round.matches.length >= SLOTS) {
      stack.appendChild(
        el('div.pvzx-mend', null, [
          el('div.pvzx-mend-title', { text: t(round.matches.length ? 'match_done' : 'match_none') }),
          el('p', { text: round.matches.length ? t('match_done_desc', { n: round.matches.length }) : t('match_none_desc') }),
        ]),
      );
    } else if (!likesLeft() && !supersLeft()) {
      stack.appendChild(el('div.pvzx-mend', null, [el('div.pvzx-mend-title', { text: '💤 ' + L(TXT.noLikes) }), el('p', { text: L(TXT.noLikesDesc) })]));
    } else {
      var next = round.cards[round.i + 1];
      if (next) stack.appendChild(cardNode(next, false));
      var top = cardNode(p, true);
      stack.appendChild(top);
      attachDrag(top);
      if (round.boosted && round.i < round.cards.length) stack.appendChild(el('div.pvzx-boost-tag', { text: L(TXT.boosted) }));
    }
    body.appendChild(stack);
    var blocked = !canSwipe();
    body.appendChild(
      el('div.pvzx-mbtns', null, [
        el('button.pvzx-mbtn.pvzx-small.pvzx-undo', { text: '↶', title: L(TXT.undo), disabled: round.undoUsed || !round.history.length, onclick: undo }),
        el('button.pvzx-mbtn.pvzx-nope', { text: '✕', title: t('match_nope') + ' (←)', disabled: blocked, onclick: function () {
          decide('nope');
        } }),
        el('button.pvzx-mbtn.pvzx-super', { title: t('match_super') + ' (↑)', disabled: blocked || !supersLeft(), onclick: function () {
          decide('super');
        } }, ['★', el('small', { text: String(supersLeft()) })]),
        el('button.pvzx-mbtn.pvzx-like', { title: t('match_like') + ' (→)', disabled: blocked || !likesLeft(), onclick: function () {
          decide('like');
        } }, ['♥', el('small', { text: String(likesLeft()) })]),
        el('button.pvzx-mbtn.pvzx-small.pvzx-boost', { text: '🚀', title: L(TXT.boost), disabled: round.boostUsed || blocked, onclick: boost }),
      ]),
    );
  }

  function likesTab(body) {
    var pending = round.cards.slice(round.i).filter(function (c) {
      return c.likedYou;
    });
    var box = el('div.pvzx-mlikes', null, [
      el('h3', { text: '💛 ' + L(TXT.likesTitle, { n: pending.length }) }),
      el('p.pvzx-small', { text: L(TXT.likesDesc) }),
      el('div.pvzx-best', { text: L(TXT.reveals, { n: reveals() }) }),
    ]);
    if (!pending.length) box.appendChild(el('p.pvzx-mempty', { text: L(TXT.likesNone) }));
    var grid = el('div.pvzx-lgrid');
    pending.forEach(function (c) {
      var shown = !!round.revealed[c.code];
      grid.appendChild(
        el('div.pvzx-lcard' + (shown ? '' : '.pvzx-blur'), null, [
          el('img', { src: avatar(c), alt: '' }),
          shown ? el('b', { text: c.name }) : el('b', { text: '?' }),
          shown
            ? el('button.mp-btn.mp-small.mp-green', { text: L(TXT.seeNow), onclick: function () {
                var at = round.cards.indexOf(c);
                round.cards.splice(at, 1);
                round.cards.splice(round.i, 0, c);
                view.tab = 'discover';
                view.photo = 0;
                render();
              } })
            : el('button.mp-btn.mp-small.mp-blue', { text: L(TXT.reveal), disabled: !reveals(), onclick: function () {
                X.store.set('matchReveals', reveals() - 1);
                round.revealed[c.code] = true;
                render();
              } }),
        ]),
      );
    });
    box.appendChild(grid);
    box.addEventListener('wheel', function (e) {
      e.stopPropagation();
    });
    body.appendChild(box);
  }

  // Chats listed: this round's matches, then partners and unread messages.
  function chatCodes() {
    var ps = partners();
    var codes = round.matches.map(function (m) {
      return m.code;
    });
    Object.keys(chats)
      .filter(function (c) {
        return codes.indexOf(c) < 0 && chats[c].msgs.length && (ps[c] || chats[c].unread);
      })
      .sort(function (a, b) {
        return chats[b].at - chats[a].at;
      })
      .forEach(function (c) {
        codes.push(c);
      });
    return codes;
  }

  function avatarNode(p, animated) {
    return el('span.pvzx-mavatar.pvzx-fam-' + p.family.toLowerCase(), null, [animated && p.photos && p.photos.idle ? animImg(p.photos.idle) : el('img', { src: avatar(p), alt: '' })]);
  }

  function messagesTab(body) {
    var p = view.chat;
    var ps = partners();
    if (!p) {
      var list = el('div.pvzx-mlist');
      var codes = chatCodes();
      if (!codes.length) list.appendChild(el('p.pvzx-mempty', { text: L(TXT.msgsEmpty) }));
      codes.forEach(function (code) {
        var m = prof(code);
        if (!m) return;
        var c = chats[code];
        var last = c && c.msgs[c.msgs.length - 1];
        var r = ps[code];
        list.appendChild(
          el('button.pvzx-mrow' + (c && c.unread ? '.pvzx-unread' : ''), { onclick: function () {
            view.chat = m;
            if (c) c.unread = false;
            saveChats();
            queuePhotos();
            render();
          } }, [
            avatarNode(m),
            el('span.pvzx-mrow-text', null, [
              el('b', { text: m.name + (r ? ' ' + STAGES[relStage(r)].icon : '') }),
              el('span', { text: last ? (last.from === 'me' ? '↪ ' : '') + last.text : L(TXT.newMatch) }),
            ]),
            el('span.pvzx-mrow-aff', { text: c && c.s ? (c.s.ghost ? '👻' : affinityHearts(c.s.affinity)) : '' }),
          ]),
        );
      });
      list.addEventListener('wheel', function (e) {
        e.stopPropagation();
      });
      body.appendChild(list);
      return;
    }
    var chat = getChat(p.code);
    var s = chat.s;
    var r = ps[p.code];
    var head = el('div.pvzx-chat-head', null, [
      el('button.pvzx-x', { text: '←', onclick: function () {
        view.chat = null;
        render();
      } }),
      avatarNode(p, true),
      el('span.pvzx-mrow-text', null, [
        el('b', { text: p.name }),
        el('span', { text: s && s.ghost ? L(TXT.seen, { n: 2 + p.distance }) : r ? stageLabel(relStage(r)) : p.online ? t('match_online') : p.world }),
      ]),
      el('button.pvzx-chip.pvzx-chip-btn', { text: L(TXT.viewProfile), onclick: function () {
        view.viewing = p;
        view.tab = 'discover';
        render();
      } }),
    ]);
    var log = el('div.pvzx-chat-log');
    chat.msgs.forEach(function (m) {
      log.appendChild(el('div.pvzx-bubble.pvzx-from-' + m.from + (m.k === 'sticker' ? '.pvzx-sticker' : ''), { text: m.text }));
    });
    if (typing[p.code]) log.appendChild(el('div.pvzx-bubble.pvzx-from-them.pvzx-typing', { text: L(TXT.typing) }));
    if (!inRound(p) && !r) log.appendChild(el('div.pvzx-bubble.pvzx-from-sys', { text: L(TXT.noChatHere) }));
    log.addEventListener('wheel', function (e) {
      e.stopPropagation();
    });
    var opts = el(
      'div.pvzx-chat-opts',
      null,
      chatOptions(p, chat).map(function (o) {
        return el('button.pvzx-chat-opt', { text: o.text, onclick: function () {
          reply(p, o);
        } });
      }),
    );
    var stickers =
      s && !s.sticker && !s.ghost && !typing[p.code] && inRound(p)
        ? el(
            'div.pvzx-stickers',
            { title: L(TXT.stickerTip) },
            CHAT.stickers.map(function (e) {
              return el('button', { text: e, title: L(TXT.stickerTip), onclick: function () {
                sendSticker(p, e);
              } });
            }),
          )
        : null;
    var foot;
    if (r) {
      foot = el('div.pvzx-chat-foot', null, [
        el('span', { text: stageLabel(relStage(r)) }),
        el('span.pvzx-pbtns', null, giftButtons(p.code, r).concat([
          el('button.mp-btn.mp-small.mp-green', { text: L(TXT.dateBtn), onclick: function () {
            openDates(p);
          } }),
        ])),
      ]);
    } else if (s) {
      foot = el('div.pvzx-chat-foot', null, [
        el('span', { text: L(TXT.affinity) + ': ' + affinityHearts(s.affinity) + (s.affinity ? ' (+' + s.affinity * 25 + ' ☀)' : '') }),
        el('button.mp-btn.mp-small.mp-green', { text: L(TXT.invite), title: L(TXT.inviteDesc, { name: p.name }), onclick: function () {
          openDates(p);
        } }),
      ]);
    }
    body.appendChild(el('div.pvzx-chat', null, [head, log, stickers, opts, foot]));
    setTimeout(function () {
      log.scrollTop = log.scrollHeight;
    }, 0);
    if (chat.unread) {
      chat.unread = false;
      saveChats();
    }
  }

  function giftButtons(code, r) {
    return [
      el('button.mp-btn.mp-small.mp-blue', { text: '💧', title: L(TXT.giftWater) + ': ' + L(TXT.giftWaterDesc), disabled: giftDone(r, 'water'), onclick: function () {
        gift(code, 'water');
      } }),
      el('button.mp-btn.mp-small.mp-brown', { text: '🍫', title: L(TXT.giftChoc) + ': ' + L(TXT.giftChocDesc), disabled: giftDone(r, 'choc') || likesLeft() < 5, onclick: function () {
        gift(code, 'choc');
      } }),
    ];
  }

  /* ------------------------------------------------------------- dates */

  // need: -1 anyone you matched, 0 partners, 1 dating, 2 engaged (wedding).
  var DATE_TYPES = [
    { id: 'picnic', icon: '🧺', waves: 6, sun: 300, rate: 'fast', mut: [], need: -1, obj: ['nomower', 'nolost'] },
    { id: 'candle', icon: '🕯️', stage: 'dark', waves: 6, sun: 300, rate: 'fast', mut: ['fog'], need: -1, obj: ['nolost', 'fast4'] },
    { id: 'race', icon: '⏱️', waves: 5, sun: 350, rate: 'fast', mut: ['rush'], need: -1, obj: ['fast3', 'nomower'] },
    { id: 'adventure', icon: '🤠', stage: 'west', waves: 8, sun: 250, rate: 'normal', mut: ['nomowers'], need: 0, obj: ['nolost', 'fast6'] },
    { id: 'double', icon: '👯', waves: 7, sun: 300, rate: 'fast', mut: [], need: 1, friend: true, obj: ['nomower', 'nolost'] },
    { id: 'wedding', icon: '💒', waves: 10, sun: 400, rate: 'fast', mut: ['horde'], need: 2, guests: true, obj: ['nomower', 'nolost'] },
  ];

  function secs(s) {
    return ((s.endedAt || Date.now()) - (s.startedAt || Date.now())) / 1000;
  }

  var OBJ = {
    nomower: { text: function () { return L(TXT.objNoMower); }, ok: function (s) { return !s.mowersUsed; } },
    nolost: { text: function () { return L(TXT.objNoLost); }, ok: function (s) { return !s.lost; } },
    fast3: { text: function () { return L(TXT.objFast, { m: 3 }); }, ok: function (s) { return secs(s) < 180; } },
    fast4: { text: function () { return L(TXT.objFast, { m: 4 }); }, ok: function (s) { return secs(s) < 240; } },
    fast6: { text: function () { return L(TXT.objFast, { m: 6 }); }, ok: function (s) { return secs(s) < 360; } },
  };

  function starsText(n) {
    return '⭐'.repeat(n) + '☆'.repeat(3 - n);
  }

  function dateLock(dt, r) {
    if (dt.need < 0) return '';
    if (!r) return L(TXT.dateNeedPartner);
    if (dt.id === 'wedding' && r.married) return stageLabel(3);
    if (relStage(r) < dt.need) return L(TXT.dateNeed, { stage: stageLabel(dt.need) });
    return '';
  }

  function openDates(p) {
    view.datePick = p;
    render();
  }

  function datePicker(p) {
    var r = partners()[p.code];
    var sheet = el('div.pvzx-mview.pvzx-dates', null, [
      el('button.pvzx-x', { text: '←', title: t('close'), onclick: function () {
        view.datePick = null;
        render();
      } }),
      el('h3', { text: '💐 ' + L(TXT.dateTitle) }),
      el('p.pvzx-small', { text: L(TXT.inviteDesc, { name: p.name }) }),
    ]);
    DATE_TYPES.forEach(function (dt) {
      var lock = dateLock(dt, r);
      var best = r && r.dates[dt.id];
      sheet.appendChild(
        el('button.pvzx-date' + (lock ? '.pvzx-locked' : ''), { disabled: !!lock, onclick: function () {
          view.datePick = null;
          date(p, dt);
        } }, [
          el('span.pvzx-date-icon', { text: dt.icon }),
          el('span.pvzx-date-text', null, [
            el('b', { text: L(DATES[dt.id].name) }),
            el('span', { text: L(DATES[dt.id].desc) + ' · ' + L(TXT.dateWaves, { n: dt.waves }) }),
            el('small', {
              text: lock || '⭐ ' + [L(TXT.objWin)].concat(dt.obj.map(function (o) {
                return OBJ[o].text();
              })).join(' · ') + (best ? '  —  ' + L(TXT.dateBest, { stars: starsText(best) }) : ''),
            }),
          ]),
        ]),
      );
    });
    sheet.addEventListener('wheel', function (e) {
      e.stopPropagation();
    });
    return sheet;
  }

  /* ---------------------------------------------------------- partners */

  function relationBox(p) {
    var r = partners()[p.code];
    if (!r) return null;
    var st = relStage(r);
    return el('div.pvzx-msec', null, [el('h4', { text: L(TXT.tabPartners) }), relationInfo(r, st)]);
  }

  function relationInfo(r, st) {
    var next = st < 2 ? STAGE_XP[st + 1] : 0;
    var pct = st >= 2 ? 100 : Math.max(0, Math.min(100, ((r.xp - STAGE_XP[st]) / (next - STAGE_XP[st])) * 100));
    return el('div.pvzx-rel', null, [
      el('span', { text: stageLabel(st) + ' · ' + L(TXT.stageBonus, { txt: L(STAGES[st].bonus) }) }),
      el('div.pvzx-xp', null, [el('i', { style: 'width:' + pct + '%' })]),
      el('small', { text: st === 3 ? L(TXT.xpMax) : st === 2 ? L(TXT.xpWedding) : L(TXT.xpNext, { xp: r.xp, next: next, stage: L(STAGES[st + 1].name) }) }),
    ]);
  }

  function partnersTab(body) {
    var ps = partners();
    var codes = Object.keys(ps).sort(function (a, b) {
      return relStage(ps[b]) - relStage(ps[a]) || ps[b].xp - ps[a].xp;
    });
    var gf = X.store.get('matchGiftFood', 0);
    var box = el('div.pvzx-mlikes', null, [
      el('h3', { text: '💍 ' + L(TXT.partnersTitle) }),
      el('p.pvzx-small', { text: L(TXT.partnersDesc) }),
      codes.length ? el('div.pvzx-best', { text: L(TXT.relPoints, { n: couplePoints(ps) }) + (gf ? ' · ' + L(TXT.giftPending, { n: gf }) : '') }) : null,
    ]);
    if (!codes.length) box.appendChild(el('p.pvzx-mempty', { text: L(TXT.partnersNone) }));
    codes.forEach(function (code) {
      var p = prof(code);
      if (!p) return;
      var r = ps[code];
      var st = relStage(r);
      var dates = Object.keys(r.dates)
        .map(function (id) {
          var dt = DATE_TYPES.find(function (d) {
            return d.id === id;
          });
          return dt ? dt.icon + ' ' + starsText(r.dates[id]) : '';
        })
        .join('  ');
      box.appendChild(
        el('div.pvzx-prow', null, [
          avatarNode(p),
          el('div.pvzx-prow-info', null, [
            el('b', { text: p.name }),
            relationInfo(r, st),
            el('small', { text: L(TXT.since, { d: new Date(r.since).toLocaleDateString() }) + (dates ? ' · ' + dates : '') }),
            el('div.pvzx-pbtns', null, giftButtons(code, r).concat([
              el('button.mp-btn.mp-small.mp-blue', { text: L(TXT.chatBtn), onclick: function () {
                view.tab = 'messages';
                view.chat = p;
                render();
              } }),
              el('button.mp-btn.mp-small.mp-green', { text: L(TXT.dateBtn), onclick: function () {
                openDates(p);
              } }),
            ])),
          ]),
        ]),
      );
    });
    box.addEventListener('wheel', function (e) {
      e.stopPropagation();
    });
    body.appendChild(box);
  }

  /* ------------------------------------------------------------ social */

  function plantRows(list, unit) {
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
  }

  function socialTab(body) {
    var wk = week();
    var famName = t('family_' + wk.fam.toLowerCase());
    var box = el('div.pvzx-mlikes.pvzx-social');
    var evTeam = round.matches.filter(function (m) {
      return m.event;
    }).length;
    box.appendChild(
      el('div.pvzx-event', null, [
        el('b', { text: '🎉 ' + L(TXT.weekTitle, { fam: famName }) }),
        el('p', { text: L(TXT.weekDesc, { fam: famName }) }),
        round.matches.length ? el('small', { text: L(TXT.weekTeam, { n: evTeam }) }) : null,
      ]),
    );

    // Most popular plants of every player on the server.
    if (!X.api.available()) box.appendChild(el('p.pvzx-small', { text: L(TXT.popOffline) }));
    else {
      loadPopular();
      var pop = social.pop || {};
      box.appendChild(el('h4', { text: L(TXT.popLikes) }));
      box.appendChild(pop.like && pop.like.length ? plantRows(pop.like.slice(0, 5), '♥') : el('p.pvzx-small', { text: social.pop ? L(TXT.popNone) : '…' }));
      if (pop.partner && pop.partner.length) {
        box.appendChild(el('h4', { text: L(TXT.popPartners) }));
        box.appendChild(plantRows(pop.partner.slice(0, 5), '💍'));
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
      box.appendChild(plantRows(mineList, '♥'));
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
            return el('button.pvzx-chip.pvzx-chip-btn' + (social.rank === b[0] ? '.pvzx-on' : ''), { text: b[1], onclick: function () {
              social.rank = b[0];
              render();
            } });
          }),
        ),
      );
      loadRank(social.rank);
      var rk = social.ranks[rankBoard(social.rank)] || {};
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
    var team = round.matches.length
      ? round.matches.map(function (m) {
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
          copyText(L(TXT.shareText, { names: names, code: teamCode(team) }));
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
          var codes = parseTeamCode(input.value);
          if (!codes) {
            if (MP.ui) MP.ui.toast(L(TXT.importBad), 'bad');
            return;
          }
          playTeam(codes, { sun: 0, food: 0 }, { shared: true });
        } }),
      ]),
    );
    box.addEventListener('wheel', function (e) {
      e.stopPropagation();
    });
    body.appendChild(box);
  }

  var TABS = [
    ['discover', '🔥', TXT.tabDiscover],
    ['messages', '💬', TXT.tabMessages],
    ['likes', '💛', TXT.tabLikes],
    ['partners', '💍', TXT.tabPartners],
    ['social', '🌍', TXT.tabSocial],
  ];

  function render() {
    if (!node) return;
    node.querySelectorAll('.pvzx-mcard').forEach(function (c) {
      if (c._cleanup) c._cleanup();
    });
    var phone = el('div.pvzx-phone');
    phone.appendChild(
      el('div.pvzx-phone-head', null, [
        el('button.pvzx-x', { text: '×', title: t('close'), onclick: M.close }),
        el('b', { text: '🔥 ' + t('mode_match') }),
        el('button.pvzx-gear', { text: '⚙', title: t('match_prefs'), onclick: function () {
          view.tab = 'discover';
          view.prefs = !view.prefs;
          view.viewing = null;
          render();
        } }),
        el('span.pvzx-phone-count', { text: t('match_count', { n: round.matches.length, max: SLOTS, left: Math.max(0, round.cards.length - round.i) }) }),
      ]),
    );
    var body = el('div.pvzx-mbody');
    ({ discover: discoverTab, messages: messagesTab, likes: likesTab, partners: partnersTab, social: socialTab }[view.tab] || discoverTab)(body);
    if (view.datePick) body.appendChild(datePicker(view.datePick));
    phone.appendChild(body);
    var b = levelBonus();
    phone.appendChild(
      el('div.pvzx-mfoot', null, [
        el('button.mp-btn.mp-green', { text: t('match_play', { n: round.matches.length }), title: L(TXT.bonus, b), disabled: !round.matches.length, onclick: play }),
        el('button.mp-btn.mp-small.mp-brown', { text: t('match_restart'), onclick: function () {
          newRound();
          render();
        } }),
      ]),
    );
    if (b.sun || b.food) phone.appendChild(el('div.pvzx-mbonus', { text: L(TXT.bonus, b) }));
    var unread = chatCodes().filter(function (c) {
      return chats[c] && chats[c].unread;
    }).length;
    var likesPending = round.cards.slice(round.i).filter(function (c) {
      return c.likedYou;
    }).length;
    phone.appendChild(
      el(
        'div.pvzx-mtabs',
        null,
        TABS.map(function (tb) {
          var count = tb[0] === 'messages' ? unread : tb[0] === 'likes' ? likesPending : 0;
          return el('button.pvzx-mtab' + (view.tab === tb[0] ? '.pvzx-on' : ''), { onclick: function () {
            view.tab = tb[0];
            view.prefs = false;
            view.viewing = null;
            view.chat = null;
            view.datePick = null;
            render();
          } }, [el('span', { text: tb[1] }), el('small', { text: L(tb[2]) }), count ? el('i', { text: String(count) }) : null]);
        }),
      ),
    );
    node.replaceChildren(phone);
  }

  var LINES = ['match_line1', 'match_line2', 'match_line3', 'match_line4', 'match_line5', 'match_line6'];

  function showMatch(p) {
    render();
    var line = t(LINES[Math.floor(Math.random() * LINES.length)], { name: p.name });
    var pic = p.photos && p.photos.idle ? animImg(p.photos.idle) : el('img', { src: p.packet, alt: '' });
    var box = el('div.pvzx-itsmatch', null, [
      el('div.pvzx-itsmatch-title', { text: t('match_its') }),
      el('div.pvzx-itsmatch-pair', null, [el('div.pvzx-itsmatch-pic', null, [pic]), el('span', { text: '💘' }), el('div.pvzx-itsmatch-you', { text: '🧑‍🌾' })]),
      el('div.pvzx-itsmatch-msg', null, [el('b', { text: p.name + ': ' }), line]),
      el('div.pvzx-itsmatch-sub', { text: t('match_count', { n: round.matches.length, max: SLOTS, left: Math.max(0, round.cards.length - round.i) }) }),
      el('div.pvzx-file-actions', null, [
        el('button.mp-btn.mp-blue', { text: '💬 ' + L(TXT.tabMessages), onclick: function () {
          view.tab = 'messages';
          view.chat = p;
          getChat(p.code).unread = false;
          render();
        } }),
        el('button.mp-btn.mp-green', { text: t('match_keep'), onclick: function () {
          box.remove();
        } }),
      ]),
    ]);
    node.querySelector('.pvzx-phone').appendChild(box);
    G.play('playCardChosen');
  }

  function onKey(e) {
    if (!node) return;
    var k = e.key;
    var p = current();
    var disc = view.tab === 'discover' && !view.prefs && !view.viewing && !view.datePick;
    if (k === 'ArrowLeft' && disc) decide('nope');
    else if (k === 'ArrowRight' && disc) decide('like');
    else if (k === 'ArrowUp' && disc) decide('super');
    else if (k === 'Backspace' && disc) undo();
    else if (k === ' ' && p && disc) {
      view.photo = (view.photo + 1) % photoList(p).length;
      render();
    } else if (k === 'Enter' && p && disc) {
      view.expanded = !view.expanded;
      render();
    } else if (k === 'Escape') {
      if (view.datePick) {
        view.datePick = null;
        render();
      } else if (view.viewing || view.prefs || view.chat) {
        view.viewing = null;
        view.prefs = false;
        view.chat = null;
        render();
      } else M.close();
    } else return;
    e.preventDefault();
    e.stopPropagation();
  }

  M.open = function () {
    if (X.online()) return;
    if (X.ui) X.ui.close();
    var go = function () {
      if (!node) {
        node = el('div#pvzx-match');
        ['mousedown', 'wheel', 'click'].forEach(function (type) {
          node.addEventListener(type, function (e) {
            e.stopPropagation();
          });
        });
        (document.getElementById('pvzmp-root') || document.body).appendChild(node);
        window.addEventListener('keydown', onKey, true);
        document.body.classList.add('pvzx-open');
      }
      if (!round || (round.i >= round.cards.length && !round.matches.length)) newRound();
      view.viewing = null;
      view.prefs = false;
      render();
      queuePhotos();
    };
    if (MP.cards && !MP.cards.ready) MP.cards.load().then(go);
    else go();
  };

  M.close = function () {
    if (node) {
      node.querySelectorAll('.pvzx-mcard').forEach(function (c) {
        if (c._cleanup) c._cleanup();
      });
      node.remove();
    }
    node = null;
    window.removeEventListener('keydown', onKey, true);
    document.body.classList.remove('pvzx-open');
    if (cam && cam.root.isValid) cam.root.destroy();
    cam = null;
    view.datePick = null;
    flushStats();
  };

  /* ------------------------------------------------------------- levels */

  function baseLevel(stage, waves, startSun, sunRate) {
    var s = MP.normalizeSettings({ mode: 'survival', stage: stage, waves: waves, difficulty: 'normal', plantPool: 'all', seedSlots: SLOTS, startSun: 50, sunRate: sunRate || 'normal', plantCooldown: 1, mowers: 'on' });
    var objects = MP.buildLevel.survival(s);
    var d = objects.find(function (o) {
      return o.objclass === 'LevelDefinition';
    }).objdata;
    d.StartingSun = startSun;
    return { objects: objects, def: d };
  }

  function setSeeds(objects, codes) {
    objects.find(function (o) {
      return o.objclass === 'SeedBankProperties';
    }).objdata = {
      SuppressObjectiveTip: true,
      SelectionMethod: 'preset',
      PresetPlantList: codes.map(function (c) {
        return { PlantType: c, Level: -1 };
      }),
    };
  }

  function play() {
    if (!round || !round.matches.length) return;
    var b = levelBonus();
    var team = round.matches.map(function (m) {
      return m.code;
    });
    jealousy(team);
    X.store.set('matchGiftFood', 0);
    X.store.set('matchLastTeam', team);
    playTeam(team, b, {});
  }

  // A Plant Match level with this team (also a friend's shared team).
  function playTeam(team, b, extra) {
    var stage = X.STAGE_IDS[Math.floor(Math.random() * X.STAGE_IDS.length)];
    var lv = baseLevel(stage, 15, 150 + b.sun);
    lv.def.Name = t('mode_match');
    lv.def.Description = t('mode_match_desc');
    setSeeds(lv.objects, team);
    var fam = week().fam;
    var evCount = team.filter(function (c) {
      return famOf(c) === fam;
    }).length;
    flushStats();
    M.close();
    X.modes.current = { kind: 'match', id: 'match', options: { stage: stage, team: team, food: b.food, shared: !!extra.shared, event: evCount }, mutators: X.mutators ? X.mutators.chosen() : [] };
    G.startCustomLevel(lv.objects);
    round = null;
  }

  // A friend for the double date: another plant of the same family.
  function friendOf(p) {
    var same = shuffle(MP.allPlants().slice()).find(function (c) {
      return c !== p.code && famOf(c) === p.family && MP.cards.plantCanvas(c);
    });
    return same || pick(MP.allPlants().filter(function (c) {
      return c !== p.code;
    }));
  }

  // A short level with one match: the kind of date sets the arena, waves
  // and modifiers; up to 3 stars from its objectives.
  function date(p, dt) {
    dt = dt || DATE_TYPES[0];
    var stage = dt.stage || STAGE_OF_WORLD[p.worldKey] || pick(X.STAGE_IDS);
    var lv = baseLevel(stage, dt.waves, dt.sun, dt.rate);
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
    if (dt.friend) team.push(friendOf(p));
    if (dt.guests) {
      shuffle(Object.keys(partners()))
        .filter(function (c) {
          return c !== p.code;
        })
        .slice(0, 4)
        .forEach(function (c) {
          team.push(c);
        });
    }
    setSeeds(lv.objects, team);
    flushStats();
    M.close();
    X.modes.current = { kind: 'matchdate', id: 'matchdate', options: { stage: stage, plant: p.code, name: p.name, type: dt.id, team: team }, mutators: dt.mut.slice() };
    G.startCustomLevel(lv.objects);
  }

  function onLevelStart() {
    var cur = X.modes.current;
    if (!cur || cur.kind !== 'match' || !cur.options.food) return;
    try {
      var P = G.m.PlantFoodCount.PlantFoodCount;
      if (P && P.component) P.component.setPlantFoodNum(cur.options.food);
    } catch (e) {}
  }

  function note(text, cls, delay) {
    setTimeout(function () {
      if (X.play && X.play.summaryNote) X.play.summaryNote(text, cls);
    }, delay || 1300);
  }

  function dateEnded(cur, s) {
    s.mode = 'matchdate';
    var dt =
      DATE_TYPES.find(function (d) {
        return d.id === cur.options.type;
      }) || DATE_TYPES[0];
    var code = cur.options.plant;
    var name = cur.options.name;
    if (s.result !== 'won') {
      pushMsg(code, 'them', Lp(CHAT.dateLostMsg));
      note(L(TXT.dateLost));
      return;
    }
    var stars = 1;
    dt.obj.forEach(function (o) {
      if (OBJ[o].ok(s)) stars++;
    });
    var ps = partners();
    var fresh = !ps[code];
    if (fresh) ps[code] = { since: Date.now(), xp: 0, dates: {} };
    var r = ps[code];
    var before = fresh ? -1 : relStage(r);
    r.dates[dt.id] = Math.max(r.dates[dt.id] || 0, stars);
    if (dt.id === 'wedding') r.married = true;
    savePartners(ps);
    pushMsg(code, 'them', Lp(CHAT.dateWonMsg));
    statEvent(code, 'date');
    if (fresh) statEvent(code, 'partner');
    if (dt.id === 'wedding') {
      statEvent(code, 'wed');
      unlock(['match_married']);
    }
    // xp after the wedding flag: the stage messages come from the change.
    addXp(code, stars);
    if (dt.id === 'wedding' && !fresh) stageMessages(code, before, 3);
    X.store.set('matchReveals', reveals() + 1);
    if (stars === 3) {
      X.store.set('matchSupers', X.store.get('matchSupers', 0) + 1);
      unlock(['match_stars']);
    }
    note(L(TXT.dateResult, { icon: dt.icon, date: L(DATES[dt.id].name), stars: starsText(stars) }), 'pvzx-good');
    note(
      [L(TXT.objWin)]
        .concat(dt.obj.map(function (o) {
          return (OBJ[o].ok(s) ? '✔ ' : '✘ ') + OBJ[o].text();
        }))
        .join(' · '),
      '',
      1400,
    );
    if (fresh) note(L(TXT.dateWon, { name: name }), 'pvzx-good', 1500);
  }

  function matchEnded(cur, s) {
    s.mode = 'match';
    var team = cur.options.team;
    s.matchTeam = team.length;
    s.score = X.modes.score(s);
    X.store.set('matchBest', Math.max(X.store.get('matchBest', 0), s.score));
    var won = s.result === 'won';
    var ps = partners();
    // Messages after the level: partners in the team and a couple more.
    var others = shuffle(
      team.filter(function (c) {
        return !ps[c];
      }),
    ).slice(0, 2);
    team.forEach(function (code) {
      var c = getChat(code);
      c.mem.levels++;
      if (won) c.mem.wins++;
      if (ps[code] || others.indexOf(code) >= 0) pushMsg(code, 'them', Lp(won ? CHAT.afterWin : CHAT.afterLoss, { kills: s.kills || 0 }));
      if (ps[code] && won) addXp(code, 1);
    });
    saveChats();
    var wk = week();
    var themed = won && !cur.options.shared && cur.options.event >= 3;
    if (won && !cur.options.shared) {
      M.reward();
      if (themed) {
        M.reward();
        unlock(['match_event']);
        note(L(TXT.weekReward), 'pvzx-good');
      }
      note(L(TXT.reward), 'pvzx-good');
    }
    if (X.api.available() && X.api.loggedIn()) {
      var details = { waves: s.wave, kills: s.kills, time: Math.round(s.time), plants: s.matchTeam, stage: cur.options.stage, team: team.join('.').slice(0, 80) };
      X.api
        .postScore('challenge:match', s.score, details)
        .then(function (r) {
          if (r.rank) note(t('summary_rank', { n: r.rank }), 'pvzx-good', 1500);
        })
        .catch(function () {});
      if (themed) X.api.postScore('challenge:week-' + wk.n, s.score, details).catch(function () {});
    }
  }

  function onLevelEnd(s) {
    var cur = X.modes.current;
    if (!cur || s.online) return;
    if (cur.kind === 'matchdate') dateEnded(cur, s);
    else if (cur.kind === 'match') matchEnded(cur, s);
    else return;
    flushStats();
  }

  // For tests and the console.
  M.debug = {
    chats: function () {
      return chats;
    },
    round: function () {
      return round;
    },
  };

  M.best = function () {
    return X.store.get('matchBest', 0);
  };

  M.init = function () {
    X.on('level-start', onLevelStart);
    X.on('level-end', onLevelEnd);
    G.on('scene', function (name) {
      if (name !== 'mainScene') M.close();
    });
  };
})();
