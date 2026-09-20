/*
 * rng.js – kleiner, reproduzierbarer Zufallsgenerator (mulberry32).
 * Gleicher Seed → gleiche Zahlenfolge. So bekommen alle Spieler eines
 * Party-Rennens dieselben Verkehrsmuster.
 */

/** Wandelt einen beliebigen String/Zahl in einen 32-Bit-Seed um. */
export function hashSeed(value) {
  const str = String(value);
  let h = 2166136261 >>> 0; // FNV-1a
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

export function createRng(seed = Date.now()) {
  let a = hashSeed(seed);

  const next = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };

  return {
    next,
    range: (min, max) => min + next() * (max - min),
    int: (min, max) => Math.floor(min + next() * (max - min + 1)), // inkl. max
    chance: (p) => next() < p,
    pick: (arr) => arr[Math.floor(next() * arr.length)],
    /** Wählt ein Element nach Gewicht: [{weight: 3, ...}, ...] */
    weighted(items) {
      const total = items.reduce((sum, it) => sum + it.weight, 0);
      let r = next() * total;
      for (const it of items) {
        r -= it.weight;
        if (r <= 0) return it;
      }
      return items[items.length - 1];
    },
    shuffle(arr) {
      for (let i = arr.length - 1; i > 0; i--) {
        const j = Math.floor(next() * (i + 1));
        [arr[i], arr[j]] = [arr[j], arr[i]];
      }
      return arr;
    },
  };
}
