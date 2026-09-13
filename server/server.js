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

const wss = new WebSocketServer({ port: PORT });

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

console.log("T-Rex multiplayer server listening on port " + PORT);
