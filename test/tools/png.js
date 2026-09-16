// Minimal PNG reader - enough to recover the RGBA pixels of this project's
// own assets, with no dependency to install.
//
// It exists because two different checks need the real artwork rather than a
// stand-in: measure-art.js weighs each sprite's brightness against the night
// palette, and playable-test.js needs the true silhouettes, since the game
// collides on a per-column profile of the visible pixels. A solid rectangle
// stands in for neither - it is both taller and wider than the art inside it,
// which is the difference between "ducking under the crow works" and "ducking
// under the crow is impossible".
const fs = require("fs");
const zlib = require("zlib");

// Returns { width, height, pixels } with pixels as RGBA bytes, exactly the
// layout p5's img.pixels uses, so a decoded image can be handed straight to
// the sketch's own imageProfile().
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

  const pixels = new Array(width * height * 4);
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
      const o = (y * width + x) * 4;
      pixels[o] = r; pixels[o + 1] = g; pixels[o + 2] = b; pixels[o + 3] = alpha;
    }
  }
  return { width, height, pixels };
}

// Average luminance over the visible (non-transparent) pixels, Rec. 709
// weighted. Null for an image with nothing visible in it at all.
function averageLuminance(image) {
  let sum = 0, n = 0;
  for (let i = 0; i < image.pixels.length; i += 4) {
    if (image.pixels[i + 3] > 0) {
      sum += 0.2126 * image.pixels[i] + 0.7152 * image.pixels[i + 1] + 0.0722 * image.pixels[i + 2];
      n++;
    }
  }
  return n ? sum / n : null;
}

module.exports = { decode, averageLuminance };
