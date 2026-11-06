/*
 * PvZ2 Gardendless - Plant Match: photos
 *
 * Plant photos rendered from the game's own display prefabs by an
 * off-screen camera, and the animated <img> loop.
 *
 * Shared state and functions of the mode live in X.matchI (see
 * x-match.js); the files load in order: text, core, photos, chat,
 * social, dates, ui.
 */
(function () {
  'use strict';

  var MP = window.PvZMP;
  var X = window.PvZX;
  var G = MP.game;
  var t = X.t;
  var el = MP.util.el;
  var M = X.match;
  var I = X.matchI;
  var MT = X.matchText;
  var TXT = MT.TXT;
  var CHAT = MT.CHAT;
  var PERS = MT.PERS;
  var DATES = MT.DATES;
  var STAGES = MT.STAGES;
  var TRAITS = MT.TRAITS;
  var fill = I.fill;
  var L = I.L;
  var Lp = I.Lp;
  var shuffle = I.shuffle;
  var pick = I.pick;
  var today = I.today;
  var tr = I.tr;
  var DECK = I.DECK;
  var SLOTS = I.SLOTS;
  var LIKES_PER_DAY = I.LIKES_PER_DAY;
  var WORLD_KEY = I.WORLD_KEY;
  var WORLD_AGE = I.WORLD_AGE;
  var CLASSIC_WORLDS = I.CLASSIC_WORLDS;
  var NEW_WORLDS = I.NEW_WORLDS;
  var STAGE_OF_WORLD = I.STAGE_OF_WORLD;

  /* --------------------------------------------------------- the camera */

  I.LAYER = 1 << 19;
  I.RT = 640;
  I.cam = null;
  I.ANIM_FRAMES = 8;

  I.frames = function frames(n) {
    return new Promise(function (r) {
      var k = 0;
      (function f() {
        if (++k >= n) r();
        else requestAnimationFrame(f);
      })();
    });
  };

  I.ensureCamera = function ensureCamera() {
    var cc = G.cc;
    if (I.cam && I.cam.root.isValid) return I.cam;
    var scene = cc.director.getScene();
    var root = new cc.Node('XMatchCamera');
    root.layer = I.LAYER;
    scene.addChild(root);
    root.setPosition(-20000, -20000, 0);
    root.addComponent(cc.RenderRoot2D);
    var camNode = new cc.Node('Cam');
    camNode.layer = I.LAYER;
    root.addChild(camNode);
    camNode.setPosition(0, 60, 1000);
    var c = camNode.addComponent(cc.Camera);
    c.projection = cc.Camera.ProjectionType.ORTHO;
    c.orthoHeight = 135;
    c.visibility = I.LAYER;
    c.clearFlags = cc.Camera.ClearFlag.SOLID_COLOR;
    c.clearColor = new cc.Color(0, 0, 0, 0);
    c.priority = -10;
    c.near = 1;
    c.far = 2000;
    var rt = new cc.RenderTexture();
    rt.reset({ width: I.RT, height: I.RT });
    c.targetTexture = rt;
    I.cam = { root: root, rt: rt };
    return I.cam;
  };

  // Pixels and their opaque bounds.
  I.readRaw = function readRaw(rt) {
    var px = rt.readPixels(0, 0, I.RT, I.RT);
    var b = { minX: I.RT, minY: I.RT, maxX: -1, maxY: -1 };
    for (var y = 0; y < I.RT; y++) {
      for (var x = 0; x < I.RT; x++) {
        if (px[(y * I.RT + x) * 4 + 3] > 8) {
          if (x < b.minX) b.minX = x;
          if (x > b.maxX) b.maxX = x;
          if (y < b.minY) b.minY = y;
          if (y > b.maxY) b.maxY = y;
        }
      }
    }
    return { px: px, box: b.maxX < 0 ? null : b };
  };

  I.unionBox = function unionBox(list) {
    var u = null;
    list.forEach(function (r) {
      var b = r.box;
      if (!b) return;
      if (!u) u = { minX: b.minX, minY: b.minY, maxX: b.maxX, maxY: b.maxY };
      else {
        u.minX = Math.min(u.minX, b.minX);
        u.minY = Math.min(u.minY, b.minY);
        u.maxX = Math.max(u.maxX, b.maxX);
        u.maxY = Math.max(u.maxY, b.maxY);
      }
    });
    return u;
  };

  // Crop to a box (the RenderTexture's rows go bottom-up) -> data URL.
  I.crop = function crop(px, b) {
    var w = b.maxX - b.minX + 1;
    var h = b.maxY - b.minY + 1;
    var pad = Math.round(Math.max(w, h) * 0.08);
    var c = document.createElement('canvas');
    c.width = w + pad * 2;
    c.height = h + pad * 2;
    var tmp = document.createElement('canvas');
    tmp.width = w;
    tmp.height = h;
    var tctx = tmp.getContext('2d');
    var id = tctx.createImageData(w, h);
    for (var yy = 0; yy < h; yy++) {
      var src = ((b.maxY - yy) * I.RT + b.minX) * 4;
      id.data.set(px.subarray(src, src + w * 4), yy * w * 4);
    }
    tctx.putImageData(id, 0, 0);
    c.getContext('2d').drawImage(tmp, pad, pad);
    return c.toDataURL();
  };

  I.POSES = {
    idle: /^idle1?$|idle/i,
    attack: /shoot|attack|lob|fire|bite|chomp|punch|throw|blow|spit|smash|zap|slap|explode|stab|produce/i,
    food: /^food$|plantfood|food/i,
    water: /^water$/i,
    death: /^death/i,
  };

  I.animFor = function animFor(names, kind) {
    return names.find(function (n) {
      return I.POSES[kind].test(n);
    });
  };

  I.loadPrefab = function loadPrefab(path) {
    return new Promise(function (resolve) {
      G.cc.resources.load(path, G.cc.Prefab, function (err, prefab) {
        resolve(err ? null : prefab);
      });
    });
  };

  I.setPose = function setPose(dbs, anim, progress) {
    dbs.forEach(function (d) {
      try {
        var a = d.armature && d.armature();
        if (a && a.animation.hasAnimation(anim)) a.animation.gotoAndStopByProgress(anim, progress);
      } catch (e) {}
    });
  };

  // {idle: [frames], attack, food, water, death} (missing poses left out).
  I.shoot = function shoot(p) {
    var cc = G.cc;
    var res = p.feature.RES || {};
    var name = res.Disabled || res.Plant;
    if (!name || !cc.RenderRoot2D) return Promise.resolve({});
    return I.loadPrefab('plants/' + name + 'DIS').then(function (prefab) {
      if (!prefab || !I.node) return {};
      var c = I.ensureCamera();
      var n = cc.instantiate(prefab);
      c.root.addChild(n);
      n.walk(function (x) {
        x.layer = I.LAYER;
      });
      var dbs = n.getComponentsInChildren(cc.dragonBones.ArmatureDisplay);
      var main = dbs.find(function (d) {
        return d.armature && d.armature();
      });
      var names = [];
      try {
        names = main.armature().animation.animationNames.slice();
      } catch (e) {}
      var out = {};
      var snap = function (anim, progress) {
        I.setPose(dbs, anim, progress);
        return I.frames(3).then(function () {
          return I.readRaw(c.rt);
        });
      };
      // Animated pose: a loop of frames cropped to the same box.
      var idle = I.animFor(names, 'idle');
      var seq = Promise.resolve();
      var raws = [];
      if (idle) {
        for (var k = 0; k < I.ANIM_FRAMES; k++) {
          (function (k) {
            seq = seq.then(function () {
              return snap(idle, k / I.ANIM_FRAMES).then(function (r) {
                raws.push(r);
              });
            });
          })(k);
        }
        seq = seq.then(function () {
          var box = I.unionBox(raws);
          if (box) {
            out.idle = raws.map(function (r) {
              return I.crop(r.px, box);
            });
          }
        });
      }
      [
        ['attack', 0.55],
        ['food', 0.5],
        ['water', 0.4],
        ['death', 0.45],
      ].forEach(function (pose) {
        seq = seq.then(function () {
          var anim = I.animFor(names, pose[0]);
          if (!anim || anim === idle) return;
          return snap(anim, pose[1]).then(function (r) {
            if (r.box) out[pose[0]] = I.crop(r.px, r.box);
          });
        });
      });
      return I.frames(3)
        .then(function () {
          return seq;
        })
        .then(function () {
          n.destroy();
          return out;
        })
        .catch(function (e) {
          MP.warn('match: photo', p.code, e);
          if (n.isValid) n.destroy();
          return out;
        });
    });
  };

  I.shooting = false;
  I.queuePhotos = function queuePhotos() {
    if (I.shooting || !I.round || !I.node) return;
    var target = null;
    var wanted = [];
    for (var i = I.round.i; i < Math.min(I.round.cards.length, I.round.i + 3); i++) wanted.push(I.round.cards[i]);
    if (I.view.viewing) wanted.unshift(I.view.viewing);
    if (I.view.chat) wanted.unshift(I.view.chat);
    I.round.matches.forEach(function (m) {
      wanted.push(m);
    });
    target = wanted.find(function (p) {
      return p && !p.photos;
    });
    if (!target) return;
    I.shooting = true;
    I.shoot(target).then(function (photos) {
      target.photos = photos;
      I.shooting = false;
      if (I.node) I.render();
      I.queuePhotos();
    });
  };

  I.photoList = function photoList(p) {
    var list = [];
    var ph = p.photos || {};
    if (ph.idle) list.push({ frames: ph.idle, label: t('match_photo_idle') });
    list.push({ src: p.packet, label: t('match_photo_card'), packet: true });
    if (ph.attack) list.push({ src: ph.attack, label: t('match_photo_attack') });
    if (ph.food) list.push({ src: ph.food, label: t('match_photo_food') });
    if (ph.water) list.push({ src: ph.water, label: L(TXT.photoWater) });
    if (ph.death) list.push({ src: ph.death, label: L(TXT.photoDeath) });
    return list;
  };

  I.avatar = function avatar(p) {
    var ph = p.photos || {};
    return (ph.idle && ph.idle[0]) || p.packet;
  };

  // Animated photos: <img> with _frames, advanced by one timer.
  I.animImg = function animImg(framesList, cls) {
    var img = el('img' + (cls ? '.' + cls : '') + '.pvzx-anim', { src: framesList[0], alt: '', draggable: 'false' });
    img._frames = framesList;
    img._k = 0;
    return img;
  };
  setInterval(function () {
    if (!I.node) return;
    I.node.querySelectorAll('img.pvzx-anim').forEach(function (img) {
      var f = img._frames;
      if (!f || f.length < 2) return;
      img._k = (img._k + 1) % f.length;
      img.src = f[img._k];
    });
  }, 110);
})();
