/*
 * PvZ2 Gardendless - "Plant Match": a simulated dating-app mode.
 *
 * A stack of plant profiles (seed packet art from mp-cards, the almanac's
 * "Chat" text as the bio, world, sun cost) is swiped right (like), left
 * (pass) or up (super like, once per round). A liked plant may like you
 * back: pricier plants are pickier, a super like always matches. Matches
 * (up to 8) become the seed bank of a generated level - waves of zombies in
 * a random arena - scored on the "challenge:match" leaderboard.
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

  var round = null; // {cards:[...], i, matches:[codes], liked, superUsed}
  var node = null;

  /* ---------------------------------------------------------- profiles */

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
    if (MP.lang === 'zh' && obj.zh) return obj.zh;
    var en = obj.en || '';
    return MP.lang === 'pt' && MP.ptBR && MP.ptBR.translate ? MP.ptBR.translate(en) : en;
  }

  var WORLD_KEY = { ice: 'iceage', modern: 'frontyard' };

  function profile(code) {
    var f = plantFeature(code);
    if (!f) return null;
    var P = G.m.Plants;
    var art = MP.cards && MP.cards.plantCanvas(code);
    if (!art) return null;
    var alm = null;
    var props = null;
    try {
      alm = P.plants.getPlantAlmanac(f.ID);
    } catch (e) {}
    try {
      props = P.plants.getPlantProps(f.ID);
    } catch (e) {}
    var cost = Number(props && props.SunCost) || 0;
    var world = WORLD_KEY[f.OBTAINWORLD] || f.OBTAINWORLD || '';
    var worldName = t('world_' + world);
    return {
      code: code,
      name: X.plantName(code),
      art: art.toDataURL(),
      cost: cost,
      world: worldName === 'world_' + world ? t('match_world_other') : worldName,
      bio: tr(alm && alm.Chat) || tr(alm && alm.Introduction),
      brief: tr(alm && alm.BriefIntroduction),
      distance: 1 + Math.floor(Math.random() * 9),
      // Pricier plants are pickier.
      chance: Math.max(0.35, Math.min(0.9, 0.9 - cost / 900)),
    };
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

  function newRound() {
    var codes = shuffle(MP.allPlants().slice());
    var cards = [];
    for (var i = 0; i < codes.length && cards.length < DECK; i++) {
      var p = profile(codes[i]);
      if (p) cards.push(p);
    }
    round = { cards: cards, i: 0, matches: [], liked: 0, superUsed: false };
  }

  /* ------------------------------------------------------------ swipe */

  function current() {
    return round && round.cards[round.i];
  }

  function decide(kind) {
    var p = current();
    if (!p || round.busy) return;
    round.busy = true;
    var card = node && node.querySelector('.pvzx-mcard.pvzx-top');
    var dx = kind === 'nope' ? -1 : kind === 'like' ? 1 : 0;
    if (card) {
      card.classList.add('pvzx-gone');
      card.style.transform = kind === 'super' ? 'translateY(-140%) rotate(0deg)' : 'translateX(' + dx * 150 + '%) rotate(' + dx * 24 + 'deg)';
      card.querySelector('.pvzx-stamp-' + kind).style.opacity = 1;
    }
    var matched = false;
    if (kind !== 'nope' && round.matches.length < SLOTS) {
      round.liked++;
      if (kind === 'super') round.superUsed = true;
      matched = kind === 'super' || Math.random() < p.chance;
      if (matched) round.matches.push(p);
    }
    setTimeout(function () {
      round.i++;
      round.busy = false;
      if (matched) showMatch(p);
      else render();
    }, 320);
  }

  function attachDrag(card) {
    var start = null;
    var dx = 0;
    var dy = 0;
    var down = function (e) {
      if (round.busy) return;
      var pt = e.touches ? e.touches[0] : e;
      start = { x: pt.clientX, y: pt.clientY };
      card.style.transition = 'none';
    };
    var move = function (e) {
      if (!start) return;
      var pt = e.touches ? e.touches[0] : e;
      dx = pt.clientX - start.x;
      dy = pt.clientY - start.y;
      card.style.transform = 'translate(' + dx + 'px,' + dy + 'px) rotate(' + dx / 14 + 'deg)';
      card.querySelector('.pvzx-stamp-like').style.opacity = Math.max(0, Math.min(1, dx / 90));
      card.querySelector('.pvzx-stamp-nope').style.opacity = Math.max(0, Math.min(1, -dx / 90));
      card.querySelector('.pvzx-stamp-super').style.opacity = round.superUsed ? 0 : Math.max(0, Math.min(1, -dy / 90 - Math.abs(dx) / 120));
    };
    var up = function () {
      if (!start) return;
      start = null;
      card.style.transition = '';
      if (dx > 100) decide('like');
      else if (dx < -100) decide('nope');
      else if (dy < -110 && !round.superUsed) decide('super');
      else {
        card.style.transform = '';
        card.querySelectorAll('.pvzx-stamp').forEach(function (s) {
          s.style.opacity = 0;
        });
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

  function cardNode(p, top) {
    return el('div.pvzx-mcard' + (top ? '.pvzx-top' : ''), null, [
      el('div.pvzx-mcard-art', null, [el('img', { src: p.art, alt: '', draggable: 'false' })]),
      el('div.pvzx-stamp.pvzx-stamp-like', { text: t('match_like') }),
      el('div.pvzx-stamp.pvzx-stamp-nope', { text: t('match_nope') }),
      el('div.pvzx-stamp.pvzx-stamp-super', { text: t('match_super') }),
      el('div.pvzx-mcard-info', null, [
        el('div.pvzx-mcard-name', null, [el('b', { text: p.name }), el('span', { text: '☀ ' + p.cost })]),
        el('div.pvzx-mcard-meta', { text: '📍 ' + p.world + ' · ' + t('match_distance', { n: p.distance }) }),
        p.brief ? el('div.pvzx-mcard-brief', { text: p.brief }) : null,
        el('p.pvzx-mcard-bio', { text: p.bio }),
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
        el('span.pvzx-phone-count', { text: t('match_count', { n: round.matches.length, max: SLOTS, left: Math.max(0, round.cards.length - round.i) }) }),
      ]),
    );
    var stack = el('div.pvzx-stack');
    var p = current();
    var done = !p || round.matches.length >= SLOTS;
    if (done) {
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
    phone.appendChild(
      el('div.pvzx-mbtns', null, [
        el('button.pvzx-mbtn.pvzx-nope', { text: '✕', title: t('match_nope') + ' (←)', disabled: done, onclick: function () {
          decide('nope');
        } }),
        el('button.pvzx-mbtn.pvzx-super', { text: '★', title: t('match_super') + ' (↑)', disabled: done || round.superUsed, onclick: function () {
          decide('super');
        } }),
        el('button.pvzx-mbtn.pvzx-like', { text: '♥', title: t('match_like') + ' (→)', disabled: done, onclick: function () {
          decide('like');
        } }),
      ]),
    );
    var strip = el('div.pvzx-mstrip');
    for (var i = 0; i < SLOTS; i++) {
      var m = round.matches[i];
      strip.appendChild(m ? el('img', { src: m.art, alt: m.name, title: m.name }) : el('span'));
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
    var box = el('div.pvzx-itsmatch', null, [
      el('div.pvzx-itsmatch-title', { text: t('match_its') }),
      el('div.pvzx-itsmatch-pair', null, [el('img', { src: p.art, alt: '' }), el('span', { text: '💘' }), el('div.pvzx-itsmatch-you', { text: '🧑‍🌾' })]),
      el('div.pvzx-itsmatch-msg', null, [el('b', { text: p.name + ': ' }), line]),
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
    if (k === 'ArrowLeft') decide('nope');
    else if (k === 'ArrowRight') decide('like');
    else if (k === 'ArrowUp' && !round.superUsed) decide('super');
    else if (k === 'Escape') M.close();
    else return;
    e.preventDefault();
    e.stopPropagation();
  }

  M.open = function () {
    if (X.online()) return;
    if (X.ui) X.ui.close();
    var go = function () {
      if (!round || round.i >= round.cards.length) newRound();
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
      render();
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
