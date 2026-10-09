/*
 * PvZ2 Gardendless - Multiplayer skin.
 *
 * The multiplayer screens are HTML, but they are dressed with the game's own
 * art: sprite frames are cut out of the loaded texture atlases at runtime and
 * exposed as CSS custom properties, and the game's fonts are registered with
 * @font-face. Nothing is hard-coded to asset UUIDs, so this survives game
 * updates; if an asset can't be found the CSS falls back to plain styling.
 */
(function () {
  'use strict';

  var MP = window.PvZMP;

  var SPRITES = [
    'BtnPurpleBigUp',
    'BtnPurpleBigDown',
    'BtnGreenBigUp',
    'BtnGreenBigDown',
    'BtnBlueBigUp',
    'BtnBlueBigDown',
    'BtnRedBigUp',
    'BtnRedBigDown',
    'BtnGreyBigUp',
    'BtnBrownUp',
    'BtnBrownDown',
    'CloseRoundUp',
    'CloseRoundDown',
    'windowCommon',
    'windowCommonBorder',
    'windowDeep',
    'PlayerName',
    'PlayerIcon',
    'PlayerHighlight',
    'ScrollBarBar',
    'ScrollBarBG',
    'Gear',
    'frontyard',
    'modern',
    'egypt',
    'pirate',
    'cowboy',
    'future',
    'dark',
    'beach',
    'iceage',
    'lostcity',
    'eighties',
    'dino',
    'sky',
    'kongfu',
    'epic',
  ];

  var FONTS = {
    FBUSV8C5EI: 'PvZMP Main',
    BRIANNETOD: 'PvZMP Hand',
    HOUSEOFTERROR: 'PvZMP Terror',
  };

  var skin = (MP.skin = { urls: {}, fonts: {}, ready: false });

  function imageSource(frame) {
    var tex = frame && frame.texture;
    var img = tex && (tex.image || (tex._mipmaps && tex._mipmaps[0]));
    var data = img && (img.data || img._nativeAsset || img);
    if (data && (data instanceof HTMLImageElement || data instanceof HTMLCanvasElement || (window.ImageBitmap && data instanceof ImageBitmap))) {
      return data;
    }
    return null;
  }

  function nativeUrl(frame) {
    var img = frame && frame.texture && frame.texture.image;
    return (img && (img.nativeUrl || img._nativeUrl)) || '';
  }

  var imageCache = {};
  function loadImage(url) {
    if (!imageCache[url]) {
      imageCache[url] = new Promise(function (resolve) {
        var im = new Image();
        im.onload = function () {
          resolve(im);
        };
        im.onerror = function () {
          resolve(null);
        };
        im.src = url;
      });
    }
    return imageCache[url];
  }

  function cut(frame, src) {
    src = src || imageSource(frame);
    if (!src) return null;
    var r = frame.rect;
    var canvas = document.createElement('canvas');
    canvas.width = r.width;
    canvas.height = r.height;
    var ctx = canvas.getContext('2d');
    try {
      if (frame.rotated) {
        // Packed rotated 90deg clockwise inside the atlas.
        ctx.translate(0, r.height);
        ctx.rotate(-Math.PI / 2);
        ctx.drawImage(src, r.x, r.y, r.height, r.width, 0, 0, r.height, r.width);
      } else {
        ctx.drawImage(src, r.x, r.y, r.width, r.height, 0, 0, r.width, r.height);
      }
      return canvas.toDataURL('image/png');
    } catch (e) {
      return null;
    }
  }

  skin.build = function () {
    var cc = MP.game.cc;
    if (!cc) return Promise.resolve();
    var pending = [];
    var wanted = {};
    SPRITES.forEach(function (n) {
      if (!skin.urls[n]) wanted[n] = true;
    });
    var fontsWanted = {};
    Object.keys(FONTS).forEach(function (n) {
      if (!skin.fonts[n]) fontsWanted[n] = true;
    });
    cc.assetManager.assets.forEach(function (asset) {
      if (asset instanceof cc.SpriteFrame && wanted[asset.name]) {
        var name = asset.name;
        var url = cut(asset);
        if (url) {
          skin.urls[name] = url;
          delete wanted[name];
        } else if (nativeUrl(asset)) {
          // Pixel data was released after GPU upload: reload the source image.
          delete wanted[name];
          pending.push(
            loadImage(nativeUrl(asset)).then(function (im) {
              var u = im && cut(asset, im);
              if (u) skin.urls[name] = u;
            }),
          );
        }
      } else if (cc.TTFFont && asset instanceof cc.TTFFont && fontsWanted[asset.name]) {
        var furl = asset.nativeUrl || asset._nativeUrl;
        if (furl) {
          skin.fonts[asset.name] = furl;
          delete fontsWanted[asset.name];
        }
      }
    });
    apply();
    return Promise.all(pending).then(apply);
  };

  function apply() {
    var root = document.documentElement;
    Object.keys(skin.urls).forEach(function (n) {
      root.style.setProperty('--mp-img-' + n, 'url("' + skin.urls[n] + '")');
    });
    var css = '';
    Object.keys(skin.fonts).forEach(function (n) {
      css += '@font-face{font-family:"' + FONTS[n] + '";src:url("' + skin.fonts[n] + '") format("truetype");font-display:swap;}\n';
    });
    var style = document.getElementById('pvzmp-fonts');
    if (!style) {
      style = document.createElement('style');
      style.id = 'pvzmp-fonts';
      document.head.appendChild(style);
    }
    style.textContent = css;
    root.classList.toggle('pvzmp-skinned', !!skin.urls.windowCommon);
    skin.ready = true;
  }

  skin.url = function (name) {
    return skin.urls[name] || '';
  };
})();
