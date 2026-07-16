/**
 * Fractional indexing over base-36 fraction strings. A key represents a
 * number in (0, 1): "i" is 0.5, "4" is ~0.11, "4i" is between "4" and "5".
 * Keys never end in "0" so lexicographic order equals numeric order.
 */
const DIGITS = '0123456789abcdefghijklmnopqrstuvwxyz';
const ZERO = DIGITS[0]!;

function midpoint(a: string, b: string): string {
  if (b !== '' && a >= b) {
    throw new Error(`midpoint: "${a}" must sort before "${b}"`);
  }
  if (b !== '') {
    // Consume the longest common prefix (treating missing digits of `a` as 0).
    let n = 0;
    while ((a[n] ?? ZERO) === b[n]) n++;
    if (n > 0) return b.slice(0, n) + midpoint(a.slice(n), b.slice(n));
  }
  const digitA = a === '' ? 0 : DIGITS.indexOf(a[0]!);
  const digitB = b === '' ? DIGITS.length : DIGITS.indexOf(b[0]!);
  if (digitB - digitA > 1) {
    return DIGITS[Math.round((digitA + digitB) / 2)]!;
  }
  // Consecutive leading digits.
  if (b.length > 1) return b.slice(0, 1);
  return DIGITS[digitA]! + midpoint(a.slice(1), '');
}

/**
 * Generate a key strictly between `a` and `b`.
 * `null` bounds mean the start/end of the sequence.
 */
export function keyBetween(a: string | null, b: string | null): string {
  if (a !== null && b !== null && a >= b) {
    throw new Error(`keyBetween: "${a}" must sort before "${b}"`);
  }
  return midpoint(a ?? '', b ?? '');
}

/** Convenience: a key after every existing key in `keys`. */
export function keyAfterAll(keys: readonly string[]): string {
  let max: string | null = null;
  for (const k of keys) if (max === null || k > max) max = k;
  return keyBetween(max, null);
}
