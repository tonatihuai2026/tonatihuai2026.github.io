const test = require("node:test");
const assert = require("node:assert");
const { makeRng } = require("../lib/rng.js");
const S = require("../lib/session.js");

test("roomCode: deterministic, right length, only from safe alphabet", () => {
  assert.strictEqual(S.roomCode(makeRng(1)), S.roomCode(makeRng(1)));
  const c = S.roomCode(makeRng(5), 6);
  assert.strictEqual(c.length, 6);
  for (const ch of c) assert.ok(S.ALPHABET.indexOf(ch) !== -1, "char in alphabet");
});

test("createRoom: host is the unique board, lobby, seq 0", () => {
  const r = S.createRoom("h1", "ABCD");
  assert.strictEqual(r.host, "h1");
  assert.strictEqual(r.status, "lobby");
  assert.strictEqual(r.seq, 0);
  assert.deepStrictEqual(r.peers, [{ id: "h1", role: "board" }]);
});

test("join: adds controllers, dedupes, and keeps board unique", () => {
  let r = S.createRoom("h1", "ABCD");
  r = S.join(r, "p2");                 // default controller
  r = S.join(r, "p3", "controller");
  r = S.join(r, "p2");                 // duplicate -> ignored
  assert.strictEqual(r.peers.length, 3);
  // second board request downgraded to controller
  r = S.join(r, "p4", "board");
  assert.strictEqual(S.boardPeer(r).id, "h1");
  assert.strictEqual(r.peers.find(p => p.id === "p4").role, "controller");
  assert.strictEqual(S.controllers(r).length, 3);
});

test("leave: removes a peer immutably", () => {
  let r = S.join(S.createRoom("h1", "ABCD"), "p2");
  const r2 = S.leave(r, "p2");
  assert.strictEqual(r2.peers.length, 1);
  assert.strictEqual(r.peers.length, 2, "original not mutated");
});

test("applyAction: rejects unknown actor, accepts joined peer, bumps seq", () => {
  let r = S.join(S.createRoom("h1", "ABCD"), "p2");
  const bad = S.applyAction(r, { from: "ghost", type: "tap" });
  assert.strictEqual(bad.accepted, false);
  assert.strictEqual(bad.state.seq, 0);
  const ok = S.applyAction(r, { from: "p2", type: "tap" });
  assert.strictEqual(ok.accepted, true);
  assert.strictEqual(ok.seq, 1);
  assert.strictEqual(r.seq, 0, "input state immutable");
});
