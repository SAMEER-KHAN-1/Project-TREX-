// Minimal PNG reader, just enough to get average visible luminance per asset.
const fs = require("fs");
const zlib = require("zlib");
const path = require("path");
const DIR = path.join(__dirname, "..", "..");

function decode(file) {
  const buf = fs.readFileSync(file);
  let pos = 8, width = 0, height = 0, depth = 0, colorType = 0, palette = null, trns = null;
  const idat = [];
  while (pos < buf.length) {
    const len = buf.readUInt32BE(pos);
    const type = buf.toString("ascii", pos + 4, pos + 8);
    const data = buf.slice(pos + 8, pos + 8 + len);
    if (type === "IHDR") {
      width = data.readUInt32BE(0); height = data.readUInt32BE(4);
      depth = data[8]; colorType = data[9];
    } else if (type === "PLTE") palette = data;
    else if (type === "tRNS") trns = data;
    else if (type === "IDAT") idat.push(data);
    else if (type === "IEND") break;
    pos += 12 + len;
  }
  if (depth !== 8) return null;
  const raw = zlib.inflateSync(Buffer.concat(idat));
  const channels = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 }[colorType];
  const bpp = channels;
  const stride = width * bpp;
  const out = Buffer.alloc(height * stride);
  let rp = 0;
  for (let y = 0; y < height; y++) {
    const filter = raw[rp++];
    for (let x = 0; x < stride; x++) {
      const v = raw[rp + x];
      const a = x >= bpp ? out[y * stride + x - bpp] : 0;
      const b = y > 0 ? out[(y - 1) * stride + x] : 0;
      const c = x >= bpp && y > 0 ? out[(y - 1) * stride + x - bpp] : 0;
      let val;
      if (filter === 0) val = v;
      else if (filter === 1) val = v + a;
      else if (filter === 2) val = v + b;
      else if (filter === 3) val = v + ((a + b) >> 1);
      else {
        const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
        val = v + (pa <= pb && pa <= pc ? a : pb <= pc ? b : c);
      }
      out[y * stride + x] = val & 0xff;
    }
    rp += stride;
  }
  // Average luminance over visible pixels.
  let sum = 0, n = 0;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = y * stride + x * bpp;
      let r, g, b, alpha = 255;
      if (colorType === 6) { r = out[i]; g = out[i + 1]; b = out[i + 2]; alpha = out[i + 3]; }
      else if (colorType === 2) { r = out[i]; g = out[i + 1]; b = out[i + 2]; }
      else if (colorType === 3) {
        const idx = out[i];
        r = palette[idx * 3]; g = palette[idx * 3 + 1]; b = palette[idx * 3 + 2];
        if (trns && idx < trns.length) alpha = trns[idx];
      } else { r = g = b = out[i]; if (colorType === 4) alpha = out[i + 1]; }
      if (alpha > 0) { sum += 0.2126 * r + 0.7152 * g + 0.0722 * b; n++; }
    }
  }
  return n ? sum / n : null;
}

const NIGHT_SKY = 0.2126 * 20 + 0.7152 * 24 + 0.0722 * 46;
const NIGHT_SAND = 0.2126 * 60 + 0.7152 * 56 + 0.0722 * 48;
console.log("night sky luminance :", NIGHT_SKY.toFixed(1));
console.log("night sand luminance:", NIGHT_SAND.toFixed(1));
console.log("");
console.log("asset".padEnd(22), "luminance", " vs sand", " vs sky");
for (const f of fs.readdirSync(DIR).filter((f) => f.endsWith(".png")).sort()) {
  const l = decode(path.join(DIR, f));
  if (l === null) { console.log(f.padEnd(22), "(unsupported)"); continue; }
  console.log(f.padEnd(22), l.toFixed(1).padStart(9), (l - NIGHT_SAND).toFixed(1).padStart(8), (l - NIGHT_SKY).toFixed(1).padStart(8));
}
// The two procedurally drawn obstacles, from their fill() calls in sketch.js
console.log("");
console.log("crow   (40,40,40)    ", (0.2126 * 40 + 0.7152 * 40 + 0.0722 * 40).toFixed(1));
console.log("boulder(95,90,85)    ", (0.2126 * 95 + 0.7152 * 90 + 0.0722 * 85).toFixed(1));
