export function findMatchingStickerKey(
  catStickers: Record<string, unknown>,
  val: string
): string | undefined {
  const valLower = val.toLowerCase();
  return Object.keys(catStickers).find((k) => {
    const escapedKey = k.replace(/[.*+?^${}()|[\]\\]/g, String.raw`\$&`);
    const regex = new RegExp(String.raw`\b${escapedKey}\b`, 'i');
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
