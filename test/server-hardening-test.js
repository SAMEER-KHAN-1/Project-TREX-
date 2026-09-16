// Server robustness: a public endpoint must not be leakable or confusable by
// a client that sends something the real game never would.
const path = require("path");
const http = require("http");
const WebSocket = require(path.join(__dirname, "..", "server", "node_modules", "ws"));

const PORT = process.env.TREX_TEST_PORT || "8080";
const URL = "ws://localhost:" + PORT;

let failures = 0;
function check(label, ok, extra) { if (!ok) failures++; console.log(label.padEnd(50), ok ? "PASS" : "FAIL " + (extra || "")); }

function open() {
  const ws = new WebSocket(URL);
  ws.seen = [];
  ws.on("message", (raw) => ws.seen.push(JSON.parse(raw)));
  ws.ready = new Promise((resolve, reject) => { ws.on("open", resolve); ws.on("error", reject); });
  return ws;
}
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const send = (ws, o) => ws.send(JSON.stringify(o));
const codesOf = (ws) => ws.seen.filter((m) => m.type === "created").map((m) => m.room);
const errorsOf = (ws) => ws.seen.filter((m) => m.type === "error");

(async () => {
  // --- Repeated "create" on one socket must not strand rooms.
  const hoarder = open();
  await hoarder.ready;
  for (let i = 0; i < 25; i++) send(hoarder, { type: "create" });
  await wait(400);
  const codes = codesOf(hoarder);
  check("every create is answered", codes.length === 25, String(codes.length));

  // Only the most recent code should still be joinable; the earlier ones must
  // have been released rather than left holding a slot forever.
  const joiners = [];
  for (const code of codes) {
    const j = open();
    await j.ready;
    send(j, { type: "join", room: code });
    joiners.push({ code, ws: j });
  }
  await wait(500);
  const stillAlive = joiners.filter((j) => j.ws.seen.some((m) => m.type === "start"));
  check("only the latest room survives", stillAlive.length === 1, stillAlive.length + " rooms were joinable");
  check("released rooms report not found",
    joiners.filter((j) => j.ws.seen.some((m) => m.type === "error" && /not found/i.test(m.message))).length === 24);

  joiners.forEach((j) => j.ws.close());
  hoarder.close();
  await wait(200);

  // --- A socket must not be able to join its own room and become its own
  //     opponent, which would echo every message straight back.
  const selfJoin = open();
  await selfJoin.ready;
  send(selfJoin, { type: "create" });
  await wait(200);
  const ownCode = codesOf(selfJoin)[0];
  send(selfJoin, { type: "join", room: ownCode });
  await wait(250);
  check("cannot join your own room", errorsOf(selfJoin).length === 1 && !selfJoin.seen.some((m) => m.type === "start"));
  selfJoin.close();
  await wait(150);

  // --- Oversized frames are refused rather than buffered.
  const flooder = open();
  await flooder.ready;
  const closed = new Promise((resolve) => flooder.on("close", resolve));
  try { flooder.send(JSON.stringify({ type: "join", room: "A".repeat(100000) })); } catch (e) { /* refused locally */ }
  const dropped = await Promise.race([closed.then(() => true), wait(1200).then(() => false)]);
  check("oversized frame closes the connection", dropped);

  // --- Garbage must never take the server down.
  //
  // "null" is the one that mattered: it is VALID JSON, so it passed the
  // try/catch around JSON.parse, and reading .type off null threw a TypeError
  // that killed the whole process - every player on the server dropped,
  // from four characters.
  const junk = open();
  await junk.ready;
  const nasty = [
    "{not json", "null", "[]", "3", '"a string"', "true",
    '{"type":null}', '{"type":123}', '{"type":{}}', '{"room":{}}',
    '{"type":"join"}', '{"type":"join","room":null}', '{"type":"join","room":{}}',
    '{"type":"state"}', '{"type":"rematch"}', '{"type":"finished"}',
    '{"type":"leave"}', '{"type":"__proto__"}', '{"type":"toString"}',
  ];
  for (const s of nasty) {
    junk.send(s);
    await wait(25);
  }
  await wait(300);
  check("survives every malformed message", junk.readyState === WebSocket.OPEN);

  // Still serving afterwards, so nothing above wedged the process.
  const alive = await new Promise((resolve) => {
    http.get("http://localhost:" + PORT + "/index.html", (res) => { res.resume(); resolve(res.statusCode === 200); })
        .on("error", () => resolve(false));
  });
  check("server still serves the game", alive);

  const survivor = open();
  await survivor.ready;
  send(survivor, { type: "create" });
  await wait(250);
  check("rooms can still be created", codesOf(survivor).length === 1);
  survivor.close();
  junk.close();
  await wait(150);

  console.log("");
  console.log(failures === 0 ? "ALL PASS" : failures + " FAILED");
  process.exit(failures === 0 ? 0 : 1);
})().catch((e) => { console.log("ERROR: " + e.message); process.exit(1); });
