/*
 * PvZ2 Gardendless - Extras window and main menu button.
 *
 * Tabs: Modes (sandbox, endless survival, daily challenge), Options,
 * Mutators, Achievements, Leaderboard and Cloud (save history from the
 * multiplayer server, restorable). Built with the multiplayer module's
 * window styles (mp.css) so it looks like the rest of the game's HTML UI.
 */
(function () {
  'use strict';

  var MP = window.PvZMP;
  var X = window.PvZX;
  var G = MP.game;
  var t = X.t;
  var el = MP.util.el;

  var ui = (X.ui = {});
  var node = null;
  var tab = X.store.get('tab', 'modes');
  var TABS = ['modes', 'options', 'mutators', 'achievements', 'ranking', 'cloud'];

  function seg(options, value, onPick) {
    var box = el('div.mp-seg');
    options.forEach(function (o) {
      box.appendChild(
        el('button' + (String(o.value) === String(value) ? '.mp-on' : ''), {
          text: o.label,
          onclick: function () {
            onPick(o.value);
          },
        }),
      );
    });
    return box;
  }

  function onOff(value, onPick) {
    return seg(
      [
        { value: true, label: t('on') },
        { value: false, label: t('off') },
      ],
      !!value,
      onPick,
    );
  }

  function opt(label, control, desc) {
    return el('div.mp-opt.pvzx-opt', null, [el('div.mp-opt-label', null, [el('span', { text: label }), desc ? el('small.pvzx-desc', { text: desc }) : null]), control]);
  }

  function stageOptions() {
    return X.STAGE_IDS.map(function (s) {
      return { value: s, label: t('stage_' + s) };
    });
  }

  /* ------------------------------------------------------------- modes */

  function renderModes(body) {
    var sb = X.modes.sandboxOptions;
    var en = X.modes.endlessOptions;
    var cards = el('div.pvzx-modes');

    cards.appendChild(
      el('div.mp-panel.pvzx-mode', null, [
        el('div.mp-panel-title', { text: '🧪 ' + t('mode_sandbox') }),
        el('p.pvzx-desc', { text: t('mode_sandbox_desc') }),
        opt(t('arena'), seg(stageOptions(), sb.stage, function (v) {
          sb.stage = v;
          render();
        })),
        opt(t('sandbox_waves'), seg([{ value: false, label: t('sandbox_waves_off') }, { value: true, label: t('sandbox_waves_on') }], sb.waves, function (v) {
          sb.waves = v;
          render();
        })),
        opt(t('infinite_sun'), onOff(sb.infiniteSun, function (v) {
          sb.infiniteSun = v;
          render();
        })),
        opt(t('no_cooldown'), onOff(sb.noCooldown, function (v) {
          sb.noCooldown = v;
          render();
        })),
        opt(t('mowers'), onOff(sb.mowers, function (v) {
          sb.mowers = v;
          render();
        })),
        el('button.mp-btn.mp-green', { text: t('play'), onclick: function () {
          X.modes.startSandbox(sb);
        } }),
      ]),
    );

    cards.appendChild(
      el('div.mp-panel.pvzx-mode', null, [
        el('div.mp-panel-title', { text: '♾️ ' + t('mode_endless') }),
        el('p.pvzx-desc', { text: t('mode_endless_desc') }),
        opt(t('arena'), seg(stageOptions(), en.stage, function (v) {
          en.stage = v;
          render();
        })),
        opt(t('difficulty'), seg(['easy', 'normal', 'hard'].map(function (d) {
          return { value: d, label: t('difficulty_' + d) };
        }), en.difficulty, function (v) {
          en.difficulty = v;
          render();
        })),
        X.modes.bestWave() ? el('div.pvzx-best', { text: t('best_wave', { n: X.modes.bestWave() }) }) : null,
        el('button.mp-btn.mp-green', { text: t('play'), onclick: function () {
          X.modes.startEndless(en);
        } }),
      ]),
    );

    var daily = el('div.mp-panel.pvzx-mode', null, [el('div.mp-panel-title', { text: '📅 ' + t('mode_daily') }), el('p.pvzx-desc', { text: t('mode_daily_desc') })]);
    var dailyInfo = el('div.pvzx-daily', { text: t('loading') });
    daily.appendChild(dailyInfo);
    daily.appendChild(
      el('button.mp-btn.mp-green', { text: t('play'), onclick: function () {
        X.modes.startDaily();
      } }),
    );
    cards.appendChild(daily);
    body.appendChild(cards);

    X.modes.daily().then(function (day) {
      var plan = X.modes.dailyPlan(day);
      dailyInfo.innerHTML = '';
      dailyInfo.appendChild(el('b', { text: t('daily_today', { date: plan.date }) }));
      dailyInfo.appendChild(el('div', { text: t('daily_arena', { arena: t('stage_' + plan.stage) }) + ' · ' + t('difficulty_' + plan.difficulty) }));
      dailyInfo.appendChild(el('div', { text: t('daily_plants') + ': ' + plan.plants.map(X.plantName).join(', ') }));
      dailyInfo.appendChild(el('div', { text: t('daily_mutators') + ': ' + (plan.mutators.length ? plan.mutators.map(function (m) {
        return t('mut_' + m);
      }).join(', ') : t('daily_none')) }));
      var prev = X.store.get('daily.' + plan.date, null);
      if (prev != null) dailyInfo.appendChild(el('div.pvzx-muted', { text: t('daily_done', { score: prev }) }));
    });
  }

  /* ----------------------------------------------------------- options */

  function renderOptions(body) {
    var s = X.settings;
    var speeds = X.SPEEDS.map(function (v) {
      return { value: v, label: (v === 0.5 ? '½' : v) + 'x' };
    });
    var set = function (k) {
      return function (v) {
        X.set(k, v);
        render();
      };
    };
    var panel = el('div.mp-panel.pvzx-options', null, [
      opt(t('opt_speed'), seg(speeds, s.speed, set('speed')), t('opt_speed_desc')),
      el('div.mp-panel-title', { text: t('opt_auto') }),
      opt(t('opt_auto_sun'), onOff(s.autoSun, set('autoSun'))),
      opt(t('opt_auto_coins'), onOff(s.autoCoins, set('autoCoins'))),
      opt(t('opt_auto_food'), onOff(s.autoFood, set('autoFood'))),
      el('div.mp-panel-title', { text: t('opt_hp') }),
      opt(t('opt_hp_zombies'), onOff(s.hpZombies, set('hpZombies'))),
      opt(t('opt_hp_plants'), onOff(s.hpPlants, set('hpPlants'))),
      opt(t('opt_dmg'), onOff(s.dmgNumbers, set('dmgNumbers'))),
      el('div.mp-panel-title', { text: t('tab_options') }),
      opt(t('opt_preview'), onOff(s.preview, set('preview'))),
      opt(t('opt_summary'), onOff(s.summary, set('summary'))),
      opt(t('opt_hud'), onOff(s.hud, set('hud'))),
      el('p.pvzx-muted', { text: t('opt_online_note') }),
    ]);
    body.appendChild(panel);
  }

  /* ---------------------------------------------------------- mutators */

  function renderMutators(body) {
    var s = X.settings;
    var head = el('div.mp-panel', null, [
      el('p.pvzx-desc', { text: t('mutators_desc') }),
      opt(t('mutators_enable'), onOff(s.mutatorsOn, function (v) {
        X.set('mutatorsOn', v);
        render();
      })),
    ]);
    body.appendChild(head);
    var grid = el('div.pvzx-mut-grid' + (s.mutatorsOn ? '' : '.pvzx-dim'));
    X.mutators.LIST.forEach(function (m) {
      var on = !!s.mutators[m.id];
      grid.appendChild(
        el('button.pvzx-mut' + (on ? '.pvzx-on' : ''), {
          onclick: function () {
            var next = Object.assign({}, X.settings.mutators);
            next[m.id] = !on;
            X.set('mutators', next);
            if (!X.settings.mutatorsOn && !on) X.set('mutatorsOn', true);
            render();
          },
        }, [el('b', { text: t('mut_' + m.id) }), el('span', { text: t('mut_' + m.id + '_desc') })]),
      );
    });
    body.appendChild(grid);
    var n = X.mutators.chosen().length;
    if (n) body.appendChild(el('div.pvzx-best', { text: t('mutators_active', { n: n }) }));
  }

  /* ------------------------------------------------------ achievements */

  function renderAchievements(body) {
    var A = X.achievements;
    body.appendChild(el('div.pvzx-best', { text: t('ach_progress', { n: A.count(), total: A.LIST.length }) }));
    body.appendChild(el('p.pvzx-muted', { text: X.api.loggedIn() ? t('ach_synced') : t('ach_local') }));
    var grid = el('div.pvzx-ach-grid');
    A.LIST.forEach(function (a) {
      var at = A.unlocked[a.id];
      grid.appendChild(
        el('div.pvzx-ach' + (at ? '.pvzx-on' : ''), { title: at ? new Date(at).toLocaleString() : '' }, [
          el('span.pvzx-ach-icon', { text: a.icon }),
          el('div', null, [el('b', { text: A.name(a.id) }), el('span', { text: A.desc(a.id) })]),
        ]),
      );
    });
    body.appendChild(grid);
  }

  /* ----------------------------------------------------------- ranking */

  function board(title, name, fmt) {
    var box = el('div.mp-panel.pvzx-board', null, [el('div.mp-panel-title', { text: title }), el('div.pvzx-muted', { text: t('loading') })]);
    X.api
      .scores(name, 20)
      .then(function (r) {
        box.lastChild.remove();
        if (!r.scores.length) {
          box.appendChild(el('div.pvzx-muted', { text: t('ranking_empty') }));
          return;
        }
        var table = el('table.pvzx-table');
        r.scores.forEach(function (s) {
          table.appendChild(el('tr', null, [el('td', { text: s.rank + 'º' }), el('td', { text: s.name }), el('td', { text: fmt(s.score) })]));
        });
        box.appendChild(table);
        if (r.me) box.appendChild(el('div.pvzx-best', { text: t('ranking_you', { rank: r.me.rank, score: fmt(r.me.score) }) }));
      })
      .catch(function (e) {
        box.lastChild.textContent = t('error', { e: e.code || e.message });
      });
    return box;
  }

  function renderRanking(body) {
    if (!X.api.available()) {
      body.appendChild(el('p.pvzx-muted', { text: t('ranking_offline') }));
      return;
    }
    var wrap = el('div.pvzx-boards');
    body.appendChild(wrap);
    X.modes.daily().then(function (day) {
      wrap.appendChild(board(t('ranking_daily') + ' (' + day.date + ')', 'daily:' + day.date, function (n) {
        return t('points', { n: n });
      }));
      wrap.appendChild(board(t('ranking_survival'), 'survival', function (n) {
        return t('wave_n', { n: n });
      }));
    });
  }

  /* ------------------------------------------------------------- cloud */

  function fmtDate(ts) {
    return ts ? new Date(ts).toLocaleString() : '-';
  }

  // Restoring a save from a .json file: the game's own export, a cloud save
  // or the raw localStorage value (MP.saves.parse). With a multiplayer server
  // the server decides who may import (ADMIN_USERS / SAVE_IMPORT=all), as in
  // the Account window; without one, this browser's save is the only one.
  function canImport() {
    return !X.api.available() || !!(MP.api && MP.api.can('importSave'));
  }

  function importFile() {
    if (!canImport()) return;
    var picker = el('input', { type: 'file', accept: '.json,application/json,text/plain' });
    picker.onchange = function () {
      var file = picker.files && picker.files[0];
      if (!file) return;
      file.text().then(function (text) {
        var blob;
        try {
          blob = MP.saves.parse(text);
        } catch (e) {
          return MP.ui.toast(t('file_bad'), 'warn');
        }
        var names = MP.saves.profileNames(blob);
        if (!window.confirm(t('file_confirm', { name: file.name, profiles: names.join(', ') }))) return;
        if (!MP.saves.canApply()) return MP.ui.toast(t('file_only_menu'), 'warn');
        MP.saves.applyLocal(blob);
        MP.ui.toast(t(X.api.loggedIn() ? 'file_applied_cloud' : 'file_applied'), 'good', 6000);
      });
    };
    picker.click();
  }

  function exportFile() {
    var blob = MP.saves.readLocal();
    if (!blob.players) return MP.ui.toast(t('file_empty'), 'warn');
    MP.saves.download(blob, MP.api && MP.api.user() ? MP.api.user().username : '');
  }

  function renderFilePanel(body) {
    var allowed = canImport();
    body.appendChild(
      el('div.mp-panel', null, [
        el('div.mp-panel-title', { text: t('file_title') }),
        el('p.pvzx-desc', { text: t('file_desc') }),
        el('div.pvzx-file-actions', null, [
          el('button.mp-btn.mp-small.mp-green', { text: t('file_import'), disabled: !allowed, onclick: importFile }),
          el('button.mp-btn.mp-small.mp-blue', { text: t('file_export'), onclick: exportFile }),
        ]),
        allowed ? null : el('p.pvzx-muted', { text: t(X.api.loggedIn() ? 'file_forbidden' : 'file_login') }),
      ]),
    );
  }

  function renderCloud(body) {
    renderFilePanel(body);
    if (!X.api.available()) {
      body.appendChild(el('p.pvzx-muted', { text: t('cloud_offline') }));
      return;
    }
    if (!X.api.loggedIn()) {
      body.appendChild(el('p.pvzx-muted', { text: t('cloud_login') }));
      return;
    }
    body.appendChild(el('p.pvzx-desc', { text: t('cloud_desc') }));
    var profiles = el('div.mp-panel', null, [el('div.mp-panel-title', { text: t('cloud_profiles') }), el('div.pvzx-muted', { text: t('loading') })]);
    var history = el('div.mp-panel', null, [el('div.mp-panel-title', { text: t('cloud_history') }), el('div.pvzx-muted', { text: t('loading') })]);
    body.appendChild(profiles);
    body.appendChild(history);
    X.api
      .saveProfiles()
      .then(function (list) {
        profiles.lastChild.remove();
        if (!list.length) profiles.appendChild(el('div.pvzx-muted', { text: '-' }));
        list.forEach(function (p) {
          profiles.appendChild(el('div.pvzx-row', null, [el('b', { text: p.name }), el('span', { text: p.coin + ' ' + t('coins') + ' · ' + p.gem + ' ' + t('gems') })]));
        });
      })
      .catch(function (e) {
        profiles.lastChild.textContent = t('error', { e: e.code || e.message });
      });
    X.api
      .saveHistory()
      .then(function (list) {
        history.lastChild.remove();
        if (!list.length) history.appendChild(el('div.pvzx-muted', { text: t('cloud_empty') }));
        list.forEach(function (h) {
          var when = h.updatedAt || h.archivedAt;
          history.appendChild(
            el('div.pvzx-row', null, [
              el('span', { text: fmtDate(when) + ' · ' + Math.max(1, Math.round(h.size / 1024)) + ' KB · ' + t('reason_' + h.reason) }),
              el('button.mp-btn.mp-small.mp-blue', {
                text: t('cloud_restore'),
                onclick: function () {
                  if (!window.confirm(t('cloud_confirm', { date: fmtDate(when) }))) return;
                  X.api
                    .restoreSave(h.id)
                    .then(function () {
                      if (MP.ui) MP.ui.toast(t('cloud_restored'), 'good');
                      return MP.cloud.download();
                    })
                    .catch(function (e) {
                      if (MP.ui) MP.ui.toast(t('error', { e: e.code || e.message }), 'bad');
                    });
                },
              }),
            ]),
          );
        });
      })
      .catch(function (e) {
        history.lastChild.textContent = t('error', { e: e.code || e.message });
      });
  }

  /* ------------------------------------------------------------ window */

  function render() {
    if (!node) return;
    var scroll = node.querySelector('.mp-tab-body');
    var top = scroll ? scroll.scrollTop : 0;
    var win = el('div.mp-window.mp-interactive.pvzx-window');
    win.appendChild(el('button.mp-close', { title: t('close'), 'aria-label': t('close'), onclick: ui.close }));
    win.appendChild(el('div.mp-window-title', { text: t('extras_title') }));
    var tabs = el('div.mp-tabs');
    TABS.forEach(function (k) {
      tabs.appendChild(
        el('button.mp-tab' + (tab === k ? '.mp-on' : ''), {
          text: t('tab_' + k),
          onclick: function () {
            tab = k;
            X.store.set('tab', k);
            render();
          },
        }),
      );
    });
    win.appendChild(tabs);
    var body = el('div.mp-tab-body.pvzx-body');
    win.appendChild(body);
    ({ modes: renderModes, options: renderOptions, mutators: renderMutators, achievements: renderAchievements, ranking: renderRanking, cloud: renderCloud }[tab] || renderModes)(body);
    node.replaceChildren(win);
    if (scroll && body) body.scrollTop = top;
  }

  ui.open = function () {
    if (!node) {
      node = el('div.mp-backdrop.pvzx-backdrop');
      ['mousedown', 'wheel', 'keydown'].forEach(function (type) {
        node.addEventListener(type, function (e) {
          e.stopPropagation();
        });
      });
      node.addEventListener('click', function (e) {
        if (e.target === node) ui.close();
      });
      (document.getElementById('pvzmp-root') || document.body).appendChild(node);
      document.body.classList.add('pvzx-open');
    }
    render();
  };

  ui.close = function () {
    if (node) node.remove();
    node = null;
    document.body.classList.remove('pvzx-open');
  };

  ui.isOpen = function () {
    return !!node;
  };

  /* ------------------------------------------------- main menu button */

  function findSpriteFrame(name) {
    var found = null;
    G.cc.assetManager.assets.forEach(function (a) {
      if (!found && a instanceof G.cc.SpriteFrame && a.name === name) found = a;
    });
    return found;
  }

  var menuLabel = null;

  ui.injectMenuButton = function () {
    var cc = G.cc;
    var canvas = cc.find('Canvas');
    var play = canvas && canvas.getChildByName('PlayButton');
    if (!play || canvas.getChildByName('ExtrasButton')) return;
    var btn = cc.instantiate(play);
    btn.name = 'ExtrasButton';
    btn.parent = canvas;
    var button = btn.getComponent(cc.Button);
    if (button) {
      button.clickEvents = [];
      var up = findSpriteFrame('BtnBlueBigUp') || findSpriteFrame('BtnOrangeBigUp');
      var down = findSpriteFrame('BtnBlueBigDown') || findSpriteFrame('BtnOrangeBigDown');
      if (up) {
        btn.getComponent(cc.Sprite).spriteFrame = up;
        button.normalSprite = up;
        button.hoverSprite = up;
        button.pressedSprite = down || up;
        button.disabledSprite = up;
      }
    }
    var label = btn.getChildByName('Label');
    if (label) {
      menuLabel = label.getComponent(cc.Label);
      menuLabel.string = t('extras');
    }
    btn.on(cc.Button.EventType.CLICK, function () {
      ui.open();
    });
    btn.on(cc.Node.EventType.SIZE_CHANGED, function () {
      if (MP.app && MP.app.relayoutMenu) MP.app.relayoutMenu();
    });
    if (MP.app && MP.app.relayoutMenu) MP.app.relayoutMenu();
  };

  ui.init = function () {
    G.on('scene', function (name) {
      if (name === 'mainScene') {
        // After the multiplayer button (same frame), so the row includes it.
        setTimeout(ui.injectMenuButton, 0);
      } else ui.close();
    });
    if (G.sceneName() === 'mainScene') setTimeout(ui.injectMenuButton, 0);
    MP.bus.on('lang', function () {
      if (menuLabel && menuLabel.isValid) menuLabel.string = t('extras');
      render();
    });
    X.achievements.on('change', function () {
      if (tab === 'achievements') render();
    });
  };
})();
