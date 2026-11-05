/*
 * PvZ2 Gardendless - Extras: namespace, settings, translations, server API.
 *
 * Extras are single-player additions loaded after the multiplayer module
 * (they reuse its bridge to the game internals, MP.game, and its account
 * API). They never modify the game bundle: everything is done by wrapping
 * the game's own classes at runtime (see x-play.js, x-modes.js).
 *
 * Gameplay changes (speed, mutators, auto-collect) are switched off while a
 * multiplayer room is open, so online matches stay fair.
 */
(function () {
  'use strict';

  var MP = window.PvZMP;
  var X = (window.PvZX = new MP.Emitter());
  X.VERSION = '1.5.0';

  /* ------------------------------------------------------------ storage */

  X.store = {
    get: function (key, def) {
      try {
        var v = localStorage.getItem('pvzx.' + key);
        return v == null ? def : JSON.parse(v);
      } catch (e) {
        return def;
      }
    },
    set: function (key, value) {
      try {
        localStorage.setItem('pvzx.' + key, JSON.stringify(value));
      } catch (e) {}
    },
  };

  /* ----------------------------------------------------------- settings */

  X.SPEEDS = [0.5, 1, 2, 3];

  var DEFAULTS = {
    speed: 1, // extra multiplier on top of the game's own 1x / 1.5x button
    autoSun: false,
    autoCoins: false, // coins, gems, tickets, sprouts
    autoFood: false,
    hpZombies: true,
    hpPlants: true,
    dmgNumbers: false,
    preview: true,
    summary: true,
    hud: true,
    mutatorsOn: false,
    mutators: {},
  };

  X.settings = Object.assign({}, DEFAULTS, X.store.get('settings', {}));
  X.settings.mutators = Object.assign({}, X.settings.mutators || {});

  X.set = function (key, value) {
    X.settings[key] = value;
    X.store.set('settings', X.settings);
    X.emit('settings', key, value);
  };

  X.toggle = function (key) {
    X.set(key, !X.settings[key]);
    return X.settings[key];
  };

  // Gameplay extras are off while a multiplayer room is open.
  X.online = function () {
    return !!(MP.app && MP.app.session);
  };

  /* ------------------------------------------------------- translations */

  var STRINGS = {
    pt: {
      extras: 'Extras',
      extras_title: 'Extras',
      tab_modes: 'Modos',
      tab_options: 'Opções',
      tab_mutators: 'Mutadores',
      tab_achievements: 'Conquistas',
      tab_ranking: 'Placar',
      tab_cloud: 'Nuvem',
      tab_visual: "Visual",
      vis_title: "Logos e imagens",
      vis_desc: "Troque logos e imagens do jogo para todos os jogadores deste servidor. As mudanças aparecem na hora neste navegador (prévia); clique em \"Salvar para todos\" para publicar. As imagens são esticadas para o tamanho da original: use a mesma proporção (o tamanho aparece em cada item).",
      vis_tab: "Aba do navegador",
      vis_page_title: "Título",
      vis_icon: "Ícone",
      vis_icon_tip: "PNG quadrado, por exemplo 64×64",
      vis_menu_logo: "Logo do menu",
      vis_menu_logo_tip: "Uma imagem desenhada sobre o fundo do menu, onde fica o logo do jogo. O logo original faz parte do fundo: para sumir com ele, troque também o \"Fundo do menu\".",
      vis_logo_image: "Imagem do logo",
      vis_x: "Horizontal",
      vis_y: "Vertical",
      vis_scale: "Tamanho",
      vis_quick: "Telas principais",
      vis_quick_tip: "Original → nova. \"Baixar original\" salva a imagem do jogo para você editar e reenviar.",
      vis_slot_menu_bg: "Fundo do menu (inclui o logo)",
      vis_slot_loading_bg: "Fundo da tela de carregamento",
      vis_slot_loading_logo: "Logo da tela de carregamento",
      vis_any: "Qualquer imagem do jogo",
      vis_any_tip: "Busque pelo nome da imagem (em inglês, como no jogo: BtnPurpleBigUp, SettingUp, PlayerIcon...). A lista mostra as imagens já carregadas: abra antes a tela onde ela aparece. Personagens animados (plantas e zumbis) não estão nesta lista.",
      vis_search: "Nome da imagem (mín. 2 letras)",
      vis_none: "Nenhuma imagem carregada com esse nome.",
      vis_replaced: "Outras imagens trocadas",
      vis_choose: "Escolher",
      vis_remove: "Remover",
      vis_download: "Baixar original",
      vis_download_tip: "Salva a imagem original do jogo em PNG",
      vis_no_original: "Não foi possível obter a imagem original.",
      vis_size: "tamanho {size}",
      vis_save: "Salvar para todos",
      vis_discard: "Descartar mudanças",
      vis_saving: "Enviando imagens...",
      vis_saved: "Visual salvo. Os jogadores veem ao abrir ou recarregar o jogo.",
      vis_too_large: "Imagem grande demais (máx. 8 MB).",
      vis_static: "Sem servidor multiplayer, o visual vem do arquivo branding/branding.json, ao lado do index.html. Crie a pasta docs/branding com o arquivo e as imagens:",
      vis_static_example: "{\n  \"title\": \"Meu servidor\",\n  \"icon\": \"branding/icone.png\",\n  \"menuLogo\": { \"url\": \"branding/logo.png\", \"x\": 0, \"y\": 0.22, \"scale\": 0.55 },\n  \"frames\": {\n    \"SPL9\": \"branding/fundo.png\",\n    \"SPL10\": \"branding/fundo.png\",\n    \"splash\": \"branding/carregamento.png\",\n    \"logoGardendless\": \"branding/logo.png\"\n  }\n}",
      close: 'Fechar',
      play: 'Jogar',
      on: 'Ligado',
      off: 'Desligado',
      // modes
      mode_sandbox: 'Sandbox',
      mode_sandbox_desc: 'Teste qualquer planta contra qualquer zumbi: sol infinito, sem recarga e a barra de zumbis do jogo para soltá-los onde quiser.',
      mode_endless: 'Sobrevivência sem fim',
      mode_endless_desc: 'Ondas cada vez maiores até você perder. Seu recorde vai para o placar.',
      mode_daily: 'Desafio Diário',
      mode_inverted: "Modo Invertido",
      mode_inverted_desc: "Os papéis se invertem: as plantas avançam pelo gramado e você defende com zumbis. Escolha um zumbi na barra e clique numa casa da metade direita: ele fica ali segurando a linha. Se uma planta passar da última coluna, você perde.",
      inv_wave: "Onda {n}/{total}",
      mode_mirror: "Modo Espelhado",
      mode_mirror_desc: "O Modo Invertido de trás para frente: as plantas entram pela direita, viradas para a esquerda, e avançam atirando nos seus zumbis, que defendem a metade esquerda virados para a direita. Escolha um zumbi e clique numa casa da metade esquerda.",
      ranking_mirror: "Modo Espelhado",
      inv_f_advance: "Avanço",
      inv_f_wall: "Muralha",
      inv_f_rush: "Investida",
      inv_f_artillery: "Artilharia",
      inv_f_focus: "Ataque concentrado",
      inv_f_elite: "Elite",
      inv_f_huge: "Onda gigante!",
      inv_jalapeno: "Jalapenho na linha {n}! Saia da frente!",
      inv_killed: "{n} plantas derrotadas",
      inv_won: "Os zumbis resistiram!",
      inv_lost: "As plantas passaram!",
      inv_again: "Jogar de novo",
      inv_menu: "Menu",
      inv_best: "Recorde: {n} pts",
      inv_help: "Teclas 1-6 escolhem o zumbi; botão direito cancela. Cérebros: renda contínua e bônus por planta derrotada.",
      ranking_inverted: "Modo Invertido",
      mode_daily_desc: 'Uma fase nova a cada dia, igual para todos: arena, plantas e mutadores sorteados. Uma tentativa vale para o placar do dia.',
      arena: 'Arena',
      sandbox_waves: 'Ondas de zumbis',
      sandbox_waves_off: 'Só os que eu soltar',
      sandbox_waves_on: 'Ondas normais',
      infinite_sun: 'Sol infinito',
      no_cooldown: 'Sem recarga',
      mowers: 'Cortadores',
      difficulty: 'Dificuldade',
      difficulty_easy: 'Fácil',
      difficulty_normal: 'Normal',
      difficulty_hard: 'Difícil',
      best_wave: 'Recorde: onda {n}',
      daily_today: 'Desafio de {date}',
      daily_arena: 'Arena: {arena}',
      daily_plants: 'Plantas',
      daily_mutators: 'Mutadores do dia',
      daily_none: 'nenhum',
      daily_done: 'Você já jogou hoje: {score} pontos. Pode jogar de novo, mas só a melhor pontuação conta.',
      stage_modern: 'Jardim', stage_egypt: 'Egito', stage_west: 'Velho Oeste', stage_future: 'Futuro', stage_dark: 'Idade das Trevas',
      // options
      opt_speed: 'Velocidade extra',
      opt_speed_desc: 'Multiplica a velocidade do jogo (soma com o botão 1,5x do jogo). Teclas: - e =',
      opt_auto: 'Coleta automática',
      opt_auto_sun: 'Sol',
      opt_auto_coins: 'Moedas, gemas e brotos',
      opt_auto_food: 'Adubo',
      opt_hp: 'Barras de vida',
      opt_hp_zombies: 'Zumbis',
      opt_hp_plants: 'Plantas feridas',
      opt_dmg: 'Números de dano',
      opt_preview: 'Prévia dos zumbis da fase',
      opt_summary: 'Resumo no fim da fase',
      opt_hud: 'Barra de atalhos na partida',
      opt_online_note: 'Velocidade, coleta automática e mutadores ficam desligados durante partidas multiplayer.',
      // mutators
      mutators_desc: 'Deixe qualquer fase do jogo mais difícil (ou diferente). Valem para fases solo: campanha, Sobrevivência e Sandbox.',
      mutators_enable: 'Usar mutadores',
      mut_tough: 'Zumbis reforçados',
      mut_tough_desc: 'Zumbis com o dobro de vida.',
      mut_horde: 'Horda dupla',
      mut_horde_desc: 'Cada onda traz o dobro de zumbis.',
      mut_scarce: 'Sol escasso',
      mut_scarce_desc: 'Metade do sol inicial e sol do céu mais lento.',
      mut_nomowers: 'Sem cortadores',
      mut_nomowers_desc: 'Nenhum cortador de grama.',
      mut_rush: 'Ondas aceleradas',
      mut_rush_desc: 'A próxima onda chega antes.',
      mut_slowseeds: 'Recarga lenta',
      mut_slowseeds_desc: 'Sementes demoram o dobro para recarregar.',
      mut_nofood: 'Sem adubo',
      mut_nofood_desc: 'Zumbis não deixam adubo cair.',
      mut_fog: 'Névoa',
      mut_fog_desc: 'Névoa cobre o lado direito do gramado.',
      mut_fast: 'Zumbis apressados',
      mut_fast_desc: 'Zumbis andam 50% mais rápido.',
      mutators_active: '{n} mutador(es) ativo(s)',
      // hud
      hud_speed: 'Velocidade extra (- / =)',
      hud_auto: 'Coleta automática',
      hud_hp: 'Barras de vida (V)',
      hud_preview: 'Zumbis da fase',
      // preview
      preview_title: 'Zumbis desta fase',
      preview_waves: '{n} ondas',
      preview_flags: '{n} bandeiras',
      preview_from: 'onda {n}',
      preview_dynamic: 'aleatório',
      preview_unknown: 'Esta fase não mostra os zumbis com antecedência.',
      // summary
      summary_title_won: 'Fase concluída!',
      summary_title_lost: 'Os zumbis venceram...',
      summary_time: 'Tempo',
      summary_kills: 'Zumbis derrotados',
      summary_sun: 'Sol coletado',
      summary_planted: 'Plantas plantadas',
      summary_lost: 'Plantas perdidas',
      summary_food: 'Adubos usados',
      summary_mowers: 'Cortadores usados',
      summary_waves: 'Ondas',
      summary_top: 'Planta mais usada',
      summary_score: 'Pontuação',
      summary_survived: 'Ondas sobrevividas',
      summary_best: 'Novo recorde!',
      summary_rank: '{n}º lugar no placar',
      summary_login: 'Entre na sua conta para ir ao placar.',
      // achievements
      ach_unlocked: 'Conquista desbloqueada: {name}',
      ach_progress: '{n} de {total} conquistas',
      ach_synced: 'Salvas na sua conta',
      ach_local: 'Salvas neste navegador. Entre na sua conta para guardá-las na nuvem.',
      // ranking
      ranking_daily: 'Desafio de hoje',
      ranking_survival: 'Sobrevivência sem fim',
      ranking_empty: 'Ninguém pontuou ainda.',
      ranking_offline: 'O placar precisa do servidor multiplayer.',
      ranking_you: 'Você: {rank}º ({score})',
      points: '{n} pts',
      wave_n: 'onda {n}',
      // cloud
      cloud_desc: 'Versões anteriores do seu save na nuvem. Restaurar uma delas troca o save atual (que continua guardado aqui) e o jogo recarrega.',
      cloud_profiles: 'Perfis no save atual',
      cloud_history: 'Versões anteriores',
      cloud_restore: 'Restaurar',
      file_title: "Restaurar de um arquivo (.json)",
      file_desc: "Importe um save exportado (botão Exportar aqui ou na janela Conta). Ele substitui o progresso deste navegador e o jogo recarrega; com conta, ele também vai para a nuvem e o save anterior fica no histórico abaixo.",
      file_import: "Importar save (.json)",
      file_export: "Exportar save (.json)",
      file_bad: "Arquivo de save inválido.",
      file_confirm: "Substituir o progresso deste navegador pelo arquivo \"{name}\" (perfis: {profiles})? O jogo será recarregado.",
      file_only_menu: "Volte ao menu principal para importar um save.",
      file_applied: "Save importado. Recarregando o jogo...",
      file_applied_cloud: "Save importado. Recarregando; ele será enviado para a sua conta.",
      file_empty: "Não há perfis para exportar.",
      file_forbidden: "Neste servidor só administradores podem importar saves (ADMIN_USERS, ou SAVE_IMPORT=all para todos).",
      file_login: "Entre na sua conta para importar: este servidor controla quem pode importar saves.",
      cloud_restored: 'Save restaurado. Recarregando...',
      cloud_empty: 'Nenhuma versão anterior ainda.',
      cloud_login: 'Entre na sua conta (botão Conta no menu) para ver o histórico do seu save.',
      cloud_offline: 'O histórico de saves precisa do servidor multiplayer.',
      cloud_confirm: 'Restaurar a versão de {date}? O save atual fica guardado no histórico.',
      coins: 'moedas', gems: 'gemas',
      reason_update: 'sincronização', reason_restore: 'antes de restaurar', reason_admin: 'editado por admin', reason_migrated: 'backup antigo',
      only_menu: 'Volte ao menu principal para iniciar um modo.',
      loading: 'Carregando...',
      error: 'Não foi possível: {e}',
    },
    en: {
      extras: 'Extras',
      extras_title: 'Extras',
      tab_modes: 'Modes',
      tab_options: 'Options',
      tab_mutators: 'Mutators',
      tab_achievements: 'Achievements',
      tab_ranking: 'Leaderboard',
      tab_cloud: 'Cloud',
      tab_visual: "Visual",
      vis_title: "Logos and images",
      vis_desc: "Replace the game's logos and images for every player of this server. Changes show right away in this browser (preview); click \"Save for everyone\" to publish. Images are stretched to the original's size: keep the same proportions (each item shows it).",
      vis_tab: "Browser tab",
      vis_page_title: "Title",
      vis_icon: "Icon",
      vis_icon_tip: "Square PNG, e.g. 64×64",
      vis_menu_logo: "Menu logo",
      vis_menu_logo_tip: "An image drawn over the menu background, where the game's logo is. The original logo is part of the background: replace the \"Menu background\" too to remove it.",
      vis_logo_image: "Logo image",
      vis_x: "Horizontal",
      vis_y: "Vertical",
      vis_scale: "Size",
      vis_quick: "Main screens",
      vis_quick_tip: "Original → new. \"Download original\" saves the game's image for you to edit and upload back.",
      vis_slot_menu_bg: "Menu background (includes the logo)",
      vis_slot_loading_bg: "Loading screen background",
      vis_slot_loading_logo: "Loading screen logo",
      vis_any: "Any game image",
      vis_any_tip: "Search by the image name (as in the game: BtnPurpleBigUp, SettingUp, PlayerIcon...). The list shows images already loaded: open the screen where it appears first. Animated characters (plants and zombies) are not in this list.",
      vis_search: "Image name (at least 2 letters)",
      vis_none: "No loaded image with that name.",
      vis_replaced: "Other replaced images",
      vis_choose: "Choose",
      vis_remove: "Remove",
      vis_download: "Download original",
      vis_download_tip: "Saves the game's original image as PNG",
      vis_no_original: "Could not get the original image.",
      vis_size: "size {size}",
      vis_save: "Save for everyone",
      vis_discard: "Discard changes",
      vis_saving: "Uploading images...",
      vis_saved: "Visual saved. Players see it when they open or reload the game.",
      vis_too_large: "Image too large (max 8 MB).",
      vis_static: "Without a multiplayer server, the visual comes from the file branding/branding.json next to index.html. Create the folder docs/branding with the file and the images:",
      vis_static_example: "{\n  \"title\": \"My server\",\n  \"icon\": \"branding/icon.png\",\n  \"menuLogo\": { \"url\": \"branding/logo.png\", \"x\": 0, \"y\": 0.22, \"scale\": 0.55 },\n  \"frames\": {\n    \"SPL9\": \"branding/background.png\",\n    \"SPL10\": \"branding/background.png\",\n    \"splash\": \"branding/loading.png\",\n    \"logoGardendless\": \"branding/logo.png\"\n  }\n}",
      close: 'Close',
      play: 'Play',
      on: 'On',
      off: 'Off',
      mode_sandbox: 'Sandbox',
      mode_sandbox_desc: 'Test any plant against any zombie: infinite sun, no recharge and the game\'s zombie bar to drop them wherever you like.',
      mode_endless: 'Endless Survival',
      mode_endless_desc: 'Ever bigger waves until you lose. Your best run goes to the leaderboard.',
      mode_daily: 'Daily Challenge',
      mode_inverted: "Inverted Mode",
      mode_inverted_desc: "Roles reversed: the plants march across the lawn and you defend with zombies. Pick a zombie on the bar and click a square of the right half: it holds that line. If a plant walks past the last column, you lose.",
      inv_wave: "Wave {n}/{total}",
      mode_mirror: "Mirrored Mode",
      mode_mirror_desc: "The Inverted Mode back to front: the plants come in from the right, turned to face left, and march shooting at your zombies, who defend the left half facing right. Pick a zombie and click a square of the left half.",
      ranking_mirror: "Mirrored Mode",
      inv_f_advance: "Advance",
      inv_f_wall: "Wall",
      inv_f_rush: "Rush",
      inv_f_artillery: "Artillery",
      inv_f_focus: "Focused attack",
      inv_f_elite: "Elite",
      inv_f_huge: "Huge wave!",
      inv_jalapeno: "Jalapeno on lane {n}! Get out of the way!",
      inv_killed: "{n} plants defeated",
      inv_won: "The zombies held!",
      inv_lost: "The plants broke through!",
      inv_again: "Play again",
      inv_menu: "Menu",
      inv_best: "Best: {n} pts",
      inv_help: "Keys 1-6 pick a zombie; right click cancels. Brains: steady income plus a bonus per plant defeated.",
      ranking_inverted: "Inverted Mode",
      mode_daily_desc: 'A new level every day, the same for everyone: random arena, plants and mutators. Your best score counts for the day\'s leaderboard.',
      arena: 'Arena',
      sandbox_waves: 'Zombie waves',
      sandbox_waves_off: 'Only the ones I drop',
      sandbox_waves_on: 'Normal waves',
      infinite_sun: 'Infinite sun',
      no_cooldown: 'No recharge',
      mowers: 'Lawn mowers',
      difficulty: 'Difficulty',
      difficulty_easy: 'Easy',
      difficulty_normal: 'Normal',
      difficulty_hard: 'Hard',
      best_wave: 'Best: wave {n}',
      daily_today: 'Challenge of {date}',
      daily_arena: 'Arena: {arena}',
      daily_plants: 'Plants',
      daily_mutators: 'Today\'s mutators',
      daily_none: 'none',
      daily_done: 'You already played today: {score} points. You can play again; only your best score counts.',
      stage_modern: 'Front Yard', stage_egypt: 'Egypt', stage_west: 'Wild West', stage_future: 'Far Future', stage_dark: 'Dark Ages',
      opt_speed: 'Extra speed',
      opt_speed_desc: 'Multiplies the game speed (on top of the game\'s 1.5x button). Keys: - and =',
      opt_auto: 'Auto-collect',
      opt_auto_sun: 'Sun',
      opt_auto_coins: 'Coins, gems and sprouts',
      opt_auto_food: 'Plant food',
      opt_hp: 'Health bars',
      opt_hp_zombies: 'Zombies',
      opt_hp_plants: 'Damaged plants',
      opt_dmg: 'Damage numbers',
      opt_preview: 'Level zombie preview',
      opt_summary: 'End-of-level summary',
      opt_hud: 'Shortcut bar in levels',
      opt_online_note: 'Speed, auto-collect and mutators are off during multiplayer matches.',
      mutators_desc: 'Make any level harder (or just different). They apply to single-player levels: campaign, Survival and Sandbox.',
      mutators_enable: 'Use mutators',
      mut_tough: 'Tough zombies',
      mut_tough_desc: 'Zombies have double health.',
      mut_horde: 'Double horde',
      mut_horde_desc: 'Every wave brings twice the zombies.',
      mut_scarce: 'Scarce sun',
      mut_scarce_desc: 'Half the starting sun and slower sky sun.',
      mut_nomowers: 'No mowers',
      mut_nomowers_desc: 'No lawn mowers.',
      mut_rush: 'Rushed waves',
      mut_rush_desc: 'The next wave comes sooner.',
      mut_slowseeds: 'Slow recharge',
      mut_slowseeds_desc: 'Seeds take twice as long to recharge.',
      mut_nofood: 'No plant food',
      mut_nofood_desc: 'Zombies drop no plant food.',
      mut_fog: 'Fog',
      mut_fog_desc: 'Fog covers the right side of the lawn.',
      mut_fast: 'Hasty zombies',
      mut_fast_desc: 'Zombies walk 50% faster.',
      mutators_active: '{n} mutator(s) on',
      hud_speed: 'Extra speed (- / =)',
      hud_auto: 'Auto-collect',
      hud_hp: 'Health bars (V)',
      hud_preview: 'Level zombies',
      preview_title: 'Zombies in this level',
      preview_waves: '{n} waves',
      preview_flags: '{n} flags',
      preview_from: 'wave {n}',
      preview_dynamic: 'random',
      preview_unknown: 'This level does not reveal its zombies in advance.',
      summary_title_won: 'Level complete!',
      summary_title_lost: 'The zombies won...',
      summary_time: 'Time',
      summary_kills: 'Zombies defeated',
      summary_sun: 'Sun collected',
      summary_planted: 'Plants planted',
      summary_lost: 'Plants lost',
      summary_food: 'Plant food used',
      summary_mowers: 'Mowers used',
      summary_waves: 'Waves',
      summary_top: 'Most used plant',
      summary_score: 'Score',
      summary_survived: 'Waves survived',
      summary_best: 'New best!',
      summary_rank: 'Rank {n} on the leaderboard',
      summary_login: 'Log in to your account to enter the leaderboard.',
      ach_unlocked: 'Achievement unlocked: {name}',
      ach_progress: '{n} of {total} achievements',
      ach_synced: 'Saved to your account',
      ach_local: 'Saved in this browser. Log in to keep them in the cloud.',
      ranking_daily: 'Today\'s challenge',
      ranking_survival: 'Endless Survival',
      ranking_empty: 'No scores yet.',
      ranking_offline: 'The leaderboard needs the multiplayer server.',
      ranking_you: 'You: #{rank} ({score})',
      points: '{n} pts',
      wave_n: 'wave {n}',
      cloud_desc: 'Earlier versions of your cloud save. Restoring one replaces the current save (which stays in this list) and reloads the game.',
      cloud_profiles: 'Profiles in the current save',
      cloud_history: 'Earlier versions',
      cloud_restore: 'Restore',
      file_title: "Restore from a file (.json)",
      file_desc: "Import an exported save (Export button here or in the Account window). It replaces the progress in this browser and the game reloads; with an account it also goes to the cloud and the previous save stays in the history below.",
      file_import: "Import save (.json)",
      file_export: "Export save (.json)",
      file_bad: "Invalid save file.",
      file_confirm: "Replace the progress in this browser with \"{name}\" (profiles: {profiles})? The game will reload.",
      file_only_menu: "Go back to the main menu to import a save.",
      file_applied: "Save imported. Reloading the game...",
      file_applied_cloud: "Save imported. Reloading; it will be uploaded to your account.",
      file_empty: "There are no profiles to export.",
      file_forbidden: "On this server only admins may import saves (ADMIN_USERS, or SAVE_IMPORT=all for everyone).",
      file_login: "Log in to import: this server controls who may import saves.",
      cloud_restored: 'Save restored. Reloading...',
      cloud_empty: 'No earlier versions yet.',
      cloud_login: 'Log in to your account (Account button on the menu) to see your save history.',
      cloud_offline: 'Save history needs the multiplayer server.',
      cloud_confirm: 'Restore the version from {date}? The current save stays in the history.',
      coins: 'coins', gems: 'gems',
      reason_update: 'sync', reason_restore: 'before a restore', reason_admin: 'edited by an admin', reason_migrated: 'old backup',
      only_menu: 'Go back to the main menu to start a mode.',
      loading: 'Loading...',
      error: 'Could not do it: {e}',
    },
    zh: {
      extras: '扩展',
      extras_title: '扩展功能',
      tab_modes: '模式',
      tab_options: '选项',
      tab_mutators: '变异',
      tab_achievements: '成就',
      tab_ranking: '排行榜',
      tab_cloud: '云存档',
      tab_visual: "外观",
      vis_title: "标志和图片",
      vis_desc: "为本服务器的所有玩家替换游戏的标志和图片。更改会立即在此浏览器中预览；点击“为所有人保存”发布。图片会拉伸到原图大小：请保持相同比例（每项都显示尺寸）。",
      vis_tab: "浏览器标签页",
      vis_page_title: "标题",
      vis_icon: "图标",
      vis_icon_tip: "正方形 PNG，例如 64×64",
      vis_menu_logo: "菜单标志",
      vis_menu_logo_tip: "绘制在菜单背景上游戏标志位置的图片。原标志是背景的一部分：如需去掉，请同时替换“菜单背景”。",
      vis_logo_image: "标志图片",
      vis_x: "水平",
      vis_y: "垂直",
      vis_scale: "大小",
      vis_quick: "主要画面",
      vis_quick_tip: "原图 → 新图。“下载原图”可保存游戏图片供编辑后再上传。",
      vis_slot_menu_bg: "菜单背景（包含标志）",
      vis_slot_loading_bg: "加载画面背景",
      vis_slot_loading_logo: "加载画面标志",
      vis_any: "任意游戏图片",
      vis_any_tip: "按图片名称搜索（如 BtnPurpleBigUp、SettingUp、PlayerIcon……）。列表只显示已加载的图片：请先打开该图片出现的画面。动画角色（植物和僵尸）不在此列表中。",
      vis_search: "图片名称（至少 2 个字母）",
      vis_none: "没有该名称的已加载图片。",
      vis_replaced: "其他已替换的图片",
      vis_choose: "选择",
      vis_remove: "移除",
      vis_download: "下载原图",
      vis_download_tip: "以 PNG 保存游戏原图",
      vis_no_original: "无法获取原图。",
      vis_size: "尺寸 {size}",
      vis_save: "为所有人保存",
      vis_discard: "放弃更改",
      vis_saving: "正在上传图片……",
      vis_saved: "外观已保存。玩家打开或重新加载游戏时即可看到。",
      vis_too_large: "图片太大（最大 8 MB）。",
      vis_static: "没有多人服务器时，外观来自 index.html 旁的 branding/branding.json 文件。请创建 docs/branding 文件夹并放入该文件和图片：",
      vis_static_example: "{\n  \"title\": \"我的服务器\",\n  \"icon\": \"branding/icon.png\",\n  \"menuLogo\": { \"url\": \"branding/logo.png\", \"x\": 0, \"y\": 0.22, \"scale\": 0.55 },\n  \"frames\": {\n    \"SPL9\": \"branding/background.png\",\n    \"SPL10\": \"branding/background.png\",\n    \"splash\": \"branding/loading.png\",\n    \"logoGardendless\": \"branding/logo.png\"\n  }\n}",
      close: '关闭',
      play: '开始',
      on: '开',
      off: '关',
      mode_sandbox: '沙盒',
      mode_sandbox_desc: '用任意植物对抗任意僵尸：无限阳光、无冷却，并可用游戏的僵尸栏随意放置僵尸。',
      mode_endless: '无尽生存',
      mode_endless_desc: '波次越来越强，直到失败。最佳成绩进入排行榜。',
      mode_daily: '每日挑战',
      mode_inverted: "反转模式",
      mode_inverted_desc: "角色互换：植物在草坪上前进，你用僵尸防守。在僵尸栏选择僵尸，点击右半边的格子，它会守住那条防线。若有植物越过最后一列，你就输了。",
      inv_wave: "第 {n}/{total} 波",
      mode_mirror: "镜像模式",
      mode_mirror_desc: "反转模式的镜像：植物从右边进入，面朝左方边射击边前进；你的僵尸面朝右方防守左半边。选择僵尸并点击左半边的格子。",
      ranking_mirror: "镜像模式",
      inv_f_advance: "推进",
      inv_f_wall: "城墙",
      inv_f_rush: "突袭",
      inv_f_artillery: "炮兵",
      inv_f_focus: "集中攻击",
      inv_f_elite: "精英",
      inv_f_huge: "超大波次！",
      inv_jalapeno: "第 {n} 行有火爆辣椒！快躲开！",
      inv_killed: "击败 {n} 株植物",
      inv_won: "僵尸守住了！",
      inv_lost: "植物突破了！",
      inv_again: "再玩一次",
      inv_menu: "菜单",
      inv_best: "最佳：{n} 分",
      inv_help: "按 1-6 选择僵尸；右键取消。脑子：持续收入，每击败一株植物另有奖励。",
      ranking_inverted: "反转模式",
      mode_daily_desc: '每天一个新关卡，所有人相同：随机场地、植物和变异。当天最高分计入排行榜。',
      arena: '场地',
      sandbox_waves: '僵尸波次',
      sandbox_waves_off: '只有我放的僵尸',
      sandbox_waves_on: '正常波次',
      infinite_sun: '无限阳光',
      no_cooldown: '无冷却',
      mowers: '小推车',
      difficulty: '难度',
      difficulty_easy: '简单',
      difficulty_normal: '普通',
      difficulty_hard: '困难',
      best_wave: '最佳：第 {n} 波',
      daily_today: '{date} 的挑战',
      daily_arena: '场地：{arena}',
      daily_plants: '植物',
      daily_mutators: '今日变异',
      daily_none: '无',
      daily_done: '你今天已玩过：{score} 分。可以再玩，只计最高分。',
      stage_modern: '前院', stage_egypt: '埃及', stage_west: '狂野西部', stage_future: '遥远未来', stage_dark: '黑暗时代',
      opt_speed: '额外速度',
      opt_speed_desc: '加快游戏速度（与游戏的 1.5 倍按钮叠加）。按键：- 和 =',
      opt_auto: '自动收集',
      opt_auto_sun: '阳光',
      opt_auto_coins: '金币、钻石和幼苗',
      opt_auto_food: '能量豆',
      opt_hp: '血条',
      opt_hp_zombies: '僵尸',
      opt_hp_plants: '受伤的植物',
      opt_dmg: '伤害数字',
      opt_preview: '关卡僵尸预览',
      opt_summary: '关卡结算',
      opt_hud: '关卡内快捷栏',
      opt_online_note: '多人对战中速度、自动收集和变异会关闭。',
      mutators_desc: '让任何关卡更难（或不一样）。适用于单人关卡：战役、生存和沙盒。',
      mutators_enable: '启用变异',
      mut_tough: '强化僵尸', mut_tough_desc: '僵尸生命值翻倍。',
      mut_horde: '双倍尸潮', mut_horde_desc: '每波僵尸数量翻倍。',
      mut_scarce: '阳光稀缺', mut_scarce_desc: '初始阳光减半，天降阳光变慢。',
      mut_nomowers: '无小推车', mut_nomowers_desc: '没有小推车。',
      mut_rush: '急促波次', mut_rush_desc: '下一波更快到来。',
      mut_slowseeds: '缓慢冷却', mut_slowseeds_desc: '种子冷却时间翻倍。',
      mut_nofood: '无能量豆', mut_nofood_desc: '僵尸不掉落能量豆。',
      mut_fog: '迷雾', mut_fog_desc: '迷雾覆盖草坪右侧。',
      mut_fast: '急躁僵尸', mut_fast_desc: '僵尸移动速度提高 50%。',
      mutators_active: '已启用 {n} 个变异',
      hud_speed: '额外速度（- / =）',
      hud_auto: '自动收集',
      hud_hp: '血条（V）',
      hud_preview: '关卡僵尸',
      preview_title: '本关僵尸',
      preview_waves: '{n} 波',
      preview_flags: '{n} 面旗',
      preview_from: '第 {n} 波',
      preview_dynamic: '随机',
      preview_unknown: '此关卡不会提前显示僵尸。',
      summary_title_won: '关卡完成！',
      summary_title_lost: '僵尸获胜了……',
      summary_time: '时间',
      summary_kills: '击败僵尸',
      summary_sun: '收集阳光',
      summary_planted: '种植植物',
      summary_lost: '损失植物',
      summary_food: '使用能量豆',
      summary_mowers: '使用小推车',
      summary_waves: '波次',
      summary_top: '最常用植物',
      summary_score: '得分',
      summary_survived: '坚持波数',
      summary_best: '新纪录！',
      summary_rank: '排行榜第 {n} 名',
      summary_login: '登录账号即可进入排行榜。',
      ach_unlocked: '解锁成就：{name}',
      ach_progress: '{n} / {total} 个成就',
      ach_synced: '已保存到你的账号',
      ach_local: '保存在此浏览器。登录即可保存到云端。',
      ranking_daily: '今日挑战',
      ranking_survival: '无尽生存',
      ranking_empty: '还没有成绩。',
      ranking_offline: '排行榜需要多人服务器。',
      ranking_you: '你：第 {rank} 名（{score}）',
      points: '{n} 分',
      wave_n: '第 {n} 波',
      cloud_desc: '云存档的早期版本。恢复会替换当前存档（当前存档仍保留在列表中）并重新加载游戏。',
      cloud_profiles: '当前存档中的档案',
      cloud_history: '早期版本',
      cloud_restore: '恢复',
      file_title: "从文件恢复（.json）",
      file_desc: "导入导出的存档（此处或账号窗口中的导出按钮）。它会替换此浏览器的进度并重新加载游戏；登录后也会上传到云端，之前的存档保留在下方历史中。",
      file_import: "导入存档（.json）",
      file_export: "导出存档（.json）",
      file_bad: "无效的存档文件。",
      file_confirm: "用“{name}”（档案：{profiles}）替换此浏览器的进度？游戏将重新加载。",
      file_only_menu: "请回到主菜单再导入存档。",
      file_applied: "存档已导入，正在重新加载……",
      file_applied_cloud: "存档已导入，正在重新加载；它将上传到你的账号。",
      file_empty: "没有可导出的档案。",
      file_forbidden: "此服务器只允许管理员导入存档（ADMIN_USERS，或 SAVE_IMPORT=all 允许所有人）。",
      file_login: "请登录后导入：此服务器控制谁可以导入存档。",
      cloud_restored: '存档已恢复，正在重新加载……',
      cloud_empty: '还没有早期版本。',
      cloud_login: '登录账号（菜单上的账号按钮）即可查看存档历史。',
      cloud_offline: '存档历史需要多人服务器。',
      cloud_confirm: '恢复 {date} 的版本？当前存档会保留在历史中。',
      coins: '金币', gems: '钻石',
      reason_update: '同步', reason_restore: '恢复前', reason_admin: '管理员编辑', reason_migrated: '旧备份',
      only_menu: '请回到主菜单再开始模式。',
      loading: '加载中……',
      error: '操作失败：{e}',
    },
  };
  X.STRINGS = STRINGS;

  X.t = function (key, vars) {
    var lang = MP.lang || 'en';
    var s = (STRINGS[lang] && STRINGS[lang][key]) || STRINGS.en[key] || (MP.t ? MP.t(key, vars) : key);
    if (vars) {
      s = s.replace(/\{(\w+)\}/g, function (_, k) {
        return vars[k] != null ? vars[k] : '';
      });
    }
    return s;
  };

  X.formatTime = function (sec) {
    sec = Math.max(0, Math.round(sec));
    var m = Math.floor(sec / 60);
    var s = sec % 60;
    return m + ':' + (s < 10 ? '0' : '') + s;
  };

  X.today = function () {
    return new Date().toISOString().slice(0, 10);
  };

  /* ------------------------------------------------------- server API */

  var api = MP.api;
  X.api = {
    available: function () {
      return !!(api && api.available());
    },
    loggedIn: function () {
      return !!(api && api.loggedIn());
    },
    daily: function () {
      return api.request('GET', '/daily', undefined, { anonymous: true });
    },
    scores: function (board, limit) {
      return api.request('GET', '/scores/' + encodeURIComponent(board) + '?limit=' + (limit || 20));
    },
    postScore: function (board, score, details) {
      return api.request('POST', '/scores/' + encodeURIComponent(board), { score: score, details: details || {} });
    },
    achievements: function () {
      return api.request('GET', '/achievements').then(function (r) {
        return r.achievements || {};
      });
    },
    putAchievements: function (ids) {
      return api.request('PUT', '/achievements', { ids: ids }).then(function (r) {
        return r.achievements || {};
      });
    },
    saveHistory: function () {
      return api.request('GET', '/save/history').then(function (r) {
        return r.history || [];
      });
    },
    saveProfiles: function () {
      return api.request('GET', '/save/profiles').then(function (r) {
        return r.profiles || [];
      });
    },
    restoreSave: function (id) {
      return api.request('POST', '/save/restore', { id: String(id) }).then(function (r) {
        return r.save;
      });
    },
  };

  /* --------------------------------------------------- seeded random */

  // Mulberry32: the same seed gives the same daily challenge everywhere.
  X.rng = function (seed) {
    var a = seed >>> 0;
    return function () {
      a = (a + 0x6d2b79f5) >>> 0;
      var t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  };

  X.hashSeed = function (str) {
    var h = 0x811c9dc5;
    for (var i = 0; i < str.length; i++) {
      h ^= str.charCodeAt(i);
      h = Math.imul(h, 0x01000193) >>> 0;
    }
    return h;
  };
})();
