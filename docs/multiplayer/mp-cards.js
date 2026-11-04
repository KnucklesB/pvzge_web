/*
 * PvZ2 Gardendless - Zombie seed packets for the HTML UI.
 *
 * The game draws zombie packets with a DragonBones armature: a world-themed
 * background ("background" armature, one animation per world) plus the zombie
 * portrait ("Zombie" armature, one animation per card sprite name). Both are
 * regions of texture atlases in the `resources` bundle. Here the armature JSON
 * is read directly and each packet is composed on a 2D canvas, so the lobby can
 * show the exact same artwork as the game without rendering any scene.
 *
 * The asset UUIDs are discovered from a live packet the first time the player
 * is in a level and remembered; the values below are the current build's.
 */
(function () {
  'use strict';

  var MP = window.PvZMP;
  var G = MP.game;

  var DEFAULT_ASSETS = {
    zSke: '52499037-3d67-4db4-a1c1-d5055559bc09',
    zAtlas: '1460d3f3-5bba-411c-bad2-47aa2d6b278f',
    bgSke: '91731241-49e8-4db3-bb69-f04d4f4762d6',
    bgAtlas: '2c339223-8acf-4c14-99cb-018fa35f1174',
  };

  var cards = (MP.cards = new MP.Emitter());
  cards.ready = false;
  var data = null; // parsed armatures/atlases
  var cache = {};
  var loading = null;

  function loadAsset(uuid) {
    return new Promise(function (resolve, reject) {
      G.cc.assetManager.loadAny({ uuid: uuid }, function (err, asset) {
        if (err) reject(err);
        else resolve(asset);
      });
    });
  }

  function loadImage(url) {
    return new Promise(function (resolve, reject) {
      var im = new Image();
      im.onload = function () {
        resolve(im);
      };
      im.onerror = reject;
      im.src = url;
    });
  }

  function textureUrl(atlasAsset) {
    var tex = atlasAsset && atlasAsset.texture;
    var img = tex && tex.image;
    return (img && (img.nativeUrl || img._nativeUrl)) || '';
  }

  // name -> display list / anim -> display index, for one armature.
  function parseArmature(skeJson, armatureName, slotName) {
    var ske = typeof skeJson === 'string' ? JSON.parse(skeJson) : skeJson;
    var arm = (ske.armature || []).find(function (a) {
      return a.name === armatureName;
    });
    if (!arm) throw new Error('armature ' + armatureName + ' not found');
    var skinSlot = arm.skin[0].slot.find(function (s) {
      return s.name === slotName;
    });
    var anims = {};
    (arm.animation || []).forEach(function (a) {
      var s = (a.slot || []).find(function (x) {
        return x.name === slotName;
      });
      var f = s && s.displayFrame && s.displayFrame[0];
      if (f && f.value != null) anims[a.name] = f.value;
    });
    return { displays: skinSlot ? skinSlot.display : [], anims: anims };
  }

  function parseAtlas(atlasJson) {
    var atlas = typeof atlasJson === 'string' ? JSON.parse(atlasJson) : atlasJson;
    var map = {};
    (atlas.SubTexture || []).forEach(function (s) {
      map[s.name] = s;
    });
    return map;
  }

  // Remembers the asset UUIDs of a live zombie packet (survives game updates).
  cards.learnFrom = function (card) {
    try {
      var ca = card.ca;
      var found = {
        zSke: ca._plantDB.dragonAsset._uuid,
        zAtlas: ca._plantDB.dragonAtlasAsset._uuid,
        bgSke: ca._bgDB.dragonAsset._uuid,
        bgAtlas: ca._bgDB.dragonAtlasAsset._uuid,
      };
      var prev = MP.store.get('cardAssets', null);
      if (!prev || prev.zSke !== found.zSke || prev.bgSke !== found.bgSke) {
        MP.store.set('cardAssets', found);
        if (!cards.ready) cards.load();
      }
    } catch (e) {}
  };

  cards.load = function () {
    if (cards.ready) return Promise.resolve(true);
    if (loading) return loading;
    var ids = Object.assign({}, DEFAULT_ASSETS, MP.store.get('cardAssets', {}));
    loading = Promise.all([loadAsset(ids.zSke), loadAsset(ids.zAtlas), loadAsset(ids.bgSke), loadAsset(ids.bgAtlas)])
      .then(function (a) {
        return Promise.all([loadImage(textureUrl(a[1])), loadImage(textureUrl(a[3]))]).then(function (imgs) {
          data = {
            zombie: parseArmature(a[0].dragonBonesJson, 'Zombie', 'zombie'),
            zAtlas: parseAtlas(a[1].atlasJson),
            zImg: imgs[0],
            bg: parseArmature(a[2].dragonBonesJson, 'background', 'bk'),
            bgAtlas: parseAtlas(a[3].atlasJson),
            bgImg: imgs[1],
          };
          cards.ready = true;
          cache = {};
          queued = {};
          cards.emit('ready');
          return true;
        });
      })
      .catch(function (e) {
        MP.warn('zombie packets unavailable', e);
        loading = null;
        return false;
      });
    return loading;
  };

  // Same mapping as the game's CardFeatureZombie.
  function bgAnimFor(world) {
    switch (world) {
      case 'egypt':
      case 'pirate':
      case 'cowboy':
      case 'kongfu':
      case 'future':
      case 'dark':
      case 'beach':
      case 'ice':
      case 'lostcity':
      case 'eighties':
      case 'sky':
      case 'dino':
      case 'modern':
      case 'frontyard':
        return world;
      case 'water':
        return 'beach';
      case 'market':
        return 'prenium';
      case 'mint':
      case 'lod':
        return 'mint';
      default:
        return 'homeless';
    }
  }

  function drawRegion(ctx, img, sub, cx, cy, scale) {
    // Trimmed regions carry the original frame size and offset.
    var fw = sub.frameWidth || sub.width;
    var fh = sub.frameHeight || sub.height;
    var ox = -(sub.frameX || 0);
    var oy = -(sub.frameY || 0);
    var s = scale || 1;
    var left = cx - (fw * s) / 2 + ox * s;
    var top = cy - (fh * s) / 2 + oy * s;
    if (sub.rotated) {
      ctx.save();
      ctx.translate(left, top + sub.width * s);
      ctx.rotate(-Math.PI / 2);
      ctx.drawImage(img, sub.x, sub.y, sub.height, sub.width, 0, 0, sub.height * s, sub.width * s);
      ctx.restore();
    } else {
      ctx.drawImage(img, sub.x, sub.y, sub.width, sub.height, left, top, sub.width * s, sub.height * s);
    }
  }

  function feature(type) {
    try {
      return G.m.Zombies.zombies.getZombieFeature(G.m.Zombies.ZombieEnum[type]);
    } catch (e) {
      return null;
    }
  }

  function compose(type) {
    var f = feature(type);
    var zi = f && data.zombie.anims[f._CARDSPRITENAME];
    var zd = zi != null && data.zombie.displays[zi];
    var zs = zd && data.zAtlas[zd.name];
    var bi = data.bg.anims[bgAnimFor(f && f.OBTAINWORLD)];
    if (bi == null) bi = data.bg.anims.homeless;
    var bd = data.bg.displays[bi];
    var bs = bd && data.bgAtlas[bd.name];
    if (!zs || !bs) return null;
    var w = bs.frameWidth || bs.width;
    var h = bs.frameHeight || bs.height;
    var c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    var ctx = c.getContext('2d');
    var bt = bd.transform || {};
    drawRegion(ctx, data.bgImg, bs, w / 2 + (bt.x || 0), h / 2 + (bt.y || 0), bt.scX || 1);
    var zt = zd.transform || {};
    // Keep the portrait inside the packet's border like the game's mask does.
    ctx.save();
    ctx.beginPath();
    ctx.rect(9, 9, w - 18, h - 18);
    ctx.clip();
    drawRegion(ctx, data.zImg, zs, w / 2 + (zt.x || 0), h / 2 + (zt.y || 0), zt.scX || 1);
    ctx.restore();
    return c;
  }

  // Packets are drawn a few at a time and PNG-encoded asynchronously, so
  // opening the chooser (200+ zombies) never blocks the page.
  var queue = [];
  var queued = {};
  var pumping = false;

  function pump() {
    if (pumping) return;
    pumping = true;
    setTimeout(function step() {
      var t0 = performance.now();
      while (queue.length && performance.now() - t0 < 8) {
        var type = queue.shift();
        var canvas = null;
        try {
          canvas = compose(type);
        } catch (e) {
          MP.warn('packet render failed', type, e);
        }
        if (!canvas) {
          cache[type] = null;
          continue;
        }
        (function (ty, cv) {
          cv.toBlob(function (blob) {
            cache[ty] = blob ? URL.createObjectURL(blob) : null;
            if (cache[ty]) cards.emit('art', ty, cache[ty]);
          }, 'image/png');
        })(type, canvas);
      }
      if (queue.length) setTimeout(step, 16);
      else pumping = false;
    }, 0);
  }

  // Packet artwork URL for a zombie type, or null while it is being drawn
  // (an 'art' event follows) or when the packets can't be loaded.
  cards.zombie = function (type) {
    if (!cards.ready) return null;
    if (cache[type] !== undefined) return cache[type];
    if (!queued[type]) {
      queued[type] = true;
      queue.push(type);
      pump();
    }
    return null;
  };

  // Draws these packets next (e.g. the world tab just opened), in order.
  cards.prioritize = function (types) {
    var front = types.filter(function (ty) {
      return queue.indexOf(ty) >= 0;
    });
    if (!front.length) return;
    queue = front.concat(
      queue.filter(function (ty) {
        return front.indexOf(ty) < 0;
      }),
    );
  };

  /* -------------------------------------------------------------- catalog */

  var WORLD_ORDER = ['frontyard', 'modern', 'egypt', 'pirate', 'cowboy', 'kongfu', 'future', 'dark', 'beach', 'ice', 'lostcity', 'eighties', 'dino', 'sky', 'market', 'water'];

  // Every zombie of the almanac that can be sent in Versus, grouped by world.
  cards.catalog = function () {
    if (cards._catalog) return cards._catalog;
    var out = [];
    try {
      var zs = G.m.Zombies.zombies;
      var boss = {};
      zs.zombossList().forEach(function (id) {
        boss[id] = true;
      });
      var seen = {};
      Object.keys(zs.AlmanacList).forEach(function (k) {
        var id = zs.AlmanacList[k];
        var f = zs.getZombieFeature(id);
        if (!f || boss[id] || seen[f.CODENAME] || f.CODENAME === 'treasureyeti') return;
        seen[f.CODENAME] = true;
        out.push({ type: f.CODENAME, world: f.OBTAINWORLD === 'water' ? 'beach' : f.OBTAINWORLD });
      });
    } catch (e) {}
    out.sort(function (a, b) {
      return WORLD_ORDER.indexOf(a.world) - WORLD_ORDER.indexOf(b.world);
    });
    if (out.length) cards._catalog = out;
    return out;
  };

  cards.worlds = function () {
    var seen = [];
    cards.catalog().forEach(function (z) {
      if (seen.indexOf(z.world) < 0) seen.push(z.world);
    });
    return seen;
  };
})();
