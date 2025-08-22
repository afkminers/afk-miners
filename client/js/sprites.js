const IMG_CACHE = new Map();

function loadImg(src) {
  if (IMG_CACHE.has(src)) return IMG_CACHE.get(src);
  const img = new Image();
  img.src = src;
  IMG_CACHE.set(src, img);
  return img;
}

export function drawSprite(ctx, meta, animName, dir, t, x, y) {
  const anim = meta.anims[animName];
  if (!anim) return;

  const row = anim.rowByDir ? anim.rowByDir[dir] : anim.row;
  const frameIdx = Math.floor(t * anim.fps) % anim.frames;
  const col = (anim.startCol || 0) + frameIdx;

  const fw = meta.frame.width;
  const fh = meta.frame.height;
  const spacing = meta.frame.spacing || 0;
  const margin = meta.frame.margin || 0;

  const sx = col * fw + spacing * col + margin;
  const sy = row * fh + spacing * row + margin;

  const img = loadImg(meta.image);
  const ax = (meta.anchor && meta.anchor.x != null) ? meta.anchor.x : 0.5;
  const ay = (meta.anchor && meta.anchor.y != null) ? meta.anchor.y : 1.0;

  const dx = Math.round(x - fw * ax);
  const dy = Math.round(y - fh * ay);

  ctx.drawImage(img, sx, sy, fw, fh, dx, dy, fw, fh);
}
