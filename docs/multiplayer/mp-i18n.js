/*
 * PvZ2 Gardendless - Brazilian Portuguese for the game itself.
 *
 * The game keeps every text as {en, zh} and picks one in
 * MultiLanguage.getString according to MultiLanguage.currentLanguage
 * (0 = English, 1 = Chinese). Portuguese is added on top of English: the
 * game stays in "English" internally (so none of its language-dependent
 * logic changes) and getString answers with the pt-BR text from
 * i18n/pt-BR.json (English text -> Portuguese) when there is one.
 *
 * The language button in the game's settings cycles
 * English -> Português -> 简体中文. Without a saved choice, Portuguese is
 * used when the browser's language is Portuguese.
 */
(function () {
  'use strict';

  var MP = window.PvZMP;
  var G = MP.game;
  var KEY = 'pvzge.pt';

  var pt = (MP.ptBR = { active: false, map: null, loaded: false });

  function saved() {
    try {
      return localStorage.getItem(KEY);
    } catch (e) {
      return null;
    }
  }

  function save(on) {
    try {
      localStorage.setItem(KEY, on ? '1' : '0');
    } catch (e) {}
  }

  var choice = saved();
  pt.active = choice != null ? choice === '1' : /^pt\b/i.test(navigator.language || '');

  // Start downloading right away: the menu texts are asked for early.
  var loading = fetch('i18n/pt-BR.json?v=' + encodeURIComponent(MP.VERSION))
    .then(function (res) {
      return res.ok ? res.json() : {};
    })
    .then(function (map) {
      pt.map = map || {};
      pt.loaded = true;
      return pt.map;
    })
    .catch(function (e) {
      MP.warn('pt-BR texts unavailable', e);
      pt.map = {};
      return pt.map;
    });

  function ML() {
    return G.m.MultiLanguage && G.m.MultiLanguage.MultiLanguage;
  }

  // Portuguese is shown while the game is set to English.
  pt.showing = function () {
    var ml = ML();
    return pt.active && !!ml && ml.currentLanguage === 0;
  };

  pt.translate = function (en) {
    var tr = pt.map && pt.map[en];
    return tr != null ? tr : en;
  };

  function hookGetString(ml) {
    if (!ml || ml._ptHooked) return;
    var orig = ml.getString;
    ml.getString = function (t) {
      var s = orig.apply(this, arguments);
      if (pt.active && ml.currentLanguage === 0 && t && typeof t.en === 'string' && pt.map) {
        var tr = pt.map[t.en];
        if (tr != null) return tr;
      }
      return s;
    };
    ml._ptHooked = true;
  }

  // Settings: English -> Português -> 简体中文 -> English.
  function hookSettings() {
    var mod;
    try {
      mod = System.get('chunks:///_virtual/SettingWindow.ts');
    } catch (e) {}
    var SW = mod && mod.SettingWindow;
    if (!SW || SW.prototype._ptHooked) return;
    var proto = SW.prototype;
    var origRead = proto.readLanguage;
    var origSwitch = proto.switchLanguage;
    proto.readLanguage = function () {
      origRead.apply(this, arguments);
      if (pt.showing() && this.languageName) this.languageName.string = 'Português';
    };
    proto.switchLanguage = function () {
      var ml = ML();
      if (!ml) return origSwitch.apply(this, arguments);
      if (ml.currentLanguage === 0 && !pt.active) {
        // English -> Português: stay on English internally.
        pt.active = true;
        ml.currentLanguage = 1; // the original switch steps back to 0
      } else if (ml.currentLanguage === 0) {
        pt.active = false; // Português -> 简体中文
      } else {
        pt.active = false; // 简体中文 -> English
      }
      save(pt.active);
      MP.bus.emit('game-lang');
      return origSwitch.apply(this, arguments);
    };
    proto._ptHooked = true;
  }

  G.on('ready', function () {
    hookGetString(ML());
    hookSettings();
    // Texts arrived after the menu was drawn (slow connection): redraw it.
    if (!pt.loaded && pt.active) {
      loading.then(function () {
        if (pt.showing() && G.sceneName() === 'mainScene') G.KL().RestartScene();
      });
    }
  });

  pt.whenLoaded = function () {
    return loading;
  };
})();
