import { PNG } from "pngjs";
import fs from "node:fs";
import path from "node:path";

// Minimalistic, modern logo: rounded square with gradient bg and centered "AI" glyph
// Deterministic generation without external assets.

const sizes = [16, 32, 48, 128];
const outDir = path.resolve(process.cwd(), "icons");

if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });

for (const size of sizes) {
  const png = new PNG({ width: size, height: size, colorType: 6 });
  // Draw background with subtle radial-like gradient and rounded corners
  const radius = Math.round(size * 0.22);
  const centerX = size / 2;
  const centerY = size / 2;
  const maxDist = Math.hypot(centerX, centerY);

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const idx = (size * y + x) << 2;
      // rounded rect mask
      const rx = Math.min(x, size - 1 - x);
      const ry = Math.min(y, size - 1 - y);
      const minEdge = Math.min(rx, ry);
      const inRound = minEdge >= radius || radius - minEdge <= radius; // simple soft corners

      const dist = Math.hypot(x - centerX, y - centerY) / maxDist;
      const t = Math.min(1, Math.max(0, dist));
      // gradient from teal to indigo
      const c1 = { r: 110, g: 231, b: 183 }; // #6ee7b7
      const c2 = { r: 99, g: 102, b: 241 }; // #6366f1
      const r = Math.round(c1.r * (1 - t) + c2.r * t);
      const g = Math.round(c1.g * (1 - t) + c2.g * t);
      const b = Math.round(c1.b * (1 - t) + c2.b * t);

      png.data[idx] = r;
      png.data[idx + 1] = g;
      png.data[idx + 2] = b;
      png.data[idx + 3] = inRound ? 255 : 0;
    }
  }

  // Draw "AI" glyph in the center (simple vector-like strokes)
  const fg = { r: 12, g: 16, b: 24 };
  const line = (x0, y0, x1, y1, w) => {
    const dx = x1 - x0,
      dy = y1 - y0;
    const len = Math.hypot(dx, dy) || 1;
    for (let t = 0; t <= 1; t += 1 / (size * 6)) {
      const x = x0 + dx * t;
      const y = y0 + dy * t;
      for (let oy = -w; oy <= w; oy++) {
        for (let ox = -w; ox <= w; ox++) {
          const px = Math.round(x + ox);
          const py = Math.round(y + oy);
          if (px < 0 || py < 0 || px >= size || py >= size) continue;
          const idx = (size * py + px) << 2;
          png.data[idx] = fg.r;
          png.data[idx + 1] = fg.g;
          png.data[idx + 2] = fg.b;
          png.data[idx + 3] = 255;
        }
      }
    }
  };

  const s = size;
  const cx = s * 0.5;
  const cy = s * 0.58;
  const stroke = Math.max(1, Math.round(s * 0.05));
  // "A"
  line(s * 0.28, cy, cx, s * 0.26, stroke);
  line(cx, s * 0.26, s * 0.72, cy, stroke);
  line(s * 0.37, cy * 0.92, s * 0.63, cy * 0.92, stroke);
  // "I"
  line(s * 0.78, s * 0.3, s * 0.78, s * 0.78, stroke);

  const file = path.join(outDir, `icon${size}.png`);
  png.pack().pipe(fs.createWriteStream(file));
  console.log("Generated", file);
}

