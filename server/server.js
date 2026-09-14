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

// roomCode -> { players: [ws, ws|null] }
const rooms = new Map();

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
const wss = new WebSocketServer({ server });

wss.on("connection", function (ws) {
  ws.isAlive = true;
  ws.roomCode = null;

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

    if (msg.type === "create") {
      var code = generateRoomCode();
      rooms.set(code, { players: [ws, null] });
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
      if (room.players[1]) {
        send(ws, { type: "error", message: "That room is already full." });
        return;
      }
      room.players[1] = ws;
      ws.roomCode = joinCode;

      var seed = Math.floor(Math.random() * 2147483647);
      var startAt = Date.now() + COUNTDOWN_MS;
      send(room.players[0], { type: "start", seed: seed, startAt: startAt, room: joinCode });
      send(room.players[1], { type: "start", seed: seed, startAt: startAt, room: joinCode });
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

    if (msg.type === "leave") {
      removeFromRoom(ws);
    }
  });

  ws.on("close", function () {
    removeFromRoom(ws);
  });
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
