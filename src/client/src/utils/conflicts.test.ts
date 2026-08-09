import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { parseAttributesString, fetchConflicts, getConflictWarning, Conflict } from './conflicts';

describe('conflicts utils', () => {
  describe('parseAttributesString', () => {
    it('returns empty array for empty string', () => {
      expect(parseAttributesString('')).toEqual([]);
    });

    it('returns array of trimmed strings', () => {
      expect(parseAttributesString('a, b, c')).toEqual(['a', 'b', 'c']);
    });

    it('filters out empty values', () => {
      expect(parseAttributesString('a, , c')).toEqual(['a', 'c']);
      expect(parseAttributesString(',a,b,,')).toEqual(['a', 'b']);
    });
  });

  describe('getConflictWarning', () => {
    it('returns undefined if conflicts array is empty', () => {
      expect(getConflictWarning([], 'attr1')).toBeUndefined();
    });

    it('returns undefined if no conflicts match target attribute', () => {
      const conflicts: Conflict[] = [{ message: 'error', target_attribute: 'attr2' }];
      expect(getConflictWarning(conflicts, 'attr1')).toBeUndefined();
    });

    it('returns message if conflict matches target attribute', () => {
      const conflicts: Conflict[] = [{ message: 'error', target_attribute: 'attr1' }];
      expect(getConflictWarning(conflicts, 'attr1')).toBe('error');
    });

    it('joins messages with a space if multiple conflicts match', () => {
      const conflicts: Conflict[] = [
        { message: 'error1', target_attribute: 'attr1' },
        { message: 'error2', target_attribute: 'attr1' },
        { message: 'error3', target_attribute: 'attr2' }
      ];
      expect(getConflictWarning(conflicts, 'attr1')).toBe('error1 error2');
    });
  });

  describe('fetchConflicts', () => {
    let fetchMock: any;

    beforeEach(() => {
      fetchMock = vi.spyOn(global, 'fetch');
    });

    afterEach(() => {
      vi.restoreAllMocks();
    });

    it('returns conflicts when response is ok', async () => {
      const mockConflicts = [{ message: 'error', target_attribute: 'attr1' }];
      fetchMock.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ conflicts: mockConflicts })
      } as Response);

      const result = await fetchConflicts({ key: ['val'] });

      expect(fetchMock).toHaveBeenCalledWith('/api/rules/check-conflicts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ attributes: { key: ['val'] } })
      });
      expect(result).toEqual(mockConflicts);
    });

    it('returns empty array if response ok but missing conflicts field', async () => {
      fetchMock.mockResolvedValueOnce({
        ok: true,
        json: async () => ({})
      } as Response);

      const result = await fetchConflicts({ key: ['val'] });
      expect(result).toEqual([]);
    });

    it('returns empty array if response is not ok', async () => {
      fetchMock.mockResolvedValueOnce({
        ok: false
      } as Response);

      const result = await fetchConflicts({ key: ['val'] });
      expect(result).toEqual([]);
    });

    it('returns empty array on network error', async () => {
      fetchMock.mockRejectedValueOnce(new Error('Network error'));

      const result = await fetchConflicts({ key: ['val'] });
      expect(result).toEqual([]);
    });
  });
});
