import { describe, it, expect } from 'vitest';
import { findMatchingStickerKey, countMatchingStickers } from './stickers';

describe('stickers utils', () => {
  const stickers = {
    orientation: {
      straight: { type: 'heart', class: 'flag-straight' },
      gay: { type: 'heart', class: 'flag-rainbow' },
      'non-binary': { type: 'flag', class: 'flag-nonbinary' },
    },
    gender: {
      woman: { type: 'icon', class: 'female-icon' },
      man: { type: 'icon', class: 'male-icon' },
    },
  };

  describe('findMatchingStickerKey', () => {
    it('matches exact and word-boundary values case-insensitively', () => {
      expect(findMatchingStickerKey(stickers.orientation, 'gay')).toBe('gay');
      expect(findMatchingStickerKey(stickers.orientation, 'GAY')).toBe('gay');
      expect(findMatchingStickerKey(stickers.orientation, 'straight')).toBe('straight');
    });

    it('returns undefined if no key matches', () => {
      expect(findMatchingStickerKey(stickers.orientation, 'asexual')).toBeUndefined();
    });

    it('matches keys with hyphens or regex characters', () => {
      expect(findMatchingStickerKey(stickers.orientation, 'non-binary')).toBe('non-binary');
    });
  });

  describe('countMatchingStickers', () => {
    it('returns 0 for empty or undefined inputs', () => {
      expect(countMatchingStickers(undefined, stickers)).toBe(0);
      expect(countMatchingStickers({}, stickers)).toBe(0);
      expect(countMatchingStickers({ orientation: ['gay'] }, undefined)).toBe(0);
    });

    it('counts matching stickers across categories', () => {
      const attributes = {
        orientation: ['gay', 'asexual'],
        gender: ['woman', 'alien'],
      };
      expect(countMatchingStickers(attributes, stickers)).toBe(2);
    });
  });
});
