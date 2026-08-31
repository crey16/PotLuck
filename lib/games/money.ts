// Money is integer cents everywhere in the home-game tracker (docs/19).
// These two functions are the only place dollars-as-text exists; nothing
// downstream ever does float arithmetic on an amount.

export function formatCents(cents: number, withSign = false): string {
  const abs = Math.abs(cents);
  const dollars = Math.floor(abs / 100);
  const remainder = String(abs % 100).padStart(2, "0");
  const grouped = dollars.toLocaleString("en-US");
  const sign = cents < 0 ? "-" : withSign && cents > 0 ? "+" : "";
  return `${sign}$${grouped}.${remainder}`;
}

/** Parse a typed dollar amount to non-negative integer cents, or null.
 * Digits are handled as strings so 19.99 can never become 1998.99…98. */
export function parseDollarsToCents(input: string): number | null {
  const cleaned = input.trim().replace(/^\$/, "").trim().replace(/,/g, "");
  const match = /^(\d+)(?:\.(\d{1,2}))?$/.exec(cleaned);
  if (!match) return null;
  const dollars = Number.parseInt(match[1], 10);
  const centsPart = match[2] ? match[2].padEnd(2, "0") : "00";
  const cents = dollars * 100 + Number.parseInt(centsPart, 10);
  return Number.isSafeInteger(cents) ? cents : null;
}
