const normalizeStickerText = (s: string) => s.toLowerCase().replaceAll(/[-_]+/g, ' ').trim();

export function findMatchingStickerKey(
  catStickers: Record<string, unknown>,
  val: string
): string | undefined {
  const valLower = val.toLowerCase();
  const valNormalized = normalizeStickerText(val);
  const keys = Object.keys(catStickers);

  const exactMatch = keys.find(
    (k) => k.toLowerCase() === valLower || normalizeStickerText(k) === valNormalized
  );
  if (exactMatch) return exactMatch;

  return keys.find((k) => {
    const kNorm = normalizeStickerText(k);
    const escapedKey = kNorm.replaceAll(/[.*+?^${}()|[\]\\]/g, String.raw`\$&`);
    const startBoundary = /^\w/.test(kNorm) ? String.raw`\b` : String.raw`(?:^|\s)`;
    const endBoundary = /\w$/.test(kNorm) ? String.raw`\b` : String.raw`(?=$|\s)`;
    const regex = new RegExp(`${startBoundary}${escapedKey}${endBoundary}`, 'i');
    return regex.test(valNormalized);
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
