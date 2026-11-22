import {
  getExclusionConflicts,
  hasToken,
  type Conflict,
  type Rule,
} from '@wishboards/matching-engine';
import type { Category } from '../EventProfileContext';

export type AttrMap = Record<string, string[]>;

export interface ConflictResolutionTarget {
  category: string;
  value: string;
  source: 'existing' | 'suggested';
}

export function normalizeAttrMap(raw?: Record<string, unknown> | null): AttrMap {
  const result: AttrMap = {};
  if (!raw || typeof raw !== 'object') return result;

  for (const [cat, val] of Object.entries(raw)) {
    const items = extractStringItems(val);
    if (items.length > 0) {
      result[cat] = items;
    }
  }
  return result;
}

function extractStringItems(val: unknown): string[] {
  let rawList: string[] = [];
  if (Array.isArray(val)) {
    rawList = val.map(String);
  } else if (typeof val === 'string') {
    rawList = val.split(',');
  }

  const seen = new Set<string>();
  const deduped: string[] = [];
  for (const entry of rawList) {
    const trimmed = entry.trim();
    const key = trimmed.toLowerCase();
    if (trimmed && !seen.has(key)) {
      seen.add(key);
      deduped.push(trimmed);
    }
  }
  return deduped;
}

export function countAttrValues(attrs: AttrMap): number {
  return Object.values(attrs).reduce((sum, list) => sum + list.length, 0);
}

export function hasAttrValue(attrs: AttrMap, category: string, value: string): boolean {
  const list = attrs[category];
  if (!list) return false;
  const target = value.trim().toLowerCase();
  return list.some((v) => v.trim().toLowerCase() === target);
}

export function addAttrValue(attrs: AttrMap, category: string, value: string): AttrMap {
  const trimmed = value.trim();
  if (!trimmed || hasAttrValue(attrs, category, trimmed)) {
    return attrs;
  }
  return {
    ...attrs,
    [category]: [...(attrs[category] || []), trimmed],
  };
}

export function removeAttrValue(attrs: AttrMap, category: string, value: string): AttrMap {
  const list = attrs[category];
  if (!list) return attrs;
  const target = value.trim().toLowerCase();
  const next = list.filter((v) => v.trim().toLowerCase() !== target);
  if (next.length === list.length) return attrs;
  const copy = { ...attrs };
  if (next.length === 0) {
    delete copy[category];
  } else {
    copy[category] = next;
  }
  return copy;
}

export function toggleAttrValue(attrs: AttrMap, category: string, value: string): AttrMap {
  return hasAttrValue(attrs, category, value)
    ? removeAttrValue(attrs, category, value)
    : addAttrValue(attrs, category, value);
}

export function mergeAttributeMaps(base: AttrMap, additions: AttrMap, removals?: AttrMap): AttrMap {
  let result: AttrMap = {};
  for (const [cat, vals] of Object.entries(base)) {
    const filtered = vals.filter((v) => !removals || !hasAttrValue(removals, cat, v));
    if (filtered.length > 0) {
      result[cat] = [...filtered];
    }
  }
  for (const [cat, vals] of Object.entries(additions)) {
    for (const val of vals) {
      result = addAttrValue(result, cat, val);
    }
  }
  return result;
}

export function detectAttributeConflicts(attrs: AttrMap, rules: Rule[]): Conflict[] {
  if (!rules || rules.length === 0) return [];
  return getExclusionConflicts(attrs, rules);
}

function collectMatchingValues(
  attrs: AttrMap,
  category: string | null | undefined,
  token: string | null | undefined,
  source: 'existing' | 'suggested'
): ConflictResolutionTarget[] {
  if (!category || !token) return [];
  const vals = attrs[category] || [];
  return vals.filter((v) => hasToken(v, token)).map((value) => ({ category, value, source }));
}

function dedupeTargets(targets: ConflictResolutionTarget[]): ConflictResolutionTarget[] {
  const seen = new Set<string>();
  return targets.filter((t) => {
    const key = `${t.source}:${t.category}:${t.value.toLowerCase()}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function findConflictTargets(
  conflict: Conflict,
  existing: AttrMap,
  selectedAdded: AttrMap
): {
  existingMatches: ConflictResolutionTarget[];
  suggestedMatches: ConflictResolutionTarget[];
} {
  const pairs: Array<[string | null | undefined, string | null | undefined]> = [
    [conflict.trigger_attribute, conflict.trigger_value],
    [conflict.target_attribute, conflict.target_value],
    [conflict.context_attribute, conflict.context_value],
  ];

  const existingMatches = dedupeTargets(
    pairs.flatMap(([cat, val]) => collectMatchingValues(existing, cat, val, 'existing'))
  );
  const suggestedMatches = dedupeTargets(
    pairs.flatMap(([cat, val]) => collectMatchingValues(selectedAdded, cat, val, 'suggested'))
  );

  return { existingMatches, suggestedMatches };
}

export function formatCategoryLabel(categoryId: string, categories: Category[] = []): string {
  const direct = categories.find((c) => c.id === categoryId);
  if (direct?.label) return direct.label;
  return categoryId.replace(/[_-]+/g, ' ').replace(/\b\w/g, (ch) => ch.toUpperCase());
}

export function areAttrMapsEqual(a: AttrMap, b: AttrMap): boolean {
  const keysA = Object.keys(a).filter((k) => (a[k] || []).length > 0);
  const keysB = Object.keys(b).filter((k) => (b[k] || []).length > 0);
  if (keysA.length !== keysB.length) return false;

  for (const key of keysA) {
    const setA = new Set((a[key] || []).map((v) => v.trim().toLowerCase()));
    const setB = new Set((b[key] || []).map((v) => v.trim().toLowerCase()));
    if (setA.size !== setB.size) return false;
    for (const item of setA) {
      if (!setB.has(item)) return false;
    }
  }
  return true;
}

export function isExactFullAccept(params: {
  existingCreator: AttrMap;
  existingDesired: AttrMap;
  suggestedCreator: AttrMap;
  suggestedDesired: AttrMap;
  finalCreator: AttrMap;
  finalDesired: AttrMap;
}): boolean {
  const expectedCreator = mergeAttributeMaps(params.existingCreator, params.suggestedCreator);
  const expectedDesired = mergeAttributeMaps(params.existingDesired, params.suggestedDesired);
  return (
    areAttrMapsEqual(params.finalCreator, expectedCreator) &&
    areAttrMapsEqual(params.finalDesired, expectedDesired)
  );
}

export function findMissingProfileCategories(
  profileAttrs: AttrMap,
  selectedCreatorAttrs: AttrMap,
  categories: Category[] = []
): string[] {
  const missingLabels: string[] = [];
  for (const [cat, vals] of Object.entries(selectedCreatorAttrs)) {
    if (vals.length === 0) continue;
    const existingProfileVals = profileAttrs[cat] || [];
    if (existingProfileVals.length === 0) {
      missingLabels.push(formatCategoryLabel(cat, categories));
    }
  }
  return missingLabels;
}
