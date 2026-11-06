/*
 * PvZ2 Gardendless - Plant Match texts (pt / en / zh): interface, the chat
 * script, personalities, dates and relationship stages. Used by x-match.js.
 */
(function () {
  'use strict';

  var X = window.PvZX;

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

  /* ------------------------------------------------ texts added in 2.0 */

  Object.assign(TXT, {
    inviteDesc: { pt: 'Escolha um encontro: uma fase curta com {name}. Vencendo, vocês começam a namorar.', en: 'Pick a date: a short level with {name}. Win it and you start dating.', zh: '选择约会：与 {name} 一起的短关卡。获胜后你们开始交往。' },
    partnersDesc: { pt: 'Plantas com quem você venceu um encontro. Sempre dão match, trazem bônus quando estão no time e o relacionamento cresce com encontros, presentes e fases jogadas juntos. Cuidado: quem fica de fora das fases sente ciúmes.', en: 'Plants you won a date with. They always match, bring a bonus when they are in your team, and the relationship grows with dates, gifts and levels played together. Careful: partners left out of a level get jealous.', zh: '与你约会获胜的植物。它们总会配对，在队伍中时带来加成，关系会随约会、礼物和一起游玩的关卡成长。注意：没被带上关卡的恋人会吃醋。' },
    newSession: { pt: '— novo match —', en: '— new match —', zh: '— 新的配对 —' },
    personality: { pt: 'Personalidade', en: 'Personality', zh: '性格' },
    stickerTip: { pt: 'Mande uma figurinha (1 por conversa). Acertar a favorita da planta vale um coração.', en: 'Send a sticker (1 per chat). Her favorite one is worth a heart.', zh: '发送一个贴纸（每次聊天 1 次）。发中它最喜欢的可得一颗心。' },
    noChatHere: { pt: 'Dê match de novo para conversar.', en: 'Match again to chat.', zh: '再次配对即可聊天。' },
    dateTitle: { pt: 'Escolha o encontro', en: 'Pick a date', zh: '选择约会' },
    dateNeed: { pt: '🔒 Precisa estar: {stage}', en: '🔒 Needs: {stage}', zh: '🔒 需要关系：{stage}' },
    dateNeedPartner: { pt: '🔒 Só para namoros', en: '🔒 Partners only', zh: '🔒 仅限恋人' },
    dateBest: { pt: 'Melhor: {stars}', en: 'Best: {stars}', zh: '最佳：{stars}' },
    dateResult: { pt: '{icon} {date}: {stars}', en: '{icon} {date}: {stars}', zh: '{icon} {date}：{stars}' },
    dateWaves: { pt: '{n} ondas', en: '{n} waves', zh: '{n} 波' },
    objWin: { pt: 'Vencer', en: 'Win', zh: '获胜' },
    objNoMower: { pt: 'Sem usar cortadores', en: 'No mowers used', zh: '不使用割草机' },
    objNoLost: { pt: 'Sem perder plantas', en: 'No plants lost', zh: '不损失植物' },
    objFast: { pt: 'Em menos de {m} min', en: 'Under {m} min', zh: '{m} 分钟内' },
    relUp: { pt: '{icon} Agora vocês estão: {stage}!', en: '{icon} You are now: {stage}!', zh: '{icon} 你们现在是：{stage}！' },
    breakup: { pt: '💔 {name} terminou com você.', en: '💔 {name} broke up with you.', zh: '💔 {name} 和你分手了。' },
    jealousSys: { pt: '😒 {name} ficou com ciúmes (−1 de relacionamento).', en: '😒 {name} got jealous (−1 relationship).', zh: '😒 {name} 吃醋了（关系 −1）。' },
    giftWater: { pt: '💧 Regar', en: '💧 Water', zh: '💧 浇水' },
    giftWaterDesc: { pt: 'Grátis, 1 vez por dia: +1 de relacionamento', en: 'Free, once a day: +1 relationship', zh: '免费，每天 1 次：关系 +1' },
    giftChoc: { pt: '🍫 Chocolate de sol', en: '🍫 Sun chocolate', zh: '🍫 阳光巧克力' },
    giftChocDesc: { pt: 'Custa 5 curtidas, 1 vez por dia: +2 de relacionamento', en: 'Costs 5 likes, once a day: +2 relationship', zh: '花费 5 个喜欢，每天 1 次：关系 +2' },
    giftSent: { pt: 'Você deu {gift} para {name}.', en: 'You gave {gift} to {name}.', zh: '你送给 {name} {gift}。' },
    giftFood: { pt: '🎁 {name} te deu +1 adubo para a próxima fase!', en: '🎁 {name} gave you +1 plant food for the next level!', zh: '🎁 {name} 送你下一关 +1 能量豆！' },
    giftLikes: { pt: '🎁 {name} te deu +5 curtidas!', en: '🎁 {name} gave you +5 likes!', zh: '🎁 {name} 送你 +5 个喜欢！' },
    relPoints: { pt: 'Pontos de casal: {n}', en: 'Couple points: {n}', zh: '情侣积分：{n}' },
    xpNext: { pt: '{xp}/{next} para {stage}', en: '{xp}/{next} to {stage}', zh: '{xp}/{next} 达到{stage}' },
    xpWedding: { pt: 'Pronto para o casamento! 💒', en: 'Ready for the wedding! 💒', zh: '可以举办婚礼了！💒' },
    xpMax: { pt: 'Felizes para sempre', en: 'Happily ever after', zh: '永远幸福' },
    stageBonus: { pt: 'No time: {txt}', en: 'In your team: {txt}', zh: '在队伍中：{txt}' },
    chatBtn: { pt: '💬 Conversa', en: '💬 Chat', zh: '💬 聊天' },
    dateBtn: { pt: '💐 Encontro', en: '💐 Date', zh: '💐 约会' },
    giftPending: { pt: 'Presentes guardados: +{n} adubo na próxima fase', en: 'Saved gifts: +{n} plant food next level', zh: '已存礼物：下一关 +{n} 能量豆' },
    tabSocial: { pt: 'Social', en: 'Social', zh: '社交' },
    weekTitle: { pt: 'Semana temática: {fam}', en: 'Theme week: {fam}', zh: '主题周：{fam}' },
    weekDesc: { pt: 'Até domingo, plantas da família {fam} aparecem mais e dão match mais fácil. Vença uma fase com 3 delas no time para ganhar recompensas em dobro e entrar no ranking da semana.', en: 'Until Sunday, {fam} plants show up more and match more easily. Win a level with 3 of them in your team for double rewards and a spot on the weekly ranking.', zh: '本周日前，{fam}家族的植物出现得更多、更容易配对。带着其中 3 株赢得关卡可获得双倍奖励并进入周排行榜。' },
    weekBadge: { pt: '🎉 Destaque da semana', en: '🎉 Plant of the week', zh: '🎉 本周明星' },
    weekReward: { pt: '🎉 Semana temática: recompensas em dobro!', en: '🎉 Theme week: double rewards!', zh: '🎉 主题周：奖励翻倍！' },
    weekTeam: { pt: 'Plantas da semana no seu time: {n}/3', en: 'Plants of the week in your team: {n}/3', zh: '队伍中的本周植物：{n}/3' },
    popLikes: { pt: '🔥 Mais curtidas no servidor', en: '🔥 Most liked on the server', zh: '🔥 服务器最受喜欢' },
    popPartners: { pt: '💍 Mais namoradas no servidor', en: '💍 Most dated on the server', zh: '💍 服务器最多恋人' },
    popNone: { pt: 'Ainda sem dados. Curta algumas plantas!', en: 'No data yet. Like some plants!', zh: '还没有数据。去喜欢一些植物吧！' },
    popOffline: { pt: 'Conecte-se a um servidor multiplayer (menu Multijogador) para ver as plantas mais populares de todos os jogadores e os rankings.', en: 'Connect to a multiplayer server (Multiplayer menu) to see the most popular plants of all players and the rankings.', zh: '连接多人服务器（多人菜单）即可查看所有玩家最受欢迎的植物和排行榜。' },
    popMine: { pt: '📊 Suas plantas favoritas', en: '📊 Your favorite plants', zh: '📊 你最喜欢的植物' },
    rankings: { pt: '🏆 Rankings', en: '🏆 Rankings', zh: '🏆 排行榜' },
    rankMatch: { pt: 'Fases', en: 'Levels', zh: '关卡' },
    rankCouple: { pt: 'Casais', en: 'Couples', zh: '情侣' },
    rankWeek: { pt: 'Semana', en: 'Week', zh: '本周' },
    rankEmpty: { pt: 'Ninguém no ranking ainda.', en: 'Nobody on this ranking yet.', zh: '排行榜暂时没有人。' },
    rankLogin: { pt: 'Entre numa conta para aparecer nos rankings.', en: 'Log in to appear on the rankings.', zh: '登录账号即可上榜。' },
    rankYou: { pt: 'Você: #{n}', en: 'You: #{n}', zh: '你：第 {n} 名' },
    shareTitle: { pt: '📤 Compartilhar', en: '📤 Share', zh: '📤 分享' },
    shareTeam: { pt: 'Copiar meu time', en: 'Copy my team', zh: '复制我的队伍' },
    shareNone: { pt: 'Dê alguns matches (ou jogue uma fase) para ter um time.', en: 'Get some matches (or play a level) to have a team.', zh: '先配对一些植物（或玩一局）来组建队伍。' },
    shareCopied: { pt: 'Copiado!', en: 'Copied!', zh: '已复制！' },
    shareText: { pt: 'Meu time no Match de Plantas 💘: {names}. Código: {code}', en: 'My Plant Match team 💘: {names}. Code: {code}', zh: '我的植物配对队伍 💘：{names}。代码：{code}' },
    shareProfile: { pt: '📤 Compartilhar perfil', en: '📤 Share profile', zh: '📤 分享资料' },
    shareProfileText: { pt: '💘 {name}, {age} · {fam} · ☀ {cost} · {pers}\n“{headline}”\nMatch de Plantas, PvZ2 Gardendless', en: '💘 {name}, {age} · {fam} · ☀ {cost} · {pers}\n“{headline}”\nPlant Match, PvZ2 Gardendless', zh: '💘 {name}，{age} · {fam} · ☀ {cost} · {pers}\n“{headline}”\n植物配对，PvZ2 Gardendless' },
    importTitle: { pt: 'Jogar com o time de um amigo', en: 'Play a friend’s team', zh: '使用好友的队伍' },
    importPh: { pt: 'Cole o código (PM1:…)', en: 'Paste the code (PM1:…)', zh: '粘贴代码（PM1:…）' },
    importGo: { pt: 'Jogar', en: 'Play', zh: '开始' },
    importBad: { pt: 'Código inválido', en: 'Invalid code', zh: '代码无效' },
    lastTeam: { pt: 'Último time: {names}', en: 'Last team: {names}', zh: '上一支队伍：{names}' },
  });

  Object.assign(CHAT, {
    // Exchange 2: one of these questions, picked per chat.
    q: {
      world: {
        ask: { pt: 'Adivinha de que mundo eu sou? 🌍', en: 'Guess which world I’m from? 🌍', zh: '猜猜我来自哪个世界？🌍' },
        right: { pt: 'Acertou! Dá pra notar o sotaque? 😄', en: 'Right! Can you hear the accent? 😄', zh: '猜对了！听得出口音吗？😄' },
        wrong: { pt: 'Errou! Eu sou de {world}. 😅', en: 'Nope! I’m from {world}. 😅', zh: '错啦！我来自{world}。😅' },
      },
      like: {
        ask: { pt: 'Adivinha do que eu mais gosto? 😏', en: 'Guess what I like the most? 😏', zh: '猜猜我最喜欢什么？😏' },
        right: { pt: 'Isso! Você presta atenção em mim. 💚', en: 'Yes! You pay attention to me. 💚', zh: '对！你很在意我。💚' },
        wrong: { pt: 'Nada a ver! Eu amo {like}. 😅', en: 'Not at all! I love {like}. 😅', zh: '完全不对！我爱{like}。😅' },
      },
      cost: {
        ask: { pt: 'Sinceridade: o que acha do meu preço de {cost} de sol?', en: 'Honestly: what do you think of my {cost} sun price?', zh: '说实话：你觉得我 {cost} 阳光的价格怎么样？' },
        worth: { pt: 'Vale cada raio de sol ✨', en: 'Worth every ray of sun ✨', zh: '每一缕阳光都值得 ✨' },
        cheap: { pt: 'Econômica, adoro isso!', en: 'Budget-friendly, I love it!', zh: '经济实惠，我喜欢！' },
        pricey: { pt: 'Meio cara pra mim...', en: 'A bit pricey for me...', zh: '对我来说有点贵……' },
        right: { pt: 'Você me entende! 🥹', en: 'You get me! 🥹', zh: '你懂我！🥹' },
      },
    },
    again: {
      pt: ['Você de novo! 😄 Ainda procurando “{role}”?', 'Olha quem voltou! Que saudade. 💚', 'Sabia que você ia voltar. 😏'],
      en: ['You again! 😄 Still looking for “{role}”?', 'Look who’s back! I missed you. 💚', 'I knew you’d come back. 😏'],
      zh: ['又是你！😄 还在找“{role}”吗？', '看看谁回来了！好想你。💚', '我就知道你会回来。😏'],
    },
    againWins: { pt: ['Saudade das nossas vitórias! Já são {wins} juntos. 🏆'], en: ['I miss our wins! {wins} together so far. 🏆'], zh: ['想念我们的胜利！已经一起赢了 {wins} 次。🏆'] },
    againGhost: { pt: ['Desculpa ter sumido da última vez... recomeçamos? 🙈'], en: ['Sorry I vanished last time... start over? 🙈'], zh: ['上次突然消失，对不起……重新开始吗？🙈'] },
    stickers: ['❤️', '🌻', '🧟', '😂', '🔥'],
    stickerLove: { pt: ['Amei essa figurinha! 😍', 'Minha favorita! Como você sabia? 🥰'], en: ['Love that sticker! 😍', 'My favorite! How did you know? 🥰'], zh: ['超爱这个贴纸！😍', '我最喜欢的！你怎么知道？🥰'] },
    stickerMeh: { pt: ['Haha 😄', 'kkkkk', '😂'], en: ['Haha 😄', 'lol', '😂'], zh: ['哈哈 😄', '笑死', '😂'] },
    afterWin: {
      pt: ['Que fase! {kills} zumbis derrotados juntos. 🏆', 'Ganhamos! Você planta muito bem. 😎', 'Vitória! Quando é a próxima? 💚'],
      en: ['What a level! {kills} zombies beaten together. 🏆', 'We won! You plant really well. 😎', 'Victory! When’s the next one? 💚'],
      zh: ['好精彩！我们一起打败了 {kills} 只僵尸。🏆', '我们赢了！你种得真好。😎', '胜利！下一次是什么时候？💚'],
    },
    afterLoss: {
      pt: ['Os zumbis venceram dessa vez... revanche? 😤', 'Não foi dessa vez. Mas eu curti jogar com você. 🌱'],
      en: ['The zombies won this time... rematch? 😤', 'Not this time. But I liked playing with you. 🌱'],
      zh: ['这次僵尸赢了……再来一局？😤', '这次没成功。但我喜欢和你一起玩。🌱'],
    },
    jealous: {
      pt: ['Vi que você jogou sem mim... 🤨', 'Tudo bem, joga com as outras plantas. Eu fico aqui. 😒', 'Nem me chamou pra fase? 💔'],
      en: ['I saw you played without me... 🤨', 'Fine, play with the other plants. I’ll stay here. 😒', 'You didn’t even invite me? 💔'],
      zh: ['我看到你没带我去玩……🤨', '好吧，和别的植物玩吧。我就待在这。😒', '居然不叫我一起？💔'],
    },
    jealousMatch: { pt: ['Vi que você deu match com {name}... quem é? 🤨', 'Então agora é {name}, é? 😒'], en: ['I saw you matched with {name}... who is that? 🤨', 'So it’s {name} now, huh? 😒'], zh: ['我看到你和 {name} 配对了……那是谁？🤨', '所以现在是 {name} 了？😒'] },
    dateWonMsg: { pt: ['Melhor encontro da minha vida! 💕', 'Que dia perfeito! Quando repetimos? 😍'], en: ['Best date of my life! 💕', 'What a perfect day! When do we do it again? 😍'], zh: ['这是我最棒的约会！💕', '完美的一天！什么时候再来？😍'] },
    dateLostMsg: { pt: ['Foi divertido mesmo assim... tenta de novo? 🥺'], en: ['It was fun anyway... try again? 🥺'], zh: ['还是很开心……再试一次？🥺'] },
    relUp: {
      1: { pt: 'Agora é oficial: estamos namorando! 💕', en: 'It’s official: we’re dating! 💕', zh: '正式官宣：我们在交往了！💕' },
      2: { pt: 'Sim! Aceito ser sua noiva! 💍 Agora só falta o casamento...', en: 'Yes! I’ll marry you! 💍 Now we just need the wedding...', zh: '我愿意！💍 现在只差一场婚礼……' },
      3: { pt: 'Felizes para sempre! 💒', en: 'Happily ever after! 💒', zh: '永远幸福！💒' },
    },
    breakup: { pt: 'Acho melhor a gente terminar... você nunca me chama para as fases. 💔', en: 'I think we should break up... you never take me to your levels. 💔', zh: '我觉得我们该分手了……你从来不带我去关卡。💔' },
    giftThanks: { pt: ['Obrigada! 🥰', 'Aaah, que fofo! 💚', 'Você é demais! 😍'], en: ['Thank you! 🥰', 'Aww, so sweet! 💚', 'You’re amazing! 😍'], zh: ['谢谢！🥰', '哇，好贴心！💚', '你太棒了！😍'] },
    giftBackFood: { pt: 'Toma, um adubo pra nossa próxima fase! 🌱', en: 'Here, some plant food for our next level! 🌱', zh: '给你，下一关用的能量豆！🌱' },
    giftBackLikes: { pt: 'Presente pra você: mais curtidas! (mas só olha pra mim, hein 😏)', en: 'A gift for you: more likes! (but only look at me, okay 😏)', zh: '送你：更多喜欢！（但只能看我哦 😏）' },
  });

  // Personalities: the openers and reactions of each plant, her favorite
  // sticker and how easily she ghosts after a bad reply.
  var PERS = {
    sweet: {
      icon: '🥰', sticker: '❤️', ghost: 0.3,
      name: { pt: 'Carinhosa', en: 'Sweet', zh: '温柔' },
      openers: { pt: ['Oi, flor! Que bom que deu match. 🥰', 'Seu perfil me deixou com as folhas vermelhas. ☺️'], en: ['Hi, sunshine! So glad we matched. 🥰', 'Your profile made my leaves blush. ☺️'], zh: ['嗨，小太阳！好高兴配对成功。🥰', '你的资料让我的叶子都红了。☺️'] },
      good: { pt: ['Que amor! 🥰', 'Você é um doce. 💕'], en: ['So sweet! 🥰', 'You’re a sweetheart. 💕'], zh: ['好甜！🥰', '你真贴心。💕'] },
      bad: { pt: ['Ai... isso doeu. 🥺', 'Poxa... 😢'], en: ['Ouch... that hurt. 🥺', 'Aw... 😢'], zh: ['哎……好伤人。🥺', '唉……😢'] },
    },
    shy: {
      icon: '🙈', sticker: '🌻', ghost: 0.6,
      name: { pt: 'Tímida', en: 'Shy', zh: '害羞' },
      openers: { pt: ['o-oi... 🙈', 'Eu nunca sei o que dizer primeiro... oi? 😳'], en: ['h-hi... 🙈', 'I never know what to say first... hi? 😳'], zh: ['你、你好……🙈', '我总不知道先说什么……嗨？😳'] },
      good: { pt: ['*fica vermelha* 😳', 'Obrigada... 🙈'], en: ['*blushes* 😳', 'Thank you... 🙈'], zh: ['*脸红* 😳', '谢谢……🙈'] },
      bad: { pt: ['...', 'Ah. Tá. 😶'], en: ['...', 'Oh. Okay. 😶'], zh: ['……', '哦。好吧。😶'] },
    },
    sassy: {
      icon: '💅', sticker: '🔥', ghost: 0.7,
      name: { pt: 'Atrevida', en: 'Sassy', zh: '傲娇' },
      openers: { pt: ['Demorou pra me curtir, hein? 💅', 'Sim, eu sei que sou a melhor planta do app. Oi. 😏'], en: ['Took you long enough to like me. 💅', 'Yes, I know I’m the best plant here. Hi. 😏'], zh: ['这么久才喜欢我？💅', '对，我知道我是这里最好的植物。嗨。😏'] },
      good: { pt: ['Hmm, gostei de você. 😏', 'Ok, você tem estilo. 🔥'], en: ['Hmm, I like you. 😏', 'Okay, you’ve got style. 🔥'], zh: ['嗯，我喜欢你。😏', '行，你有品位。🔥'] },
      bad: { pt: ['Próximo! 💅', 'Sério? 🙄'], en: ['Next! 💅', 'Seriously? 🙄'], zh: ['下一个！💅', '认真的？🙄'] },
    },
    nerd: {
      icon: '🤓', sticker: '🧟', ghost: 0.4,
      name: { pt: 'Nerd', en: 'Nerd', zh: '学霸' },
      openers: { pt: ['Oi! Sabia que eu li o almanaque inteiro? Duas vezes. 🤓', 'Estatisticamente, a gente ia dar match. Oi! 📊'], en: ['Hi! Did you know I read the whole almanac? Twice. 🤓', 'Statistically, we were bound to match. Hi! 📊'], zh: ['嗨！你知道我把图鉴读了两遍吗？🤓', '从统计上说，我们注定会配对。嗨！📊'] },
      good: { pt: ['Resposta correta! +10 pontos. 🤓', 'Fascinante! 📚'], en: ['Correct answer! +10 points. 🤓', 'Fascinating! 📚'], zh: ['回答正确！+10 分。🤓', '太有意思了！📚'] },
      bad: { pt: ['Isso não faz sentido lógico. 🤨', 'Erro 404: graça não encontrada.'], en: ['That makes no logical sense. 🤨', 'Error 404: charm not found.'], zh: ['这不合逻辑。🤨', '错误 404：找不到魅力。'] },
    },
    brave: {
      icon: '💪', sticker: '🧟', ghost: 0.3,
      name: { pt: 'Corajosa', en: 'Brave', zh: '勇敢' },
      openers: { pt: ['Bora derrotar uns zumbis juntos? 💪', 'Eu fico na primeira fileira. E você? ⚔️'], en: ['Let’s beat some zombies together? 💪', 'I stand in the front row. You? ⚔️'], zh: ['一起去打僵尸吧？💪', '我站第一排。你呢？⚔️'] },
      good: { pt: ['Isso aí! 💪', 'Gostei da atitude! ⚔️'], en: ['That’s it! 💪', 'Love the attitude! ⚔️'], zh: ['就是这样！💪', '喜欢你的态度！⚔️'] },
      bad: { pt: ['Fraco. 😤', 'Esperava mais de você. 😤'], en: ['Weak. 😤', 'I expected more. 😤'], zh: ['太弱了。😤', '我以为你会更好。😤'] },
    },
    drama: {
      icon: '🎭', sticker: '😂', ghost: 0.5,
      name: { pt: 'Dramática', en: 'Dramatic', zh: '戏精' },
      openers: { pt: ['FINALMENTE um match! Eu já estava murchando de solidão. 🎭', 'Ai, meu caule! Você é real? 😱'], en: ['FINALLY a match! I was wilting of loneliness. 🎭', 'Oh my stem! Are you real? 😱'], zh: ['终于配对了！我都孤独得快枯萎了。🎭', '我的茎啊！你是真的吗？😱'] },
      good: { pt: ['Eu vou CHORAR. 😭💕', 'A melhor coisa que já me disseram! 🎭'], en: ['I’m going to CRY. 😭💕', 'Best thing anyone ever told me! 🎭'], zh: ['我要哭了。😭💕', '这是我听过最好的话！🎭'] },
      bad: { pt: ['Que TRAGÉDIA. 😱', 'Meu coração virou adubo. 💔'], en: ['What a TRAGEDY. 😱', 'My heart turned to compost. 💔'], zh: ['真是悲剧！😱', '我的心变成肥料了。💔'] },
    },
  };

  // Dates: the level settings live in x-match.js, these are the texts.
  var DATES = {
    picnic: { name: { pt: 'Piquenique', en: 'Picnic', zh: '野餐' }, desc: { pt: 'O clássico: no mundo da planta, sol rápido.', en: 'The classic: in the plant’s world, fast sun.', zh: '经典约会：在植物的世界，阳光掉落更快。' } },
    candle: { name: { pt: 'Jantar à luz de velas', en: 'Candlelight dinner', zh: '烛光晚餐' }, desc: { pt: 'Idade das Trevas com neblina. Romântico e perigoso.', en: 'Dark Ages with fog. Romantic and dangerous.', zh: '黑暗时代加迷雾。浪漫又危险。' } },
    race: { name: { pt: 'Encontro relâmpago', en: 'Speed date', zh: '闪电约会' }, desc: { pt: 'Ondas apressadas: a próxima chega antes de você acabar a anterior.', en: 'Rushed waves: the next one comes before you finish the last.', zh: '加速波次：上一波还没打完下一波就来了。' } },
    adventure: { name: { pt: 'Aventura no Velho Oeste', en: 'Wild West adventure', zh: '狂野西部冒险' }, desc: { pt: 'Mais ondas e nenhum cortador de grama.', en: 'More waves and no lawn mowers.', zh: '更多波次，没有割草机。' } },
    double: { name: { pt: 'Encontro duplo', en: 'Double date', zh: '双人约会' }, desc: { pt: 'A planta leva uma amiga da mesma família.', en: 'The plant brings a friend from her family.', zh: '植物会带上一位同家族的朋友。' } },
    wedding: { name: { pt: 'Casamento', en: 'Wedding', zh: '婚礼' }, desc: { pt: 'A grande fase: horda de zumbis, com seus outros namoros como convidados.', en: 'The big one: a zombie horde, with your other partners as guests.', zh: '盛大关卡：僵尸大军，其他恋人作为宾客出席。' } },
  };

  // Relationship stages (name, bonus text).
  var STAGES = [
    { icon: '🌱', name: { pt: 'Ficando', en: 'Seeing each other', zh: '暧昧中' }, bonus: { pt: '+25 ☀', en: '+25 ☀', zh: '+25 ☀' } },
    { icon: '💕', name: { pt: 'Namorando', en: 'Dating', zh: '交往中' }, bonus: { pt: '+1 adubo', en: '+1 plant food', zh: '+1 能量豆' } },
    { icon: '💍', name: { pt: 'Noivos', en: 'Engaged', zh: '已订婚' }, bonus: { pt: '+1 adubo, +50 ☀', en: '+1 plant food, +50 ☀', zh: '+1 能量豆，+50 ☀' } },
    { icon: '💒', name: { pt: 'Casados', en: 'Married', zh: '已结婚' }, bonus: { pt: '+2 adubos, +100 ☀', en: '+2 plant food, +100 ☀', zh: '+2 能量豆，+100 ☀' } },
  ];

  X.matchText = { TXT: TXT, CHAT: CHAT, PERS: PERS, DATES: DATES, STAGES: STAGES };
})();
