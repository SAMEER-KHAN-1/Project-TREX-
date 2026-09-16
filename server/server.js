// ---------------------------------------------------------------------------
// T-Rex Runner multiplayer server
//
// A thin room-matchmaking relay, not an authoritative game server. Each
// client runs the full game locally and the two clients stay in lockstep
// because they're both seeded with the same random seed (see the "start"
// message below) - obstacle spawning is deterministic from that seed, so
// there's nothing to sync there. The only things this server ever relays
// are each player's live trex height/crouch/alive state, forwarded straight
// to their opponent. That keeps this server simple and cheap to host, at
// the cost of trusting each client not to cheat - acceptable for a casual
// two-player race, not for anything competitive/ranked.
// ---------------------------------------------------------------------------

const http = require("http");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { WebSocketServer } = require("ws");

const PORT = process.env.PORT || 8080;
const ROOM_CODE_CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // no 0/O/1/I - easy to misread aloud
const ROOM_CODE_LENGTH = 4;
const COUNTDOWN_MS = 3000;
const HEARTBEAT_INTERVAL_MS = 15000;

// This server is reachable by anyone once deployed, so two cheap ceilings.
// Neither is near anything real play produces: the largest message the game
// sends is a position update well under 200 bytes, and 500 rooms is 1000
// simultaneous players on a free instance that will fall over long before.
// They exist so a stray script cannot exhaust memory by asking politely.
const MAX_ROOMS = 500;
const MAX_MESSAGE_BYTES = 4096;

// roomCode -> { players: [ws, ws|null], rematchReady: [bool, bool] }
const rooms = new Map();

// Starting a match and starting a rematch are the same event - a fresh seed
// and a fresh countdown sent to both seats - so they go through one function.
// The seed is rolled per match, so a rematch is a genuinely new course rather
// than a replay of the one both players have just learned.
function startMatch(room, code) {
  room.rematchReady = [false, false];
  var seed = Math.floor(Math.random() * 2147483647);

  // A countdown DURATION rather than a start timestamp. An absolute time
  // would be on this server's clock, and the two players' device clocks can
  // be minutes apart from it and from each other, so neither could
  // meaningfully compare it against their own. A duration is measured against
  // each client's own clock from the moment it arrives, leaving only one-way
  // network latency (a few ms) as the discrepancy.
  var message = { type: "start", seed: seed, countdownMs: COUNTDOWN_MS, room: code };
  send(room.players[0], message);
  send(room.players[1], message);
}

function generateRoomCode() {
  var code;
  do {
    code = "";
    for (var i = 0; i < ROOM_CODE_LENGTH; i++) {
      code += ROOM_CODE_CHARS[Math.floor(Math.random() * ROOM_CODE_CHARS.length)];
    }
  } while (rooms.has(code));
  return code;
}

function send(ws, message) {
  if (ws && ws.readyState === ws.OPEN) {
    ws.send(JSON.stringify(message));
  }
}

function opponentOf(room, ws) {
  return room.players[0] === ws ? room.players[1] : room.players[0];
}

function removeFromRoom(ws) {
  var code = ws.roomCode;
  if (!code) {
    return;
  }
  var room = rooms.get(code);
  if (!room) {
    return;
  }
  var opponent = opponentOf(room, ws);
  send(opponent, { type: "opponent_left" });
  //either the room is now empty, or the remaining player needs a fresh room
  //rather than being rejoinable by a stranger later, so drop it either way
  rooms.delete(code);
  ws.roomCode = null;
}

// ---------------------------------------------------------------------------
// Static file hosting
//
// The game's own files are served from this same process, on this same port,
// rather than being opened straight off the disk as file:// URLs. Two reasons,
// and both are what make "two separate devices" actually possible:
//
//   - A phone can't open a file:// path that lives on your laptop. It CAN open
//     http://<laptop-lan-ip>:8080, so serving the game here is what lets a
//     second device join a room at all without deploying anything first.
//   - One origin for both the page and the socket means the client can derive
//     the WebSocket URL from its own location instead of needing a hardcoded
//     address that has to be edited for every environment.
//
// On Render this collapses the whole project into a single free web service:
// the page and the relay are the same deployment, so there is no CORS setup,
// no second host, and no mixed-content https-page/ws://-socket problem.
// ---------------------------------------------------------------------------
const CLIENT_ROOT = path.resolve(__dirname, "..");

const CONTENT_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".gif": "image/gif",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".json": "application/json; charset=utf-8"
};

function sendPlain(res, status, body) {
  res.writeHead(status, { "Content-Type": "text/plain; charset=utf-8" });
  res.end(body);
}

function serveStaticFile(req, res) {
  //strip the query string, and decode so a name with %20 in it still resolves
  var requestPath;
  try {
    requestPath = decodeURIComponent(String(req.url || "/").split("?")[0]);
  } catch (e) {
    sendPlain(res, 400, "Bad request");
    return;
  }
  if (requestPath === "/") {
    requestPath = "/index.html";
  }

  // path.join() collapses "..", so a request for "/../../etc/passwd" would
  // otherwise resolve to a real file outside the project. Reject anything that
  // escapes CLIENT_ROOT, and the server directory too - node_modules and
  // server.js are not the browser's business.
  var filePath = path.join(CLIENT_ROOT, requestPath);
  var relative = path.relative(CLIENT_ROOT, filePath);
  if (relative.startsWith("..") || path.isAbsolute(relative) || relative.split(path.sep)[0] === "server") {
    sendPlain(res, 404, "Not found");
    return;
  }

  fs.readFile(filePath, function (err, data) {
    if (err) {
      sendPlain(res, 404, "Not found");
      return;
    }
    var type = CONTENT_TYPES[path.extname(filePath).toLowerCase()] || "application/octet-stream";
    res.writeHead(200, { "Content-Type": type });
    res.end(data);
  });
}

//printed on startup so you can read the address to type into the second
//device's browser straight off the console, instead of hunting for it in
//ipconfig output
function listLanAddresses() {
  var addresses = [];
  var interfaces = os.networkInterfaces();
  Object.keys(interfaces).forEach(function (name) {
    (interfaces[name] || []).forEach(function (entry) {
      if (entry.family === "IPv4" && !entry.internal) {
        addresses.push(entry.address);
      }
    });
  });
  return addresses;
}

const server = http.createServer(serveStaticFile);
//shares the HTTP server rather than binding its own port, so the page and the
//socket are always reachable at the same address - see the block comment above
//ws would otherwise buffer up to 100MB per frame before handing it over
const wss = new WebSocketServer({ server, maxPayload: MAX_MESSAGE_BYTES });

wss.on("connection", function (ws) {
  ws.isAlive = true;
  ws.roomCode = null;

  // An 'error' event with no listener IS an uncaught exception in Node, so
  // without this the whole server dies whenever one socket misbehaves - and
  // these are ordinary events, not exotic ones: a frame over maxPayload, a
  // protocol violation, or simply a phone dropping off wifi mid-race and
  // resetting the connection. One player losing signal must not disconnect
  // everybody else. 'close' fires after this and releases the room.
  ws.on("error", function (e) {
    console.error("socket error:", e && e.message);
  });

  ws.on("pong", function () {
    ws.isAlive = true;
  });

  ws.on("message", function (raw) {
    var msg;
    try {
      msg = JSON.parse(raw);
    } catch (e) {
      return; //ignore malformed input rather than crash the connection
    }

    // Valid JSON is not the same as a valid message. JSON.parse happily
    // returns null for "null", and a number, string or array for their
    // literals - none of which have a .type. Reading .type off null threw a
    // TypeError, and an uncaught throw inside a ws handler takes the whole
    // PROCESS down, not just the offending connection: a four-character
    // message disconnected every player on the server.
    if (!msg || typeof msg !== "object" || Array.isArray(msg)) {
      return;
    }
    if (typeof msg.type !== "string") {
      return;
    }

    try {
      handleMessage(ws, msg);
    } catch (e) {
      // Belt and braces for the same failure mode: whatever one client manages
      // to send, it must cost that client its message and nobody else their
      // game. Logged rather than swallowed silently so it can be found.
      console.error("error handling " + msg.type + ":", e && e.message);
    }
  });

  ws.on("close", function () {
    removeFromRoom(ws);
  });
});

// Dispatches one already-validated message. Split out from the socket handler
// so the caller can contain a throw to the connection that caused it.
function handleMessage(ws, msg) {

  if (msg.type === "create") {
    // Leaving any previous room first. Without this, a second "create" on
    // one connection simply overwrote ws.roomCode - and since a disconnect
    // only ever cleans up the room that field currently points at, the
    // earlier room stayed in the map for the life of the process, holding a
    // code nobody could use. The game's own client never does this (each
    // create opens a fresh socket), but a public endpoint should not be
    // leakable by anything that can send two messages.
    removeFromRoom(ws);

    if (rooms.size >= MAX_ROOMS) {
      send(ws, { type: "error", message: "Server is busy. Try again shortly." });
      return;
    }

    var code = generateRoomCode();
    rooms.set(code, { players: [ws, null], rematchReady: [false, false] });
    ws.roomCode = code;
    send(ws, { type: "created", room: code });
    return;
  }

  if (msg.type === "join") {
    var joinCode = String(msg.room || "").toUpperCase();
    var room = rooms.get(joinCode);
    if (!room) {
      send(ws, { type: "error", message: "Room not found." });
      return;
    }
    // Joining your own room would seat one socket in both chairs, making it
    // its own opponent - every relayed message would come straight back.
    if (room.players[0] === ws) {
      send(ws, { type: "error", message: "That is your own room." });
      return;
    }
    if (room.players[1]) {
      send(ws, { type: "error", message: "That room is already full." });
      return;
    }
    //same reasoning as "create" above: never leave an orphaned room behind
    removeFromRoom(ws);
    room.players[1] = ws;
    ws.roomCode = joinCode;

    startMatch(room, joinCode);
    return;
  }

  if (msg.type === "state") {
    var stateRoom = rooms.get(ws.roomCode);
    if (!stateRoom) {
      return;
    }
    var opponent = opponentOf(stateRoom, ws);
    send(opponent, {
      type: "opponent_state",
      y: msg.y,
      crouching: msg.crouching,
      dead: msg.dead,
      score: msg.score
    });
    return;
  }

  // Sent once, the moment a player crashes. The live "state" relay above
  // also carries a dead flag, but a player stops sending state once their
  // run is over - so a dedicated message is what guarantees the opponent
  // learns the final score rather than having to infer it from whichever
  // state tick happened to be the last one through.
  if (msg.type === "finished") {
    var finishedRoom = rooms.get(ws.roomCode);
    if (!finishedRoom) {
      return;
    }
    send(opponentOf(finishedRoom, ws), { type: "opponent_finished", score: msg.score });
    return;
  }

  // Both seats have to ask before a rematch starts - one player alone can't
  // drag the other back into a race they haven't agreed to. Asking is
  // relayed to the opponent either way, so a waiting player can see that
  // the offer is on the table rather than staring at an idle screen.
  if (msg.type === "rematch") {
    var rematchRoom = rooms.get(ws.roomCode);
    if (!rematchRoom) {
      return;
    }
    var seat = rematchRoom.players[0] === ws ? 0 : 1;
    if (rematchRoom.rematchReady[seat]) {
      return; //already asked; don't re-notify on a double click
    }
    rematchRoom.rematchReady[seat] = true;
    send(opponentOf(rematchRoom, ws), { type: "opponent_wants_rematch" });

    if (rematchRoom.rematchReady[0] && rematchRoom.rematchReady[1]) {
      startMatch(rematchRoom, ws.roomCode);
    }
    return;
  }

  if (msg.type === "leave") {
    removeFromRoom(ws);
  }
}

//same reasoning as the per-socket handler: an unheard 'error' is fatal
wss.on("error", function (e) {
  console.error("websocket server error:", e && e.message);
});

server.on("error", function (e) {
  console.error("http server error:", e && e.message);
});

//drop connections that stopped responding (closed laptop lid, dead wifi, etc.)
//instead of leaving a half-open socket occupying a room seat forever
const heartbeat = setInterval(function () {
  wss.clients.forEach(function (ws) {
    if (!ws.isAlive) {
      ws.terminate();
      return;
    }
    ws.isAlive = false;
    ws.ping();
  });
}, HEARTBEAT_INTERVAL_MS);

wss.on("close", function () {
  clearInterval(heartbeat);
});

//0.0.0.0 rather than the default localhost-only bind, so another device on the
//same wifi can actually reach it - binding to localhost would make the server
//invisible to every machine but this one, defeating the point
server.listen(PORT, "0.0.0.0", function () {
  console.log("T-Rex server listening on port " + PORT);
  console.log("  this device:   http://localhost:" + PORT);
  listLanAddresses().forEach(function (address) {
    console.log("  other devices: http://" + address + ":" + PORT);
  });
});
