import { describe, it, expect } from 'vitest';
import type { Rule } from '@wishboards/matching-engine';
import {
  normalizeAttrMap,
  countAttrValues,
  hasAttrValue,
  addAttrValue,
  removeAttrValue,
  toggleAttrValue,
  mergeAttributeMaps,
  detectAttributeConflicts,
  findConflictTargets,
  formatCategoryLabel,
  areAttrMapsEqual,
  isExactFullAccept,
  findMissingProfileCategories,
} from './aiSuggestions';

const SAMPLE_RULES: Rule[] = [
  {
    id: 'excl_gay_straight',
    rule_type: 'exclusion',
    trigger_attribute: 'orientation',
    trigger_value: 'gay',
    target_attribute: 'orientation',
    target_value: 'straight',
  },
  {
    id: 'excl_lesbian_man',
    rule_type: 'exclusion',
    trigger_attribute: 'orientation',
    trigger_value: 'lesbian',
    context_attribute: 'gender',
    context_value: 'man',
    target_attribute: 'gender',
    target_value: 'man',
  },
];

describe('aiSuggestions utilities', () => {
  it('normalizes mixed array/string maps and deduplicates case-insensitively', () => {
    expect(normalizeAttrMap(null)).toEqual({});
    expect(normalizeAttrMap(undefined)).toEqual({});
    expect(
      normalizeAttrMap({
        role: ['Switch', 'switch', ' Top ', ''],
        orientation: 'Queer, queer, Bisexual',
        empty: [],
      })
    ).toEqual({
      role: ['Switch', 'Top'],
      orientation: ['Queer', 'Bisexual'],
    });
  });

  it('adds, removes, toggles, and counts attribute values immutably', () => {
    let map = addAttrValue({}, 'role', 'Switch');
    map = addAttrValue(map, 'role', 'switch'); // duplicate ignored
    map = addAttrValue(map, 'role', '   '); // blank ignored
    map = addAttrValue(map, 'gender', 'Nonbinary');

    expect(countAttrValues(map)).toBe(2);
    expect(hasAttrValue(map, 'role', 'SWITCH')).toBe(true);
    expect(hasAttrValue(map, 'orientation', 'Queer')).toBe(false);

    map = toggleAttrValue(map, 'role', 'Switch');
    expect(map).toEqual({ gender: ['Nonbinary'] });

    map = toggleAttrValue(map, 'role', 'Top');
    expect(map).toEqual({ gender: ['Nonbinary'], role: ['Top'] });

    expect(removeAttrValue(map, 'role', 'Missing')).toBe(map);
    expect(removeAttrValue(map, 'unknown', 'Val')).toBe(map);
  });

  it('merges base, additions, and removals cleanly', () => {
    const merged = mergeAttributeMaps(
      { orientation: ['Gay'], role: ['Switch'] },
      { orientation: ['Straight'], gender: ['Man'] },
      { orientation: ['gay'] }
    );
    expect(merged).toEqual({
      role: ['Switch'],
      orientation: ['Straight'],
      gender: ['Man'],
    });
  });

  it('detects exclusion conflicts using @wishboards/matching-engine and identifies resolution targets', () => {
    expect(detectAttributeConflicts({ orientation: ['Gay', 'Straight'] }, [])).toEqual([]);

    const merged = mergeAttributeMaps({ orientation: ['Gay'] }, { orientation: ['Straight'] });
    const conflicts = detectAttributeConflicts(merged, SAMPLE_RULES);
    expect(conflicts).toHaveLength(1);

    const targets = findConflictTargets(
      conflicts[0],
      { orientation: ['Gay'] },
      { orientation: ['Straight'] }
    );
    expect(targets.existingMatches).toEqual([
      { category: 'orientation', value: 'Gay', source: 'existing' },
    ]);
    expect(targets.suggestedMatches).toEqual([
      { category: 'orientation', value: 'Straight', source: 'suggested' },
    ]);
  });

  it('detects context-sensitive conflicts (e.g., lesbian + man)', () => {
    const merged = mergeAttributeMaps({ gender: ['Man'] }, { orientation: ['Lesbian'] });
    const conflicts = detectAttributeConflicts(merged, SAMPLE_RULES);
    expect(conflicts).toHaveLength(1);
    const targets = findConflictTargets(
      conflicts[0],
      { gender: ['Man'] },
      { orientation: ['Lesbian'] }
    );
    expect(targets.existingMatches).toEqual([
      { category: 'gender', value: 'Man', source: 'existing' },
    ]);
    expect(targets.suggestedMatches).toEqual([
      { category: 'orientation', value: 'Lesbian', source: 'suggested' },
    ]);
  });

  it('formats category labels from profile metadata or humanizes fallback IDs', () => {
    expect(formatCategoryLabel('gender', [{ id: 'gender', label: 'Gender' }])).toBe('Gender');
    expect(formatCategoryLabel('knowledge_domain', [])).toBe('Knowledge Domain');
  });

  it('compares attribute maps case-insensitively and checks exact full accepts', () => {
    expect(areAttrMapsEqual({ role: ['Switch', 'Top'] }, { role: ['top', 'switch'] })).toBe(true);
    expect(areAttrMapsEqual({ role: ['Switch'] }, { role: ['Switch', 'Top'] })).toBe(false);
    expect(areAttrMapsEqual({ role: ['Switch'] }, { gender: ['Man'] })).toBe(false);
    expect(areAttrMapsEqual({ role: ['Switch'] }, { role: ['Bottom'] })).toBe(false);

    expect(
      isExactFullAccept({
        existingCreator: { gender: ['Woman'] },
        existingDesired: {},
        suggestedCreator: { role: ['Switch'] },
        suggestedDesired: { role: ['Top'] },
        finalCreator: { gender: ['Woman'], role: ['Switch'] },
        finalDesired: { role: ['Top'] },
      })
    ).toBe(true);

    expect(
      isExactFullAccept({
        existingCreator: { gender: ['Woman'] },
        existingDesired: {},
        suggestedCreator: { role: ['Switch'] },
        suggestedDesired: { role: ['Top'] },
        finalCreator: { gender: ['Woman'], role: ['Switch'] },
        finalDesired: {},
      })
    ).toBe(false);
  });

  it('finds categories missing from Account Profile compared to selected creator suggestions', () => {
    const missing = findMissingProfileCategories(
      { role: ['Switch'] },
      { role: ['Top'], orientation: ['Queer'], gender: [] },
      [
        { id: 'role', label: 'Role' },
        { id: 'orientation', label: 'Orientation' },
      ]
    );
    expect(missing).toEqual(['Orientation']);
  });
});
