// Catalyst.play co-play session protocol — PURE, deterministic, transport-agnostic.
// Knows nothing about WebRTC/DOM. The realtime layer (signaling + peer connections)
// will carry these state transitions; here we just define the rules so they're testable.
// Roles: exactly one "board" (the shared screen/TV) + N "controller" peers (phones).
var ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789"; // no ambiguous 0/O/1/I/L

function roomCode(rng, len) {
  len = len || 4;
  var s = "";
  for (var i = 0; i < len; i++) s += ALPHABET[Math.floor(rng() * ALPHABET.length)];
  return s;
}

function createRoom(hostId, code) {
  return { code: code, host: hostId, status: "lobby",
           peers: [{ id: hostId, role: "board" }], seq: 0 };
}

function hasPeer(state, peerId) {
  return state.peers.some(function (p) { return p.id === peerId; });
}

// Add a peer. Default role "controller". The board role is unique: a second board
// request is downgraded to controller. Duplicate ids are ignored (idempotent).
function join(state, peerId, role) {
  if (hasPeer(state, peerId)) return state;
  var wantBoard = role === "board";
  var boardTaken = state.peers.some(function (p) { return p.role === "board"; });
  var finalRole = (wantBoard && !boardTaken) ? "board" : "controller";
  return Object.assign({}, state, {
    peers: state.peers.concat([{ id: peerId, role: finalRole }])
  });
}

function leave(state, peerId) {
  return Object.assign({}, state, {
    peers: state.peers.filter(function (p) { return p.id !== peerId; })
  });
}

function controllers(state) { return state.peers.filter(function (p) { return p.role === "controller"; }); }
function boardPeer(state) { return state.peers.filter(function (p) { return p.role === "board"; })[0] || null; }

// Generic action reducer: a controller (or board) emits an action; we accept it only
// from a joined peer, stamp a monotonic seq, and return {state, accepted}. Game-specific
// logic plugs in on top of this ordered, authenticated action stream.
function applyAction(state, action) {
  if (!action || !hasPeer(state, action.from)) return { state: state, accepted: false };
  var next = Object.assign({}, state, { seq: state.seq + 1 });
  return { state: next, accepted: true, seq: next.seq };
}

var API = { ALPHABET: ALPHABET, roomCode: roomCode, createRoom: createRoom, join: join,
            leave: leave, controllers: controllers, boardPeer: boardPeer, applyAction: applyAction };
if (typeof module !== "undefined" && module.exports) module.exports = API;
else if (typeof window !== "undefined") window.CoplaySession = API;
