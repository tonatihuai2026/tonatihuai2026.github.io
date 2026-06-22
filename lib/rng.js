// Seedable deterministic PRNG (mulberry32). Same seed -> identical sequence.
function makeRng(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
if (typeof module !== "undefined" && module.exports) module.exports = { makeRng };
else if (typeof window !== "undefined") window.GameRng = { makeRng };
