/**
 * Poker hand engine — exact, no approximations.
 *
 * Cards are encoded as a single integer 0..51:  rankIndex * 4 + suitIndex
 *   rankIndex 0..12 -> "23456789TJQKA"
 *   suitIndex 0..3  -> "shdc"
 *
 * Everything here is pure and dependency-free so it can run in a React Server
 * Component, a client component, or a Node test with no setup.
 *
 * Verified against an independent Python implementation: identical equities on
 * all test spots, including cases where a board-pairing card silently kills an
 * out (see engine.test.ts).
 */

export const RANKS = "23456789TJQKA";
export const SUITS = "shdc";
export const SUIT_GLYPH: Record<string, string> = { s: "♠", h: "♥", d: "♦", c: "♣" };

export type Card = number;
export type Street = "flop" | "turn";

export const rankOf = (c: Card): number => (c >> 2) + 2; // 2..14
export const suitOf = (c: Card): number => c & 3;
export const cardStr = (c: Card): string => RANKS[c >> 2] + SUITS[c & 3];

export function parseCard(s: string): Card {
  const r = RANKS.indexOf(s[0].toUpperCase());
  const u = SUITS.indexOf(s[1].toLowerCase());
  if (r < 0 || u < 0) throw new Error(`bad card: ${s}`);
  return r * 4 + u;
}
export const parseCards = (s: string): Card[] => s.trim().split(/\s+/).map(parseCard);

export function deck(): Card[] {
  const d: Card[] = [];
  for (let i = 0; i < 52; i++) d.push(i);
  return d;
}

export function remaining(dead: Card[]): Card[] {
  const s = new Set(dead);
  return deck().filter((c) => !s.has(c));
}

/* ------------------------------------------------------------------ *
 * Hand evaluation
 * ------------------------------------------------------------------ */

export const HAND_CATEGORY = [
  "high card", "one pair", "two pair", "three of a kind",
  "a straight", "a flush", "a full house", "four of a kind", "a straight flush",
] as const;

/** 15^5 — the multiplier that isolates the category from a packed score. */
export const CATEGORY_SCALE = 759375;

/**
 * Score exactly five cards. Higher is better. The value packs the category in
 * the high digits and up to five tiebreak ranks below it, so plain `>` compares
 * two hands correctly and `Math.floor(v / CATEGORY_SCALE)` recovers the category.
 */
export function score5(a: Card, b: Card, c: Card, d: Card, e: Card): number {
  const cs = [a, b, c, d, e];
  const rs = cs.map(rankOf).sort((x, y) => y - x);
  const s0 = suitOf(a);
  const flush = suitOf(b) === s0 && suitOf(c) === s0 && suitOf(d) === s0 && suitOf(e) === s0;

  const cnt: Record<number, number> = {};
  for (const r of rs) cnt[r] = (cnt[r] || 0) + 1;
  const groups = Object.keys(cnt)
    .map((k) => [+k, cnt[+k]] as [number, number])
    .sort((p, q) => q[1] - p[1] || q[0] - p[0]);

  const uniq = [...new Set(rs)];
  let straightHigh = 0;
  if (uniq.length === 5) {
    if (uniq[0] - uniq[4] === 4) straightHigh = uniq[0];
    else if (uniq[0] === 14 && uniq[1] === 5 && uniq[4] === 2) straightHigh = 5; // wheel
  }

  let cat: number;
  let tie: number[];
  if (flush && straightHigh) { cat = 8; tie = [straightHigh]; }
  else if (groups[0][1] === 4) { cat = 7; tie = [groups[0][0], groups[1][0]]; }
  else if (groups[0][1] === 3 && groups[1][1] === 2) { cat = 6; tie = [groups[0][0], groups[1][0]]; }
  else if (flush) { cat = 5; tie = rs; }
  else if (straightHigh) { cat = 4; tie = [straightHigh]; }
  else if (groups[0][1] === 3) { cat = 3; tie = [groups[0][0], groups[1][0], groups[2][0]]; }
  else if (groups[0][1] === 2 && groups[1][1] === 2) { cat = 2; tie = [groups[0][0], groups[1][0], groups[2][0]]; }
  else if (groups[0][1] === 2) { cat = 1; tie = [groups[0][0], groups[1][0], groups[2][0], groups[3][0]]; }
  else { cat = 0; tie = rs; }

  let v = cat;
  for (let i = 0; i < 5; i++) v = v * 15 + (tie[i] || 0);
  return v;
}

const C5_OF_7: number[][] = [];
for (let a = 0; a < 7; a++)
  for (let b = a + 1; b < 7; b++)
    for (let c = b + 1; c < 7; c++)
      for (let d = c + 1; d < 7; d++)
        for (let e = d + 1; e < 7; e++) C5_OF_7.push([a, b, c, d, e]);

/** Best five-card score from 5, 6, or 7 cards. */
export function bestHand(cards: Card[]): number {
  const n = cards.length;
  if (n === 5) return score5(cards[0], cards[1], cards[2], cards[3], cards[4]);
  if (n === 7) {
    let best = 0;
    for (const i of C5_OF_7) {
      const v = score5(cards[i[0]], cards[i[1]], cards[i[2]], cards[i[3]], cards[i[4]]);
      if (v > best) best = v;
    }
    return best;
  }
  let best = 0;
  for (let a = 0; a < n; a++)
    for (let b = a + 1; b < n; b++)
      for (let c = b + 1; c < n; c++)
        for (let d = c + 1; d < n; d++)
          for (let e = d + 1; e < n; e++) {
            const v = score5(cards[a], cards[b], cards[c], cards[d], cards[e]);
            if (v > best) best = v;
          }
  return best;
}

export const categoryOf = (score: number): number => Math.floor(score / CATEGORY_SCALE);

const RANK_NAME: Record<number, string> = {
  2: "Two", 3: "Three", 4: "Four", 5: "Five", 6: "Six", 7: "Seven", 8: "Eight",
  9: "Nine", 10: "Ten", 11: "Jack", 12: "Queen", 13: "King", 14: "Ace",
};
export const pluralRank = (r: number): string => RANK_NAME[r] + (r === 6 ? "es" : "s");

/** Human-readable hand name, e.g. "two pair, Kings and Fives". */
export function handName(cards: Card[]): string {
  const v = bestHand(cards);
  const cat = categoryOf(v);
  const t0 = Math.floor(v / 50625) % 15;
  const t1 = Math.floor(v / 3375) % 15;
  if (cat === 0) return RANK_NAME[t0] + " high";
  if (cat === 1) return "a pair of " + pluralRank(t0);
  if (cat === 2) return "two pair, " + pluralRank(t0) + " and " + pluralRank(t1);
  if (cat === 3) return "three " + pluralRank(t0);
  if (cat === 6) return "a full house, " + pluralRank(t0) + " full of " + pluralRank(t1);
  if (cat === 7) return "four " + pluralRank(t0);
  return HAND_CATEGORY[cat];
}

/* ------------------------------------------------------------------ *
 * Equity and outs (opponent hand known)
 * ------------------------------------------------------------------ */

export interface EquityResult { equity: number; wins: number; ties: number; total: number }

/** Exact equity by enumerating every remaining runout. Flop = 990 runouts, turn = 46. */
export function equityVsHand(hero: Card[], villain: Card[], board: Card[]): EquityResult {
  const rest = remaining([...hero, ...villain, ...board]);
  let wins = 0, ties = 0, total = 0;
  if (board.length === 3) {
    for (let i = 0; i < rest.length; i++)
      for (let j = i + 1; j < rest.length; j++) {
        const b = [board[0], board[1], board[2], rest[i], rest[j]];
        const h = bestHand([hero[0], hero[1], ...b]);
        const v = bestHand([villain[0], villain[1], ...b]);
        if (h > v) wins++; else if (h === v) ties++;
        total++;
      }
  } else {
    for (const c of rest) {
      const b = [...board, c];
      const h = bestHand([hero[0], hero[1], ...b]);
      const v = bestHand([villain[0], villain[1], ...b]);
      if (h > v) wins++; else if (h === v) ties++;
      total++;
    }
  }
  return { equity: (wins + ties / 2) / total, wins, ties, total };
}

export interface OutsResult { clean: Card[]; chop: Card[]; unseen: number }

/** Next-street cards that put hero ahead of a known villain hand. */
export function outsVsHand(hero: Card[], villain: Card[], board: Card[]): OutsResult {
  const rest = remaining([...hero, ...villain, ...board]);
  const clean: Card[] = [], chop: Card[] = [];
  for (const c of rest) {
    const b = [...board, c];
    const h = bestHand([hero[0], hero[1], ...b]);
    const v = bestHand([villain[0], villain[1], ...b]);
    if (h > v) clean.push(c); else if (h === v) chop.push(c);
  }
  return { clean, chop, unseen: rest.length };
}

/**
 * Cards that finish hero's draw but still lose — the single most expensive
 * miscount in poker. A heart that completes your flush and pairs the board can
 * hand villain a full house.
 */
export interface DeadOut { card: Card; you: string; them: string }
export function deadOuts(hero: Card[], villain: Card[], board: Card[]): DeadOut[] {
  const out: DeadOut[] = [];
  for (const c of remaining([...hero, ...villain, ...board])) {
    const b = [...board, c];
    const mine = bestHand([...hero, ...b]);
    if (categoryOf(mine) < 4) continue;                 // must actually make a hand
    if (mine > bestHand([...villain, ...b])) continue;  // it wins, so not dead
    out.push({ card: c, you: handName([...hero, ...b]), them: handName([...villain, ...b]) });
  }
  return out;
}

/** 1 = hero ahead, 0 = tied, -1 = behind. */
export function whoIsAhead(hero: Card[], villain: Card[], board: Card[]): -1 | 0 | 1 {
  const h = bestHand([...hero, ...board]);
  const v = bestHand([...villain, ...board]);
  return h > v ? 1 : h === v ? 0 : -1;
}

/* ------------------------------------------------------------------ *
 * Draw outs (opponent unknown) — the beginner mode
 * ------------------------------------------------------------------ */

/**
 * Cards that take hero from drawing to a made straight or better.
 *
 * Two subtleties that a naive implementation gets wrong, both handled here:
 *  - the card must be an improvement, not just a made hand you already had;
 *  - your hole cards must actually be used. A flush or straight sitting on the
 *    board alone is shared by everyone, so it is not an out for anybody.
 */
export function drawOuts(hero: Card[], board: Card[]): Card[] {
  const current = categoryOf(bestHand([...hero, ...board]));
  const list: Card[] = [];
  for (const c of remaining([...hero, ...board])) {
    const nb = [...board, c];
    const mine = bestHand([...hero, ...nb]);
    const cat = categoryOf(mine);
    if (cat < 4 || cat <= current) continue;
    if (nb.length === 5 && mine <= score5(nb[0], nb[1], nb[2], nb[3], nb[4])) continue;
    list.push(c);
  }
  return list;
}

/** Textbook chance of hitting n outs, from 47 unseen (flop) or 46 (turn). */
export function hitProbability(outs: number, street: Street): number {
  return street === "flop"
    ? 1 - ((47 - outs) * (46 - outs)) / (47 * 46)
    : outs / 46;
}

/* ------------------------------------------------------------------ *
 * Draw classification
 * ------------------------------------------------------------------ */

/** Canonical draw names and the out count each one must have. */
export const DRAW_OUTS: Record<string, number> = {
  "gutshot": 4,
  "open-ended straight draw": 8,
  "double gutshot": 8,
  "flush draw": 9,
  "flush draw + gutshot": 12,
  "flush draw + open-ended straight draw": 15,
  "flush draw + double gutshot": 15,
};

export function describeDraw(hero: Card[], board: Card[]): string {
  const all = [...hero, ...board];
  const suitCount: Record<number, number> = {};
  for (const c of all) suitCount[suitOf(c)] = (suitCount[suitOf(c)] || 0) + 1;

  let flushDraw = false, backdoor = false;
  for (const s of new Set(hero.map(suitOf))) {
    if (suitCount[s] === 4) flushDraw = true;
    else if (suitCount[s] === 3) backdoor = true;
  }

  const ranks = [...new Set(all.map(rankOf))].sort((a, b) => a - b);
  const withWheel = ranks.includes(14) ? [1, ...ranks] : ranks;

  // count distinct RANKS that complete a straight: 1 = gutshot, 2+ = 8-out draw
  let straightRanks = 0;
  for (let r = 2; r <= 14; r++) {
    if (all.some((c) => rankOf(c) === r)) continue;
    const set = new Set([...withWheel, r]);
    if (r === 14) set.add(1);
    let run = 0, max = 0;
    for (let k = 1; k <= 14; k++) { if (set.has(k)) { run++; max = Math.max(max, run); } else run = 0; }
    if (max >= 5) straightRanks++;
  }

  // four in a row present => open-ender; otherwise two out-ranks => double gutshot
  const wset = new Set(withWheel);
  let run = 0, hasFour = false;
  for (let k = 1; k <= 14; k++) { if (wset.has(k)) { run++; if (run >= 4) hasFour = true; } else run = 0; }

  const topBoard = Math.max(...board.map(rankOf));
  const overs = hero.filter((c) => rankOf(c) > topBoard).length;

  const tags: string[] = [];
  if (flushDraw) tags.push("flush draw");
  if (straightRanks >= 2) tags.push(hasFour ? "open-ended straight draw" : "double gutshot");
  else if (straightRanks > 0) tags.push("gutshot");
  if (!flushDraw && backdoor) tags.push("backdoor flush");
  if (overs === 2 && !flushDraw && straightRanks === 0) tags.push("two overcards");
  else if (overs === 1 && !flushDraw && straightRanks === 0) tags.push("one overcard");
  return tags.length ? tags.join(" + ") : "no obvious draw";
}

export const coreDraw = (description: string): string =>
  description.split(" + ").filter((t) => /flush draw|straight draw|gutshot/.test(t)).join(" + ");

/* ------------------------------------------------------------------ *
 * Spot generation
 * ------------------------------------------------------------------ */

export interface Spot {
  hero: Card[];
  board: Card[];
  villain?: Card[];
  street: Street;
  outs: number;
  outCards: Card[];
  draw: string;
  unseen: number;
  equity: number;
}

export type Rng = () => number;
const defaultRng: Rng = Math.random;

function shuffled<T>(a: T[], rng: Rng): T[] {
  const out = a.slice();
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/** Holdings a real player would actually have on the flop. Keeps spots believable. */
export function isPlausibleHand(h: Card[]): boolean {
  const a = rankOf(h[0]), b = rankOf(h[1]);
  const hi = Math.max(a, b), lo = Math.min(a, b), gap = hi - lo;
  const suited = suitOf(h[0]) === suitOf(h[1]);
  if (gap === 0) return true;
  if (suited) {
    if (gap <= 4) return true;
    if (hi >= 13) return true;
    return lo >= 9;
  }
  if (hi === 14 && lo >= 9) return true;
  if (hi >= 12 && lo >= 10) return true;
  if (gap <= 2 && lo >= 8) return true;
  return false;
}

export interface DrawSpotOptions {
  street?: Street;
  /** 1 = one clean draw type, 2 = combo draws allowed, 3 = widest range. */
  level?: 1 | 2 | 3;
  rng?: Rng;
  /** Thin out gutshots so practice has a realistic spread. 0..1, default 0.4. */
  gutshotKeepRate?: number;
}

/**
 * Deal hero + board with a genuine, unambiguous draw and no villain.
 *
 * Constraints exist so the stated draw always has the out count it is supposed
 * to have: unpaired board and no pocket pair means the only way one card can
 * reach "straight or better" is by completing the draw, and the label is checked
 * against DRAW_OUTS before the spot is returned.
 */
export function dealDrawSpot(opts: DrawSpotOptions = {}): Spot {
  const street = opts.street ?? "flop";
  const level = opts.level ?? 2;
  const rng = opts.rng ?? defaultRng;
  const keep = opts.gutshotKeepRate ?? 0.4;
  const nBoard = street === "flop" ? 3 : 4;
  const range: [number, number] = level === 1 ? [4, 9] : level === 2 ? [4, 12] : [3, 15];

  for (let attempt = 0; attempt < 8000; attempt++) {
    const loose = attempt > 6000; // relax cosmetic filters rather than fail
    const d = shuffled(deck(), rng);
    const hero = [d[0], d[1]];
    const board = d.slice(2, 2 + nBoard);

    if (!loose && !isPlausibleHand(hero)) continue;
    if (new Set(board.map(rankOf)).size !== nBoard) continue;   // unpaired board
    if (rankOf(hero[0]) === rankOf(hero[1])) continue;          // no pocket pairs
    if (categoryOf(bestHand([...hero, ...board])) > 1) continue; // still drawing

    const outs = drawOuts(hero, board);
    if (!loose && (outs.length < range[0] || outs.length > range[1])) continue;

    const label = coreDraw(describeDraw(hero, board));
    if (!label) continue;
    if (DRAW_OUTS[label] !== outs.length) continue;              // label must match reality
    if (!loose && level === 1 && label.includes("+")) continue;
    if (!loose && label === "gutshot" && rng() > keep) continue;

    return {
      hero, board, street,
      outs: outs.length, outCards: outs, draw: label,
      unseen: 50 - nBoard,
      equity: hitProbability(outs.length, street),
    };
  }
  throw new Error("dealDrawSpot: no qualifying spot found");
}

/** Deal a spot where hero is behind a known villain hand and drawing to beat it. */
export function dealVsHandSpot(opts: DrawSpotOptions = {}): Spot {
  const street = opts.street ?? "flop";
  const level = opts.level ?? 2;
  const rng = opts.rng ?? defaultRng;
  const nBoard = street === "flop" ? 3 : 4;
  const range: [number, number] = level === 1 ? [4, 9] : level === 2 ? [2, 12] : [2, 15];

  for (let attempt = 0; attempt < 8000; attempt++) {
    const loose = attempt > 6000;
    const d = shuffled(deck(), rng);
    const hero = [d[0], d[1]], villain = [d[2], d[3]];
    const board = d.slice(4, 4 + nBoard);
    if (!loose && (!isPlausibleHand(hero) || !isPlausibleHand(villain))) continue;
    if (whoIsAhead(hero, villain, board) !== -1) continue;

    const o = outsVsHand(hero, villain, board);
    if (!loose && (o.clean.length < range[0] || o.clean.length > range[1])) continue;
    if (o.chop.length > 2) continue;

    return {
      hero, board, villain, street,
      outs: o.clean.length, outCards: o.clean,
      draw: describeDraw(hero, board),
      unseen: o.unseen,
      equity: equityVsHand(hero, villain, board).equity,
    };
  }
  throw new Error("dealVsHandSpot: no qualifying spot found");
}

/** Group a set of outs into readable language: "9 hearts ♥ · 3 kings". */
export function describeOuts(cards: Card[]): string {
  if (!cards.length) return "none";
  const SUIT_WORD: Record<string, string> = { s: "spades", h: "hearts", d: "diamonds", c: "clubs" };
  const bySuit: Record<number, Card[]> = {};
  for (const c of cards) (bySuit[suitOf(c)] ||= []).push(c);

  const parts: string[] = [];
  let left = cards.slice();
  for (const s of Object.keys(bySuit).map(Number)) {
    if (bySuit[s].length >= 5) {
      parts.push(`${bySuit[s].length} ${SUIT_WORD[SUITS[s]]} ${SUIT_GLYPH[SUITS[s]]}`);
      left = left.filter((c) => suitOf(c) !== s);
    }
  }
  const byRank: Record<number, Card[]> = {};
  for (const c of left) (byRank[rankOf(c)] ||= []).push(c);
  for (const r of Object.keys(byRank).map(Number).sort((a, b) => b - a)) {
    const g = byRank[r];
    parts.push(g.length > 1
      ? `${g.length} ${pluralRank(r).toLowerCase()}`
      : `the ${cardStr(g[0]).replace("T", "10").replace(/[shdc]$/, (m) => SUIT_GLYPH[m])}`);
  }
  return parts.join(" · ");
}
