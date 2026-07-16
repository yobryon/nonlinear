/** Linear-ish palette used for teams, labels, projects, and avatars. */
export const PALETTE = [
  '#5e6ad2', // indigo
  '#26b5ce', // cyan
  '#0f7488', // teal
  '#4cb782', // green
  '#f2c94c', // yellow
  '#f2994a', // orange
  '#f7855b', // coral
  '#eb5757', // red
  '#c052d5', // purple
  '#95a2b3', // gray-blue
] as const;

export function colorFor(seed: string): string {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0;
  return PALETTE[h % PALETTE.length]!;
}
