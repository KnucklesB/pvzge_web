/*
 * PvZ2 Gardendless - "Plant Match": a simulated dating-app mode.
 *
 * A stack of plant profiles is swiped right (like), left (pass) or up (super
 * like, once per round). A liked plant may like you back: pricier plants are
 * pickier, plants that fill a gap in your team are keener, a super like
 * always matches. Matches (up to 8) become the seed bank of a generated
 * level, scored on the "challenge:match" leaderboard.
 *
 * Profiles:
 *  - photos: the seed packet plus the plant itself idle, in action and with
 *    plant food, rendered from the game's own display prefab
 *    (plants/<Name>DIS) by an off-screen camera into a RenderTexture;
 *  - the almanac's bio, ability and special notes, its stats (sun cost,
 *    recharge, toughness, damage, range, area, plant food, sun production),
 *    the plant's family with made-up interests and "looking for";
 *  - a team compatibility score (roles still missing in your matches).
 * Preferences filter the deck by family and sun cost and can guarantee a sun
 * producer; matches can be reopened and undone.
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

  var round = null; // {cards, i, matches, liked, superUsed}
  var node = null;
  var view = { photo: 0, expanded: false, prefs: false, viewing: null };
  M.prefs = X.store.get('matchPrefs', { families: [], maxCost: 0, sun: true });

  /* ------------------------------------------------------------ helpers */

  function plantFeature(code) {
    var P = G.m.Plants;
    var out = null;
    Object.keys(P.PlantEnum).some(function (k) {
      if (!isNaN(+k)) return false;
      var f = P.plants.getPlantFeature(P.PlantEnum[k]);
      if (f && f.CODENAME === code) out = f;
      return !!out;
    });
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

  var WORLD_KEY = { ice: 'iceage', modern: 'frontyard' };
  M.FAMILIES = ['Peashooter', 'Sun', 'Defence', 'Explosive', 'Lobber', 'Sharp', 'Cold', 'Melee', 'Poison', 'Slow', 'Fire', 'Shadow', 'Electricity', 'Magic', 'Nope'];

  /* ------------------------------------------------------------ profiles */

  function rechargeLabel(cd) {
    return cd <= 7.5 ? t('match_fast') : cd <= 20 ? t('match_medium') : t('match_slow');
  }

  function toughLabel(v) {
    return v < 300 ? t('match_fragile') : v < 1000 ? t('match_normal') : v < 4000 ? t('match_tough') : t('match_wall');
  }

  // Roles a plant covers, for the team compatibility.
  function rolesOf(p) {
    var r = {};
    if (p.family === 'Sun' || p.sunprod) r.sun = 1;
    if (p.family === 'Defence' || p.toughness >= 2000) r.defense = 1;
    if (p.area || p.family === 'Explosive') r.area = 1;
    if (p.damage && !r.area) r.attack = 1;
    if (!Object.keys(r).length) r.support = 1;
    return r;
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
    var world = WORLD_KEY[f.OBTAINWORLD] || f.OBTAINWORLD || '';
    var worldName = t('world_' + world);
    var cost = Number(props.SunCost) || 0;
    var p = {
      code: code,
      feature: f,
      name: X.plantName(code),
      packet: art.toDataURL(),
      photos: null, // filled by the camera
      cost: cost,
      cooldown: Number(props.Cooldown) || 0,
      toughness: Number(props.Toughness) || 0,
      damage: elem.DAMAGE ? elem.DAMAGE.VALUE != null ? String(elem.DAMAGE.VALUE) : tr(elem.DAMAGE.SORT) : '',
      range: elem.RANGE ? tr(elem.RANGE.SORT) : '',
      area: elem.AREA ? tr(elem.AREA.SORT) : '',
      food: elem.PLANTFOOD ? tr(elem.PLANTFOOD.SORT) : '',
      sunprod: elem.SUNPRODUCTION ? tr(elem.SUNPRODUCTION.SORT) : '',
      arming: elem.ARMINGTIME && elem.ARMINGTIME.VALUE,
      duration: elem.DURATION && elem.DURATION.VALUE,
      family: props.Family || 'Nope',
      world: worldName === 'world_' + world ? t('match_world_other') : worldName,
      bio: tr(alm.Chat),
      intro: tr(alm.Introduction),
      brief: tr(alm.BriefIntroduction),
      specials: (alm.Special || []).map(function (s) {
        return { name: tr(s.NAME), desc: tr(s.DESCRIPTION) };
      }),
      distance: 1 + Math.floor(Math.random() * 9),
      // Pricier plants are pickier.
      chance: Math.max(0.35, Math.min(0.9, 0.9 - cost / 900)),
      online: Math.random() < 0.4,
    };
    p.roles = rolesOf(p);
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
    // A sun producer among the first profiles, if asked.
    if (prefs.sun && !sunSeen && sunSpare) cards.splice(Math.min(3, cards.length), 0, sunSpare);
    else if (prefs.sun) {
      var at = cards.findIndex(function (c) {
        return c.roles.sun;
      });
      if (at > 4) cards.splice(2, 0, cards.splice(at, 1)[0]);
    }
    round = { cards: cards, i: 0, matches: [], liked: 0, superUsed: false };
    view.photo = 0;
    view.expanded = false;
    queuePhotos();
  }

  /* -------------------------------------------------- team compatibility */

  var ROLE_ORDER = ['sun', 'defense', 'attack', 'area', 'support'];

  function compatibility(p) {
    var have = {};
    round.matches.forEach(function (m) {
      Object.keys(m.roles).forEach(function (r) {
        have[r] = (have[r] || 0) + 1;
      });
    });
    if (p._compat && p._compatFor === round.matches.length) return p._compat;
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
    p._compat = { score: Math.max(12, Math.min(99, score)), reason: reason };
    p._compatFor = round.matches.length;
    return p._compat;
  }

  /* --------------------------------------------------------- the camera */
  // Renders a plant's display prefab off-screen and keeps PNG snapshots of
  // a few animation moments.

  var LAYER = 1 << 19;
  var RT = 640;
  var cam = null;

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

  // RenderTexture pixels -> canvas cropped to the plant (alpha bounds).
  function readCrop(rt) {
    var px = rt.readPixels(0, 0, RT, RT);
    var minX = RT;
    var minY = RT;
    var maxX = -1;
    var maxY = -1;
    for (var y = 0; y < RT; y++) {
      for (var x = 0; x < RT; x++) {
        if (px[(y * RT + x) * 4 + 3] > 8) {
          if (x < minX) minX = x;
          if (x > maxX) maxX = x;
          if (y < minY) minY = y;
          if (y > maxY) maxY = y;
        }
      }
    }
    if (maxX < 0) return null;
    var w = maxX - minX + 1;
    var h = maxY - minY + 1;
    var pad = Math.round(Math.max(w, h) * 0.08);
    var c = document.createElement('canvas');
    c.width = w + pad * 2;
    c.height = h + pad * 2;
    var ctx = c.getContext('2d');
    var id = ctx.createImageData(w, h);
    for (var yy = 0; yy < h; yy++) {
      // The RenderTexture's rows go bottom-up: the crop's top row is maxY.
      var src = ((maxY - yy) * RT + minX) * 4;
      id.data.set(px.subarray(src, src + w * 4), yy * w * 4);
    }
    var tmp = document.createElement('canvas');
    tmp.width = w;
    tmp.height = h;
    tmp.getContext('2d').putImageData(id, 0, 0);
    ctx.drawImage(tmp, pad, pad);
    return c;
  }

  function animFor(names, kind) {
    var re = { idle: /^idle$|idle/i, attack: /shoot|attack|lob|fire|bite|chomp|punch|throw|blow|spit|smash|zap|slap|explode|stab/i, food: /^food$|plantfood|food/i }[kind];
    return names.find(function (n) {
      return re.test(n);
    });
  }

  function loadPrefab(path) {
    return new Promise(function (resolve) {
      G.cc.resources.load(path, G.cc.Prefab, function (err, prefab) {
        resolve(err ? null : prefab);
      });
    });
  }

  // {idle, attack, food} data URLs (missing poses are left out).
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
      var poses = [
        ['idle', 0.35],
        ['attack', 0.55],
        ['food', 0.5],
      ];
      return frames(3)
        .then(function step() {
          var pose = poses.shift();
          if (!pose) return out;
          var anim = animFor(names, pose[0]);
          if (!anim) return step();
          dbs.forEach(function (d) {
            try {
              var a = d.armature && d.armature();
              if (a && a.animation.hasAnimation(anim)) a.animation.gotoAndStopByProgress(anim, pose[1]);
            } catch (e) {}
          });
          return frames(3).then(function () {
            var canvas = readCrop(c.rt);
            if (canvas) out[pose[0]] = canvas.toDataURL();
            return step();
          });
        })
        .then(function (o) {
          n.destroy();
          return o;
        })
        .catch(function (e) {
          MP.warn('match: photo', p.code, e);
          if (n.isValid) n.destroy();
          return out;
        });
    });
  }

  var shooting = false;
  // Photos for the current card and the next two, one plant at a time.
  function queuePhotos() {
    if (shooting || !round || !node) return;
    var target = null;
    for (var i = round.i; i < Math.min(round.cards.length, round.i + 3); i++) {
      if (!round.cards[i].photos) {
        target = round.cards[i];
        break;
      }
    }
    if (!target && view.viewing && !view.viewing.photos) target = view.viewing;
    if (!target) return;
    shooting = true;
    shoot(target).then(function (photos) {
      target.photos = photos;
      shooting = false;
      if (node && (target === current() || target === view.viewing)) render();
      queuePhotos();
    });
  }

  function photoList(p) {
    var list = [{ src: p.packet, label: t('match_photo_card'), packet: true }];
    var ph = p.photos || {};
    if (ph.idle) list.push({ src: ph.idle, label: t('match_photo_idle') });
    if (ph.attack) list.push({ src: ph.attack, label: t('match_photo_attack') });
    if (ph.food) list.push({ src: ph.food, label: t('match_photo_food') });
    return list;
  }

  /* ------------------------------------------------------------- swipe */

  function current() {
    return round && round.cards[round.i];
  }

  function decide(kind) {
    var p = current();
    if (!p || round.busy || view.viewing || view.prefs) return;
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
    if (kind !== 'nope' && round.matches.length < SLOTS) {
      round.liked++;
      if (kind === 'super') round.superUsed = true;
      // Plants that fill a gap in the team are keener.
      var chance = Math.min(0.97, p.chance * (0.7 + compatibility(p).score / 160));
      matched = kind === 'super' || Math.random() < chance;
      if (matched) round.matches.push(p);
    }
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
      card.querySelector('.pvzx-stamp-super').style.opacity = round.superUsed ? 0 : Math.max(0, Math.min(1, -dy / 90 - Math.abs(dx) / 120));
    };
    var up = function (e) {
      if (!start) return;
      var s = start;
      start = null;
      card.style.transition = '';
      if (dx > 100) decide('like');
      else if (dx < -100) decide('nope');
      else if (dy < -110 && !round.superUsed) decide('super');
      else {
        card.style.transform = '';
        card.querySelectorAll('.pvzx-stamp').forEach(function (x) {
          x.style.opacity = 0;
        });
        // A tap on the photo: previous / next photo.
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

  /* -------------------------------------------------------------- view */

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
    return el('div.pvzx-mcard-art.pvzx-fam-' + p.family.toLowerCase() + (ph.packet ? '.pvzx-packet' : ''), null, [
      el('img', { src: ph.src, alt: '', draggable: 'false' }),
      bars,
      el('span.pvzx-photo-label', { text: ph.label + (p.online ? ' · ' + t('match_online') : '') }),
    ]);
  }

  function details(p, opts) {
    var compat = compatibility(p);
    var fam = 'family_' + p.family.toLowerCase();
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
          t(fam + '_likes')
            .split('|')
            .map(function (x) {
              return el('span.pvzx-chip.pvzx-chip-like', { text: x });
            }),
        ),
      ]),
      el('div.pvzx-msec', null, [el('h4', { text: t('match_looking') }), el('p', { text: t(fam + '_wants') })]),
      opts && opts.undo
        ? el('button.mp-btn.mp-red', { text: t('match_unmatch'), onclick: function () {
            round.matches.splice(round.matches.indexOf(p), 1);
            view.viewing = null;
            render();
          } })
        : null,
    ]);
  }

  function cardNode(p, top) {
    var info = el('div.pvzx-mcard-info', null, [
      el('div.pvzx-mcard-name', null, [
        el('b', { text: p.name }),
        el('span.pvzx-fam', { text: t('family_' + p.family.toLowerCase()) }),
        top
          ? el('button.pvzx-more', { text: view.expanded ? '▾' : 'ⓘ', title: t('match_more'), onclick: function (e) {
              e.stopPropagation();
              view.expanded = !view.expanded;
              render();
            } })
          : null,
      ]),
      el('div.pvzx-mcard-meta', { text: '📍 ' + p.world + ' · ' + t('match_distance', { n: p.distance }) }),
      top ? el('div.pvzx-compat-mini', { text: '💚 ' + t('match_compat', { n: compatibility(p).score }) + ' · ' + t(compatibility(p).reason) }) : null,
      chips(p),
      p.brief && !view.expanded ? el('div.pvzx-mcard-brief', { text: p.brief }) : null,
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

  function render() {
    if (!node) return;
    (node.querySelectorAll('.pvzx-mcard') || []).forEach(function (c) {
      if (c._cleanup) c._cleanup();
    });
    var phone = el('div.pvzx-phone');
    phone.appendChild(
      el('div.pvzx-phone-head', null, [
        el('button.pvzx-x', { text: '×', title: t('close'), onclick: M.close }),
        el('b', { text: '🔥 ' + t('mode_match') }),
        el('button.pvzx-gear', { text: '⚙', title: t('match_prefs'), onclick: function () {
          view.prefs = !view.prefs;
          view.viewing = null;
          render();
        } }),
        el('span.pvzx-phone-count', { text: t('match_count', { n: round.matches.length, max: SLOTS, left: Math.max(0, round.cards.length - round.i) }) }),
      ]),
    );
    var stack = el('div.pvzx-stack');
    var p = current();
    var done = !p || round.matches.length >= SLOTS;
    if (view.prefs) stack.appendChild(prefsPanel());
    else if (view.viewing) {
      var v = view.viewing;
      var sheet = el('div.pvzx-mview', null, [
        el('button.pvzx-x', { text: '←', title: t('close'), onclick: function () {
          view.viewing = null;
          render();
        } }),
        el(
          'div.pvzx-mview-photos',
          null,
          photoList(v).map(function (x) {
            return el('img', { src: x.src, alt: x.label, title: x.label });
          }),
        ),
        el('div.pvzx-mcard-name', null, [el('b', { text: v.name }), el('span.pvzx-fam', { text: t('family_' + v.family.toLowerCase()) })]),
        chips(v),
        details(v, { undo: true }),
      ]);
      sheet.addEventListener('wheel', function (e) {
        e.stopPropagation();
      });
      stack.appendChild(sheet);
    } else if (done) {
      stack.appendChild(
        el('div.pvzx-mend', null, [
          el('div.pvzx-mend-title', { text: t(round.matches.length ? 'match_done' : 'match_none') }),
          el('p', { text: round.matches.length ? t('match_done_desc', { n: round.matches.length }) : t('match_none_desc') }),
        ]),
      );
    } else {
      var next = round.cards[round.i + 1];
      if (next) stack.appendChild(cardNode(next, false));
      var top = cardNode(p, true);
      stack.appendChild(top);
      attachDrag(top);
    }
    phone.appendChild(stack);
    var blocked = done || !!view.viewing || view.prefs;
    phone.appendChild(
      el('div.pvzx-mbtns', null, [
        el('button.pvzx-mbtn.pvzx-nope', { text: '✕', title: t('match_nope') + ' (←)', disabled: blocked, onclick: function () {
          decide('nope');
        } }),
        el('button.pvzx-mbtn.pvzx-super', { text: '★', title: t('match_super') + ' (↑)', disabled: blocked || round.superUsed, onclick: function () {
          decide('super');
        } }),
        el('button.pvzx-mbtn.pvzx-like', { text: '♥', title: t('match_like') + ' (→)', disabled: blocked, onclick: function () {
          decide('like');
        } }),
      ]),
    );
    var strip = el('div.pvzx-mstrip');
    for (var i = 0; i < SLOTS; i++) {
      (function (m) {
        strip.appendChild(
          m
            ? el('img', { src: m.packet, alt: m.name, title: m.name + ' · ' + t('match_view'), onclick: function () {
                view.viewing = m;
                view.prefs = false;
                queuePhotos();
                render();
              } })
            : el('span'),
        );
      })(round.matches[i]);
    }
    phone.appendChild(strip);
    phone.appendChild(
      el('div.pvzx-mfoot', null, [
        el('button.mp-btn.mp-green', { text: t('match_play', { n: round.matches.length }), disabled: !round.matches.length, onclick: play }),
        el('button.mp-btn.mp-small.mp-brown', { text: t('match_restart'), onclick: function () {
          newRound();
          render();
        } }),
      ]),
    );
    node.replaceChildren(phone);
  }

  var LINES = ['match_line1', 'match_line2', 'match_line3', 'match_line4', 'match_line5', 'match_line6'];

  function showMatch(p) {
    render();
    var line = t(LINES[Math.floor(Math.random() * LINES.length)], { name: p.name });
    var pic = (p.photos && (p.photos.idle || p.photos.attack)) || p.packet;
    var box = el('div.pvzx-itsmatch', null, [
      el('div.pvzx-itsmatch-title', { text: t('match_its') }),
      el('div.pvzx-itsmatch-pair', null, [el('div.pvzx-itsmatch-pic', null, [el('img', { src: pic, alt: '' })]), el('span', { text: '💘' }), el('div.pvzx-itsmatch-you', { text: '🧑‍🌾' })]),
      el('div.pvzx-itsmatch-msg', null, [el('b', { text: p.name + ': ' }), line]),
      el('div.pvzx-itsmatch-sub', { text: t('match_count', { n: round.matches.length, max: SLOTS, left: Math.max(0, round.cards.length - round.i) }) }),
      el('button.mp-btn.mp-green', { text: t('match_keep'), onclick: function () {
        box.remove();
      } }),
    ]);
    node.querySelector('.pvzx-phone').appendChild(box);
    G.play('playCardChosen');
  }

  function onKey(e) {
    if (!node) return;
    var k = e.key;
    var p = current();
    if (k === 'ArrowLeft') decide('nope');
    else if (k === 'ArrowRight') decide('like');
    else if (k === 'ArrowUp' && !round.superUsed) decide('super');
    else if (k === ' ' && p) {
      view.photo = (view.photo + 1) % photoList(p).length;
      render();
    } else if (k === 'Enter' && p) {
      view.expanded = !view.expanded;
      render();
    } else if (k === 'Escape') {
      if (view.viewing || view.prefs) {
        view.viewing = null;
        view.prefs = false;
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
      if (!round || round.i >= round.cards.length) newRound();
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
  };

  /* -------------------------------------------------------------- level */

  function play() {
    if (!round || !round.matches.length) return;
    var stage = X.STAGE_IDS[Math.floor(Math.random() * X.STAGE_IDS.length)];
    var s = MP.normalizeSettings({ mode: 'survival', stage: stage, waves: 15, difficulty: 'normal', plantPool: 'all', seedSlots: SLOTS, startSun: 150, sunRate: 'normal', plantCooldown: 1, mowers: 'on' });
    var objects = MP.buildLevel.survival(s);
    var d = objects.find(function (o) {
      return o.objclass === 'LevelDefinition';
    }).objdata;
    d.Name = t('mode_match');
    d.Description = t('mode_match_desc');
    objects.find(function (o) {
      return o.objclass === 'SeedBankProperties';
    }).objdata = {
      SuppressObjectiveTip: true,
      SelectionMethod: 'preset',
      PresetPlantList: round.matches.map(function (m) {
        return { PlantType: m.code, Level: -1 };
      }),
    };
    var team = round.matches.map(function (m) {
      return m.code;
    });
    M.close();
    X.modes.current = { kind: 'match', id: 'match', options: { stage: stage, team: team }, mutators: X.mutators ? X.mutators.chosen() : [] };
    G.startCustomLevel(objects);
    round = null; // a new round next time
  }

  function onLevelEnd(s) {
    var cur = X.modes.current;
    if (!cur || cur.kind !== 'match' || s.online) return;
    s.mode = 'match';
    s.matchTeam = cur.options.team.length;
    s.score = X.modes.score(s);
    X.store.set('matchBest', Math.max(X.store.get('matchBest', 0), s.score));
    if (X.api.available() && X.api.loggedIn()) {
      X.api
        .postScore('challenge:match', s.score, { waves: s.wave, kills: s.kills, time: Math.round(s.time), plants: s.matchTeam, stage: cur.options.stage })
        .then(function (r) {
          setTimeout(function () {
            if (r.rank) X.play.summaryNote(t('summary_rank', { n: r.rank }), 'pvzx-good');
          }, 1300);
        })
        .catch(function () {});
    }
  }

  M.best = function () {
    return X.store.get('matchBest', 0);
  };

  M.init = function () {
    X.on('level-end', onLevelEnd);
    G.on('scene', function (name) {
      if (name !== 'mainScene') M.close();
    });
  };
})();
