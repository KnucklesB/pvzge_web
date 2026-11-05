/*
 * PvZ2 Gardendless - Extras start-up: waits for the game bridge (MP.game),
 * loads the extra game modules it needs and starts every part.
 */
(function () {
  'use strict';

  var MP = window.PvZMP;
  var X = window.PvZX;
  var G = MP.game;

  function start() {
    if (X.started) return;
    X.started = true;
    var extra = ['Zombie'];
    Promise.all(
      extra.map(function (name) {
        return System.import('chunks:///_virtual/' + name + '.ts')
          .then(function (m) {
            G.m[name] = m;
          })
          .catch(function (e) {
            MP.warn('extras: module not available', name, e);
            G.m[name] = {};
          });
      }),
    ).then(function () {
      [X.play, X.modes, X.inverted, X.achievements, X.ui].forEach(function (part) {
        try {
          part.init();
        } catch (e) {
          MP.warn('extras init failed', e);
        }
      });
      X.emit('ready');
    });
  }

  if (G.ready) start();
  else G.on('ready', start);
})();
