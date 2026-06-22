/* Catalyst.play — Co-play preview (tech demo)
 * Two roles on one page: BOARD (the shared screen) and CONTROLLER (a phone).
 * Transport: PeerJS (free public broker for signaling + Google STUN). No backend we run.
 * Protocol rules (rooms/roles/actions) come ENTIRELY from window.CoplaySession — not reimplemented here.
 */
(function () {
  "use strict";

  var Session = window.CoplaySession;
  var Rng = window.GameRng;
  var ID_PREFIX = "catalystplay-";
  var COLORS = [
    { name: "Blue",   hex: "#3b82f6" },
    { name: "Green",  hex: "#22c55e" },
    { name: "Red",    hex: "#ef4444" },
    { name: "Yellow", hex: "#eab308" },
    { name: "Purple", hex: "#a855f7" },
    { name: "Cyan",   hex: "#06b6d4" }
  ];

  function $(id) { return document.getElementById(id); }
  function show(el) { el.classList.remove("hide"); }
  function hide(el) { el.classList.add("hide"); }

  if (!Session || !Rng) { alert("Co-play libraries failed to load."); return; }
  if (typeof Peer === "undefined") {
    var s = $("ctrlStatus"); if (s) { s.textContent = "WebRTC library (PeerJS) failed to load. Check your connection and reload."; s.className = "status err"; }
    var ss = $("startScreen");
    if (ss) {
      var warn = document.createElement("div");
      warn.className = "status err";
      warn.textContent = "WebRTC library (PeerJS) failed to load — the demo can't start. Please reload.";
      ss.insertBefore(warn, ss.firstChild);
    }
    return;
  }

  /* ============================ BOARD MODE ============================ */
  function startBoard() {
    var code = Session.roomCode(Rng.makeRng(Date.now()), 4);
    var boardId = ID_PREFIX + code;
    var joinUrl = "https://tonatihuai2026.github.io/play/?room=" + code;

    // Session state: the board is the unique "board" peer (host).
    var state = Session.createRoom(boardId, code);
    var names = {}; // peerId -> display name

    var stage = $("boardStage");
    $("boardCode").textContent = code;
    var joinEl = $("boardJoin");
    joinEl.textContent = joinUrl;
    stage.classList.add("live");
    document.body.style.overflow = "hidden";
    drawQR($("boardQR"), joinUrl);

    function renderPeers() {
      var ctrls = Session.controllers(state);
      var box = $("boardPeers");
      if (!ctrls.length) { box.innerHTML = '<span class="chip">No controllers yet — scan to join</span>'; return; }
      box.innerHTML = ctrls.map(function (p) {
        return '<span class="chip">' + escapeHtml(names[p.id] || "player") + "</span>";
      }).join("");
    }
    renderPeers();

    var peer = new Peer(boardId, { debug: 1 });

    peer.on("error", function (err) {
      var msg = String(err && err.type === "unavailable-id"
        ? "That room code is busy — exit and start again to get a new one."
        : "Connection broker error (" + (err && err.type || err) + "). The free WebRTC broker may be unavailable; try again.");
      $("boardEvent").textContent = msg;
      $("boardEvent").style.color = "#ff9aa8";
    });

    peer.on("open", function () {
      $("boardEvent").textContent = "Ready — waiting for controllers…";
    });

    peer.on("connection", function (conn) {
      conn.on("open", function () {
        // Tell the controller it's connected; actual join happens on "hello".
        safeSend(conn, { type: "welcome", code: code });
      });
      conn.on("data", function (data) {
        if (!data || typeof data !== "object") return;
        if (data.type === "hello") {
          names[conn.peer] = sanitizeName(data.name);
          state = Session.join(state, conn.peer, "controller"); // protocol decides final role
          safeSend(conn, { type: "joined", you: conn.peer });
          flash(COLORS[0].hex, escapeHtml(names[conn.peer]) + " joined");
          renderPeers();
          return;
        }
        if (data.type === "action") {
          // Build a protocol action; applyAction REJECTS non-joined peers for us.
          var action = { from: conn.peer, type: "tap", color: data.color };
          var res = Session.applyAction(state, action);
          if (!res.accepted) return; // ignore actions from peers not in the room
          state = res.state;
          var color = pickColor(data.color);
          var who = escapeHtml(names[conn.peer] || "player");
          flash(color, who + " tapped (#" + res.seq + ")");
        }
      });
      conn.on("close", function () {
        state = Session.leave(state, conn.peer);
        var who = escapeHtml(names[conn.peer] || "player");
        delete names[conn.peer];
        $("boardEvent").textContent = who + " left";
        renderPeers();
      });
    });

    function flash(hex, text) {
      stage.style.backgroundColor = hex;
      $("boardEvent").style.color = "#fff";
      $("boardEvent").textContent = text;
    }

    $("boardExit").onclick = function () {
      try { peer.destroy(); } catch (e) {}
      window.location.href = "/play/";
    };
  }

  function pickColor(name) {
    for (var i = 0; i < COLORS.length; i++) if (COLORS[i].name === name) return COLORS[i].hex;
    return "#5b8cff";
  }

  /* ========================= CONTROLLER MODE ========================= */
  function startController(code) {
    code = String(code || "").toUpperCase().trim();
    show($("controllerScreen"));
    hide($("startScreen"));
    var statusEl = $("ctrlStatus");
    setStatus("Connecting to room " + code + "…", "");

    var boardId = ID_PREFIX + code;
    var peer = new Peer(null, { debug: 1 });
    var conn = null;
    var selectedColor = COLORS[0].name;
    var joined = false;

    buildColorGrid();

    peer.on("error", function (err) {
      var t = err && err.type;
      var msg = (t === "peer-unavailable")
        ? "No board found for code " + code + ". Check the code, or the board may have closed."
        : "Connection error (" + (t || err) + "). The free WebRTC broker may be unavailable; try again.";
      setStatus(msg, "err");
    });

    peer.on("open", function () {
      conn = peer.connect(boardId, { reliable: true });
      conn.on("open", function () { setStatus("Connected. Enter your name to join.", "ok"); });
      conn.on("data", function (data) {
        if (!data || typeof data !== "object") return;
        if (data.type === "joined") {
          joined = true;
          setStatus("Joined! You're controlling the board.", "ok");
          hide($("nameStep")); show($("controlStep"));
        }
      });
      conn.on("close", function () {
        setStatus("Disconnected from the board.", "err");
        joined = false;
      });
    });

    $("ctrlJoinBtn").onclick = function () {
      if (!conn || !conn.open) { setStatus("Not connected yet — please wait or reload.", "err"); return; }
      var nm = sanitizeName($("ctrlName").value) || "player";
      safeSend(conn, { type: "hello", name: nm });
    };
    $("ctrlName").addEventListener("keydown", function (e) { if (e.key === "Enter") $("ctrlJoinBtn").click(); });

    $("tapBtn").onclick = function () {
      if (!joined || !conn || !conn.open) { setStatus("Not joined yet.", "err"); return; }
      safeSend(conn, { type: "action", color: selectedColor });
      $("ctrlEcho").textContent = "Sent: " + selectedColor + " tap";
    };

    function buildColorGrid() {
      var grid = $("colorGrid");
      grid.innerHTML = "";
      COLORS.forEach(function (c, i) {
        var b = document.createElement("button");
        b.className = "swatch" + (i === 0 ? " sel" : "");
        b.style.background = c.hex;
        b.setAttribute("aria-label", c.name);
        b.onclick = function () {
          selectedColor = c.name;
          Array.prototype.forEach.call(grid.children, function (el) { el.classList.remove("sel"); });
          b.classList.add("sel");
        };
        grid.appendChild(b);
      });
    }

    function setStatus(text, cls) { statusEl.textContent = text; statusEl.className = "status" + (cls ? " " + cls : ""); }
  }

  /* ============================== SHARED ============================= */
  function safeSend(conn, obj) { try { if (conn && conn.open) conn.send(obj); } catch (e) {} }
  function sanitizeName(n) { return String(n || "").replace(/[<>]/g, "").trim().slice(0, 16); }
  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }

  /* ===================== START SCREEN WIRING ======================== */
  function wireStart() {
    var params = new URLSearchParams(window.location.search);
    var room = params.get("room");
    if (room) { startController(room); return; }

    $("startBoard").onclick = startBoard;
    $("showJoin").onclick = function () {
      var f = $("joinForm");
      if (f.classList.contains("hide")) { show(f); $("joinCode").focus(); } else { hide(f); }
    };
    $("joinGo").onclick = function () {
      var c = ($("joinCode").value || "").toUpperCase().trim();
      if (c.length !== 4) { $("joinCode").style.borderColor = "#ff9aa8"; return; }
      startController(c);
    };
    $("joinCode").addEventListener("keydown", function (e) { if (e.key === "Enter") $("joinGo").click(); });
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", wireStart);
  else wireStart();

  /* =================================================================== *
   *  Self-contained QR Code generator (no external image API).          *
   *  Compact QR Model 2 encoder, byte mode, error-correction level L.   *
   *  Adapted to the minimum needed to encode a short https URL and      *
   *  render to a <canvas>. Public-domain-style minimal implementation.  *
   * =================================================================== */
  function drawQR(canvas, text) {
    try {
      var qr = qrEncode(text);
      var n = qr.size, modules = qr.modules;
      var quiet = 4, scale = Math.max(2, Math.floor(160 / (n + quiet * 2)));
      var px = (n + quiet * 2) * scale;
      canvas.width = px; canvas.height = px;
      var ctx = canvas.getContext("2d");
      ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, px, px);
      ctx.fillStyle = "#000";
      for (var r = 0; r < n; r++) for (var c = 0; c < n; c++) {
        if (modules[r][c]) ctx.fillRect((c + quiet) * scale, (r + quiet) * scale, scale, scale);
      }
    } catch (e) {
      // QR is a convenience; the code + URL are always shown as text.
      var ctx2 = canvas.getContext("2d");
      ctx2.fillStyle = "#fff"; ctx2.fillRect(0, 0, canvas.width, canvas.height);
    }
  }

  // ---- Minimal QR encoder (byte mode, ECC level L) ----
  function qrEncode(text) {
    var data = toUtf8Bytes(text);
    // Choose smallest version (1..10) that fits byte mode at ECC L.
    var capL = [0,17,32,53,78,106,134,154,192,230,271]; // data codewords capacity (bytes) v1..v10, ECC L
    var version = 0;
    for (var v = 1; v <= 10; v++) { if (data.length + 2 <= capL[v]) { version = v; break; } }
    if (!version) throw new Error("data too long for embedded QR");

    var size = 17 + version * 4;
    var totalDataCodewords = capL[version];

    // Build bit stream: mode (0100) + length (8 or 16 bits) + data + terminator + pad.
    var bits = [];
    pushBits(bits, 0x4, 4);                 // byte mode
    var lenBits = version <= 9 ? 8 : 16;
    pushBits(bits, data.length, lenBits);
    for (var i = 0; i < data.length; i++) pushBits(bits, data[i], 8);
    // terminator
    var cap = totalDataCodewords * 8;
    for (var t = 0; t < 4 && bits.length < cap; t++) bits.push(0);
    while (bits.length % 8 !== 0) bits.push(0);
    // pad bytes
    var padBytes = [0xEC, 0x11], pi = 0;
    while (bits.length < cap) { pushBits(bits, padBytes[pi % 2], 8); pi++; }

    // bits -> data codewords
    var dataCodewords = [];
    for (var b = 0; b < bits.length; b += 8) {
      var byte = 0;
      for (var k = 0; k < 8; k++) byte = (byte << 1) | bits[b + k];
      dataCodewords.push(byte);
    }

    // ECC codewords per block (version, ECC L) — single block for v1..v5, else split.
    var ecInfo = ECC_L[version];
    var blocks = splitBlocks(dataCodewords, ecInfo);
    var allCodewords = interleave(blocks, ecInfo);

    // Build matrix.
    var m = buildMatrix(size, version, allCodewords);
    return { size: size, modules: m };
  }

  function pushBits(arr, val, len) { for (var i = len - 1; i >= 0; i--) arr.push((val >> i) & 1); }

  function toUtf8Bytes(str) {
    var out = [];
    for (var i = 0; i < str.length; i++) {
      var c = str.charCodeAt(i);
      if (c < 0x80) out.push(c);
      else if (c < 0x800) { out.push(0xC0 | (c >> 6), 0x80 | (c & 0x3F)); }
      else { out.push(0xE0 | (c >> 12), 0x80 | ((c >> 6) & 0x3F), 0x80 | (c & 0x3F)); }
    }
    return out;
  }

  // ECC L parameters: {ecPerBlock, numBlocks, [block data lengths]} for v1..v10
  var ECC_L = {
    1:  { ec: 7,  blocks: [19] },
    2:  { ec: 10, blocks: [34] },
    3:  { ec: 15, blocks: [55] },
    4:  { ec: 20, blocks: [80] },
    5:  { ec: 26, blocks: [108] },
    6:  { ec: 18, blocks: [68, 68] },
    7:  { ec: 20, blocks: [78, 78] },
    8:  { ec: 24, blocks: [97, 97] },
    9:  { ec: 30, blocks: [116, 116] },
    10: { ec: 18, blocks: [68, 68, 69, 69] }
  };

  function splitBlocks(dataCodewords, ecInfo) {
    var blocks = [], idx = 0;
    for (var i = 0; i < ecInfo.blocks.length; i++) {
      var len = ecInfo.blocks[i];
      var dataBlk = dataCodewords.slice(idx, idx + len); idx += len;
      var ecBlk = rsEncode(dataBlk, ecInfo.ec);
      blocks.push({ data: dataBlk, ec: ecBlk });
    }
    return blocks;
  }

  function interleave(blocks, ecInfo) {
    var result = [];
    var maxData = Math.max.apply(null, blocks.map(function (b) { return b.data.length; }));
    for (var i = 0; i < maxData; i++) for (var j = 0; j < blocks.length; j++)
      if (i < blocks[j].data.length) result.push(blocks[j].data[i]);
    var maxEc = ecInfo.ec;
    for (var e = 0; e < maxEc; e++) for (var j2 = 0; j2 < blocks.length; j2++)
      result.push(blocks[j2].ec[e]);
    return result;
  }

  // ---- Reed-Solomon over GF(256) ----
  var GF_EXP = new Array(512), GF_LOG = new Array(256);
  (function initGF() {
    var x = 1;
    for (var i = 0; i < 255; i++) { GF_EXP[i] = x; GF_LOG[x] = i; x <<= 1; if (x & 0x100) x ^= 0x11D; }
    for (var j = 255; j < 512; j++) GF_EXP[j] = GF_EXP[j - 255];
  })();
  function gfMul(a, b) { if (a === 0 || b === 0) return 0; return GF_EXP[GF_LOG[a] + GF_LOG[b]]; }
  function rsGenPoly(deg) {
    var poly = [1];
    for (var i = 0; i < deg; i++) {
      var next = new Array(poly.length + 1).fill(0);
      for (var j = 0; j < poly.length; j++) {
        next[j] ^= gfMul(poly[j], GF_EXP[i]);
        next[j + 1] ^= poly[j];
      }
      poly = next;
    }
    return poly;
  }
  function rsEncode(data, ecLen) {
    var gen = rsGenPoly(ecLen);
    var res = data.slice().concat(new Array(ecLen).fill(0));
    for (var i = 0; i < data.length; i++) {
      var coef = res[i];
      if (coef !== 0) for (var j = 0; j < gen.length; j++) res[i + j] ^= gfMul(gen[j], coef);
    }
    return res.slice(data.length);
  }

  // ---- Matrix construction, masking, format/version info ----
  function buildMatrix(size, version, codewords) {
    var m = []; var fn = []; // fn = reserved/function flag
    for (var r = 0; r < size; r++) { m.push(new Array(size).fill(0)); fn.push(new Array(size).fill(false)); }

    function placeFinder(r0, c0) {
      for (var r = -1; r <= 7; r++) for (var c = -1; c <= 7; c++) {
        var rr = r0 + r, cc = c0 + c;
        if (rr < 0 || rr >= size || cc < 0 || cc >= size) continue;
        var on = (r >= 0 && r <= 6 && (c === 0 || c === 6)) ||
                 (c >= 0 && c <= 6 && (r === 0 || r === 6)) ||
                 (r >= 2 && r <= 4 && c >= 2 && c <= 4);
        m[rr][cc] = on ? 1 : 0; fn[rr][cc] = true;
      }
    }
    placeFinder(0, 0); placeFinder(0, size - 7); placeFinder(size - 7, 0);

    // Timing patterns
    for (var i = 8; i < size - 8; i++) {
      if (!fn[6][i]) { m[6][i] = (i % 2 === 0) ? 1 : 0; fn[6][i] = true; }
      if (!fn[i][6]) { m[i][6] = (i % 2 === 0) ? 1 : 0; fn[i][6] = true; }
    }
    // Dark module
    m[size - 8][8] = 1; fn[size - 8][8] = true;

    // Alignment patterns (versions >= 2)
    var aligns = ALIGN_POS[version] || [];
    for (var a = 0; a < aligns.length; a++) for (var b = 0; b < aligns.length; b++) {
      var ar = aligns[a], ac = aligns[b];
      if (fn[ar] && fn[ar][ac]) continue;
      // skip if overlapping finder
      if (isFinderArea(ar, ac, size)) continue;
      for (var dr = -2; dr <= 2; dr++) for (var dc = -2; dc <= 2; dc++) {
        var on = Math.max(Math.abs(dr), Math.abs(dc)) !== 1;
        m[ar + dr][ac + dc] = on ? 1 : 0; fn[ar + dr][ac + dc] = true;
      }
    }

    // Reserve format info areas
    reserveFormat(fn, size);

    // Place data with zig-zag
    placeData(m, fn, size, codewords);

    // Apply mask 0 (simple, valid) and set format bits for ECC L + mask 0.
    var mask = 0;
    for (var rr2 = 0; rr2 < size; rr2++) for (var cc2 = 0; cc2 < size; cc2++) {
      if (fn[rr2][cc2]) continue;
      if ((rr2 + cc2) % 2 === 0) m[rr2][cc2] ^= 1; // mask pattern 0
    }
    placeFormat(m, size, mask);
    return m;
  }

  function isFinderArea(r, c, size) {
    return (r <= 8 && c <= 8) || (r <= 8 && c >= size - 9) || (r >= size - 9 && c <= 8);
  }

  function reserveFormat(fn, size) {
    for (var i = 0; i <= 8; i++) { if (i !== 6) { fn[8][i] = true; fn[i][8] = true; } }
    for (var j = 0; j < 8; j++) { fn[8][size - 1 - j] = true; fn[size - 1 - j][8] = true; }
    fn[8][6] = fn[6][8] = true;
  }

  function placeData(m, fn, size, codewords) {
    var bitIdx = 0, total = codewords.length * 8;
    function bit(i) { return i < total ? (codewords[i >> 3] >> (7 - (i & 7))) & 1 : 0; }
    var up = true;
    for (var col = size - 1; col > 0; col -= 2) {
      if (col === 6) col--; // skip timing column
      for (var rowStep = 0; rowStep < size; rowStep++) {
        var row = up ? size - 1 - rowStep : rowStep;
        for (var cset = 0; cset < 2; cset++) {
          var c = col - cset;
          if (fn[row][c]) continue;
          m[row][c] = bit(bitIdx) ? 1 : 0;
          bitIdx++;
        }
      }
      up = !up;
    }
  }

  function placeFormat(m, size, mask) {
    // Format: ECC level L (01) + mask (3 bits), BCH-encoded, XOR 0x5412.
    var ecBits = 0x01; // L
    var data = (ecBits << 3) | mask;
    var rem = data;
    for (var i = 0; i < 10; i++) rem = (rem << 1) ^ (((rem >> 9) & 1) ? 0x537 : 0);
    var bits = ((data << 10) | rem) ^ 0x5412;
    // place 15 bits
    for (var k = 0; k <= 5; k++) { m[8][k] = (bits >> k) & 1; }
    m[8][7] = (bits >> 6) & 1;
    m[8][8] = (bits >> 7) & 1;
    m[7][8] = (bits >> 8) & 1;
    for (var k2 = 9; k2 <= 14; k2++) { m[14 - k2][8] = (bits >> k2) & 1; }
    // second copy
    for (var j = 0; j <= 7; j++) { m[size - 1 - j][8] = (bits >> j) & 1; }
    for (var j2 = 8; j2 <= 14; j2++) { m[8][size - 15 + j2] = (bits >> j2) & 1; }
  }

  // Alignment pattern center coords per version (v1 none).
  var ALIGN_POS = {
    1: [], 2: [6, 18], 3: [6, 22], 4: [6, 26], 5: [6, 30],
    6: [6, 34], 7: [6, 22, 38], 8: [6, 24, 42], 9: [6, 26, 46], 10: [6, 28, 50]
  };

})();
