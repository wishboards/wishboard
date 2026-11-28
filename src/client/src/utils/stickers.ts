export function findMatchingStickerKey(
  catStickers: Record<string, unknown>,
  val: string
): string | undefined {
  const valLower = val.toLowerCase();
  const keys = Object.keys(catStickers);

  const exactMatch = keys.find((k) => k.toLowerCase() === valLower);
  if (exactMatch) return exactMatch;

  return keys.find((k) => {
    const escapedKey = k.replace(/[.*+?^${}()|[\]\\]/g, String.raw`\$&`);
    const startBoundary = /^\w/.test(k) ? String.raw`\b` : String.raw`(?:^|\s)`;
    const endBoundary = /\w$/.test(k) ? String.raw`\b` : String.raw`(?=$|\s)`;
    const regex = new RegExp(`${startBoundary}${escapedKey}${endBoundary}`, 'i');
    return regex.test(valLower);
  });
}

export function countMatchingStickers(
  attributes?: Record<string, string[]>,
  stickers?: Record<string, Record<string, unknown>>
): number {
  if (!attributes || !stickers) return 0;
  let count = 0;
  for (const [cat, vals] of Object.entries(attributes)) {
    if (Array.isArray(vals)) {
      const catStickers = stickers[cat] || {};
      vals.forEach((val) => {
        if (findMatchingStickerKey(catStickers, val.toLowerCase())) {
          count++;
        }
      });
    }
  }
  return count;
}
