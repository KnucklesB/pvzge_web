/*
 * PvZ2 Gardendless - Extras achievements.
 *
 * Checked when a level ends (statistics from x-play.js). Unlocked ones are
 * kept in this browser and, when logged in, merged with the account on the
 * multiplayer server (PUT /api/achievements never removes any).
 */
(function () {
  'use strict';

  var MP = window.PvZMP;
  var X = window.PvZX;
  var t = X.t;

  var ach = (X.achievements = new MP.Emitter());

  function won(s) {
    return s.result === 'won';
  }
  function campaignLike(s) {
    return s.mode !== 'sandbox';
  }

  // icon: emoji shown on the badge; check(stats, totals) on level end.
  ach.LIST = [
    { id: 'first_win', icon: '🌻', check: function (s) { return won(s) && campaignLike(s); } },
    { id: 'no_mowers', icon: '🚜', check: function (s) { return won(s) && campaignLike(s) && s.mowersStart > 0 && s.mowersUsed === 0 && s.waveCount >= 5; } },
    { id: 'minimalist', icon: '🌱', check: function (s) { return won(s) && campaignLike(s) && s.planted <= 5 && s.waveCount >= 5; } },
    { id: 'no_food', icon: '🍃', check: function (s) { return won(s) && campaignLike(s) && s.food === 0 && s.waveCount >= 5; } },
    { id: 'untouchable', icon: '🛡️', check: function (s) { return won(s) && campaignLike(s) && s.lost === 0 && s.waveCount >= 5; } },
    { id: 'speedrun', icon: '⏱️', check: function (s) { return won(s) && campaignLike(s) && s.waveCount >= 5 && (s.endedAt - s.startedAt) / 1000 < 180; } },
    { id: 'zombie_100', icon: '🧟', check: function (s) { return campaignLike(s) && s.kills >= 100; } },
    { id: 'zombie_1000', icon: '💀', check: function (s, tot) { return tot.kills >= 1000; } },
    { id: 'zombie_10000', icon: '☠️', check: function (s, tot) { return tot.kills >= 10000; } },
    { id: 'sun_5000', icon: '☀️', check: function (s) { return campaignLike(s) && s.sun >= 5000; } },
    { id: 'wins_10', icon: '🏅', check: function (s, tot) { return tot.wins >= 10; } },
    { id: 'wins_100', icon: '🏆', check: function (s, tot) { return tot.wins >= 100; } },
    { id: 'survive_10', icon: '🥉', check: function (s) { return s.mode === 'endless' && s.survived >= 10; } },
    { id: 'survive_25', icon: '🥈', check: function (s) { return s.mode === 'endless' && s.survived >= 25; } },
    { id: 'survive_50', icon: '🥇', check: function (s) { return s.mode === 'endless' && s.survived >= 50; } },
    { id: 'daily_play', icon: '📅', check: function (s) { return s.mode === 'daily'; } },
    { id: 'daily_win', icon: '🎯', check: function (s) { return s.mode === 'daily' && won(s); } },
    { id: 'daily_streak', icon: '🔥', check: function () { return streak() >= 3; } },
    { id: 'sandbox', icon: '🧪', check: function (s) { return s.mode === 'sandbox'; } },
    { id: 'mutated', icon: '🧬', check: function (s) { return won(s) && campaignLike(s) && s.mutators.length >= 3; } },
    { id: 'speed_demon', icon: '⚡', check: function (s) { return won(s) && campaignLike(s) && s.maxSpeed >= 4; } },
  ];

  var NAMES = {
    pt: {
      first_win: ['Primeira vitória', 'Vença uma fase.'],
      no_mowers: ['Sem rede de proteção', 'Vença uma fase sem usar nenhum cortador de grama.'],
      minimalist: ['Minimalista', 'Vença uma fase plantando no máximo 5 plantas.'],
      no_food: ['Dieta natural', 'Vença uma fase sem usar adubo.'],
      untouchable: ['Intocável', 'Vença uma fase sem perder nenhuma planta.'],
      speedrun: ['Corrida contra o tempo', 'Vença uma fase em menos de 3 minutos.'],
      zombie_100: ['Centena', 'Derrote 100 zumbis em uma única fase.'],
      zombie_1000: ['Exterminador', 'Derrote 1.000 zumbis no total.'],
      zombie_10000: ['Lenda do jardim', 'Derrote 10.000 zumbis no total.'],
      sun_5000: ['Banho de sol', 'Colete 5.000 de sol em uma única fase.'],
      wins_10: ['Jardineiro', 'Vença 10 fases.'],
      wins_100: ['Mestre jardineiro', 'Vença 100 fases.'],
      survive_10: ['Resistente', 'Sobreviva a 10 ondas na Sobrevivência sem fim.'],
      survive_25: ['Inabalável', 'Sobreviva a 25 ondas na Sobrevivência sem fim.'],
      survive_50: ['Imortal', 'Sobreviva a 50 ondas na Sobrevivência sem fim.'],
      daily_play: ['Rotina', 'Jogue um Desafio Diário.'],
      daily_win: ['Desafio aceito', 'Vença um Desafio Diário.'],
      daily_streak: ['Em sequência', 'Jogue o Desafio Diário 3 dias seguidos.'],
      sandbox: ['Cientista', 'Jogue no Sandbox.'],
      mutated: ['Mutante', 'Vença uma fase com 3 ou mais mutadores.'],
      speed_demon: ['Pisando fundo', 'Vença uma fase jogando a 4x ou mais.'],
    },
    en: {
      first_win: ['First win', 'Win a level.'],
      no_mowers: ['No safety net', 'Win a level without using any lawn mower.'],
      minimalist: ['Minimalist', 'Win a level planting 5 plants or fewer.'],
      no_food: ['Natural diet', 'Win a level without using plant food.'],
      untouchable: ['Untouchable', 'Win a level without losing a plant.'],
      speedrun: ['Against the clock', 'Win a level in under 3 minutes.'],
      zombie_100: ['A hundred', 'Defeat 100 zombies in a single level.'],
      zombie_1000: ['Exterminator', 'Defeat 1,000 zombies in total.'],
      zombie_10000: ['Garden legend', 'Defeat 10,000 zombies in total.'],
      sun_5000: ['Sunbather', 'Collect 5,000 sun in a single level.'],
      wins_10: ['Gardener', 'Win 10 levels.'],
      wins_100: ['Master gardener', 'Win 100 levels.'],
      survive_10: ['Sturdy', 'Survive 10 waves in Endless Survival.'],
      survive_25: ['Unshakable', 'Survive 25 waves in Endless Survival.'],
      survive_50: ['Immortal', 'Survive 50 waves in Endless Survival.'],
      daily_play: ['Routine', 'Play a Daily Challenge.'],
      daily_win: ['Challenge accepted', 'Win a Daily Challenge.'],
      daily_streak: ['On a streak', 'Play the Daily Challenge 3 days in a row.'],
      sandbox: ['Scientist', 'Play in the Sandbox.'],
      mutated: ['Mutant', 'Win a level with 3 or more mutators.'],
      speed_demon: ['Pedal to the metal', 'Win a level playing at 4x or faster.'],
    },
    zh: {
      first_win: ['首胜', '赢得一个关卡。'],
      no_mowers: ['没有退路', '不使用小推车赢得关卡。'],
      minimalist: ['极简主义', '最多种植 5 株植物赢得关卡。'],
      no_food: ['天然饮食', '不使用能量豆赢得关卡。'],
      untouchable: ['毫发无伤', '不损失任何植物赢得关卡。'],
      speedrun: ['争分夺秒', '3 分钟内赢得关卡。'],
      zombie_100: ['百人斩', '单关击败 100 只僵尸。'],
      zombie_1000: ['终结者', '累计击败 1000 只僵尸。'],
      zombie_10000: ['花园传奇', '累计击败 10000 只僵尸。'],
      sun_5000: ['日光浴', '单关收集 5000 阳光。'],
      wins_10: ['园丁', '赢得 10 个关卡。'],
      wins_100: ['园艺大师', '赢得 100 个关卡。'],
      survive_10: ['坚韧', '无尽生存中坚持 10 波。'],
      survive_25: ['坚不可摧', '无尽生存中坚持 25 波。'],
      survive_50: ['不朽', '无尽生存中坚持 50 波。'],
      daily_play: ['日常', '玩一次每日挑战。'],
      daily_win: ['接受挑战', '赢得一次每日挑战。'],
      daily_streak: ['连胜', '连续 3 天玩每日挑战。'],
      sandbox: ['科学家', '在沙盒中游玩。'],
      mutated: ['变异体', '启用 3 个以上变异赢得关卡。'],
      speed_demon: ['油门踩到底', '以 4 倍或更快速度赢得关卡。'],
    },
  };

  ach.name = function (id) {
    var n = (NAMES[MP.lang] && NAMES[MP.lang][id]) || NAMES.en[id];
    return n ? n[0] : id;
  };
  ach.desc = function (id) {
    var n = (NAMES[MP.lang] && NAMES[MP.lang][id]) || NAMES.en[id];
    return n ? n[1] : '';
  };

  /* ------------------------------------------------------------ state */

  ach.unlocked = X.store.get('achievements', {}); // {id: unlockedAt}
  ach.totals = Object.assign({ kills: 0, wins: 0, levels: 0, sun: 0, planted: 0 }, X.store.get('totals', {}));

  function save() {
    X.store.set('achievements', ach.unlocked);
    X.store.set('totals', ach.totals);
  }

  function streak() {
    var days = X.store.get('dailyDays', []).slice().sort();
    if (!days.length) return 0;
    var best = 1;
    var run = 1;
    for (var i = 1; i < days.length; i++) {
      var gap = (Date.parse(days[i]) - Date.parse(days[i - 1])) / 86400000;
      run = gap === 1 ? run + 1 : 1;
      if (run > best) best = run;
    }
    return best;
  }

  ach.count = function () {
    return Object.keys(ach.unlocked).filter(function (id) {
      return ach.LIST.some(function (a) {
        return a.id === id;
      });
    }).length;
  };

  function unlock(ids) {
    var fresh = ids.filter(function (id) {
      return !ach.unlocked[id];
    });
    if (!fresh.length) return;
    var now = Date.now();
    fresh.forEach(function (id) {
      ach.unlocked[id] = now;
    });
    save();
    fresh.forEach(function (id, i) {
      setTimeout(function () {
        toast(id);
      }, 1800 + i * 1600);
    });
    ach.emit('change');
    ach.sync();
  }

  function toast(id) {
    var a = ach.LIST.find(function (x) {
      return x.id === id;
    });
    var node = MP.util.el('div.pvzx-ach-toast', null, [
      MP.util.el('span.pvzx-ach-icon', { text: a ? a.icon : '★' }),
      MP.util.el('div', null, [MP.util.el('b', { text: t('ach_unlocked', { name: ach.name(id) }) }), MP.util.el('div', { text: ach.desc(id) })]),
    ]);
    document.body.appendChild(node);
    setTimeout(function () {
      node.classList.add('pvzx-out');
    }, 4200);
    setTimeout(function () {
      node.remove();
    }, 4800);
  }

  // Local and account achievements merged both ways.
  var syncing = null;
  ach.sync = function () {
    if (!X.api.available() || !X.api.loggedIn()) return Promise.resolve(false);
    if (syncing) return syncing;
    syncing = X.api
      .putAchievements(Object.keys(ach.unlocked))
      .then(function (remote) {
        var changed = false;
        Object.keys(remote).forEach(function (id) {
          if (!ach.unlocked[id]) {
            ach.unlocked[id] = remote[id];
            changed = true;
          }
        });
        if (changed) {
          save();
          ach.emit('change');
        }
        ach.synced = true;
        return true;
      })
      .catch(function () {
        return false;
      })
      .finally(function () {
        syncing = null;
      });
    return syncing;
  };

  function onLevelEnd(s) {
    if (s.online) return;
    var tot = ach.totals;
    tot.levels++;
    tot.kills += s.kills;
    tot.sun += s.sun;
    tot.planted += s.planted;
    if (s.result === 'won' && campaignLike(s)) tot.wins++;
    save();
    // The mode (endless/daily) sets its fields on the same event: check after.
    setTimeout(function () {
      var ids = [];
      ach.LIST.forEach(function (a) {
        try {
          if (!ach.unlocked[a.id] && a.check(s, tot)) ids.push(a.id);
        } catch (e) {}
      });
      unlock(ids);
    }, 0);
  }

  ach.init = function () {
    X.on('level-end', onLevelEnd);
    X.on('level-start', function (s) {
      if (s.mode === 'sandbox') unlock(['sandbox']);
    });
    if (MP.api) {
      MP.api.on('auth', function (user) {
        if (user) ach.sync();
      });
      if (MP.api.loggedIn()) ach.sync();
    }
  };
})();
