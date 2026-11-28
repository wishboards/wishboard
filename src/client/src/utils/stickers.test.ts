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
      expect(findMatchingStickerKey({ 'c++': { type: 'heart' } }, 'c++')).toBe('c++');
      expect(findMatchingStickerKey({ 'c++': { type: 'heart' } }, 'I love c++')).toBe('c++');
    });

    it('prefers exact key match before partial regex match', () => {
      const roleStickers = {
        top: { type: 'heart', class: 'top' },
        'service top': { type: 'heart', class: 'service-top' },
      };
      expect(findMatchingStickerKey(roleStickers, 'Service Top')).toBe('service top');
    });
  });

  describe('countMatchingStickers', () => {
    it('returns 0 for empty or undefined inputs', () => {
      expect(countMatchingStickers(undefined, stickers)).toBe(0);
      expect(countMatchingStickers({}, stickers)).toBe(0);
      expect(countMatchingStickers({ orientation: ['gay'] }, undefined)).toBe(0);
    });

    it('counts matching stickers across categories and ignores non-array or missing categories', () => {
      const attributes = {
        orientation: ['gay', 'asexual'],
        gender: ['woman', 'alien'],
        unknown_cat: ['foo'],
        malformed: 'not-an-array' as unknown as string[],
      };
      expect(countMatchingStickers(attributes, stickers)).toBe(2);
    });
  });
});
