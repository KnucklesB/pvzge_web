/*
 * PvZ2 Gardendless - Plant Match: chats and relationships
 *
 * Chats kept between rounds, personalities, questions, stickers,
 * relationship stages, gifts and jealousy.
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

  /* -------------------------------------------------------------- chat */

  // Chats are kept between rounds (memory, partners' messages): {code:
  // {msgs: [{from, text, k}], unread, at, s: session of this round, mem}}.
  I.chats = X.store.get('matchChats', {});
  I.MAX_CHATS = 40;
  I.MAX_MSGS = 60;

  I.saveChats = function saveChats() {
    var codes = Object.keys(I.chats);
    if (codes.length > I.MAX_CHATS) {
      var ps = I.partners();
      codes
        .filter(function (c) {
          return !ps[c] && !(I.round && I.round.matches.some(function (m) {
            return m.code === c;
          }));
        })
        .sort(function (a, b) {
          return I.chats[a].at - I.chats[b].at;
        })
        .slice(0, codes.length - I.MAX_CHATS)
        .forEach(function (c) {
          delete I.chats[c];
        });
    }
    Object.keys(I.chats).forEach(function (c) {
      var ch = I.chats[c];
      if (ch.msgs.length > I.MAX_MSGS) {
        var cut = ch.msgs.length - I.MAX_MSGS;
        ch.msgs = ch.msgs.slice(cut);
        if (ch.s) ch.s.start = Math.max(0, ch.s.start - cut);
      }
    });
    X.store.set('matchChats', I.chats);
  };

  I.getChat = function getChat(code) {
    var c = I.chats[code];
    if (!c) c = I.chats[code] = { msgs: [], unread: false, at: Date.now(), s: null, mem: { sessions: 0, wins: 0, levels: 0 } };
    return c;
  };

  I.viewingChat = function viewingChat(code) {
    return !!(I.node && I.view.tab === 'messages' && I.view.chat && I.view.chat.code === code);
  };

  I.pushMsg = function pushMsg(code, from, text, kind) {
    var c = I.getChat(code);
    var m = { from: from, text: text, t: Date.now() };
    if (kind) m.k = kind;
    c.msgs.push(m);
    if (from !== 'me' && !I.viewingChat(code)) {
      c.unread = true;
      if (from === 'them') I.notify(code, text);
    }
    c.at = Date.now();
    I.saveChats();
  };

  I.persOf = function persOf(p) {
    return PERS[p.pers] || PERS.sweet;
  };

  I.startChat = function startChat(p) {
    var c = I.getChat(p.code);
    var mem = c.mem;
    var start = c.msgs.length;
    if (c.msgs.length) c.msgs.push({ from: 'sys', text: L(TXT.newSession) });
    var text;
    if (mem.sessions && mem.ghosted) text = Lp(CHAT.againGhost);
    else if (mem.sessions && mem.wins) text = Lp(CHAT.againWins, { wins: mem.wins });
    else if (mem.sessions && mem.role && CHAT.roles[mem.role]) text = Lp(CHAT.again, { role: L(CHAT.roles[mem.role]) });
    else if (mem.sessions) text = Lp(CHAT.again, { role: L(CHAT.roles.sun) });
    else text = Math.random() < 0.6 ? Lp(I.persOf(p).openers) : Lp(CHAT.openers, { like: (p.likes[0] || '').toLowerCase() });
    mem.sessions++;
    mem.ghosted = false;
    c.s = { id: Date.now(), step: 1, affinity: 0, ghost: false, done: false, sticker: false, start: start, q2: null };
    I.pushMsg(p.code, 'them', text);
    c.unread = true;
  };

  // Undo / unmatch: the session of this round disappears.
  I.dropChat = function dropChat(code) {
    var c = I.chats[code];
    if (!c || !c.s) return;
    c.msgs.length = Math.min(c.msgs.length, c.s.start);
    var id = c.s.id;
    I.queue = I.queue.filter(function (q) {
      return !(q.code === code && q.sess === id);
    });
    I.saveQueue();
    c.s = null;
    c.mem.sessions = Math.max(0, c.mem.sessions - 1);
    c.unread = false;
    I.saveChats();
  };

  I.WORLD_LIST = ['frontyard', 'egypt', 'pirate', 'cowboy', 'kongfu', 'future', 'dark', 'beach', 'iceage', 'lostcity', 'eighties', 'dino', 'sky'];

  I.otherWorlds = function otherWorlds(p, n) {
    return shuffle(
      I.WORLD_LIST.map(function (w) {
        return t('world_' + w);
      }).filter(function (name) {
        return name !== p.world && name.indexOf('world_') !== 0;
      }),
    ).slice(0, n);
  };

  I.otherLikes = function otherLikes(p, n) {
    return shuffle(
      M.FAMILIES.filter(function (f) {
        return f !== p.family && f !== 'Nope';
      }),
    )
      .slice(0, n)
      .map(function (f) {
        return t('family_' + f.toLowerCase() + '_likes').split('|')[0];
      });
  };

  // Exchange 2: a question about the plant (role, world, interests, price).
  I.makeQ2 = function makeQ2(p) {
    var types = ['role', 'role', 'like', 'cost'];
    if (p.world !== t('match_world_other')) types.push('world');
    var type = pick(types);
    var opts;
    var ask;
    if (type === 'role') {
      var right = I.mainRole(p);
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
        I.otherWorlds(p, 2).map(function (w) {
          return { q: 'meh', text: w };
        }),
      );
    } else if (type === 'like') {
      ask = L(CHAT.q.like.ask);
      opts = [{ q: 'good', text: p.likes[0] || '?' }].concat(
        I.otherLikes(p, 2).map(function (x) {
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
  };

  I.chatOptions = function chatOptions(p, c) {
    var s = c.s;
    if (I.busy(p.code)) return [];
    if (!s || s.done || s.ghost || !I.inRound(p)) return I.dailyOptions(p.code);
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
      if (!s.q2) s.q2 = I.makeQ2(p);
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
  };

  I.inRound = function inRound(p) {
    return !!(I.round && I.round.matches.some(function (m) {
      return m.code === p.code;
    }));
  };

  I.reactionTo = function reactionTo(p, s, opt) {
    var pers = I.persOf(p);
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
  };

  I.reply = function reply(p, opt) {
    if (opt.daily) return I.replyDaily(p, opt);
    var c = I.getChat(p.code);
    var s = c.s;
    if (!s || I.busy(p.code)) return;
    I.pushMsg(p.code, 'me', opt.text);
    if (opt.q === 'good') s.affinity = Math.min(3, s.affinity + 1);
    if (opt.role) c.mem.role = opt.key;
    I.saveChats();
    I.enqueue(p.code, 'reply', { q: opt.q, role: !!opt.role, key: opt.key || '' }, I.replyTimes(p.code, 'x'.repeat(45)), s.id);
    I.render();
  };

  // The plant's answer, when it arrives (see the queue below).
  I.answer = function answer(p, c, opt) {
    var s = c.s;
    var reaction = I.reactionTo(p, s, opt);
    // Some plants ghost after a bad first reply (or just because).
    if (s.step === 1 && Math.random() < (opt.q === 'bad' ? I.persOf(p).ghost : 0.05)) {
      s.ghost = true;
      c.mem.ghosted = true;
      c.onlineUntil = 0;
      I.pushMsg(p.code, 'sys', L(TXT.ghosted, { name: p.name }));
      return;
    }
    I.pushMsg(p.code, 'them', reaction);
    s.step++;
    var next;
    if (s.step === 2) {
      s.q2 = I.makeQ2(p);
      next = s.q2.ask;
    } else if (s.step === 3) next = L(CHAT.r3q);
    else {
      s.done = true;
      next = L(CHAT.end[Math.min(3, s.affinity)]);
      if (s.affinity >= 3) I.unlock(['match_chat']);
    }
    // The follow-up comes as a second message, typed after the first.
    I.enqueue(p.code, 'msg', { text: next, follow: true }, [0, 200, Math.min(3500, 800 + next.length * 30)]);
  };

  I.sendSticker = function sendSticker(p, emoji) {
    var c = I.getChat(p.code);
    var s = c.s;
    if (!s || s.sticker || s.ghost || I.busy(p.code)) return;
    s.sticker = true;
    I.pushMsg(p.code, 'me', emoji, 'sticker');
    I.enqueue(p.code, 'sticker', { emoji: emoji }, I.replyTimes(p.code, 'xxxxxxxxxx'), s.id);
    I.render();
  };

  I.answerSticker = function answerSticker(p, c, data) {
    if (data.emoji === I.persOf(p).sticker) {
      c.s.affinity = Math.min(3, c.s.affinity + 1);
      I.pushMsg(p.code, 'them', Lp(CHAT.stickerLove));
    } else I.pushMsg(p.code, 'them', Lp(CHAT.stickerMeh));
  };

  /* ----------------------------------------------- messages in real time */

  // Replies and messages are queued with real times: the plant reads (✓✓),
  // types for a while (longer messages, longer typing) and answers; offline
  // plants take longer. The queue is kept, so messages also arrive with the
  // phone closed (a notification on the menu) or after a reload.
  // matchQueue: [{id, code, due, readAt, typeAt, kind, data, sess}]
  I.queue = X.store.get('matchQueue', []);
  I.typing = {};

  I.saveQueue = function saveQueue() {
    X.store.set('matchQueue', I.queue);
  };

  I.isOnline = function isOnline(code) {
    var c = I.chats[code];
    if (c && c.onlineUntil > Date.now()) return true;
    var p = I.profCache[code] || (I.round && I.round.cards.find(function (x) {
      return x.code === code;
    }));
    return !!(p && p.online && !(c && c.onlineUntil));
  };

  // Times of a reply of this length: [read, start typing, sent] from now.
  I.replyTimes = function replyTimes(code, text) {
    var online = I.isOnline(code);
    var read = online ? 600 + Math.random() * 1200 : 5000 + Math.random() * 12000;
    var think = 300 + Math.random() * 900;
    var type = Math.min(4000, 700 + String(text || '').length * 35);
    return [read, read + think, read + think + type];
  };

  I.enqueue = function enqueue(code, kind, data, times, sess) {
    var now = Date.now();
    I.queue.push({ id: now + '-' + Math.random().toString(36).slice(2, 7), code: code, kind: kind, data: data, readAt: now + times[0], typeAt: now + times[1], due: now + times[2], sess: sess || 0 });
    I.saveQueue();
  };

  // A message from the plant later on (after levels, jealousy, greetings).
  I.later = function later(code, text, delay, kind, from) {
    var d = delay == null ? 2000 + Math.random() * 6000 : delay;
    var type = from === 'sys' ? 0 : Math.min(4000, 700 + String(text || '').length * 35);
    I.enqueue(code, 'msg', { text: text, k: kind || '', from: from || 'them' }, [Math.max(0, d - type - 300), Math.max(0, d - type), d]);
  };

  // Waiting for this plant's answer (no options meanwhile).
  I.busy = function busy(code) {
    return I.queue.some(function (q) {
      return q.code === code && (q.kind === 'reply' || q.kind === 'sticker' || q.kind === 'daily' || (q.kind === 'msg' && (q.data.follow || q.data.k === 'daily')));
    });
  };

  I.markRead = function markRead(code) {
    var c = I.chats[code];
    if (!c) return;
    for (var i = c.msgs.length - 1; i >= 0 && c.msgs[i].from !== 'them'; i--) {
      if (c.msgs[i].from === 'me') c.msgs[i].r = 1;
    }
  };

  I.tick = function tick() {
    var now = Date.now();
    var changed = false;
    var typing = {};
    var due = [];
    I.queue.forEach(function (q) {
      if (now >= q.readAt && !q.read) {
        q.read = true;
        I.markRead(q.code);
        changed = true;
      }
      if (now >= q.typeAt && now < q.due) typing[q.code] = true;
      if (now >= q.due) due.push(q);
    });
    if (Object.keys(typing).join() !== Object.keys(I.typing).join()) changed = true;
    I.typing = typing;
    if (due.length) {
      I.queue = I.queue.filter(function (q) {
        return due.indexOf(q) < 0;
      });
      I.saveQueue();
      due.forEach(I.deliver);
      I.saveChats();
      changed = true;
    }
    if (changed && I.node && I.view.tab === 'messages') I.render();
    else if (due.length && I.node) I.render();
  };

  I.deliver = function deliver(q) {
    var c = I.getChat(q.code);
    c.onlineUntil = Date.now() + 120000;
    I.markRead(q.code);
    if (q.kind === 'msg') {
      I.pushMsg(q.code, q.data.from || 'them', q.data.text, q.data.k);
      return;
    }
    // Answers need the plant's profile (personality): before the plant
    // cards are loaded, try again a bit later.
    var p = MP.cards && MP.cards.ready ? I.prof(q.code) : null;
    if (!p) {
      q.due = Date.now() + 2000;
      I.queue.push(q);
      I.saveQueue();
      return;
    }
    if (q.kind === 'reply') {
      if (c.s && c.s.id === q.sess) I.answer(p, c, q.data);
    } else if (q.kind === 'sticker') {
      if (c.s && c.s.id === q.sess) I.answerSticker(p, c, q.data);
    } else if (q.kind === 'daily') I.answerDaily(p, c, q.data);
  };

  setInterval(function () {
    try {
      I.tick();
    } catch (e) {
      MP.warn('match tick', e);
    }
  }, 1000);

  // Notifications for messages arriving while their chat is not open: one
  // toast for a burst, on the menu (not in the middle of a level).
  I.notes = [];
  I.notify = function notify(code, text) {
    I.notes.push({ code: code, text: text });
    clearTimeout(I.noteTimer);
    I.noteTimer = setTimeout(function () {
      var list = I.notes;
      I.notes = [];
      if (!list.length || !MP.ui || G.sceneName() === 'inGameScene') return;
      var msg = list.length === 1 ? L(TXT.notify, { name: X.plantName(list[0].code), text: list[0].text }) : L(TXT.newMsgs, { n: list.length });
      MP.ui.toast(msg, 'good');
      if (M.onUnread) M.onUnread(M.unread());
    }, 1200);
  };

  // Unread chats (for the menu badge).
  M.unread = function () {
    var ps = I.partners();
    return Object.keys(I.chats).filter(function (c) {
      return I.chats[c].unread && (ps[c] || I.inRound({ code: c }) || I.chats[c].msgs.length);
    }).length;
  };

  /* --------------------------------------------- partners: daily check-in */

  I.partOfDay = function partOfDay() {
    var h = new Date().getHours();
    return h < 5 ? 'night' : h < 12 ? 'morning' : h < 18 ? 'afternoon' : 'night';
  };

  // Once a day each partner says hi and asks something; a good answer is
  // worth a relationship point.
  I.dailyCheck = function dailyCheck() {
    var ps = I.partners();
    var day = today();
    Object.keys(ps).forEach(function (code, i) {
      var c = I.getChat(code);
      if (c.daily && c.daily.day === day) return;
      var qi = Math.floor(Math.random() * CHAT.daily.length);
      c.daily = { day: day, qi: qi, answered: false, ready: false, order: shuffle([0, 1, 2]) };
      var wait = 2500 + i * 4000 + Math.random() * 3000;
      I.later(code, Lp(CHAT.greet[I.partOfDay()]), wait);
      I.enqueue(code, 'msg', { text: L(CHAT.daily[qi].q), k: 'daily' }, [wait + 500, wait + 1500, wait + 3500]);
    });
    I.saveChats();
  };

  I.dailyOptions = function dailyOptions(code) {
    var c = I.chats[code];
    if (!c || !c.daily || c.daily.answered || c.daily.day !== today() || I.busy(code)) return [];
    var asked = c.msgs.some(function (m) {
      return m.k === 'daily' && m.t && new Date(m.t).toISOString().slice(0, 10) === c.daily.day;
    });
    if (!asked) return [];
    var d = CHAT.daily[c.daily.qi];
    return c.daily.order.map(function (i) {
      return { q: d.a[i].q, text: L(d.a[i]), daily: true };
    });
  };

  I.replyDaily = function replyDaily(p, opt) {
    var c = I.getChat(p.code);
    if (!c.daily || c.daily.answered) return;
    c.daily.answered = true;
    I.pushMsg(p.code, 'me', opt.text);
    I.enqueue(p.code, 'daily', { q: opt.q }, I.replyTimes(p.code, 'x'.repeat(30)));
    I.render();
  };

  I.answerDaily = function answerDaily(p, c, data) {
    var pers = I.persOf(p);
    var r = I.partners()[p.code];
    if (data.q === 'good') {
      I.pushMsg(p.code, 'them', Lp(pers.good));
      if (r) I.addXp(p.code, 1);
    } else if (data.q === 'bad') {
      I.pushMsg(p.code, 'them', Lp(pers.bad));
      if (r && I.relStage(r) >= 1) I.addXp(p.code, -1);
    } else I.pushMsg(p.code, 'them', Lp(CHAT.react.meh));
  };

  I.affinityHearts = function affinityHearts(n) {
    return '❤'.repeat(n) + '♡'.repeat(Math.max(0, 3 - n));
  };

  I.unlock = function unlock(ids) {
    if (X.achievements && X.achievements.unlockExtra) X.achievements.unlockExtra(ids);
  };

  /* ------------------------------------------------------ relationships */

  // Stage: 0 seeing each other, 1 dating (3 xp), 2 engaged (8 xp), 3 married
  // (won the wedding date). Bonus each partner brings in the team.
  I.STAGE_XP = [0, 3, 8];
  I.STAGE_BONUS = [
    { sun: 25, food: 0 },
    { sun: 0, food: 1 },
    { sun: 50, food: 1 },
    { sun: 100, food: 2 },
  ];

  I.relStage = function relStage(r) {
    return r.married ? 3 : r.xp >= I.STAGE_XP[2] ? 2 : r.xp >= I.STAGE_XP[1] ? 1 : 0;
  };

  I.stageLabel = function stageLabel(i) {
    return STAGES[i].icon + ' ' + L(STAGES[i].name);
  };

  I.couplePoints = function couplePoints(ps) {
    return Object.keys(ps).reduce(function (n, c) {
      return n + Math.max(0, ps[c].xp) + (ps[c].married ? 10 : 0);
    }, 0);
  };

  I.savePartners = function savePartners(ps) {
    X.store.set('matchPartners', ps);
    I.refreshPartnerFlags(ps);
  };

  I.refreshPartnerFlags = function refreshPartnerFlags(ps) {
    var list = (I.round ? I.round.cards : []).concat(
      Object.keys(I.profCache).map(function (k) {
        return I.profCache[k];
      }),
    );
    list.forEach(function (p) {
      if (p) p.partner = !!ps[p.code];
    });
  };

  I.stageMessages = function stageMessages(code, before, after) {
    if (after <= before) return;
    I.pushMsg(code, 'them', L(CHAT.relUp[after]));
    I.pushMsg(code, 'sys', L(TXT.relUp, { icon: STAGES[after].icon, stage: L(STAGES[after].name) }));
    if (MP.ui) MP.ui.toast(X.plantName(code) + ': ' + I.stageLabel(after), 'good');
  };

  // Relationship points: dates, gifts, levels together; jealousy takes them
  // away, and a partner (not married) below 0 breaks up.
  I.addXp = function addXp(code, n) {
    var ps = I.partners();
    var r = ps[code];
    if (!r) return;
    var before = I.relStage(r);
    r.xp += n;
    if (r.xp < 0 && !r.married) {
      delete ps[code];
      I.savePartners(ps);
      I.pushMsg(code, 'them', L(CHAT.breakup));
      I.pushMsg(code, 'sys', L(TXT.breakup, { name: X.plantName(code) }));
      if (MP.ui) MP.ui.toast(L(TXT.breakup, { name: X.plantName(code) }), 'bad');
      return;
    }
    if (r.xp < 0) r.xp = 0;
    I.savePartners(ps);
    I.stageMessages(code, before, I.relStage(r));
  };

  I.giftDone = function giftDone(r, kind) {
    return !!(r.gifts && r.gifts[kind] === today());
  };

  I.gift = function gift(code, kind) {
    var ps = I.partners();
    var r = ps[code];
    if (!r || I.giftDone(r, kind)) return;
    if (kind === 'choc') {
      if (I.likesLeft() < 5) return;
      I.useLike(5);
    }
    r.gifts = r.gifts || {};
    r.gifts[kind] = today();
    X.store.set('matchPartners', ps);
    I.pushMsg(code, 'me', kind === 'water' ? '💧' : '🍫', 'sticker');
    I.later(code, Lp(CHAT.giftThanks), 1500 + Math.random() * 2500);
    I.addXp(code, kind === 'water' ? 1 : 2);
    if (ps[code] && Math.random() < 0.3) {
      var name = X.plantName(code);
      if (Math.random() < 0.5 && X.store.get('matchGiftFood', 0) < 3) {
        X.store.set('matchGiftFood', X.store.get('matchGiftFood', 0) + 1);
        I.later(code, L(CHAT.giftBackFood), 5000 + Math.random() * 4000);
        if (MP.ui) MP.ui.toast(L(TXT.giftFood, { name: name }), 'good');
      } else {
        var st = I.likesState();
        st.bonus += 5;
        X.store.set('matchLikes', st);
        I.later(code, L(CHAT.giftBackLikes), 5000 + Math.random() * 4000);
        if (MP.ui) MP.ui.toast(L(TXT.giftLikes, { name: name }), 'good');
      }
    }
    I.render();
  };

  // Partners left out of a Plant Match level get jealous.
  // Only dating partners (or more) mind, and only when the team still had
  // room for them; married ones just complain.
  I.MAX_PARTNERS = 5;
  I.jealousy = function jealousy(team) {
    var ps = I.partners();
    if (team.length >= I.SLOTS) return;
    Object.keys(ps).forEach(function (code, i) {
      if (team.indexOf(code) >= 0 || I.relStage(ps[code]) < 1) return;
      var wait = 6000 + i * 5000 + Math.random() * 15000;
      I.later(code, Lp(CHAT.jealous), wait);
      if (!ps[code].married) {
        I.later(code, L(TXT.jealousSys, { name: X.plantName(code) }), wait + 400, '', 'sys');
        I.addXp(code, -1);
      }
    });
  };

  // Bonus the matches bring to the level: chat affinity, partners, gifts.
  I.levelBonus = function levelBonus() {
    var sun = 0;
    var food = X.store.get('matchGiftFood', 0);
    var ps = I.partners();
    (I.round ? I.round.matches : []).forEach(function (m) {
      var c = I.chats[m.code];
      if (c && c.s && !c.s.ghost) sun += c.s.affinity * 25;
      if (ps[m.code]) {
        var b = I.STAGE_BONUS[I.relStage(ps[m.code])];
        sun += b.sun;
        food += b.food;
      }
    });
    return { sun: Math.min(sun, 400), food: Math.min(food, 3) };
  };
})();
