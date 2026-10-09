/*
 * PvZ2 Gardendless - Multiplayer core: namespace, config, events, storage, i18n.
 */
(function () {
  'use strict';

  var MP = (window.PvZMP = window.PvZMP || {});
  MP.VERSION = '2.0.0';
  MP.PROTOCOL = 2;

  /* ------------------------------------------------------------------ config */

  var cfg = Object.assign({}, window.PVZ_MP_CONFIG || {});
  var params = new URLSearchParams(location.search);
  if (params.get('mp_server')) cfg.server = params.get('mp_server');

  // `server` is the base URL of a multiplayer server (see /server): it serves
  // PeerJS signaling under /peerjs/ and the accounts/rooms API under /api/.
  // Without it, signaling falls back to the public PeerJS cloud and the
  // online features (accounts, cloud saves, room list, history) are off.
  cfg.api = null;
  if (cfg.server) {
    try {
      var u = new URL(cfg.server, location.href);
      var secure = u.protocol === 'https:' || u.protocol === 'wss:';
      var base = u.pathname.replace(/\/+$/, '');
      cfg.peer = {
        host: u.hostname,
        port: u.port ? Number(u.port) : secure ? 443 : 80,
        path: base + '/peerjs/',
        secure: secure,
      };
      cfg.api = (secure ? 'https://' : 'http://') + u.host + base + '/api';
    } catch (e) {
      console.warn('[PvZMP] invalid multiplayer server URL', e);
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
      mode_versus_desc: 'Plantas contra Zumbis! Um escolhe as plantas e defende, o outro monta um baralho de zumbis e ataca com cérebros.',
      mode_survival: 'Sobrevivência',
      mode_survival_desc: 'Cada um no seu gramado, vendo a tela do outro ao vivo. Quem aguenta mais ondas?',
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
      difficulty: 'Dificuldade',
      difficulty_easy: 'Fácil',
      difficulty_normal: 'Normal',
      difficulty_hard: 'Difícil',
      plant_pool: 'Plantas disponíveis',
      pool_all: 'Todas',
      pool_classic: 'Clássicas',
      pool_collection: 'Minha coleção',
      seed_slots: 'Espaços de sementes',
      start_sun: 'Sol inicial',
      sun_rate: 'Sol do céu',
      rate_slow: 'Lento',
      rate_normal: 'Normal',
      rate_fast: 'Rápido',
      rate_very_fast: 'Muito rápido',
      plant_cooldown: 'Recarga das plantas',
      mowers: 'Cortadores de grama',
      onoff_on: 'Sim',
      onoff_off: 'Não',
      start_brains: 'Cérebros iniciais',
      brain_rate: 'Geração de cérebros',
      zombie_cooldown: 'Recarga dos zumbis',
      zombie_deck: 'Baralho de zumbis ({n}/{max})',
      zombie_deck_you: 'Você joga de Zumbis: escolha até 6 zumbis (a ordem define as teclas 1-6).',
      zombie_deck_other: 'O jogador de Zumbis escolhe este baralho.',
      plants_pick_note: 'O jogador de Plantas escolhe as plantas na tela de seleção do jogo, antes da partida.',
      survival_note: 'Cada jogador escolhe as próprias plantas no seu gramado.',
      coop_options_note: 'O anfitrião escolhe a fase no mapa. O convidado também pode ajudar a escolher as sementes.',
      deck_full: 'O baralho já tem {n} zumbis.',
      room_visibility: 'Visibilidade da sala',
      room_public: 'Pública',
      room_private: 'Privada',
      result_forfeit: 'O adversário saiu da partida.',
      best_wave: 'Melhor: {name} na onda {n}/{total}',
      survived: 'Sobreviveu',
      fell: 'Caiu',
      fell_at: 'Caiu na onda {n}',
      picking_seeds: 'Escolhendo plantas...',
      stat_result: 'Resultado',
      you_survived: 'Você sobreviveu a todas as ondas! Assistindo {name}...',
      you_fell: 'Você caiu na onda {n}! Assistindo {name}...',
      end_match: 'Encerrar partida',
      end_match_confirm: 'Encerrar a partida e voltar à sala?',
      back_to_room: 'Voltar à sala',
      leave_room: 'Sair da sala',
      waiting_host_rematch: 'O anfitrião pode iniciar a revanche.',
      guest_back_to_room: '{name} voltou para a sala.',
      guest_ended: '{name} encerrou a partida.',
      guest_pick_seeds: 'Escolha suas plantas e clique em "Let\'s Rock!"',
      host_guest_picks_seeds: '{name} está escolhendo as plantas...',
      pip_sound: 'Som do parceiro',
      pip_expand: 'Ampliar',
      pip_back: 'Voltar à minha tela',
      tab_play: 'Jogar',
      tab_rooms: 'Salas',
      tab_history: 'Partidas',
      tab_account: 'Conta',
      account_verified: 'Conta verificada',
      login_hint: 'Entre na sua conta para salvar seu progresso na nuvem:',
      online_unavailable: 'Recurso online indisponível',
      online_unavailable_desc: 'Este site não está conectado a um servidor multiplayer, então contas, salas públicas e histórico estão desativados. Você ainda pode jogar com um amigo usando o código da sala.',
      ago_s: 'há {n}s',
      ago_m: 'há {n} min',
      ago_h: 'há {n} h',
      ago_d: 'há {n} dias',
      public_rooms: 'Salas públicas',
      loading: 'Carregando...',
      refresh: 'Atualizar',
      no_rooms: 'Nenhuma sala aberta agora',
      no_rooms_desc: 'Crie uma sala na aba Jogar e ela aparecerá aqui para outros jogadores.',
      status_playing: 'Jogando',
      status_waiting: 'Aguardando',
      history_all: 'Todas',
      history_mine: 'Minhas',
      login_needed: 'Entre na sua conta para ver suas partidas',
      recent_matches: 'Partidas recentes',
      no_matches: 'Nenhuma partida registrada ainda',
      vs: 'vs',
      wave_short: 'onda {n}',
      username: 'Usuário',
      password: 'Senha',
      password_repeat: 'Repita a senha',
      register: 'Criar conta',
      login: 'Entrar',
      logout: 'Sair da conta',
      account_why: 'Por que criar uma conta?',
      account_why_1: 'Seu progresso do jogo fica salvo na nuvem e sincroniza entre navegadores.',
      account_why_2: 'Suas vitórias e recordes aparecem no histórico de partidas.',
      account_why_3: 'Seu nome aparece verificado (✓) para os outros jogadores.',
      member_since: 'Membro desde {date}',
      stat_matches: 'Partidas',
      stat_wins: 'Vitórias',
      stat_versus_wins: 'Vitórias no Contra',
      stat_best_wave: 'Melhor onda',
      account_created: 'Conta criada! Seu progresso foi enviado para a nuvem.',
      err_bad_username: 'Use de 3 a 20 letras, números, "_", "-" ou ".".',
      err_bad_password: 'A senha precisa de pelo menos 6 caracteres.',
      err_password_match: 'As senhas não são iguais.',
      err_username_taken: 'Este nome de usuário já existe.',
      err_bad_credentials: 'Usuário ou senha incorretos.',
      err_rate_limited: 'Muitas tentativas. Aguarde um minuto.',
      cloud_title: 'Progresso na nuvem',
      cloud_desc: 'Todos os perfis do jogo deste navegador são salvos automaticamente na sua conta.',
      cloud_syncing: 'Sincronizando...',
      cloud_synced: 'Progresso salvo na nuvem!',
      cloud_synced_at: 'Sincronizado {when}',
      cloud_never: 'Ainda não sincronizado',
      cloud_error: 'Não foi possível sincronizar o progresso.',
      cloud_conflict_short: 'Escolha qual progresso manter',
      cloud_conflict: 'Sua conta tem um progresso salvo em {when} que é diferente do progresso deste navegador. Qual você quer manter?',
      cloud_keep_cloud: 'Usar o da nuvem',
      cloud_keep_local: 'Manter este navegador',
      cloud_sync_now: 'Sincronizar agora',
      cloud_download: 'Baixar da nuvem',
      cloud_download_confirm: 'Substituir o progresso deste navegador pelo da nuvem? O jogo será recarregado.',
      cloud_reloading: 'Carregando seu progresso da nuvem...',
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
      mode_versus_desc: 'Plants vs. Zombies! One picks plants and defends, the other builds a zombie deck and attacks with brains.',
      mode_survival: 'Survival',
      mode_survival_desc: 'Each player on their own lawn, watching the other live. Who lasts more waves?',
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
      difficulty: 'Difficulty',
      difficulty_easy: 'Easy',
      difficulty_normal: 'Normal',
      difficulty_hard: 'Hard',
      plant_pool: 'Available plants',
      pool_all: 'All',
      pool_classic: 'Classic',
      pool_collection: 'My collection',
      seed_slots: 'Seed slots',
      start_sun: 'Starting sun',
      sun_rate: 'Sky sun',
      rate_slow: 'Slow',
      rate_normal: 'Normal',
      rate_fast: 'Fast',
      rate_very_fast: 'Very fast',
      plant_cooldown: 'Plant recharge',
      mowers: 'Lawn mowers',
      onoff_on: 'On',
      onoff_off: 'Off',
      start_brains: 'Starting brains',
      brain_rate: 'Brain income',
      zombie_cooldown: 'Zombie recharge',
      zombie_deck: 'Zombie deck ({n}/{max})',
      zombie_deck_you: 'You play the Zombies: pick up to 6 zombies (the order sets keys 1-6).',
      zombie_deck_other: 'The Zombie player picks this deck.',
      plants_pick_note: 'The Plant player picks plants in the game\'s seed chooser before the match.',
      survival_note: 'Each player picks their own plants on their own lawn.',
      coop_options_note: 'The host picks the level on the map. The guest can also help pick the seeds.',
      deck_full: 'The deck already has {n} zombies.',
      room_visibility: 'Room visibility',
      room_public: 'Public',
      room_private: 'Private',
      result_forfeit: 'The opponent left the match.',
      best_wave: 'Best: {name} at wave {n}/{total}',
      survived: 'Survived',
      fell: 'Fell',
      fell_at: 'Fell at wave {n}',
      picking_seeds: 'Picking plants...',
      stat_result: 'Result',
      you_survived: 'You survived every wave! Watching {name}...',
      you_fell: 'You fell at wave {n}! Watching {name}...',
      end_match: 'End match',
      end_match_confirm: 'End the match and go back to the room?',
      back_to_room: 'Back to room',
      leave_room: 'Leave room',
      waiting_host_rematch: 'The host can start a rematch.',
      guest_back_to_room: '{name} went back to the room.',
      guest_ended: '{name} ended the match.',
      guest_pick_seeds: 'Pick your plants and click "Let\'s Rock!"',
      host_guest_picks_seeds: '{name} is picking the plants...',
      pip_sound: 'Partner sound',
      pip_expand: 'Enlarge',
      pip_back: 'Back to my lawn',
      tab_play: 'Play',
      tab_rooms: 'Rooms',
      tab_history: 'Matches',
      tab_account: 'Account',
      account_verified: 'Verified account',
      login_hint: 'Log in to save your progress in the cloud:',
      online_unavailable: 'Online feature unavailable',
      online_unavailable_desc: 'This site is not connected to a multiplayer server, so accounts, public rooms and match history are off. You can still play with a friend using a room code.',
      ago_s: '{n}s ago',
      ago_m: '{n} min ago',
      ago_h: '{n} h ago',
      ago_d: '{n} days ago',
      public_rooms: 'Public rooms',
      loading: 'Loading...',
      refresh: 'Refresh',
      no_rooms: 'No open rooms right now',
      no_rooms_desc: 'Create a room in the Play tab and it will show up here for other players.',
      status_playing: 'Playing',
      status_waiting: 'Waiting',
      history_all: 'All',
      history_mine: 'Mine',
      login_needed: 'Log in to see your matches',
      recent_matches: 'Recent matches',
      no_matches: 'No matches recorded yet',
      vs: 'vs',
      wave_short: 'wave {n}',
      username: 'Username',
      password: 'Password',
      password_repeat: 'Repeat password',
      register: 'Sign up',
      login: 'Log in',
      logout: 'Log out',
      account_why: 'Why create an account?',
      account_why_1: 'Your game progress is saved in the cloud and syncs between browsers.',
      account_why_2: 'Your wins and records show up in the match history.',
      account_why_3: 'Your name shows as verified (✓) to other players.',
      member_since: 'Member since {date}',
      stat_matches: 'Matches',
      stat_wins: 'Wins',
      stat_versus_wins: 'Versus wins',
      stat_best_wave: 'Best wave',
      account_created: 'Account created! Your progress was uploaded to the cloud.',
      err_bad_username: 'Use 3 to 20 letters, numbers, "_", "-" or ".".',
      err_bad_password: 'The password needs at least 6 characters.',
      err_password_match: 'The passwords do not match.',
      err_username_taken: 'This username is already taken.',
      err_bad_credentials: 'Wrong username or password.',
      err_rate_limited: 'Too many attempts. Wait a minute.',
      cloud_title: 'Cloud progress',
      cloud_desc: 'Every game profile in this browser is saved to your account automatically.',
      cloud_syncing: 'Syncing...',
      cloud_synced: 'Progress saved to the cloud!',
      cloud_synced_at: 'Synced {when}',
      cloud_never: 'Not synced yet',
      cloud_error: 'Could not sync your progress.',
      cloud_conflict_short: 'Choose which progress to keep',
      cloud_conflict: 'Your account has progress saved on {when} that differs from this browser\'s progress. Which one do you want to keep?',
      cloud_keep_cloud: 'Use cloud progress',
      cloud_keep_local: 'Keep this browser',
      cloud_sync_now: 'Sync now',
      cloud_download: 'Download from cloud',
      cloud_download_confirm: 'Replace this browser\'s progress with the cloud copy? The game will reload.',
      cloud_reloading: 'Loading your cloud progress...',
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
      mode_versus_desc: '植物对僵尸！一人选植物防守，另一人组建僵尸卡组用脑子进攻。',
      mode_survival: '生存',
      mode_survival_desc: '每人一块草坪，实时观看对方画面。谁能坚持更多波？',
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
      difficulty: '难度',
      difficulty_easy: '简单',
      difficulty_normal: '普通',
      difficulty_hard: '困难',
      plant_pool: '可用植物',
      pool_all: '全部',
      pool_classic: '经典',
      pool_collection: '我的收藏',
      seed_slots: '卡槽数',
      start_sun: '初始阳光',
      sun_rate: '天降阳光',
      rate_slow: '慢',
      rate_normal: '普通',
      rate_fast: '快',
      rate_very_fast: '很快',
      plant_cooldown: '植物冷却',
      mowers: '割草机',
      onoff_on: '开',
      onoff_off: '关',
      start_brains: '初始脑子',
      brain_rate: '脑子产量',
      zombie_cooldown: '僵尸冷却',
      zombie_deck: '僵尸卡组（{n}/{max}）',
      zombie_deck_you: '你是僵尸方：最多选 6 个僵尸（顺序对应按键 1-6）。',
      zombie_deck_other: '由僵尸方选择这套卡组。',
      plants_pick_note: '植物方在开局前的选卡界面选择植物。',
      survival_note: '每位玩家在自己的草坪上选择植物。',
      coop_options_note: '房主在地图上选择关卡，客人也可以帮忙选卡。',
      deck_full: '卡组已有 {n} 个僵尸。',
      room_visibility: '房间可见性',
      room_public: '公开',
      room_private: '私密',
      result_forfeit: '对手离开了对局。',
      best_wave: '最佳：{name} 第 {n}/{total} 波',
      survived: '存活',
      fell: '失败',
      fell_at: '在第 {n} 波失败',
      picking_seeds: '正在选卡...',
      stat_result: '结果',
      you_survived: '你坚持到了最后！正在观看 {name}...',
      you_fell: '你在第 {n} 波失败！正在观看 {name}...',
      end_match: '结束对局',
      end_match_confirm: '结束对局并返回房间？',
      back_to_room: '返回房间',
      leave_room: '离开房间',
      waiting_host_rematch: '房主可以开始再来一局。',
      guest_back_to_room: '{name} 返回了房间。',
      guest_ended: '{name} 结束了对局。',
      guest_pick_seeds: '选好植物后点击 "Let\'s Rock!"',
      host_guest_picks_seeds: '{name} 正在选择植物...',
      pip_sound: '对方声音',
      pip_expand: '放大',
      pip_back: '返回我的草坪',
      tab_play: '开始',
      tab_rooms: '房间',
      tab_history: '战绩',
      tab_account: '账号',
      account_verified: '已验证账号',
      login_hint: '登录账号以在云端保存进度：',
      online_unavailable: '在线功能不可用',
      online_unavailable_desc: '本站未连接多人服务器，账号、公开房间和战绩不可用。你仍可用房间代码和朋友一起玩。',
      ago_s: '{n} 秒前',
      ago_m: '{n} 分钟前',
      ago_h: '{n} 小时前',
      ago_d: '{n} 天前',
      public_rooms: '公开房间',
      loading: '加载中...',
      refresh: '刷新',
      no_rooms: '暂无开放房间',
      no_rooms_desc: '在“开始”页创建房间，其他玩家就能在这里看到。',
      status_playing: '游戏中',
      status_waiting: '等待中',
      history_all: '全部',
      history_mine: '我的',
      login_needed: '登录后可查看你的战绩',
      recent_matches: '最近对局',
      no_matches: '暂无对局记录',
      vs: '对',
      wave_short: '第 {n} 波',
      username: '用户名',
      password: '密码',
      password_repeat: '重复密码',
      register: '注册',
      login: '登录',
      logout: '退出登录',
      account_why: '为什么要注册？',
      account_why_1: '游戏进度保存在云端，可在不同浏览器同步。',
      account_why_2: '你的胜场和纪录会显示在战绩中。',
      account_why_3: '其他玩家会看到你的名字带有验证标记（✓）。',
      member_since: '注册于 {date}',
      stat_matches: '对局',
      stat_wins: '胜利',
      stat_versus_wins: '对战胜利',
      stat_best_wave: '最高波次',
      account_created: '账号已创建！进度已上传到云端。',
      err_bad_username: '请使用 3-20 个字母、数字、"_"、"-" 或 "."。',
      err_bad_password: '密码至少需要 6 个字符。',
      err_password_match: '两次输入的密码不一致。',
      err_username_taken: '该用户名已被使用。',
      err_bad_credentials: '用户名或密码错误。',
      err_rate_limited: '尝试次数过多，请稍等一分钟。',
      cloud_title: '云端进度',
      cloud_desc: '此浏览器中的所有游戏存档都会自动保存到你的账号。',
      cloud_syncing: '同步中...',
      cloud_synced: '进度已保存到云端！',
      cloud_synced_at: '已同步（{when}）',
      cloud_never: '尚未同步',
      cloud_error: '无法同步进度。',
      cloud_conflict_short: '请选择要保留的进度',
      cloud_conflict: '你的账号在 {when} 保存的进度与本浏览器不同。要保留哪一个？',
      cloud_keep_cloud: '使用云端进度',
      cloud_keep_local: '保留本浏览器',
      cloud_sync_now: '立即同步',
      cloud_download: '从云端下载',
      cloud_download_confirm: '用云端进度覆盖本浏览器进度？游戏将重新加载。',
      cloud_reloading: '正在加载云端进度...',
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
