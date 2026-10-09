/*
 * PvZ2 Gardendless - Multiplayer server API client (accounts, cloud saves,
 * public rooms, match history). All calls fail gracefully when no server is
 * configured: `MP.api.available()` is false and the UI hides those features.
 */
(function () {
  'use strict';

  var MP = window.PvZMP;
  var STORE_KEY = 'auth';

  var api = (MP.api = new MP.Emitter());
  var auth = MP.store.get(STORE_KEY, null); // {token, user}

  api.available = function () {
    return !!MP.config.api;
  };

  api.user = function () {
    return auth && auth.user;
  };

  api.loggedIn = function () {
    return !!(auth && auth.token);
  };

  function setAuth(value) {
    auth = value;
    MP.store.set(STORE_KEY, value);
    api.emit('auth', api.user());
  }

  function apiError(code, status) {
    var e = new Error(code);
    e.code = code;
    e.status = status;
    return e;
  }

  api.request = function (method, path, body, opts) {
    if (!api.available()) return Promise.reject(apiError('no_server', 0));
    var headers = { Accept: 'application/json' };
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    if (auth && auth.token && !(opts && opts.anonymous)) headers.Authorization = 'Bearer ' + auth.token;
    var ctrl = window.AbortController ? new AbortController() : null;
    var timer = ctrl && setTimeout(function () {
      ctrl.abort();
    }, (opts && opts.timeout) || 15000);
    return fetch(MP.config.api + path, {
      method: method,
      headers: headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
      signal: ctrl ? ctrl.signal : undefined,
      keepalive: !!(opts && opts.keepalive),
    }).then(
      function (res) {
        if (timer) clearTimeout(timer);
        return res
          .json()
          .catch(function () {
            return {};
          })
          .then(function (data) {
            if (res.status === 401 && auth && !(opts && opts.anonymous) && path.indexOf('/auth/login') < 0) {
              setAuth(null); // session expired or revoked
            }
            if (!res.ok) {
              var e = apiError(data.error || 'server_error', res.status);
              e.data = data;
              throw e;
            }
            return data;
          });
      },
      function () {
        if (timer) clearTimeout(timer);
        throw apiError('offline', 0);
      },
    );
  };

  /* -------------------------------------------------------------- accounts */

  api.register = function (username, password) {
    return api.request('POST', '/auth/register', { username: username, password: password }, { anonymous: true }).then(function (r) {
      setAuth({ token: r.token, user: r.user });
      return r.user;
    });
  };

  api.login = function (username, password) {
    return api.request('POST', '/auth/login', { username: username, password: password }, { anonymous: true }).then(function (r) {
      setAuth({ token: r.token, user: r.user });
      return r.user;
    });
  };

  api.logout = function () {
    var p = api.loggedIn() ? api.request('POST', '/auth/logout', {}).catch(function () {}) : Promise.resolve();
    setAuth(null);
    return p;
  };

  api.refreshMe = function () {
    if (!api.loggedIn()) return Promise.resolve(null);
    return api.request('GET', '/auth/me').then(function (r) {
      setAuth({ token: auth.token, user: r.user });
      return r.user;
    });
  };

  api.changePassword = function (current, password) {
    return api.request('POST', '/auth/password', { current: current, password: password });
  };

  api.ticket = function () {
    if (!api.loggedIn()) return Promise.resolve(null);
    return api
      .request('GET', '/auth/ticket')
      .then(function (r) {
        return r.ticket;
      })
      .catch(function () {
        return null;
      });
  };

  /* ---------------------------------------------------------------- saves */

  api.saveMeta = function () {
    return api.request('GET', '/save?meta=1').then(function (r) {
      return r.save;
    });
  };

  api.getSave = function () {
    return api.request('GET', '/save').then(function (r) {
      return r.save;
    });
  };

  api.putSave = function (data, base, force) {
    return api.request('PUT', '/save', { data: data, base: base, force: !!force, device: navigator.platform || '' }, { timeout: 60000 }).then(function (r) {
      return r.save;
    });
  };

  /* ---------------------------------------------------------------- rooms */

  api.rooms = function () {
    return api.request('GET', '/rooms', undefined, { anonymous: true }).then(function (r) {
      return r.rooms || [];
    });
  };

  api.publishRoom = function (code, info) {
    return api.request('PUT', '/rooms/' + code, info);
  };

  api.unpublishRoom = function (code, key) {
    return api.request('DELETE', '/rooms/' + code, { key: key }, { keepalive: true }).catch(function () {});
  };

  /* -------------------------------------------------------------- matches */

  api.postMatch = function (match) {
    return api.request('POST', '/matches', match).catch(function (e) {
      MP.warn('could not record match', e);
    });
  };

  api.matches = function (user) {
    var q = '/matches?limit=40' + (user ? '&user=' + encodeURIComponent(user) : '');
    return api.request('GET', q, undefined, { anonymous: true }).then(function (r) {
      return r.matches || [];
    });
  };
})();
