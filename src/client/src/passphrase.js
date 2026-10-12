let cryptoProvider;

if (typeof globalThis !== 'undefined' && typeof globalThis.crypto?.getRandomValues === 'function') {
  cryptoProvider = globalThis.crypto;
} else {
  throw new Error('No secure crypto available in this environment.');
}

const randomIndex = (max) => {
  if (max <= 1) return 0;

  // 0x100000000 is 4294967296 (max value of 32-bit uint + 1)
  const limit = 4294967296 - (4294967296 % max);
  const bucketSize = Math.floor(limit / max);

  const typedArray = new Uint32Array(1);

  while (true) {
    // NOSONAR
    cryptoProvider.getRandomValues(typedArray);
    const randomUint32 = typedArray[0];

    // If the number falls into a complete bucket, safely divide to map to index
    if (randomUint32 < limit) {
      return Math.floor(randomUint32 / bucketSize);
    }
  }
};
const choose = (items) => items[randomIndex(items.length)];

export const generatePassphrase = () => {
  const adjectives = [
    'solar',
    'bright',
    'gentle',
    'lucky',
    'quiet',
    'merry',
    'wild',
    'cosmic',
    'velvet',
    'golden',
  ];
  const nouns = [
    'spark',
    'wish',
    'cloud',
    'echo',
    'lantern',
    'maple',
    'beam',
    'ripple',
    'pixel',
    'trail',
  ];
  const colors = [
    'blue',
    'amber',
    'jade',
    'pearl',
    'ruby',
    'sapphire',
    'copper',
    'opal',
    'sage',
    'ivory',
  ];

  return `${choose(adjectives)}-${choose(nouns)}-${choose(colors)}`;
};

export { randomIndex };
