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
    },
  };

  var lang = (MP.store.get('lang') || navigator.language || 'en').toLowerCase().slice(0, 2);
  MP.lang = STRINGS[lang] ? lang : 'en';
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
