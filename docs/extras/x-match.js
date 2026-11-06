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
 * Messages: every match starts a short scripted chat (3 exchanges, replies
 * that land well, so-so or badly; some plants ghost you). Affinity gives
 * extra starting sun in the level.
 * Likes: plants that liked you, blurred until you spend a reveal.
 * Dates: a mini level alone with a match; winning makes it your partner:
 * partners always match again and bring plant food to Plant Match levels.
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
  function L(o, vars) {
    var s = (o && (o[MP.lang] || o.en)) || '';
    if (vars) {
      s = s.replace(/\{(\w+)\}/g, function (_, k) {
        return vars[k] != null ? vars[k] : '';
      });
    }
    return s;
  }

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

  function today() {
    return new Date().toISOString().slice(0, 10);
  }

  var WORLD_KEY = { ice: 'iceage', modern: 'frontyard' };
  M.FAMILIES = ['Peashooter', 'Sun', 'Defence', 'Explosive', 'Lobber', 'Sharp', 'Cold', 'Melee', 'Poison', 'Slow', 'Fire', 'Shadow', 'Electricity', 'Magic', 'Nope'];

  // Made-up ages by the world the plant comes from (years).
  var WORLD_AGE = { frontyard: 2, egypt: 4500, pirate: 300, cowboy: 150, kongfu: 1200, future: -300, dark: 700, beach: 25, ice: 10000, lostcity: 90, eighties: 40, dino: 65000000, modern: 1, sky: 3 };
  var CLASSIC_WORLDS = { frontyard: 1, egypt: 1, pirate: 1, cowboy: 1 };
  var NEW_WORLDS = { eighties: 1, dino: 1, modern: 1, sky: 1, lostcity: 1, epic: 1 };
  var STAGE_OF_WORLD = { frontyard: 'modern', modern: 'modern', egypt: 'egypt', cowboy: 'west', future: 'future', dark: 'dark' };

  var TXT = {
    age: { pt: '{n} anos', en: '{n} years', zh: '{n} 岁' },
    ageFuture: { pt: 'ainda vai nascer', en: 'not born yet', zh: '还没出生' },
    likesLeft: { pt: 'curtidas hoje', en: 'likes today', zh: '今日喜欢' },
    supers: { pt: 'superlikes', en: 'super likes', zh: '超级喜欢' },
    tabDiscover: { pt: 'Descobrir', en: 'Discover', zh: '发现' },
    tabMessages: { pt: 'Mensagens', en: 'Messages', zh: '消息' },
    tabLikes: { pt: 'Curtidas', en: 'Likes', zh: '喜欢我' },
    tabPartners: { pt: 'Namoros', en: 'Partners', zh: '恋人' },
    undo: { pt: 'Desfazer o último swipe (1 por rodada, Backspace)', en: 'Undo the last swipe (1 per round, Backspace)', zh: '撤销上一次滑动（每轮 1 次，Backspace）' },
    boost: { pt: 'Boost: mostra primeiro as plantas mais compatíveis (1 por rodada)', en: 'Boost: most compatible plants first (1 per round)', zh: '加速：优先显示最契合的植物（每轮 1 次）' },
    boosted: { pt: '🚀 Boost ativo: as próximas são as mais compatíveis!', en: '🚀 Boost on: the next profiles are the most compatible!', zh: '🚀 加速中：接下来是最契合的植物！' },
    noLikes: { pt: 'Suas curtidas de hoje acabaram', en: 'You are out of likes for today', zh: '今天的喜欢次数用完了' },
    noLikesDesc: { pt: 'Volte amanhã, ou vença uma fase do Match de Plantas para ganhar +10 curtidas, 1 superlike e 1 revelação.', en: 'Come back tomorrow, or win a Plant Match level for +10 likes, 1 super like and 1 reveal.', zh: '明天再来，或赢得一局植物配对，获得 +10 喜欢、1 个超级喜欢和 1 次揭晓。' },
    likedYou: { pt: '💛 Curtiu você', en: '💛 Liked you', zh: '💛 喜欢你' },
    badgeVerified: { pt: '✔ Verificada', en: '✔ Verified', zh: '✔ 已认证' },
    badgeLegend: { pt: '👑 Lendária', en: '👑 Legendary', zh: '👑 传奇' },
    badgeNew: { pt: '✨ Nova no app', en: '✨ New here', zh: '✨ 新人' },
    badgePopular: { pt: '🔥 Popular', en: '🔥 Popular', zh: '🔥 人气' },
    badgePartner: { pt: '💍 Namora você', en: '💍 Your partner', zh: '💍 你的恋人' },
    photoWater: { pt: 'Na piscina', en: 'At the pool', zh: '泳池' },
    photoDeath: { pt: 'Dia ruim', en: 'Bad day', zh: '糟糕的一天' },
    msgsEmpty: { pt: 'Nenhum match ainda. Vá em Descobrir e curta algumas plantas!', en: 'No matches yet. Go to Discover and like some plants!', zh: '还没有配对。去“发现”喜欢一些植物吧！' },
    newMatch: { pt: 'Novo match! Diga oi.', en: 'New match! Say hi.', zh: '新配对！打个招呼吧。' },
    typing: { pt: 'digitando…', en: 'typing…', zh: '正在输入…' },
    ghosted: { pt: '{name} parou de responder. 👻', en: '{name} stopped replying. 👻', zh: '{name} 不再回复了。👻' },
    seen: { pt: 'visto por último há {n} h', en: 'last seen {n} h ago', zh: '{n} 小时前在线' },
    affinity: { pt: 'Afinidade', en: 'Affinity', zh: '好感度' },
    viewProfile: { pt: 'Ver perfil', en: 'View profile', zh: '查看资料' },
    invite: { pt: '💐 Convidar para um encontro', en: '💐 Ask out on a date', zh: '💐 邀请约会' },
    inviteDesc: { pt: 'Uma fase curta só com {name}. Se vocês vencerem, viram namorados: {name} sempre dá match e traz 1 adubo para as fases do Match de Plantas.', en: 'A short level alone with {name}. Win it and you become partners: {name} always matches and brings 1 plant food to Plant Match levels.', zh: '只和 {name} 一起的短关卡。获胜后你们将成为恋人：{name} 总会配对，并为植物配对关卡带来 1 个能量豆。' },
    likesTitle: { pt: '{n} plantas curtiram você', en: '{n} plants liked you', zh: '{n} 株植物喜欢你' },
    likesDesc: { pt: 'Use uma revelação para ver quem é. Curtir de volta é match na hora. Você ganha revelações vencendo fases e encontros.', en: 'Spend a reveal to see who it is. Liking back is an instant match. Win levels and dates to earn reveals.', zh: '使用揭晓次数来查看是谁。回喜欢即可立即配对。赢得关卡和约会可获得揭晓次数。' },
    reveals: { pt: 'Revelações: {n}', en: 'Reveals: {n}', zh: '揭晓次数：{n}' },
    reveal: { pt: 'Revelar', en: 'Reveal', zh: '揭晓' },
    seeNow: { pt: 'Ver agora', en: 'See now', zh: '立即查看' },
    likesNone: { pt: 'Ninguém novo por enquanto. Continue no Descobrir!', en: 'Nobody new for now. Keep discovering!', zh: '暂时没有新的喜欢。继续发现吧！' },
    partnersTitle: { pt: 'Seus namoros', en: 'Your partners', zh: '你的恋人' },
    partnersDesc: { pt: 'Plantas com quem você venceu um encontro. Sempre dão match, e cada uma no time traz 1 adubo no início das fases deste modo (até 3).', en: 'Plants you won a date with. They always match, and each one in your team brings 1 plant food at the start of this mode’s levels (up to 3).', zh: '与你约会获胜的植物。它们总会配对，每株在队伍中时，本模式关卡开始时带来 1 个能量豆（最多 3 个）。' },
    partnersNone: { pt: 'Nenhum namoro ainda. Convide um match para um encontro pela conversa.', en: 'No partners yet. Ask a match out on a date from the chat.', zh: '还没有恋人。在聊天中邀请配对对象约会吧。' },
    since: { pt: 'juntos desde {d}', en: 'together since {d}', zh: '自 {d} 起在一起' },
    bonus: { pt: 'Bônus da fase: +{sun} ☀ · {food} adubo(s)', en: 'Level bonus: +{sun} ☀ · {food} plant food', zh: '关卡加成：+{sun} ☀ · {food} 能量豆' },
    dateName: { pt: 'Encontro com {name}', en: 'Date with {name}', zh: '与 {name} 约会' },
    dateWon: { pt: '💍 {name} agora namora você!', en: '💍 {name} is now your partner!', zh: '💍 {name} 现在是你的恋人了！' },
    dateLost: { pt: '💔 O encontro não deu certo... tente de novo pela conversa.', en: '💔 The date didn’t work out... try again from the chat.', zh: '💔 约会不太顺利……在聊天中再试一次吧。' },
    reward: { pt: '🎁 +10 curtidas, +1 superlike e +1 revelação no Match de Plantas!', en: '🎁 +10 likes, +1 super like and +1 reveal in Plant Match!', zh: '🎁 植物配对：+10 喜欢、+1 超级喜欢、+1 揭晓！' },
    headlines: {
      pt: ['Fã de {a} e {b}.', 'Procurando alguém para dividir o gramado.', 'Se você gosta de {a}, já temos algo em comum.', 'Vim de {w} só para te conhecer.', '{a}, {b} e zumbis derrotados. Nessa ordem.'],
      en: ['Into {a} and {b}.', 'Looking for someone to share a lawn with.', 'If you like {a}, we already have something in common.', 'Came all the way from {w} to meet you.', '{a}, {b} and defeated zombies. In that order.'],
      zh: ['喜欢{a}和{b}。', '想找人一起守护草坪。', '如果你喜欢{a}，我们已经有共同点了。', '为了认识你，我从{w}赶来。', '{a}、{b}和被打败的僵尸，按这个顺序。'],
    },
  };

  // The chat script: 3 exchanges. Each reply is good (+1 affinity), so-so
  // or bad; exchange 2 asks about the role the plant plays.
  var CHAT = {
    openers: {
      pt: ['Oi! Vi que você também curte {like}. 😊', 'Então... você planta na primeira fileira ou é do tipo que espera?', 'Confesso: dei like porque gostei do seu gramado.', 'Sem rodeios: quantos zumbis você já derrotou?', 'Oi! Prometo não ocupar mais que uma casa. 🌱'],
      en: ['Hi! I see you’re into {like} too. 😊', 'So... do you plant in the front row or are you the waiting type?', 'Confession: I liked you because of your lawn.', 'Straight to the point: how many zombies have you beaten?', 'Hi! I promise I only take one square. 🌱'],
      zh: ['嗨！看到你也喜欢{like}。😊', '那么……你喜欢种在第一排，还是会等一等？', '坦白说：我点喜欢是因为你的草坪。', '直接问吧：你打败过多少僵尸？', '嗨！我保证只占一格。🌱'],
    },
    r1: [
      { q: 'good', pt: 'Adorei seu perfil, {name}! Ainda mais a parte de {like}.', en: 'Loved your profile, {name}! Especially the {like} part.', zh: '{name}，我很喜欢你的资料！尤其是{like}那部分。' },
      { q: 'meh', pt: 'Oi, tudo bem?', en: 'Hey, how are you?', zh: '嗨，你好吗？' },
      { q: 'bad', pt: 'Só dei like porque você é barata.', en: 'I only liked you because you’re cheap.', zh: '我点喜欢只是因为你便宜。' },
    ],
    r2q: { pt: 'Me conta: o que você procura numa planta?', en: 'Tell me: what are you looking for in a plant?', zh: '告诉我：你想找什么样的植物？' },
    roles: {
      sun: { pt: 'Alguém que traga energia para o time ☀️', en: 'Someone who brings energy to the team ☀️', zh: '能为队伍带来能量的伙伴 ☀️' },
      defense: { pt: 'Alguém que segure a barra quando apertar 🛡️', en: 'Someone who holds the line when it gets tough 🛡️', zh: '关键时刻能顶住的伙伴 🛡️' },
      attack: { pt: 'Alguém que parta para cima dos zumbis ⚔️', en: 'Someone who goes after the zombies ⚔️', zh: '敢冲向僵尸的伙伴 ⚔️' },
      area: { pt: 'Alguém que resolva tudo de uma vez 💥', en: 'Someone who solves it all at once 💥', zh: '能一次解决所有问题的伙伴 💥' },
      support: { pt: 'Alguém que ajude todo mundo 🤝', en: 'Someone who helps everyone 🤝', zh: '乐于帮助大家的伙伴 🤝' },
    },
    r3q: { pt: 'Então... topa um encontro? Onda 1, no seu quintal. 🌻', en: 'So... how about a date? Wave 1, at your front yard. 🌻', zh: '那么……约会吗？第 1 波，在你家前院。🌻' },
    r3: [
      { q: 'good', pt: 'Claro! Já guardei a melhor casa pra você.', en: 'Of course! I saved the best square for you.', zh: '当然！我给你留了最好的格子。' },
      { q: 'meh', pt: 'Pode ser, vou ver minha agenda.', en: 'Maybe, let me check my schedule.', zh: '也许吧，我看看日程。' },
      { q: 'bad', pt: 'Acho que não, prefiro jogar sozinho.', en: 'I don’t think so, I’d rather play alone.', zh: '算了吧，我更喜欢一个人玩。' },
    ],
    react: {
      good: { pt: ['Aaah, que fofo! 😍', 'Você sabe conversar! 💚', 'Ganhou meu coração (e minha folha). 🌿'], en: ['Aww, how sweet! 😍', 'You know how to talk! 💚', 'You won my heart (and my leaf). 🌿'], zh: ['哇，好甜！😍', '你真会聊天！💚', '你赢得了我的心（和我的叶子）。🌿'] },
      meh: { pt: ['Entendi. 🙂', 'Hmm, ok! 🙂', 'Ah... legal.'], en: ['I see. 🙂', 'Hmm, okay! 🙂', 'Oh... nice.'], zh: ['明白了。🙂', '嗯，好的！🙂', '哦……不错。'] },
      hello: { pt: ['Tudo ótimo! E você?'], en: ['All good! You?'], zh: ['都挺好！你呢？'] },
      bad: { pt: ['Hmm... ok então. 😐', 'Nossa. 🙄', 'Tá bom, né...'], en: ['Hmm... okay then. 😐', 'Wow. 🙄', 'Sure, I guess...'], zh: ['嗯……好吧。😐', '哇哦。🙄', '行吧……'] },
    },
    roleGood: { pt: 'É exatamente isso que eu faço! 😍', en: 'That’s exactly what I do! 😍', zh: '这正是我擅长的！😍' },
    roleMeh: { pt: 'Ah... não é bem a minha praia.', en: 'Oh... that’s not really my thing.', zh: '哦……那不太是我的强项。' },
    end: {
      3: { pt: 'Você é demais! Vou dar o meu melhor na fase. 🔥', en: 'You’re amazing! I’ll give it my all in the level. 🔥', zh: '你太棒了！我会在关卡里全力以赴。🔥' },
      2: { pt: 'Foi legal conversar! Até o gramado. 🌱', en: 'Nice talking! See you on the lawn. 🌱', zh: '聊得很开心！草坪上见。🌱' },
      1: { pt: 'Tá... a gente se vê.', en: 'Okay... see you around.', zh: '好吧……回头见。' },
      0: { pt: 'Tá... a gente se vê.', en: 'Okay... see you around.', zh: '好吧……回头见。' },
    },
  };

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
  function partners() {
    return X.store.get('matchPartners', {});
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
    var age = WORLD_AGE[w];
    p.age = age == null ? '' : age < 0 ? L(TXT.ageFuture) : L(TXT.age, { n: age.toLocaleString(MP.lang === 'pt' ? 'pt-BR' : MP.lang === 'zh' ? 'zh-CN' : 'en-US') });
    var likes = t(famKey(p) + '_likes').split('|');
    p.likes = likes;
    p.headline = L({ pt: pick(TXT.headlines.pt), en: pick(TXT.headlines.en), zh: pick(TXT.headlines.zh) }, { a: (likes[0] || '').toLowerCase(), b: (likes[1] || '').toLowerCase(), w: p.world });
    p.badges = [];
    if (p.partner) p.badges.push(L(TXT.badgePartner));
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
    // Partners (dates won) always show up again early in the deck.
    shuffle(Object.keys(partners()))
      .slice(0, 3)
      .forEach(function (code) {
        if (cards.some(function (c) {
          return c.code === code;
        })) return;
        var pp = profile(code);
        if (pp) cards.splice(Math.floor(Math.random() * Math.min(10, cards.length + 1)), 0, pp);
      });
    if (cards.length > DECK) cards.length = DECK;
    round = { cards: cards, i: 0, matches: [], chats: {}, history: [], superUsed: false, undoUsed: false, boostUsed: false, boosted: false, revealed: {} };
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

  function startChat(p) {
    var opener = L({ pt: pick(CHAT.openers.pt), en: pick(CHAT.openers.en), zh: pick(CHAT.openers.zh) }, { like: (p.likes[0] || '').toLowerCase() });
    round.chats[p.code] = { msgs: [{ from: 'them', text: opener }], step: 1, affinity: 0, ghost: false, done: false, unread: true, typing: false };
  }

  function chatOptions(p, chat) {
    if (chat.done || chat.ghost || chat.typing) return [];
    if (chat.step === 1) {
      return shuffle(
        CHAT.r1.map(function (r) {
          return { q: r.q, text: L(r, { name: p.name, like: (p.likes[0] || '').toLowerCase() }) };
        }),
      );
    }
    if (chat.step === 2) {
      var right = mainRole(p);
      var others = shuffle(
        Object.keys(CHAT.roles).filter(function (r) {
          return r !== right;
        }),
      ).slice(0, 2);
      if (!chat._r2) {
        chat._r2 = shuffle(
          [{ q: 'good', role: right }].concat(
            others.map(function (r) {
              return { q: 'meh', role: r };
            }),
          ),
        );
      }
      return chat._r2.map(function (o) {
        return { q: o.q, role: true, text: L(CHAT.roles[o.role]) };
      });
    }
    if (chat.step === 3) {
      return (chat._r3 =
        chat._r3 ||
        shuffle(
          CHAT.r3.map(function (r) {
            return { q: r.q, text: L(r) };
          }),
        ));
    }
    return [];
  }

  function reply(p, opt) {
    var chat = round.chats[p.code];
    if (!chat || chat.typing) return;
    chat.msgs.push({ from: 'me', text: opt.text });
    if (opt.q === 'good') chat.affinity++;
    chat.typing = true;
    render();
    var delay = 700 + Math.random() * 700;
    setTimeout(function () {
      chat.typing = false;
      var reactions = opt.role ? (opt.q === 'good' ? L(CHAT.roleGood) : L(CHAT.roleMeh)) : pick(L(CHAT.react[chat.step === 1 && opt.q === 'meh' ? 'hello' : opt.q]));
      // Some plants ghost after a bad first reply (or just because).
      if (chat.step === 1 && (opt.q === 'bad' ? Math.random() < 0.5 : Math.random() < 0.08)) {
        chat.ghost = true;
        chat.msgs.push({ from: 'sys', text: L(TXT.ghosted, { name: p.name }) });
      } else {
        chat.msgs.push({ from: 'them', text: reactions });
        chat.step++;
        if (chat.step === 2) chat.msgs.push({ from: 'them', text: L(CHAT.r2q) });
        else if (chat.step === 3) chat.msgs.push({ from: 'them', text: L(CHAT.r3q) });
        else {
          chat.done = true;
          chat.msgs.push({ from: 'them', text: L(CHAT.end[Math.min(3, chat.affinity)]) });
          if (chat.affinity >= 3) X.achievements && X.achievements.unlockExtra && X.achievements.unlockExtra(['match_chat']);
        }
      }
      chat.unread = view.chat !== p;
      if (node) render();
    }, delay);
  }

  function affinityHearts(n) {
    return '❤'.repeat(n) + '♡'.repeat(Math.max(0, 3 - n));
  }

  // Bonus the matches bring to the level.
  function levelBonus() {
    var sun = 0;
    var food = 0;
    var ps = partners();
    (round ? round.matches : []).forEach(function (m) {
      var c = round.chats[m.code];
      if (c && !c.ghost) sun += c.affinity * 25;
      if (ps[m.code]) food++;
    });
    return { sun: Math.min(sun, 300), food: Math.min(food, 3) };
  }

  /* ------------------------------------------------------------- swipe */

  function current() {
    return round && round.cards[round.i];
  }

  function canSwipe() {
    return !!current() && round.matches.length < SLOTS && view.tab === 'discover' && !view.prefs && !view.viewing;
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
      var chance = Math.min(0.97, p.chance * (0.7 + compatibility(p).score / 160));
      matched = kind === 'super' || p.likedYou || p.partner || Math.random() < chance;
      if (matched) {
        round.matches.push(p);
        startChat(p);
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
      delete round.chats[h.card.code];
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
      opts && opts.undo
        ? el('div.pvzx-file-actions', null, [
            p.partner ? null : el('button.mp-btn.mp-small.mp-green', { text: L(TXT.invite), onclick: function () {
              date(p);
            } }),
            el('button.mp-btn.mp-small.mp-red', { text: t('match_unmatch'), onclick: function () {
              round.matches.splice(round.matches.indexOf(p), 1);
              delete round.chats[p.code];
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

  function messagesTab(body) {
    var p = view.chat;
    if (p && round.matches.indexOf(p) < 0) p = view.chat = null;
    if (!p) {
      var list = el('div.pvzx-mlist');
      if (!round.matches.length) list.appendChild(el('p.pvzx-mempty', { text: L(TXT.msgsEmpty) }));
      round.matches.forEach(function (m) {
        var c = round.chats[m.code];
        var last = c && c.msgs[c.msgs.length - 1];
        list.appendChild(
          el('button.pvzx-mrow' + (c && c.unread ? '.pvzx-unread' : ''), { onclick: function () {
            view.chat = m;
            if (c) c.unread = false;
            queuePhotos();
            render();
          } }, [
            el('span.pvzx-mavatar.pvzx-fam-' + m.family.toLowerCase(), null, [el('img', { src: avatar(m), alt: '' })]),
            el('span.pvzx-mrow-text', null, [
              el('b', { text: m.name + (partners()[m.code] ? ' 💍' : '') }),
              el('span', { text: last ? (last.from === 'me' ? '↪ ' : '') + last.text : L(TXT.newMatch) }),
            ]),
            el('span.pvzx-mrow-aff', { text: c && c.ghost ? '👻' : affinityHearts(c ? c.affinity : 0) }),
          ]),
        );
      });
      list.addEventListener('wheel', function (e) {
        e.stopPropagation();
      });
      body.appendChild(list);
      return;
    }
    var chat = round.chats[p.code];
    var head = el('div.pvzx-chat-head', null, [
      el('button.pvzx-x', { text: '←', onclick: function () {
        view.chat = null;
        render();
      } }),
      el('span.pvzx-mavatar.pvzx-fam-' + p.family.toLowerCase(), null, [p.photos && p.photos.idle ? animImg(p.photos.idle) : el('img', { src: avatar(p), alt: '' })]),
      el('span.pvzx-mrow-text', null, [el('b', { text: p.name }), el('span', { text: chat.ghost ? L(TXT.seen, { n: 2 + p.distance }) : p.online ? t('match_online') : p.world })]),
      el('button.pvzx-chip.pvzx-chip-btn', { text: L(TXT.viewProfile), onclick: function () {
        view.viewing = p;
        view.tab = 'discover';
        render();
      } }),
    ]);
    var log = el('div.pvzx-chat-log');
    chat.msgs.forEach(function (m) {
      log.appendChild(el('div.pvzx-bubble.pvzx-from-' + m.from, { text: m.text }));
    });
    if (chat.typing) log.appendChild(el('div.pvzx-bubble.pvzx-from-them.pvzx-typing', { text: L(TXT.typing) }));
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
    var foot = el('div.pvzx-chat-foot', null, [
      el('span', { text: L(TXT.affinity) + ': ' + affinityHearts(chat.affinity) + (chat.affinity ? ' (+' + chat.affinity * 25 + ' ☀)' : '') }),
      partners()[p.code] ? el('span', { text: L(TXT.badgePartner) }) : el('button.mp-btn.mp-small.mp-green', { text: L(TXT.invite), title: L(TXT.inviteDesc, { name: p.name }), onclick: function () {
        date(p);
      } }),
    ]);
    body.appendChild(el('div.pvzx-chat', null, [head, log, opts, foot]));
    setTimeout(function () {
      log.scrollTop = log.scrollHeight;
    }, 0);
    chat.unread = false;
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

  function partnersTab(body) {
    var ps = partners();
    var codes = Object.keys(ps);
    var box = el('div.pvzx-mlikes', null, [el('h3', { text: '💍 ' + L(TXT.partnersTitle) }), el('p.pvzx-small', { text: L(TXT.partnersDesc) })]);
    if (!codes.length) box.appendChild(el('p.pvzx-mempty', { text: L(TXT.partnersNone) }));
    var grid = el('div.pvzx-lgrid');
    codes.forEach(function (code) {
      var art = MP.cards && MP.cards.plantCanvas(code);
      grid.appendChild(
        el('div.pvzx-lcard', null, [
          art ? el('img', { src: art.toDataURL(), alt: '' }) : null,
          el('b', { text: X.plantName(code) }),
          el('span.pvzx-small', { text: L(TXT.since, { d: new Date(ps[code].since).toLocaleDateString() }) }),
        ]),
      );
    });
    box.appendChild(grid);
    body.appendChild(box);
  }

  var TABS = [
    ['discover', '🔥', TXT.tabDiscover],
    ['messages', '💬', TXT.tabMessages],
    ['likes', '💛', TXT.tabLikes],
    ['partners', '💍', TXT.tabPartners],
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
    ({ discover: discoverTab, messages: messagesTab, likes: likesTab, partners: partnersTab }[view.tab] || discoverTab)(body);
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
    var unread = round.matches.filter(function (m) {
      return round.chats[m.code] && round.chats[m.code].unread;
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
          round.chats[p.code].unread = false;
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
    var disc = view.tab === 'discover' && !view.prefs && !view.viewing;
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
      if (view.viewing || view.prefs || view.chat) {
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
    var stage = X.STAGE_IDS[Math.floor(Math.random() * X.STAGE_IDS.length)];
    var b = levelBonus();
    var lv = baseLevel(stage, 15, 150 + b.sun);
    lv.def.Name = t('mode_match');
    lv.def.Description = t('mode_match_desc');
    var team = round.matches.map(function (m) {
      return m.code;
    });
    setSeeds(lv.objects, team);
    M.close();
    X.modes.current = { kind: 'match', id: 'match', options: { stage: stage, team: team, food: b.food }, mutators: X.mutators ? X.mutators.chosen() : [] };
    G.startCustomLevel(lv.objects);
    round = null;
  }

  // A short level alone with one match.
  function date(p) {
    var stage = STAGE_OF_WORLD[p.worldKey] || pick(X.STAGE_IDS);
    var lv = baseLevel(stage, 6, 300, 'fast');
    lv.def.Name = L(TXT.dateName, { name: p.name });
    lv.def.Description = L(TXT.inviteDesc, { name: p.name });
    var wm = lv.objects.find(function (o) {
      return o.objclass === 'WaveManagerProperties';
    });
    wm.objdata.FlagWaveInterval = 3;
    var dyn = lv.objects.find(function (o) {
      return o.objclass === 'WaveManagerModuleProperties';
    });
    (dyn.objdata.DynamicZombies || []).forEach(function (z) {
      z.PointIncrementPerWave = Math.round(z.PointIncrementPerWave * 0.6);
      z.StartingPoints = Math.round(z.StartingPoints * 0.6);
    });
    setSeeds(lv.objects, [p.code]);
    M.close();
    X.modes.current = { kind: 'matchdate', id: 'matchdate', options: { stage: stage, plant: p.code, name: p.name }, mutators: [] };
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

  function onLevelEnd(s) {
    var cur = X.modes.current;
    if (!cur || s.online) return;
    if (cur.kind === 'matchdate') {
      s.mode = 'matchdate';
      if (s.result === 'won') {
        var ps = partners();
        ps[cur.options.plant] = { since: Date.now() };
        X.store.set('matchPartners', ps);
        X.store.set('matchReveals', reveals() + 1);
      }
      setTimeout(function () {
        X.play.summaryNote(s.result === 'won' ? L(TXT.dateWon, { name: cur.options.name }) : L(TXT.dateLost), s.result === 'won' ? 'pvzx-good' : '');
      }, 1300);
      return;
    }
    if (cur.kind !== 'match') return;
    s.mode = 'match';
    s.matchTeam = cur.options.team.length;
    s.score = X.modes.score(s);
    X.store.set('matchBest', Math.max(X.store.get('matchBest', 0), s.score));
    if (s.result === 'won') {
      M.reward();
      setTimeout(function () {
        X.play.summaryNote(L(TXT.reward), 'pvzx-good');
      }, 1300);
    }
    if (X.api.available() && X.api.loggedIn()) {
      X.api
        .postScore('challenge:match', s.score, { waves: s.wave, kills: s.kills, time: Math.round(s.time), plants: s.matchTeam, stage: cur.options.stage })
        .then(function (r) {
          setTimeout(function () {
            if (r.rank) X.play.summaryNote(t('summary_rank', { n: r.rank }), 'pvzx-good');
          }, 1500);
        })
        .catch(function () {});
    }
  }

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
