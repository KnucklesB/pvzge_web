/*
 * PvZ2 Gardendless - Multiplayer core: namespace, config, events, storage, i18n.
 */
(function () {
  'use strict';

  var MP = (window.PvZMP = window.PvZMP || {});
  MP.VERSION = '1.0.0';
  MP.PROTOCOL = 1;

  /* ------------------------------------------------------------------ config */

  var cfg = Object.assign({}, window.PVZ_MP_CONFIG || {});
  var params = new URLSearchParams(location.search);
  if (params.get('mp_server')) {
    try {
      var u = new URL(params.get('mp_server'));
      var secure = u.protocol === 'https:' || u.protocol === 'wss:';
      cfg.peer = {
        host: u.hostname,
        port: u.port ? Number(u.port) : secure ? 443 : 80,
        path: u.pathname || '/',
        secure: secure,
      };
    } catch (e) {
      console.warn('[PvZMP] invalid mp_server parameter', e);
    }
  }
  if (params.get('mp_debug')) cfg.debug = true;
  MP.config = cfg;
  MP.params = params;

  MP.log = function () {
    if (!cfg.debug) return;
    var args = Array.prototype.slice.call(arguments);
    args.unshift('[PvZMP]');
    console.log.apply(console, args);
  };
  MP.warn = function () {
    var args = Array.prototype.slice.call(arguments);
    args.unshift('[PvZMP]');
    console.warn.apply(console, args);
  };

  /* ------------------------------------------------------------------ events */

  function Emitter() {
    this._handlers = {};
  }
  Emitter.prototype.on = function (type, fn) {
    (this._handlers[type] = this._handlers[type] || []).push(fn);
    return this;
  };
  Emitter.prototype.off = function (type, fn) {
    var list = this._handlers[type];
    if (!list) return this;
    this._handlers[type] = fn ? list.filter(function (f) { return f !== fn; }) : [];
    return this;
  };
  Emitter.prototype.emit = function (type) {
    var list = this._handlers[type];
    if (!list || !list.length) return;
    var args = Array.prototype.slice.call(arguments, 1);
    list.slice().forEach(function (fn) {
      try {
        fn.apply(null, args);
      } catch (e) {
        console.error('[PvZMP] handler error for', type, e);
      }
    });
  };
  MP.Emitter = Emitter;
  MP.bus = new Emitter();

  /* ----------------------------------------------------------------- storage */

  MP.store = {
    get: function (key, def) {
      try {
        var v = localStorage.getItem('pvzmp.' + key);
        return v == null ? def : JSON.parse(v);
      } catch (e) {
        return def;
      }
    },
    set: function (key, value) {
      try {
        localStorage.setItem('pvzmp.' + key, JSON.stringify(value));
      } catch (e) {
        /* storage unavailable (private mode) */
      }
    },
  };

  /* ------------------------------------------------------------------- utils */

  MP.util = {
    clamp: function (v, a, b) {
      return v < a ? a : v > b ? b : v;
    },
    now: function () {
      return performance.now();
    },
    formatTime: function (sec) {
      sec = Math.max(0, Math.ceil(sec));
      var m = Math.floor(sec / 60);
      var s = sec % 60;
      return m + ':' + (s < 10 ? '0' : '') + s;
    },
    escape: function (s) {
      return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
        return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
      });
    },
    // Tiny DOM builder: el('div.cls#id', {attr}, [children|text])
    el: function (spec, attrs, children) {
      var m = /^([a-z0-9]+)?((?:[.#][\w-]+)*)$/i.exec(spec) || [];
      var node = document.createElement(m[1] || 'div');
      (m[2] || '').replace(/([.#])([\w-]+)/g, function (_, k, v) {
        if (k === '.') node.classList.add(v);
        else node.id = v;
      });
      if (attrs) {
        Object.keys(attrs).forEach(function (k) {
          var v = attrs[k];
          if (v == null || v === false) return;
          if (k === 'text') node.textContent = v;
          else if (k === 'html') node.innerHTML = v;
          else if (k.slice(0, 2) === 'on' && typeof v === 'function') node.addEventListener(k.slice(2), v);
          else if (k === 'style' && typeof v === 'object') Object.assign(node.style, v);
          else node.setAttribute(k, v === true ? '' : v);
        });
      }
      if (children != null) {
        (Array.isArray(children) ? children : [children]).forEach(function (c) {
          if (c == null || c === false) return;
          node.appendChild(typeof c === 'string' || typeof c === 'number' ? document.createTextNode(String(c)) : c);
        });
      }
      return node;
    },
    randomCode: function (len) {
      var alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
      var out = '';
      var buf = new Uint32Array(len);
      (window.crypto || window.msCrypto).getRandomValues(buf);
      for (var i = 0; i < len; i++) out += alphabet[buf[i] % alphabet.length];
      return out;
    },
    // Ignore key events typed into our own inputs so the game doesn't react.
    shieldInput: function (input) {
      ['keydown', 'keyup', 'keypress'].forEach(function (t) {
        input.addEventListener(t, function (e) {
          e.stopPropagation();
        });
      });
    },
  };

  /* -------------------------------------------------------------------- i18n */

  var STRINGS = {
    pt: {
      multiplayer: 'Multiplayer',
      lobby_title: 'Multiplayer',
      lobby_subtitle: 'Jogue com um amigo pela internet',
      your_name: 'Seu nome',
      create_room: 'Criar sala',
      join_room: 'Entrar',
      room_code: 'Código da sala',
      room_code_ph: 'Ex: K7P2Q',
      or: 'ou',
      connecting: 'Conectando...',
      creating: 'Criando sala...',
      waiting_player: 'Aguardando outro jogador...',
      share_code: 'Envie o código para seu amigo',
      copy: 'Copiar',
      copy_link: 'Copiar convite',
      copied: 'Copiado!',
      leave: 'Sair',
      close: 'Fechar',
      back: 'Voltar',
      start: 'Começar!',
      ready: 'Pronto!',
      not_ready: 'Cancelar pronto',
      host: 'Anfitrião',
      guest: 'Convidado',
      you: 'você',
      is_ready: 'Pronto',
      waiting: 'Aguardando',
      empty_slot: 'Vaga livre',
      mode: 'Modo de jogo',
      options: 'Opções',
      mode_coop: 'Cooperativo',
      mode_coop_desc: 'Joguem a campanha juntos. O anfitrião escolhe a fase no mapa e vocês dividem o sol e as sementes.',
      mode_versus: 'Contra',
      mode_versus_desc: 'Plantas contra Zumbis! Um defende o jardim, o outro invade com cartas de zumbi usando cérebros.',
      mode_survival: 'Sobrevivência',
      mode_survival_desc: 'Resistam juntos a ondas cada vez mais fortes. Até onde vocês conseguem chegar?',
      arena: 'Arena',
      your_side: 'Seu lado',
      side_plants: 'Plantas',
      side_zombies: 'Zumbis',
      duration: 'Duração',
      minutes: '{n} min',
      waves: 'Ondas',
      waves_n: '{n} ondas',
      plant_deck: 'Plantas',
      deck_kit: 'Kit balanceado',
      deck_collection: 'Minha coleção',
      stage_modern: 'Jardim',
      stage_egypt: 'Egito Antigo',
      stage_west: 'Velho Oeste',
      stage_future: 'Futuro',
      stage_dark: 'Idade das Trevas',
      only_host_changes: 'Somente o anfitrião altera as opções.',
      guest_must_ready: 'Aguardando o convidado ficar pronto...',
      need_player: 'Aguardando um jogador entrar...',
      starting: 'Iniciando partida...',
      quality: 'Qualidade da transmissão',
      quality_low: 'Baixa',
      quality_medium: 'Média',
      quality_high: 'Alta',
      // errors
      err_not_found: 'Sala não encontrada. Confira o código.',
      err_full: 'Esta sala já está cheia.',
      err_version: 'Versões diferentes do jogo/multiplayer. Atualizem a página.',
      err_network: 'Não foi possível conectar ao servidor multiplayer. Verifique sua internet.',
      err_timeout: 'Tempo de conexão esgotado.',
      err_generic: 'Ocorreu um erro de conexão.',
      err_closed: 'O anfitrião fechou a sala.',
      err_lost: 'A conexão com o outro jogador foi perdida.',
      err_no_stream: 'Seu navegador não suporta transmissão de vídeo do jogo.',
      err_code: 'Digite um código válido.',
      err_name: 'Digite um nome.',
      // in game
      player_joined: '{name} entrou na sala!',
      player_left: '{name} saiu.',
      player_ready: '{name} está pronto!',
      reconnect: 'Reconectar',
      stream_waiting: 'Recebendo transmissão do anfitrião...',
      click_to_play: 'Clique para entrar no jogo',
      host_in_menu: 'O anfitrião está escolhendo a fase...',
      end_session: 'Voltar ao lobby',
      menu: 'Menu',
      ping: '{ms} ms',
      brains: 'Cérebros',
      time_left: 'Tempo',
      wave: 'Onda',
      wave_of: 'Onda {n}/{total}',
      versus_plants_goal: 'Defenda o jardim até o tempo acabar!',
      versus_zombies_goal: 'Alcance a casa antes do tempo acabar!',
      last_30: '30 segundos restantes!',
      pick_zombie: 'Escolha um zumbi e clique em uma linha',
      not_enough_brains: 'Cérebros insuficientes!',
      recharging: 'Carregando...',
      // results
      result_victory: 'Vitória!',
      result_defeat: 'Derrota!',
      result_plants_win: 'As Plantas venceram!',
      result_zombies_win: 'Os Zumbis venceram!',
      result_survived: 'Vocês sobreviveram!',
      result_overrun: 'Os zumbis invadiram!',
      stat_time: 'Tempo de jogo',
      stat_wave: 'Onda alcançada',
      stat_planted: 'Plantas plantadas',
      stat_zombies_sent: 'Zumbis enviados',
      stat_brains_spent: 'Cérebros gastos',
      rematch: 'Jogar de novo',
      to_lobby: 'Voltar ao lobby',
      waiting_host: 'Aguardando o anfitrião...',
      chat_ph: 'Mensagem... (Enter)',
      chat_hint: 'Enter: conversar',
      level_name_versus: 'Contra',
      level_name_survival: 'Sobrevivência',
      p2_label: 'J2',
      coop_hint: 'Modo cooperativo ativo: escolha uma fase no mapa!',
      spectating: 'Assistindo',
      quit_confirm: 'Sair da sala multiplayer?',
      players: 'Jogadores',
      language: 'Idioma',
      controls_hint: 'Convidado: clique nas sementes (ou 1-4, Q-R), D = pá, F = adubo, botão direito cancela. Zumbis: clique num pacote (ou 1-6) e depois numa linha.',
    },
    en: {
      multiplayer: 'Multiplayer',
      lobby_title: 'Multiplayer',
      lobby_subtitle: 'Play with a friend over the internet',
      your_name: 'Your name',
      create_room: 'Create room',
      join_room: 'Join',
      room_code: 'Room code',
      room_code_ph: 'E.g. K7P2Q',
      or: 'or',
      connecting: 'Connecting...',
      creating: 'Creating room...',
      waiting_player: 'Waiting for another player...',
      share_code: 'Send this code to your friend',
      copy: 'Copy',
      copy_link: 'Copy invite',
      copied: 'Copied!',
      leave: 'Leave',
      close: 'Close',
      back: 'Back',
      start: 'Start!',
      ready: 'Ready!',
      not_ready: 'Not ready',
      host: 'Host',
      guest: 'Guest',
      you: 'you',
      is_ready: 'Ready',
      waiting: 'Waiting',
      empty_slot: 'Open slot',
      mode: 'Game mode',
      options: 'Options',
      mode_coop: 'Co-op',
      mode_coop_desc: 'Play the campaign together. The host picks a level on the map and you share sun and seed packets.',
      mode_versus: 'Versus',
      mode_versus_desc: 'Plants vs. Zombies! One defends the lawn, the other invades with zombie packets paid with brains.',
      mode_survival: 'Survival',
      mode_survival_desc: 'Hold out together against ever stronger waves. How far can you go?',
      arena: 'Arena',
      your_side: 'Your side',
      side_plants: 'Plants',
      side_zombies: 'Zombies',
      duration: 'Duration',
      minutes: '{n} min',
      waves: 'Waves',
      waves_n: '{n} waves',
      plant_deck: 'Plants',
      deck_kit: 'Balanced kit',
      deck_collection: 'My collection',
      stage_modern: 'Front Lawn',
      stage_egypt: 'Ancient Egypt',
      stage_west: 'Wild West',
      stage_future: 'Far Future',
      stage_dark: 'Dark Ages',
      only_host_changes: 'Only the host can change the options.',
      guest_must_ready: 'Waiting for the guest to be ready...',
      need_player: 'Waiting for a player to join...',
      starting: 'Starting match...',
      quality: 'Stream quality',
      quality_low: 'Low',
      quality_medium: 'Medium',
      quality_high: 'High',
      err_not_found: 'Room not found. Check the code.',
      err_full: 'This room is already full.',
      err_version: 'Different game/multiplayer versions. Please refresh the page.',
      err_network: 'Could not reach the multiplayer server. Check your connection.',
      err_timeout: 'Connection timed out.',
      err_generic: 'A connection error occurred.',
      err_closed: 'The host closed the room.',
      err_lost: 'Connection to the other player was lost.',
      err_no_stream: 'Your browser does not support game streaming.',
      err_code: 'Enter a valid code.',
      err_name: 'Enter a name.',
      player_joined: '{name} joined the room!',
      player_left: '{name} left.',
      player_ready: '{name} is ready!',
      reconnect: 'Reconnect',
      stream_waiting: 'Receiving the host stream...',
      click_to_play: 'Click to join the game',
      host_in_menu: 'The host is choosing a level...',
      end_session: 'Back to lobby',
      menu: 'Menu',
      ping: '{ms} ms',
      brains: 'Brains',
      time_left: 'Time',
      wave: 'Wave',
      wave_of: 'Wave {n}/{total}',
      versus_plants_goal: 'Defend the lawn until time runs out!',
      versus_zombies_goal: 'Reach the house before time runs out!',
      last_30: '30 seconds left!',
      pick_zombie: 'Pick a zombie and click a lane',
      not_enough_brains: 'Not enough brains!',
      recharging: 'Recharging...',
      result_victory: 'Victory!',
      result_defeat: 'Defeat!',
      result_plants_win: 'The Plants win!',
      result_zombies_win: 'The Zombies win!',
      result_survived: 'You survived!',
      result_overrun: 'The zombies broke through!',
      stat_time: 'Play time',
      stat_wave: 'Wave reached',
      stat_planted: 'Plants planted',
      stat_zombies_sent: 'Zombies sent',
      stat_brains_spent: 'Brains spent',
      rematch: 'Play again',
      to_lobby: 'Back to lobby',
      waiting_host: 'Waiting for the host...',
      chat_ph: 'Message... (Enter)',
      chat_hint: 'Enter: chat',
      level_name_versus: 'Versus',
      level_name_survival: 'Survival',
      p2_label: 'P2',
      coop_hint: 'Co-op is active: pick a level on the map!',
      spectating: 'Spectating',
      quit_confirm: 'Leave the multiplayer room?',
      players: 'Players',
      controls_hint: 'Guest: click seed packets (or 1-4, Q-R), D = shovel, F = plant food, right click cancels. Zombies: click a packet (or 1-6), then a lane.',
      language: 'Language',
    },
    zh: {
      multiplayer: '多人游戏',
      lobby_title: '多人游戏',
      lobby_subtitle: '和朋友在线一起玩',
      your_name: '你的名字',
      create_room: '创建房间',
      join_room: '加入',
      room_code: '房间代码',
      room_code_ph: '例如 K7P2Q',
      or: '或',
      connecting: '正在连接...',
      creating: '正在创建房间...',
      waiting_player: '等待其他玩家...',
      share_code: '把代码发给你的朋友',
      copy: '复制',
      copy_link: '复制邀请',
      copied: '已复制！',
      leave: '离开',
      close: '关闭',
      back: '返回',
      start: '开始！',
      ready: '准备！',
      not_ready: '取消准备',
      host: '房主',
      guest: '客人',
      you: '你',
      is_ready: '已准备',
      waiting: '等待中',
      empty_slot: '空位',
      mode: '游戏模式',
      options: '选项',
      mode_coop: '合作',
      mode_coop_desc: '一起玩冒险模式。房主在地图上选择关卡，你们共享阳光和种子包。',
      mode_versus: '对战',
      mode_versus_desc: '植物对僵尸！一人守护草坪，另一人用脑子购买僵尸卡进攻。',
      mode_survival: '生存',
      mode_survival_desc: '一起抵挡越来越强的僵尸波次。你们能坚持多久？',
      arena: '场地',
      your_side: '你的阵营',
      side_plants: '植物',
      side_zombies: '僵尸',
      duration: '时长',
      minutes: '{n} 分钟',
      waves: '波次',
      waves_n: '{n} 波',
      plant_deck: '植物',
      deck_kit: '平衡卡组',
      deck_collection: '我的收藏',
      stage_modern: '前院',
      stage_egypt: '神秘埃及',
      stage_west: '狂野西部',
      stage_future: '遥远未来',
      stage_dark: '黑暗时代',
      only_host_changes: '只有房主可以修改选项。',
      guest_must_ready: '等待客人准备...',
      need_player: '等待玩家加入...',
      starting: '正在开始...',
      quality: '画面质量',
      quality_low: '低',
      quality_medium: '中',
      quality_high: '高',
      err_not_found: '找不到房间，请检查代码。',
      err_full: '房间已满。',
      err_version: '游戏或多人模块版本不同，请刷新页面。',
      err_network: '无法连接多人服务器，请检查网络。',
      err_timeout: '连接超时。',
      err_generic: '发生连接错误。',
      err_closed: '房主关闭了房间。',
      err_lost: '与另一位玩家的连接已断开。',
      err_no_stream: '你的浏览器不支持游戏画面传输。',
      err_code: '请输入有效的代码。',
      err_name: '请输入名字。',
      player_joined: '{name} 加入了房间！',
      player_left: '{name} 离开了。',
      player_ready: '{name} 已准备！',
      reconnect: '重新连接',
      stream_waiting: '正在接收房主的画面...',
      click_to_play: '点击进入游戏',
      host_in_menu: '房主正在选择关卡...',
      end_session: '返回大厅',
      menu: '菜单',
      ping: '{ms} 毫秒',
      brains: '脑子',
      time_left: '时间',
      wave: '波次',
      wave_of: '第 {n}/{total} 波',
      versus_plants_goal: '守住草坪直到时间结束！',
      versus_zombies_goal: '在时间结束前冲进房子！',
      last_30: '还剩 30 秒！',
      pick_zombie: '选择一个僵尸，再点击一行',
      not_enough_brains: '脑子不够！',
      recharging: '冷却中...',
      result_victory: '胜利！',
      result_defeat: '失败！',
      result_plants_win: '植物获胜！',
      result_zombies_win: '僵尸获胜！',
      result_survived: '你们活下来了！',
      result_overrun: '僵尸突破了防线！',
      stat_time: '游戏时间',
      stat_wave: '到达波次',
      stat_planted: '种植数量',
      stat_zombies_sent: '派出僵尸',
      stat_brains_spent: '花费脑子',
      rematch: '再来一局',
      to_lobby: '返回大厅',
      waiting_host: '等待房主...',
      chat_ph: '消息... (回车)',
      chat_hint: '回车：聊天',
      level_name_versus: '对战',
      level_name_survival: '生存',
      p2_label: 'P2',
      coop_hint: '合作模式已开启：在地图上选择关卡！',
      spectating: '观战中',
      quit_confirm: '离开多人房间？',
      players: '玩家',
      controls_hint: '客人：点击种子包（或 1-4、Q-R），D = 铲子，F = 能量豆，右键取消。僵尸：点击僵尸卡（或 1-6），再点击一行。',
      language: '语言',
    },
  };

  // English by default, like the game. Players can switch in the lobby; the
  // choice is remembered. Without a saved choice the game's own language
  // (English or Chinese) is followed once the game has loaded.
  MP.LANGUAGES = [
    { code: 'en', label: 'English' },
    { code: 'pt', label: 'Português' },
    { code: 'zh', label: '中文' },
  ];
  var saved = MP.store.get('lang');
  MP.lang = STRINGS[saved] ? saved : 'en';
  MP.langChosen = !!STRINGS[saved];
  MP.setLang = function (code, remember) {
    if (!STRINGS[code]) return;
    MP.lang = code;
    if (remember) {
      MP.langChosen = true;
      MP.store.set('lang', code);
    }
    MP.bus.emit('lang', code);
  };
  MP.t = function (key, vars) {
    var s = (STRINGS[MP.lang] && STRINGS[MP.lang][key]) || STRINGS.en[key] || key;
    if (vars) {
      s = s.replace(/\{(\w+)\}/g, function (_, k) {
        return vars[k] != null ? vars[k] : '';
      });
    }
    return s;
  };
})();
