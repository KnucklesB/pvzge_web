/*
 * PvZ2 Gardendless - Plant Match: the phone
 *
 * Swiping, profiles, the tabs, the "It's a match" screen, keys, open and
 * close.
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

  /* ------------------------------------------------------------- swipe */

  I.current = function current() {
    return I.round && I.round.cards[I.round.i];
  };

  I.canSwipe = function canSwipe() {
    return !!I.current() && I.round.matches.length < SLOTS && I.view.tab === 'discover' && !I.view.prefs && !I.view.viewing && !I.view.datePick;
  };

  I.decide = function decide(kind) {
    var p = I.current();
    if (!p || I.round.busy || !I.canSwipe()) return;
    if (kind === 'like' && !I.likesLeft()) {
      I.render();
      return;
    }
    if (kind === 'super' && !I.supersLeft()) return;
    I.round.busy = true;
    var card = I.node && I.node.querySelector('.pvzx-mcard.pvzx-top');
    var dx = kind === 'nope' ? -1 : kind === 'like' ? 1 : 0;
    if (card) {
      card.classList.add('pvzx-gone');
      card.style.transform = kind === 'super' ? 'translateY(-140%)' : 'translateX(' + dx * 150 + '%) rotate(' + dx * 24 + 'deg)';
      var stamp = card.querySelector('.pvzx-stamp-' + kind);
      if (stamp) stamp.style.opacity = 1;
    }
    var matched = false;
    var usedSuperExtra = false;
    if (kind === 'like') I.useLike(1);
    if (kind === 'super') {
      if (!I.round.superUsed) I.round.superUsed = true;
      else {
        X.store.set('matchSupers', Math.max(0, X.store.get('matchSupers', 0) - 1));
        usedSuperExtra = true;
      }
    }
    if (kind !== 'nope') {
      I.statEvent(p.code, kind === 'super' ? 'super' : 'like');
      // Plants that look for someone else are harder to match.
      var chance = Math.min(0.97, p.chance * (0.7 + I.compatibility(p).score / 160) * (I.seeksYou(p) ? 1 : 0.45));
      matched = kind === 'super' || p.likedYou || p.partner || Math.random() < chance;
      if (matched) {
        I.round.matches.push(p);
        I.startChat(p);
        I.statEvent(p.code, 'match');
        // A partner of the same family (not matched this round) notices.
        var ps = I.partners();
        Object.keys(ps).forEach(function (code) {
          if (code === p.code || I.inRound({ code: code }) || I.famOf(code) !== p.family || Math.random() > 0.35) return;
          I.later(code, Lp(CHAT.jealousMatch, { name: p.name }), 8000 + Math.random() * 20000);
        });
      }
    }
    I.round.history.push({ card: p, kind: kind, matched: matched, superExtra: usedSuperExtra });
    setTimeout(function () {
      I.round.i++;
      I.round.busy = false;
      I.view.photo = 0;
      I.view.expanded = false;
      I.queuePhotos();
      if (matched) I.showMatch(p);
      else I.render();
    }, 320);
  };

  I.undo = function undo() {
    if (!I.round || I.round.undoUsed || !I.round.history.length || I.round.busy) return;
    var h = I.round.history.pop();
    I.round.undoUsed = true;
    I.round.i--;
    if (h.kind === 'like') I.useLike(-1);
    if (h.kind === 'super') {
      if (h.superExtra) X.store.set('matchSupers', X.store.get('matchSupers', 0) + 1);
      else I.round.superUsed = false;
    }
    if (h.matched) {
      I.round.matches.splice(I.round.matches.indexOf(h.card), 1);
      I.dropChat(h.card.code);
    }
    I.view.photo = 0;
    I.render();
  };

  I.boost = function boost() {
    if (!I.round || I.round.boostUsed) return;
    I.round.boostUsed = true;
    I.round.boosted = true;
    var rest = I.round.cards.slice(I.round.i + 1);
    rest.sort(function (a, b) {
      return I.compatibility(b).score - I.compatibility(a).score;
    });
    I.round.cards = I.round.cards.slice(0, I.round.i + 1).concat(rest);
    I.queuePhotos();
    I.render();
  };

  I.attachDrag = function attachDrag(card) {
    var start = null;
    var dx = 0;
    var dy = 0;
    var moved = false;
    var down = function (e) {
      // Phones send a compatibility mouse event after a tap: ignore it.
      if (e.touches) I.lastTouch = Date.now();
      else if (Date.now() - (I.lastTouch || 0) < 900) return;
      if (I.round.busy || I.view.expanded) return;
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
      card.querySelector('.pvzx-stamp-super').style.opacity = I.supersLeft() ? Math.max(0, Math.min(1, -dy / 90 - Math.abs(dx) / 120)) : 0;
    };
    var up = function () {
      if (!start) return;
      var s = start;
      start = null;
      card.style.transition = '';
      if (dx > 100 && I.likesLeft()) I.decide('like');
      else if (dx < -100) I.decide('nope');
      else if (dy < -110 && I.supersLeft()) I.decide('super');
      else {
        card.style.transform = '';
        card.querySelectorAll('.pvzx-stamp').forEach(function (x) {
          x.style.opacity = 0;
        });
        if (!moved) {
          var photo = card.querySelector('.pvzx-mcard-art');
          var r = photo.getBoundingClientRect();
          if (s.y >= r.top && s.y <= r.bottom) {
            var n = I.photoList(I.current()).length;
            I.view.photo = s.x < r.left + r.width / 2 ? Math.max(0, I.view.photo - 1) : Math.min(n - 1, I.view.photo + 1);
            I.render();
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
  };

  /* ------------------------------------------------------- profile view */

  I.chips = function chips(p) {
    var list = [
      ['☀', p.cost, t('match_stat_cost')],
      ['⏱', I.rechargeLabel(p.cooldown), t('match_stat_recharge')],
    ];
    if (p.toughness) list.push(['🛡', I.toughLabel(p.toughness), t('match_stat_tough')]);
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
  };

  I.badges = function badges(p) {
    if (!p.badges.length) return null;
    return el(
      'div.pvzx-badges',
      null,
      p.badges.map(function (b) {
        return el('span.pvzx-badge', { text: b });
      }),
    );
  };

  I.photoNode = function photoNode(p, idx) {
    var list = I.photoList(p);
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
    var img = ph.frames ? I.animImg(ph.frames) : el('img', { src: ph.src, alt: '', draggable: 'false' });
    return el('div.pvzx-mcard-art.pvzx-fam-' + p.family.toLowerCase() + (ph.packet ? '.pvzx-packet' : ''), null, [
      img,
      bars,
      el('span.pvzx-photo-label', { text: ph.label + (p.online ? ' · ' + t('match_online') : '') }),
      p.likedYou && I.round.revealed[p.code] ? el('span.pvzx-liked-tag', { text: L(TXT.likedYou) }) : null,
    ]);
  };

  I.details = function details(p, opts) {
    var compat = I.compatibility(p);
    var fam = I.famKey(p);
    var specials = p.specials.filter(function (s) {
      return s.desc;
    });
    var sheet = [
      [t('match_stat_cost'), '☀ ' + p.cost],
      [t('match_stat_recharge'), I.rechargeLabel(p.cooldown) + (p.cooldown ? ' (' + p.cooldown + 's)' : '')],
    ];
    if (p.toughness) sheet.push([t('match_stat_tough'), I.toughLabel(p.toughness) + ' (' + p.toughness + ')']);
    if (p.damage) sheet.push([t('match_stat_damage'), p.damage]);
    if (p.range) sheet.push([t('match_stat_range'), p.range]);
    if (p.area) sheet.push([t('match_stat_area'), p.area]);
    if (p.sunprod) sheet.push([t('match_stat_sun'), p.sunprod]);
    if (p.food) sheet.push([t('match_stat_food'), p.food]);
    if (p.arming) sheet.push([t('match_stat_arming'), p.arming + 's']);
    if (p.duration) sheet.push([t('match_stat_duration'), p.duration + 's']);
    return el('div.pvzx-mdetails', null, [
      el('div.pvzx-compat', null, [el('b', { text: '💚 ' + t('match_compat', { n: compat.score }) }), el('span', { text: t(compat.reason) }), compat.seek ? el('span.pvzx-seek', { text: compat.seek }) : null]),
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
        el('h4', { text: L(TRAITS.labels.basics) }),
        el(
          'table.pvzx-sheet',
          null,
          I.traitRows(p).map(function (r) {
            return el('tr', null, [el('td', { text: r[0] + ' ' + r[1] }), el('td', { text: r[2] })]);
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
              I.openDates(p);
            } }),
            el('button.mp-btn.mp-small.mp-red', { text: t('match_unmatch'), onclick: function () {
              I.round.matches.splice(I.round.matches.indexOf(p), 1);
              I.dropChat(p.code);
              I.view.viewing = null;
              I.view.chat = null;
              I.render();
            } }),
          ])
        : null,
    ]);
  };

  I.nameRow = function nameRow(p, withMore) {
    return el('div.pvzx-mcard-name', null, [
      el('b', { text: p.name }),
      p.age ? el('span.pvzx-age', { text: p.age }) : null,
      el('span.pvzx-fam', { text: t(I.famKey(p)) }),
      withMore
        ? el('button.pvzx-more', { text: I.view.expanded ? '▾' : 'ⓘ', title: t('match_more'), onclick: function (e) {
            e.stopPropagation();
            I.view.expanded = !I.view.expanded;
            I.render();
          } })
        : null,
    ]);
  };

  I.cardNode = function cardNode(p, top) {
    var info = el('div.pvzx-mcard-info', null, [
      I.nameRow(p, top),
      I.badges(p),
      el('div.pvzx-mcard-meta', { text: '📍 ' + p.world + ' · ' + t('match_distance', { n: p.distance }) }),
      el('div.pvzx-mcard-meta', { text: I.traitLine(p) }),
      top ? el('div.pvzx-compat-mini' + (I.compatibility(p).seek ? '.pvzx-seek' : ''), { text: '💚 ' + t('match_compat', { n: I.compatibility(p).score }) + ' · ' + (I.compatibility(p).seek || t(I.compatibility(p).reason)) }) : null,
      I.chips(p),
      !I.view.expanded ? el('div.pvzx-mcard-brief', { text: '“' + p.headline + '”' }) : null,
    ]);
    var card = el('div.pvzx-mcard' + (top ? '.pvzx-top' : '') + (top && I.view.expanded ? '.pvzx-expanded' : ''), null, [
      I.photoNode(p, top ? I.view.photo : 0),
      el('div.pvzx-stamp.pvzx-stamp-like', { text: t('match_like') }),
      el('div.pvzx-stamp.pvzx-stamp-nope', { text: t('match_nope') }),
      el('div.pvzx-stamp.pvzx-stamp-super', { text: t('match_super') }),
      info,
    ]);
    if (top && I.view.expanded) {
      var d = I.details(p);
      d.addEventListener('wheel', function (e) {
        e.stopPropagation();
      });
      card.appendChild(d);
    }
    return card;
  };

  I.fullProfile = function fullProfile(p) {
    var sheet = el('div.pvzx-mview', null, [
      el('button.pvzx-x', { text: '←', title: t('close'), onclick: function () {
        I.view.viewing = null;
        I.render();
      } }),
      el(
        'div.pvzx-mview-photos',
        null,
        I.photoList(p).map(function (x) {
          return x.frames ? I.animImg(x.frames) : el('img', { src: x.src, alt: x.label, title: x.label });
        }),
      ),
      I.nameRow(p, false),
      I.badges(p),
      I.chips(p),
      I.details(p, { undo: I.round.matches.indexOf(p) >= 0 }),
      I.relationBox(p),
      el('div.pvzx-file-actions', null, [
        el('button.mp-btn.mp-small.mp-blue', { text: L(TXT.shareProfile), onclick: function () {
          I.copyText(
            L(TXT.shareProfileText, { name: p.name, age: p.age ? p.age + ' · ' : '', fam: t(I.famKey(p)), cost: p.cost, pers: PERS[p.pers].icon + ' ' + L(PERS[p.pers].name), headline: p.headline }),
          );
        } }),
      ]),
    ]);
    sheet.addEventListener('wheel', function (e) {
      e.stopPropagation();
    });
    return sheet;
  };

  /* --------------------------------------------------------- the tabs */

  I.choiceChips = function choiceChips(values, current, onPick, label) {
    return el(
      'div.pvzx-chips',
      null,
      values.map(function (v) {
        return el('button.pvzx-chip.pvzx-chip-btn' + (current === v ? '.pvzx-on' : ''), { text: label(v), onclick: function () {
          onPick(v);
        } });
      }),
    );
  };

  I.prefsPanel = function prefsPanel() {
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
            I.render();
          },
        });
      }),
    );
    var costs = [0, 100, 150, 200, 300];
    return el('div.pvzx-mprefs', null, [
      el('h3', { text: '⚙ ' + t('match_prefs') }),
      el('h4', { text: L(TXT.prefMe) }),
      el('p.pvzx-small', { text: L(TXT.prefMeTip) }),
      I.choiceChips(['f', 'm', 'n', ''], pr.me, function (v) {
        pr.me = v;
        save();
        I.round.cards.forEach(function (c) {
          c._compat = null;
        });
        I.render();
      }, function (v) {
        return v ? TRAITS.gender[v].icon + ' ' + L(TRAITS.gender[v]) : L(TXT.prefUnset);
      }),
      el('h4', { text: L(TXT.prefShow) }),
      I.choiceChips(['all', 'f', 'm', 'n'], pr.show || 'all', function (v) {
        pr.show = v;
        save();
        I.render();
      }, function (v) {
        return v === 'all' ? L(TXT.showAll) : TRAITS.gender[v].icon + ' ' + L(TRAITS.interest[v]);
      }),
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
              I.render();
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
          I.view.prefs = false;
          I.newRound();
          I.render();
        } }),
        el('button.mp-btn.mp-small.mp-brown', { text: t('close'), onclick: function () {
          I.view.prefs = false;
          I.render();
        } }),
      ]),
    ]);
  };

  I.discoverTab = function discoverTab(body) {
    var stack = el('div.pvzx-stack');
    var p = I.current();
    if (I.view.prefs) stack.appendChild(I.prefsPanel());
    else if (I.view.viewing) stack.appendChild(I.fullProfile(I.view.viewing));
    else if (!p || I.round.matches.length >= SLOTS) {
      stack.appendChild(
        el('div.pvzx-mend', null, [
          el('div.pvzx-mend-title', { text: t(I.round.matches.length ? 'match_done' : 'match_none') }),
          el('p', { text: I.round.matches.length ? t('match_done_desc', { n: I.round.matches.length }) : t('match_none_desc') }),
        ]),
      );
    } else if (!I.likesLeft() && !I.supersLeft()) {
      stack.appendChild(el('div.pvzx-mend', null, [el('div.pvzx-mend-title', { text: '💤 ' + L(TXT.noLikes) }), el('p', { text: L(TXT.noLikesDesc) })]));
    } else {
      var next = I.round.cards[I.round.i + 1];
      if (next) stack.appendChild(I.cardNode(next, false));
      var top = I.cardNode(p, true);
      stack.appendChild(top);
      I.attachDrag(top);
      if (I.round.boosted && I.round.i < I.round.cards.length) stack.appendChild(el('div.pvzx-boost-tag', { text: L(TXT.boosted) }));
    }
    body.appendChild(stack);
    var blocked = !I.canSwipe();
    body.appendChild(
      el('div.pvzx-mbtns', null, [
        el('button.pvzx-mbtn.pvzx-small.pvzx-undo', { text: '↶', title: L(TXT.undo), disabled: I.round.undoUsed || !I.round.history.length, onclick: I.undo }),
        el('button.pvzx-mbtn.pvzx-nope', { text: '✕', title: t('match_nope') + ' (←)', disabled: blocked, onclick: function () {
          I.decide('nope');
        } }),
        el('button.pvzx-mbtn.pvzx-super', { title: t('match_super') + ' (↑)', disabled: blocked || !I.supersLeft(), onclick: function () {
          I.decide('super');
        } }, ['★', el('small', { text: String(I.supersLeft()) })]),
        el('button.pvzx-mbtn.pvzx-like', { title: t('match_like') + ' (→)', disabled: blocked || !I.likesLeft(), onclick: function () {
          I.decide('like');
        } }, ['♥', el('small', { text: String(I.likesLeft()) })]),
        el('button.pvzx-mbtn.pvzx-small.pvzx-boost', { text: '🚀', title: L(TXT.boost), disabled: I.round.boostUsed || blocked, onclick: I.boost }),
      ]),
    );
  };

  I.likesTab = function likesTab(body) {
    var pending = I.round.cards.slice(I.round.i).filter(function (c) {
      return c.likedYou;
    });
    var box = el('div.pvzx-mlikes', null, [
      el('h3', { text: '💛 ' + L(TXT.likesTitle, { n: pending.length }) }),
      el('p.pvzx-small', { text: L(TXT.likesDesc) }),
      el('div.pvzx-best', { text: L(TXT.reveals, { n: I.reveals() }) }),
    ]);
    if (!pending.length) box.appendChild(el('p.pvzx-mempty', { text: L(TXT.likesNone) }));
    var grid = el('div.pvzx-lgrid');
    pending.forEach(function (c) {
      var shown = !!I.round.revealed[c.code];
      grid.appendChild(
        el('div.pvzx-lcard' + (shown ? '' : '.pvzx-blur'), null, [
          el('img', { src: I.avatar(c), alt: '' }),
          shown ? el('b', { text: c.name }) : el('b', { text: '?' }),
          shown
            ? el('button.mp-btn.mp-small.mp-green', { text: L(TXT.seeNow), onclick: function () {
                var at = I.round.cards.indexOf(c);
                I.round.cards.splice(at, 1);
                I.round.cards.splice(I.round.i, 0, c);
                I.view.tab = 'discover';
                I.view.photo = 0;
                I.render();
              } })
            : el('button.mp-btn.mp-small.mp-blue', { text: L(TXT.reveal), disabled: !I.reveals(), onclick: function () {
                X.store.set('matchReveals', I.reveals() - 1);
                I.round.revealed[c.code] = true;
                I.render();
              } }),
        ]),
      );
    });
    box.appendChild(grid);
    box.addEventListener('wheel', function (e) {
      e.stopPropagation();
    });
    body.appendChild(box);
  };

  // Chats listed: this round's matches, then partners and unread messages.
  I.chatCodes = function chatCodes() {
    var ps = I.partners();
    var codes = I.round.matches.map(function (m) {
      return m.code;
    });
    Object.keys(I.chats)
      .filter(function (c) {
        return codes.indexOf(c) < 0 && I.chats[c].msgs.length && (ps[c] || I.chats[c].unread);
      })
      .sort(function (a, b) {
        return I.chats[b].at - I.chats[a].at;
      })
      .forEach(function (c) {
        codes.push(c);
      });
    return codes;
  };

  I.avatarNode = function avatarNode(p, animated) {
    return el('span.pvzx-mavatar.pvzx-fam-' + p.family.toLowerCase(), null, [animated && p.photos && p.photos.idle ? I.animImg(p.photos.idle) : el('img', { src: I.avatar(p), alt: '' })]);
  };

  I.hhmm = function hhmm(ms) {
    var d = new Date(ms);
    return ('0' + d.getHours()).slice(-2) + ':' + ('0' + d.getMinutes()).slice(-2);
  };

  I.dayLabel = function dayLabel(ms) {
    var d = new Date(ms);
    var key = d.toDateString();
    if (key === new Date().toDateString()) return L(TXT.today);
    if (key === new Date(Date.now() - 86400000).toDateString()) return L(TXT.yesterday);
    return d.toLocaleDateString(MP.lang === 'pt' ? 'pt-BR' : MP.lang === 'zh' ? 'zh-CN' : 'en-US');
  };

  // "typing…", "online" or "last seen today at 14:32" (ghosts: hours ago).
  I.statusLine = function statusLine(p, chat) {
    if (I.typing[p.code]) return L(TXT.typing);
    if (chat.s && chat.s.ghost) return L(TXT.seen, { n: 2 + p.distance });
    var r = I.partners()[p.code];
    var stage = r ? I.stageLabel(I.relStage(r)) + ' · ' : '';
    if (I.isOnline(p.code)) return stage + t('match_online');
    var last = 0;
    chat.msgs.forEach(function (m) {
      if (m.from === 'them' && m.t) last = m.t;
    });
    if (!last) return stage + p.world;
    return stage + L(TXT.lastSeen, { day: I.dayLabel(last).toLowerCase(), time: I.hhmm(last) });
  };

  I.messagesTab = function messagesTab(body) {
    if (I.view.msgSub === 'players') {
      if (I.pm.chat) I.playerChat(body, I.pm.chat);
      else I.playersView(body);
      return;
    }
    var p = I.view.chat;
    var ps = I.partners();
    if (!p) {
      body.appendChild(I.subSwitch());
      var list = el('div.pvzx-mlist');
      var codes = I.chatCodes();
      if (!codes.length) list.appendChild(el('p.pvzx-mempty', { text: L(TXT.msgsEmpty) }));
      codes.forEach(function (code) {
        var m = I.prof(code);
        if (!m) return;
        var c = I.chats[code];
        var last = c && c.msgs[c.msgs.length - 1];
        var r = ps[code];
        list.appendChild(
          el('button.pvzx-mrow' + (c && c.unread ? '.pvzx-unread' : ''), { onclick: function () {
            I.view.chat = m;
            if (c) c.unread = false;
            I.saveChats();
            I.queuePhotos();
            I.render();
          } }, [
            I.avatarNode(m),
            I.isOnline(code) ? el('i.pvzx-dot') : null,
            el('span.pvzx-mrow-text', null, [
              el('b', { text: m.name + (r ? ' ' + STAGES[I.relStage(r)].icon : '') }),
              el('span', { text: last ? (last.from === 'me' ? '↪ ' : '') + last.text : L(TXT.newMatch) }),
            ]),
            el('span.pvzx-mrow-aff', null, [
              last && last.t ? el('small', { text: I.dayLabel(last.t) === L(TXT.today) ? I.hhmm(last.t) : I.dayLabel(last.t) }) : null,
              el('span', { text: I.typing[code] ? '✍️' : c && c.s ? (c.s.ghost ? '👻' : I.affinityHearts(c.s.affinity)) : '' }),
            ]),
          ]),
        );
      });
      list.addEventListener('wheel', function (e) {
        e.stopPropagation();
      });
      body.appendChild(list);
      return;
    }
    var chat = I.getChat(p.code);
    var s = chat.s;
    var r = ps[p.code];
    var head = el('div.pvzx-chat-head', null, [
      el('button.pvzx-x', { text: '←', onclick: function () {
        I.view.chat = null;
        I.render();
      } }),
      I.avatarNode(p, true),
      el('span.pvzx-mrow-text', null, [
        el('b', { text: p.name }),
        el('span.pvzx-status' + (I.typing[p.code] ? '.pvzx-typing-now' : I.isOnline(p.code) ? '.pvzx-online' : ''), { text: I.statusLine(p, chat) }),
      ]),
      el('button.pvzx-chip.pvzx-chip-btn', { text: L(TXT.viewProfile), onclick: function () {
        I.view.viewing = p;
        I.view.tab = 'discover';
        I.render();
      } }),
    ]);
    var log = el('div.pvzx-chat-log');
    var lastDay = '';
    chat.msgs.forEach(function (m) {
      var day = m.t ? I.dayLabel(m.t) : '';
      if (day && day !== lastDay) log.appendChild(el('div.pvzx-day', { text: day }));
      if (day) lastDay = day;
      var meta = m.t && m.from !== 'sys' ? el('small.pvzx-time', { text: I.hhmm(m.t) }, m.from === 'me' ? [el('i' + (m.r ? '.pvzx-read' : ''), { text: m.r ? ' ✓✓' : ' ✓' })] : []) : null;
      log.appendChild(el('div.pvzx-bubble.pvzx-from-' + m.from + (m.k === 'sticker' ? '.pvzx-sticker' : ''), null, [m.text, meta]));
    });
    if (I.typing[p.code]) log.appendChild(el('div.pvzx-bubble.pvzx-from-them.pvzx-typing', { text: L(TXT.typing) }));
    if (!I.inRound(p) && !r) log.appendChild(el('div.pvzx-bubble.pvzx-from-sys', { text: L(TXT.noChatHere) }));
    log.addEventListener('wheel', function (e) {
      e.stopPropagation();
    });
    var opts = el(
      'div.pvzx-chat-opts',
      null,
      I.chatOptions(p, chat).map(function (o) {
        return el('button.pvzx-chat-opt', { text: I.gfix(o.text, p.gender), onclick: function () {
          I.reply(p, o);
        } });
      }),
    );
    var stickers =
      s && !s.sticker && !s.ghost && !s.done && !I.busy(p.code) && I.inRound(p)
        ? el(
            'div.pvzx-stickers',
            { title: L(TXT.stickerTip) },
            CHAT.stickers.map(function (e) {
              return el('button', { text: e, title: L(TXT.stickerTip), onclick: function () {
                I.sendSticker(p, e);
              } });
            }),
          )
        : null;
    var foot;
    if (r) {
      foot = el('div.pvzx-chat-foot', null, [
        el('span', { text: I.stageLabel(I.relStage(r)) }),
        el('span.pvzx-pbtns', null, I.giftButtons(p.code, r).concat([
          el('button.mp-btn.mp-small.mp-green', { text: L(TXT.dateBtn), onclick: function () {
            I.openDates(p);
          } }),
        ])),
      ]);
    } else if (s) {
      foot = el('div.pvzx-chat-foot', null, [
        el('span', { text: L(TXT.affinity) + ': ' + I.affinityHearts(s.affinity) + (s.affinity ? ' (+' + s.affinity * 25 + ' ☀)' : '') }),
        el('button.mp-btn.mp-small.mp-green', { text: L(TXT.invite), title: L(TXT.inviteDesc, { name: p.name }), onclick: function () {
          I.openDates(p);
        } }),
      ]);
    }
    body.appendChild(el('div.pvzx-chat', null, [head, log, stickers, opts, foot]));
    setTimeout(function () {
      log.scrollTop = log.scrollHeight;
    }, 0);
    if (chat.unread) {
      chat.unread = false;
      I.saveChats();
    }
  };

  I.giftButtons = function giftButtons(code, r) {
    return [
      el('button.mp-btn.mp-small.mp-blue', { text: '💧', title: L(TXT.giftWater) + ': ' + L(TXT.giftWaterDesc), disabled: I.giftDone(r, 'water'), onclick: function () {
        I.gift(code, 'water');
      } }),
      el('button.mp-btn.mp-small.mp-brown', { text: '🍫', title: L(TXT.giftChoc) + ': ' + L(TXT.giftChocDesc), disabled: I.giftDone(r, 'choc') || I.likesLeft() < 5, onclick: function () {
        I.gift(code, 'choc');
      } }),
    ];
  };


  /* ---------------------------------------------------------- partners */

  I.relationBox = function relationBox(p) {
    var r = I.partners()[p.code];
    if (!r) return null;
    var st = I.relStage(r);
    return el('div.pvzx-msec', null, [el('h4', { text: L(TXT.tabPartners) }), I.relationInfo(r, st)]);
  };

  I.relationInfo = function relationInfo(r, st) {
    var next = st < 2 ? I.STAGE_XP[st + 1] : 0;
    var pct = st >= 2 ? 100 : Math.max(0, Math.min(100, ((r.xp - I.STAGE_XP[st]) / (next - I.STAGE_XP[st])) * 100));
    return el('div.pvzx-rel', null, [
      el('span', { text: I.stageLabel(st) + ' · ' + L(TXT.stageBonus, { txt: L(STAGES[st].bonus) }) }),
      el('div.pvzx-xp', null, [el('i', { style: 'width:' + pct + '%' })]),
      el('small', { text: st === 3 ? L(TXT.xpMax) : st === 2 ? L(TXT.xpWedding) : L(TXT.xpNext, { xp: r.xp, next: next, stage: L(STAGES[st + 1].name) }) }),
    ]);
  };

  I.partnersTab = function partnersTab(body) {
    var ps = I.partners();
    var codes = Object.keys(ps).sort(function (a, b) {
      return I.relStage(ps[b]) - I.relStage(ps[a]) || ps[b].xp - ps[a].xp;
    });
    var gf = X.store.get('matchGiftFood', 0);
    var box = el('div.pvzx-mlikes', null, [
      el('h3', { text: '💍 ' + L(TXT.partnersTitle) }),
      el('p.pvzx-small', { text: L(TXT.partnersDesc) }),
      el('p.pvzx-small', { text: I.cloudOn() ? L(TXT.synced) : L(TXT.localOnly) }),
      codes.length ? el('div.pvzx-best', { text: L(TXT.relPoints, { n: I.couplePoints(ps) }) + (gf ? ' · ' + L(TXT.giftPending, { n: gf }) : '') }) : null,
    ]);
    if (!codes.length) box.appendChild(el('p.pvzx-mempty', { text: L(TXT.partnersNone) }));
    codes.forEach(function (code) {
      var p = I.prof(code);
      if (!p) return;
      var r = ps[code];
      var st = I.relStage(r);
      var dates = Object.keys(r.dates)
        .map(function (id) {
          var dt = I.DATE_TYPES.find(function (d) {
            return d.id === id;
          });
          return dt ? dt.icon + ' ' + I.starsText(r.dates[id]) : '';
        })
        .join('  ');
      box.appendChild(
        el('div.pvzx-prow', null, [
          I.avatarNode(p),
          el('div.pvzx-prow-info', null, [
            el('b', { text: p.name }),
            I.relationInfo(r, st),
            el('small', { text: L(TXT.since, { d: new Date(r.since).toLocaleDateString() }) + (dates ? ' · ' + dates : '') }),
            el('div.pvzx-pbtns', null, I.giftButtons(code, r).concat([
              el('button.mp-btn.mp-small.mp-blue', { text: L(TXT.chatBtn), onclick: function () {
                I.view.tab = 'messages';
                I.view.chat = p;
                I.render();
              } }),
              el('button.mp-btn.mp-small.mp-green', { text: L(TXT.dateBtn), onclick: function () {
                I.openDates(p);
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
  };


  I.TABS = [
    ['discover', '🔥', TXT.tabDiscover],
    ['messages', '💬', TXT.tabMessages],
    ['likes', '💛', TXT.tabLikes],
    ['partners', '💍', TXT.tabPartners],
    ['social', '🌍', TXT.tabSocial],
  ];

  I.render = function render() {
    if (!I.node) return;
    // Keep the field being typed in (inputs with data-keep) across renders.
    var act = document.activeElement;
    var keep = act && I.node.contains(act) && act.getAttribute('data-keep');
    I.node.querySelectorAll('.pvzx-mcard').forEach(function (c) {
      if (c._cleanup) c._cleanup();
    });
    var phone = el('div.pvzx-phone');
    phone.appendChild(
      el('div.pvzx-phone-head', null, [
        el('button.pvzx-x', { text: '×', title: t('close'), onclick: M.close }),
        el('b', { text: '🔥 ' + t('mode_match') }),
        el('button.pvzx-gear', { text: '⚙', title: t('match_prefs'), onclick: function () {
          I.view.tab = 'discover';
          I.view.prefs = !I.view.prefs;
          I.view.viewing = null;
          I.render();
        } }),
        el('span.pvzx-phone-count', { text: t('match_count', { n: I.round.matches.length, max: SLOTS, left: Math.max(0, I.round.cards.length - I.round.i) }) }),
      ]),
    );
    var body = el('div.pvzx-mbody');
    ({ discover: I.discoverTab, messages: I.messagesTab, likes: I.likesTab, partners: I.partnersTab, social: I.socialTab }[I.view.tab] || I.discoverTab)(body);
    if (I.view.datePick) body.appendChild(I.datePicker(I.view.datePick));
    phone.appendChild(body);
    var b = I.levelBonus();
    phone.appendChild(
      el('div.pvzx-mfoot', null, [
        el('button.mp-btn.mp-green', { text: t('match_play', { n: I.round.matches.length }), title: L(TXT.bonus, b), disabled: !I.round.matches.length, onclick: I.play }),
        el('button.mp-btn.mp-small.mp-brown', { text: t('match_restart'), onclick: function () {
          I.newRound();
          I.render();
        } }),
      ]),
    );
    if (b.sun || b.food) phone.appendChild(el('div.pvzx-mbonus', { text: L(TXT.bonus, b) }));
    var unread =
      I.chatCodes().filter(function (c) {
        return I.chats[c] && I.chats[c].unread;
      }).length + I.pmUnread();
    var likesPending = I.round.cards.slice(I.round.i).filter(function (c) {
      return c.likedYou;
    }).length;
    phone.appendChild(
      el(
        'div.pvzx-mtabs',
        null,
        I.TABS.map(function (tb) {
          var count = tb[0] === 'messages' ? unread : tb[0] === 'likes' ? likesPending : 0;
          return el('button.pvzx-mtab' + (I.view.tab === tb[0] ? '.pvzx-on' : ''), { onclick: function () {
            I.view.tab = tb[0];
            I.view.prefs = false;
            I.view.viewing = null;
            I.view.chat = null;
            I.view.datePick = null;
            I.render();
          } }, [el('span', { text: tb[1] }), el('small', { text: L(tb[2]) }), count ? el('i', { text: String(count) }) : null]);
        }),
      ),
    );
    I.node.replaceChildren(phone);
    if (keep) {
      var again = I.node.querySelector('[data-keep="' + keep + '"]');
      if (again) {
        again.focus();
        try {
          again.setSelectionRange(again.value.length, again.value.length);
        } catch (e) {}
      }
    }
  };

  I.LINES = ['match_line1', 'match_line2', 'match_line3', 'match_line4', 'match_line5', 'match_line6'];

  I.showMatch = function showMatch(p) {
    I.render();
    var line = t(I.LINES[Math.floor(Math.random() * I.LINES.length)], { name: p.name });
    var pic = p.photos && p.photos.idle ? I.animImg(p.photos.idle) : el('img', { src: p.packet, alt: '' });
    var box = el('div.pvzx-itsmatch', null, [
      el('div.pvzx-itsmatch-title', { text: t('match_its') }),
      el('div.pvzx-itsmatch-pair', null, [el('div.pvzx-itsmatch-pic', null, [pic]), el('span', { text: '💘' }), el('div.pvzx-itsmatch-you', { text: '🧑‍🌾' })]),
      el('div.pvzx-itsmatch-msg', null, [el('b', { text: p.name + ': ' }), line]),
      el('div.pvzx-itsmatch-sub', { text: t('match_count', { n: I.round.matches.length, max: SLOTS, left: Math.max(0, I.round.cards.length - I.round.i) }) }),
      el('div.pvzx-file-actions', null, [
        el('button.mp-btn.mp-blue', { text: '💬 ' + L(TXT.tabMessages), onclick: function () {
          I.view.tab = 'messages';
          I.view.chat = p;
          I.getChat(p.code).unread = false;
          I.render();
        } }),
        el('button.mp-btn.mp-green', { text: t('match_keep'), onclick: function () {
          box.remove();
        } }),
      ]),
    ]);
    I.node.querySelector('.pvzx-phone').appendChild(box);
    G.play('playCardChosen');
  };

  I.onKey = function onKey(e) {
    if (!I.node) return;
    var k = e.key;
    var p = I.current();
    var disc = I.view.tab === 'discover' && !I.view.prefs && !I.view.viewing && !I.view.datePick;
    if (k === 'ArrowLeft' && disc) I.decide('nope');
    else if (k === 'ArrowRight' && disc) I.decide('like');
    else if (k === 'ArrowUp' && disc) I.decide('super');
    else if (k === 'Backspace' && disc) I.undo();
    else if (k === ' ' && p && disc) {
      I.view.photo = (I.view.photo + 1) % I.photoList(p).length;
      I.render();
    } else if (k === 'Enter' && p && disc) {
      I.view.expanded = !I.view.expanded;
      I.render();
    } else if (k === 'Escape') {
      if (I.view.datePick) {
        I.view.datePick = null;
        I.render();
      } else if (I.view.tab === 'messages' && I.view.msgSub === 'players' && (I.pm.chat || I.pm.viewing || I.pm.editing)) {
        I.pm.chat = null;
        I.pm.viewing = null;
        I.pm.editing = false;
        I.render();
      } else if (I.view.viewing || I.view.prefs || I.view.chat) {
        I.view.viewing = null;
        I.view.prefs = false;
        I.view.chat = null;
        I.render();
      } else M.close();
    } else return;
    e.preventDefault();
    e.stopPropagation();
  };

  M.open = function () {
    if (X.online()) return;
    if (X.ui) X.ui.close();
    var go = function () {
      if (!I.node) {
        I.node = el('div#pvzx-match');
        ['mousedown', 'wheel', 'click'].forEach(function (type) {
          I.node.addEventListener(type, function (e) {
            e.stopPropagation();
          });
        });
        (document.getElementById('pvzmp-root') || document.body).appendChild(I.node);
        window.addEventListener('keydown', I.onKey, true);
        document.body.classList.add('pvzx-open');
      }
      if (!I.round || (I.round.i >= I.round.cards.length && !I.round.matches.length)) I.newRound();
      I.view.viewing = null;
      I.view.prefs = false;
      I.render();
      I.queuePhotos();
      I.dailyCheck();
      I.pullState();
    };
    if (MP.cards && !MP.cards.ready) MP.cards.load().then(go);
    else go();
  };

  M.close = function () {
    if (I.node) {
      I.node.querySelectorAll('.pvzx-mcard').forEach(function (c) {
        if (c._cleanup) c._cleanup();
      });
      I.node.remove();
    }
    I.node = null;
    window.removeEventListener('keydown', I.onKey, true);
    document.body.classList.remove('pvzx-open');
    if (I.cam && I.cam.root.isValid) I.cam.root.destroy();
    I.cam = null;
    I.view.datePick = null;
    I.flushStats();
    I.pushState();
  };
})();
