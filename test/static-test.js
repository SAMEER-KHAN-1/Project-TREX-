// The game's own files, as the relay serves them: compressed, cacheable, and
// never anything that is not part of the game.
//
// The page is about 3.5MB, nearly all of it p5.js, and it used to go out raw
// on every visit - to what is usually a phone on mobile data following an
// invite link. And the project root is a git checkout, so the same handler
// that served the game also served .git/config and every object in .git.
const fs = require("fs");
const http = require("http");
const path = require("path");
const zlib = require("zlib");

const PORT = process.env.TREX_TEST_PORT || "8080";
const ROOT = path.join(__dirname, "..");

let failures = 0;
function check(label, ok, extra) { if (!ok) failures++; console.log(label.padEnd(50), ok ? "PASS" : "FAIL " + (extra || "")); }

function get(urlPath, headers) {
  return new Promise(function (resolve, reject) {
    http.get({ host: "127.0.0.1", port: PORT, path: urlPath, headers: headers || {} }, function (res) {
      const chunks = [];
      res.on("data", function (c) { chunks.push(c); });
      res.on("end", function () { resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks) }); });
    }).on("error", reject);
  });
}

function decode(res) {
  const encoding = res.headers["content-encoding"];
  if (encoding === "br") return zlib.brotliDecompressSync(res.body);
  if (encoding === "gzip") return zlib.gunzipSync(res.body);
  return res.body;
}

(async function main() {
  const p5 = fs.readFileSync(path.join(ROOT, "p5.js"));

  // --- Compression
  const plain = await get("/p5.js");
  check("a client that asks for nothing gets it raw", !plain.headers["content-encoding"] && plain.body.equals(p5));

  const gz = await get("/p5.js", { "Accept-Encoding": "gzip, deflate" });
  check("gzip is used when offered", gz.headers["content-encoding"] === "gzip", gz.headers["content-encoding"]);
  check("gzip decodes to the exact file", decode(gz).equals(p5));
  check("gzip makes p5.js at least 4x smaller", gz.body.length * 4 < p5.length,
    gz.body.length + " of " + p5.length);

  const br = await get("/p5.js", { "Accept-Encoding": "gzip, deflate, br" });
  check("brotli is preferred when offered", br.headers["content-encoding"] === "br", br.headers["content-encoding"]);
  check("brotli decodes to the exact file", decode(br).equals(p5));
  check("brotli beats gzip", br.body.length < gz.body.length, br.body.length + " vs " + gz.body.length);
  check("the length is declared, not chunked", Number(br.headers["content-length"]) === br.body.length,
    br.headers["content-length"] + " vs " + br.body.length);
  check("caches are told the body varies", /accept-encoding/i.test(br.headers["vary"] || ""));

  const refused = await get("/p5.js", { "Accept-Encoding": "br;q=0, gzip;q=0" });
  check("an explicit q=0 is respected", !refused.headers["content-encoding"] && refused.body.equals(p5));
  const onlyGzip = await get("/p5.js", { "Accept-Encoding": "br;q=0, gzip" });
  check("refusing brotli falls back to gzip", onlyGzip.headers["content-encoding"] === "gzip");

  // Already-compressed images gain nothing and are sent as they are.
  const png = await get("/trex1.png", { "Accept-Encoding": "gzip, br" });
  check("images are not recompressed", png.status === 200 && !png.headers["content-encoding"] &&
    png.body.equals(fs.readFileSync(path.join(ROOT, "trex1.png"))));

  const page = await get("/", { "Accept-Encoding": "gzip, br" });
  const pageSource = fs.readFileSync(path.join(ROOT, "index.html"), "utf8");
  check("the page itself is compressed too", page.status === 200 && !!page.headers["content-encoding"] &&
    decode(page).toString() === pageSource.split("%ORIGIN%").join("http://127.0.0.1:" + PORT));

  // --- Link previews. A pasted link unfurls into a card whose image must be
  // an absolute URL, and the page cannot know its own address - so the server
  // writes in the one it was asked for.
  const html = decode(page).toString();
  const image = /<meta property="og:image" content="([^"]+)"/.exec(html);
  check("the preview image is an absolute URL", image && image[1] === "http://127.0.0.1:" + PORT + "/docs/preview.png",
    image && image[1]);
  check("no placeholder is left in the page", html.indexOf("%ORIGIN%") === -1);
  const card = await get("/docs/preview.png");
  check("the preview image is served", card.status === 200 && card.headers["content-type"] === "image/png" &&
    card.body.length > 1000, card.status + " " + card.headers["content-type"]);

  // Render terminates https in front of the server and says so in a header.
  const behindProxy = decode(await get("/", { "Host": "trex.onrender.com", "X-Forwarded-Proto": "https" })).toString();
  check("behind Render's proxy the image is https",
    behindProxy.indexOf('content="https://trex.onrender.com/docs/preview.png"') !== -1);

  // The Host header is chosen by the client and lands inside HTML.
  const hostile = decode(await get("/", { "Host": 'x.com"><script>alert(1)</script>' })).toString();
  check("a hostile Host header is not written into the page",
    hostile.indexOf("<script>alert") === -1 && hostile.indexOf("http://localhost:") !== -1);

  // One page per address, so the cache validator has to differ too.
  const lanTag = (await get("/", { "Host": "192.168.1.20:8080" })).headers["etag"];
  const localTag = (await get("/", { "Host": "localhost:8080" })).headers["etag"];
  check("each address gets its own ETag", lanTag && localTag && lanTag !== localTag, lanTag + " vs " + localTag);

  // --- Revalidation: a returning player should not download the game again.
  const etag = br.headers["etag"];
  check("responses carry an ETag", !!etag);
  check("the browser is told to check before reusing", /no-cache/.test(br.headers["cache-control"] || ""));
  const again = await get("/p5.js", { "Accept-Encoding": "br", "If-None-Match": etag || 'W/"none"' });
  check("an unchanged file revalidates as 304", again.status === 304 && again.body.length === 0,
    again.status + " " + again.body.length + "B");
  const stale = await get("/p5.js", { "If-None-Match": 'W/"stale"' });
  check("a stale ETag gets the file", stale.status === 200 && stale.body.equals(p5));

  // Editing a file during development must be picked up on the next request,
  // not hidden behind the compressed copy of the old one.
  const scratch = path.join(ROOT, "static-test-scratch.js");
  try {
    fs.writeFileSync(scratch, "var before = 1;\n");
    const first = await get("/static-test-scratch.js", { "Accept-Encoding": "gzip" });
    fs.writeFileSync(scratch, "var after = 2; // longer, so the size changes too\n");
    const second = await get("/static-test-scratch.js", { "Accept-Encoding": "gzip" });
    check("an edited file is served fresh", decode(first).toString() === "var before = 1;\n" &&
      decode(second).toString().indexOf("after") !== -1);
  } finally {
    fs.unlinkSync(scratch);
  }

  // --- Only the game. The project root is a git checkout.
  const hidden = ["/.git/config", "/.git/HEAD", "/.gitignore", "/.env", "/.claude/settings.local.json"];
  for (const p of hidden) {
    const res = await get(p);
    check("refuses " + p, res.status === 404, String(res.status));
  }
  for (const p of ["/server/server.js", "/server/package.json", "/%2e%2e/%2e%2e/etc/passwd", "/test/"]) {
    const res = await get(p);
    check("refuses " + p, res.status === 404, String(res.status));
  }

  console.log("");
  console.log(failures === 0 ? "ALL PASS" : failures + " FAILED");
  process.exit(failures === 0 ? 0 : 1);
})().catch(function (e) { console.log("ERROR: " + e.message); process.exit(1); });
