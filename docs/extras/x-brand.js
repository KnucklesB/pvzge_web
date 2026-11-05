/*
 * PvZ2 Gardendless - Branding: logos and game images replaced by admins.
 *
 * The configuration comes from the multiplayer server (GET /api/branding,
 * edited by ADMIN_USERS in Extras -> Visual) or, without a server, from the
 * static file branding/branding.json next to index.html:
 *
 *   { "title": "My server", "icon": "branding/icon.png",
 *     "menuLogo": { "url": "branding/logo.png", "x": 0, "y": 0.22, "scale": 0.55 },
 *     "frames": { "SPL9": "branding/menu.png", "logoGardendless": "branding/logo.png" } }
 *
 * "frames" maps a game sprite frame name to an image. The game keeps its
 * images in atlases; a replaced frame gets its own texture (the image is
 * stretched to the frame's original size, so layouts don't move) and every
 * sprite showing it is refreshed. This runs from the first frame on (the
 * engine's global `cc` exists before the loading screen), so the loading
 * screen is covered too. The menu logo is an extra sprite drawn over the
 * menu background, where the game's logo is painted.
 */
(function () {
  'use strict';

  var MP = window.PvZMP;
  var X = window.PvZX;
  var B = (X.brand = new MP.Emitter());

  // Shortcuts shown first in the editor: [key, sprite frame names].
  B.SLOTS = [
    ['menu_bg', ['SPL9', 'SPL10']],
    ['loading_bg', ['splash']],
    ['loading_logo', ['logoGardendless']],
  ];

  B.config = null; // normalized: {title, icon, menuLogo:{url,x,y,scale}, frames:{name:url}}
  B.raw = null; // as stored on the server (image ids)

  // The engine module once the game bridge has it (complete); before that,
  // the legacy global (enough for textures and sprite frames).
  function CC() {
    return (MP.game && MP.game.cc) || window.cc;
  }

  var imageCache = {};
  function loadImage(url) {
    if (!imageCache[url]) {
      imageCache[url] = new Promise(function (resolve, reject) {
        var img = new Image();
        if (!/^data:/.test(url)) img.crossOrigin = 'anonymous';
        img.onload = function () {
          resolve(img);
        };
        img.onerror = function () {
          reject(new Error('image ' + url));
        };
        img.src = url;
      });
    }
    return imageCache[url];
  }
  B.loadImage = loadImage;

  /* ------------------------------------------------------------ config */

  function serverUrl(id) {
    return MP.config.api + '/branding/img/' + id;
  }

  // Server config (image ids) -> URLs.
  B.fromServer = function (raw) {
    if (!raw) return null;
    var frames = {};
    Object.keys(raw.frames || {}).forEach(function (k) {
      frames[k] = serverUrl(raw.frames[k]);
    });
    return {
      title: raw.title || '',
      icon: raw.icon ? serverUrl(raw.icon) : '',
      menuLogo: raw.menuLogo && raw.menuLogo.img ? { url: serverUrl(raw.menuLogo.img), x: raw.menuLogo.x, y: raw.menuLogo.y, scale: raw.menuLogo.scale } : null,
      frames: frames,
    };
  };

  function fetchConfig() {
    var api = MP.api;
    if (api && api.available()) {
      return api
        .request('GET', '/branding', undefined, { anonymous: true, timeout: 4000 })
        .then(function (r) {
          B.raw = r.branding || null;
          return B.fromServer(B.raw);
        })
        .catch(function () {
          return null;
        });
    }
    return fetch('branding/branding.json', { cache: 'no-cache' })
      .then(function (res) {
        return res.ok ? res.json() : null;
      })
      .then(function (c) {
        if (!c) return null;
        return { title: c.title || '', icon: c.icon || '', menuLogo: c.menuLogo && c.menuLogo.url ? c.menuLogo : null, frames: c.frames || {} };
      })
      .catch(function () {
        return null;
      });
  }

  /* ------------------------------------------------------- tab and icon */

  var originalTitle = document.title;

  function applyDocument(cfg) {
    document.title = (cfg && cfg.title) || originalTitle;
    var link = document.getElementById('pvzx-icon');
    if (cfg && cfg.icon) {
      if (!link) {
        link = document.createElement('link');
        link.id = 'pvzx-icon';
        link.rel = 'icon';
        document.head.appendChild(link);
      }
      link.href = cfg.icon;
    } else if (link) link.remove();
  }

  /* ---------------------------------------------------- sprite frames */

  var pending = {}; // frame name -> loaded image (or null while loading)
  var applied = typeof WeakMap === 'function' ? new WeakMap() : null; // frame -> {tex, url}

  function want(name) {
    return !!(B.config && B.config.frames && B.config.frames[name]);
  }

  function imageFor(name) {
    var url = B.config.frames[name];
    if (pending[url] === undefined) {
      pending[url] = null;
      loadImage(url).then(
        function (img) {
          pending[url] = img;
        },
        function () {
          pending[url] = false;
        },
      );
    }
    return pending[url] ? { url: url, img: pending[url] } : null;
  }

  function refreshSprites(sf) {
    var cc = CC();
    var scene = cc.director.getScene();
    if (!scene || !cc.Sprite) return;
    scene.getComponentsInChildren(cc.Sprite).forEach(function (sp) {
      if (sp.spriteFrame === sf) {
        sp.spriteFrame = null;
        sp.spriteFrame = sf;
      }
    });
  }

  // Gives the frame its own texture with the new image, at its original size.
  function patchFrame(sf, src) {
    var cc = CC();
    var W = Math.max(1, Math.round(sf.originalSize.width));
    var H = Math.max(1, Math.round(sf.originalSize.height));
    var canvas = document.createElement('canvas');
    canvas.width = W;
    canvas.height = H;
    canvas.getContext('2d').drawImage(src.img, 0, 0, W, H);
    var tex = new cc.Texture2D();
    tex.image = new cc.ImageAsset(canvas);
    if (!sf._xBrandOrig) {
      sf._xBrandOrig = { texture: sf.texture, rect: sf.rect.clone(), offset: sf.offset.clone(), originalSize: sf.originalSize.clone(), rotated: sf.rotated };
    }
    sf.texture = tex;
    sf.rotated = false;
    sf.rect = new cc.Rect(0, 0, W, H);
    sf.offset = new cc.Vec2(0, 0);
    sf.originalSize = new cc.Size(W, H);
    if (applied) applied.set(sf, { tex: tex, url: src.url });
    refreshSprites(sf);
  }

  // Back to the game's own image (a replacement was removed in the editor).
  function restoreFrame(sf) {
    var o = sf._xBrandOrig;
    if (!o) return;
    sf.texture = o.texture;
    sf.rotated = o.rotated;
    sf.rect = o.rect;
    sf.offset = o.offset;
    sf.originalSize = o.originalSize;
    sf._xBrandOrig = null;
    if (applied) applied.delete(sf);
    refreshSprites(sf);
  }

  function scanFrames() {
    var cc = window.cc;
    var assets = cc.assetManager && cc.assetManager.assets;
    if (!assets) return;
    assets.forEach(function (a) {
      if (!(a instanceof cc.SpriteFrame)) return;
      var cur = applied && applied.get(a);
      if (!want(a.name)) {
        if (a._xBrandOrig) restoreFrame(a);
        return;
      }
      if (!a.texture || !(a.originalSize && a.originalSize.width)) return;
      var src = imageFor(a.name);
      if (!src) return;
      // Patched already with this image and the engine kept it.
      if (cur && cur.url === src.url && a.texture === cur.tex) return;
      if (a._xBrandOrig && cur && a.texture !== cur.tex) a._xBrandOrig = null; // reloaded by the engine
      try {
        patchFrame(a, src);
      } catch (e) {
        MP.warn('branding: cannot replace', a.name, e);
      }
    });
  }

  /* ----------------------------------------------------- menu logo */

  var logoNode = null;

  function placeLogo() {
    var cc = MP.game && MP.game.cc;
    if (!cc || !cc.UITransform) {
      setTimeout(placeLogo, 300);
      return;
    }
    var cfg = B.config && B.config.menuLogo;
    var canvasNode = cc.find('Canvas');
    var bg = canvasNode && canvasNode.getChildByName('mainScreenBg');
    if (logoNode && !logoNode.isValid) logoNode = null;
    if (!cfg || !bg) {
      if (logoNode) logoNode.destroy();
      logoNode = null;
      return;
    }
    loadImage(cfg.url).then(function (img) {
      if (!bg.isValid || B.config.menuLogo !== cfg) return;
      var tex = new cc.Texture2D();
      tex.image = new cc.ImageAsset(img);
      var sf = new cc.SpriteFrame();
      sf.texture = tex;
      if (!logoNode || !logoNode.isValid) {
        logoNode = new cc.Node('XBrandLogo');
        logoNode.layer = bg.layer;
        logoNode.parent = canvasNode;
        logoNode.setSiblingIndex(bg.getSiblingIndex() + 1);
        logoNode.addComponent(cc.UITransform);
        logoNode.addComponent(cc.Sprite);
      }
      var sp = logoNode.getComponent(cc.Sprite);
      sp.sizeMode = cc.Sprite.SizeMode.CUSTOM;
      sp.spriteFrame = sf;
      var bt = bg.getComponent(cc.UITransform);
      var w = bt.width * (cfg.scale || 0.55);
      var h = (w * img.height) / img.width;
      logoNode.getComponent(cc.UITransform).setContentSize(w, h);
      logoNode.setPosition((cfg.x || 0) * (bt.width / 2), (cfg.y == null ? 0.22 : cfg.y) * (bt.height / 2), 0);
    });
  }

  /* ----------------------------------------------------------- apply */

  // Applies a configuration now (also used for the editor's live preview).
  B.apply = function (cfg) {
    B.config = cfg || null;
    applyDocument(B.config);
    if (window.cc && cc.director && cc.director.getScene()) {
      scanFrames();
      placeLogo();
    }
    B.emit('change', B.config);
  };

  var hooked = false;
  function hookEngine() {
    if (hooked) return;
    if (!(window.cc && cc.director && cc.Director && cc.assetManager)) {
      setTimeout(hookEngine, 30);
      return;
    }
    hooked = true;
    var n = 0;
    cc.director.on(cc.Director.EVENT_AFTER_UPDATE, function () {
      if (!B.config || !Object.keys(B.config.frames || {}).length) return;
      // Often while loading, then a few times per second.
      if (++n % (cc.director.getTotalFrames() < 1800 ? 3 : 15)) return;
      scanFrames();
    });
    cc.director.on(cc.Director.EVENT_AFTER_SCENE_LAUNCH, function () {
      scanFrames();
      if (cc.director.getScene() && cc.director.getScene().name === 'mainScene') setTimeout(placeLogo, 50);
    });
  }

  B.reload = function () {
    return fetchConfig().then(function (cfg) {
      B.apply(cfg);
      return cfg;
    });
  };

  hookEngine();
  B.ready = B.reload();

  /* -------------------------------------------------- originals (editor) */

  // The original image of a sprite frame, cut from the game's PNG atlas
  // (compressed .astc textures ship a .png next to them).
  B.originalCanvas = function (sf) {
    var o = sf._xBrandOrig || { texture: sf.texture, rect: sf.rect, offset: sf.offset, originalSize: sf.originalSize, rotated: sf.rotated };
    var ia = o.texture && o.texture.image;
    var url = ia && ia.nativeUrl;
    if (!url) return Promise.reject(new Error('no_source'));
    url = url.replace(/\.(astc|pkm|pvr)$/, '.png');
    return loadImage(url).then(function (img) {
      var r = o.rect;
      var W = Math.round(o.originalSize.width);
      var H = Math.round(o.originalSize.height);
      var c = document.createElement('canvas');
      c.width = W;
      c.height = H;
      var ctx = c.getContext('2d');
      var dx = Math.round((W - r.width) / 2 + o.offset.x);
      var dy = Math.round((H - r.height) / 2 - o.offset.y);
      if (o.rotated) {
        // Stored turned 90 degrees in the atlas.
        ctx.save();
        ctx.translate(dx, dy + r.height);
        ctx.rotate(-Math.PI / 2);
        ctx.drawImage(img, r.x, r.y, r.height, r.width, 0, 0, r.height, r.width);
        ctx.restore();
      } else ctx.drawImage(img, r.x, r.y, r.width, r.height, dx, dy, r.width, r.height);
      return c;
    });
  };

  // Sprite frames currently loaded by the game, for the "any image" list.
  B.loadedFrames = function (q) {
    var cc = window.cc;
    var out = {};
    q = String(q || '').toLowerCase();
    cc.assetManager.assets.forEach(function (a) {
      if (!(a instanceof cc.SpriteFrame) || !a.name || out[a.name]) return;
      if (q && a.name.toLowerCase().indexOf(q) < 0) return;
      var s = (a._xBrandOrig || a).originalSize;
      if (!s || s.width < 8 || s.height < 8) return;
      out[a.name] = { name: a.name, w: Math.round(s.width), h: Math.round(s.height), frame: a };
    });
    return Object.keys(out)
      .sort()
      .map(function (k) {
        return out[k];
      });
  };

  B.findFrame = function (name) {
    var found = null;
    window.cc.assetManager.assets.forEach(function (a) {
      if (!found && a instanceof window.cc.SpriteFrame && a.name === name) found = a;
    });
    return found;
  };
})();
