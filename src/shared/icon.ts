// The app icon, drawn in code so the tray (runtime) and the .exe (scripts/make-icon.mjs) share it
// without binary assets: a dark rounded square with a gold diamond, anti-aliased.

const BG = [0x16, 0x1b, 0x22];
const GOLD = [0xc8, 0xa2, 0x4a];

const clamp01 = (x: number) => Math.max(0, Math.min(1, x));

/** RGBA pixels, row-major, `size` x `size`. */
export function drawIcon(size: number): Uint8Array {
  const px = new Uint8Array(size * size * 4);
  const c = (size - 1) / 2;
  const half = size * 0.47; // square half-size
  const radius = size * 0.18; // corner radius
  const border = Math.max(1, size * 0.045);
  const outer = size * 0.3; // diamond outline: distance from center to its corners
  const ring = Math.max(1.2, size * 0.055);
  const inner = size * 0.13; // filled center diamond (corner distance)
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = Math.abs(x - c);
      const dy = Math.abs(y - c);
      // rounded square signed distance
      const qx = dx - (half - radius);
      const qy = dy - (half - radius);
      const sq = Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - radius;
      const inside = clamp01(0.5 - sq);
      if (inside <= 0) continue;
      const l1 = dx + dy; // diamond "radius"; perpendicular distance to its edge = delta / sqrt(2)
      const goldRing = clamp01(ring / 2 + 0.5 - Math.abs(l1 - outer) / Math.SQRT2);
      const goldCore = clamp01(0.5 - (l1 - inner) / Math.SQRT2);
      const goldEdge = clamp01(0.5 - Math.abs(sq + border / 2) + border / 2 - 0.5);
      const g = Math.max(goldRing, goldCore, goldEdge);
      const i = (y * size + x) * 4;
      for (let k = 0; k < 3; k++) px[i + k] = Math.round(BG[k] * (1 - g) + GOLD[k] * g);
      px[i + 3] = Math.round(255 * inside);
    }
  }
  return px;
}

/** Same pixels in BGRA order (what Electron's nativeImage.createFromBitmap expects on Windows). */
export function drawIconBGRA(size: number): Uint8Array {
  const px = drawIcon(size);
  for (let i = 0; i < px.length; i += 4) {
    const r = px[i];
    px[i] = px[i + 2];
    px[i + 2] = r;
  }
  return px;
}
