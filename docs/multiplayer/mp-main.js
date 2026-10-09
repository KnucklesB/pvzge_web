/*
 * PvZ2 Gardendless - Multiplayer bootstrap.
 */
(function () {
  'use strict';

  function boot() {
    try {
      window.PvZMP.app.init();
    } catch (e) {
      console.error('[PvZMP] failed to start multiplayer', e);
    }
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
