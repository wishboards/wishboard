import React, { useState } from 'react';
import type { Conflict } from '@wishboards/matching-engine';
import type { Category } from '../EventProfileContext';
import {
  type AttrMap,
  findConflictTargets,
  formatCategoryLabel,
  hasAttrValue,
} from '../utils/aiSuggestions';

export interface AiAttributeSectionProps {
  variant: 'creator' | 'desired';
  title: string;
  emptyLabel: string;
  categories: Category[];
  existingAttributes: AttrMap;
  suggestedAttributes: AttrMap;
  selectedSuggested: AttrMap;
  customAdded: AttrMap;
  removedExisting: AttrMap;
  conflicts: Conflict[];
  onToggleSuggested: (category: string, value: string) => void;
  onAddCustom: (category: string, value: string) => void;
  onRemoveCustom: (category: string, value: string) => void;
  onReplaceExisting: (category: string, value: string) => void;
  onRestoreExisting: (category: string, value: string) => void;
  onResolveKeepExisting: (suggestedTargets: Array<{ category: string; value: string }>) => void;
  onResolveReplaceWithSuggested: (
    existingTargets: Array<{ category: string; value: string }>
  ) => void;
}

function collectSectionCategories(
  existingAttributes: AttrMap,
  suggestedAttributes: AttrMap,
  customAdded: AttrMap
): string[] {
  const ordered = new Set<string>();
  for (const map of [suggestedAttributes, customAdded, existingAttributes]) {
    for (const [cat, vals] of Object.entries(map)) {
      if (vals.length > 0) ordered.add(cat);
    }
  }
  return Array.from(ordered);
}

function isChipConflicting(
  category: string,
  value: string,
  conflicts: Conflict[],
  existingAttributes: AttrMap,
  selectedAdded: AttrMap
): boolean {
  const valLower = value.toLowerCase();
  return conflicts.some((conflict) => {
    const { existingMatches, suggestedMatches } = findConflictTargets(
      conflict,
      existingAttributes,
      selectedAdded
    );
    return [...existingMatches, ...suggestedMatches].some(
      (t) => t.category === category && t.value.toLowerCase() === valLower
    );
  });
}

interface ConflictBannerProps {
  conflict: Conflict;
  existingAttributes: AttrMap;
  selectedAdded: AttrMap;
  onResolveKeepExisting: (suggestedTargets: Array<{ category: string; value: string }>) => void;
  onResolveReplaceWithSuggested: (
    existingTargets: Array<{ category: string; value: string }>
  ) => void;
}

function ConflictBanner({
  conflict,
  existingAttributes,
  selectedAdded,
  onResolveKeepExisting,
  onResolveReplaceWithSuggested,
}: Readonly<ConflictBannerProps>) {
  const { existingMatches, suggestedMatches } = findConflictTargets(
    conflict,
    existingAttributes,
    selectedAdded
  );

  const hasExistingAndSuggested = existingMatches.length > 0 && suggestedMatches.length > 0;
  const hasMultipleSuggested = existingMatches.length === 0 && suggestedMatches.length >= 2;

  return (
    <div className="ai-conflict-callout" role="alert">
      <div className="ai-conflict-message">
        <span aria-hidden="true">⚠️</span>
        <span>{conflict.message}</span>
      </div>
      <div className="ai-conflict-actions">
        {hasExistingAndSuggested && (
          <>
            <button
              type="button"
              className="ai-conflict-btn"
              onClick={() => onResolveKeepExisting(suggestedMatches)}
            >
              Keep &ldquo;{existingMatches.map((m) => m.value).join(', ')}&rdquo;
            </button>
            <button
              type="button"
              className="ai-conflict-btn ai-conflict-btn--replace"
              onClick={() => onResolveReplaceWithSuggested(existingMatches)}
            >
              Replace with &ldquo;{suggestedMatches.map((m) => m.value).join(', ')}&rdquo;
            </button>
          </>
        )}
        {hasMultipleSuggested &&
          suggestedMatches.map((keepTarget) => {
            const others = suggestedMatches.filter(
              (other) =>
                !(
                  other.category === keepTarget.category &&
                  other.value.toLowerCase() === keepTarget.value.toLowerCase()
                )
            );
            return (
              <button
                key={`${keepTarget.category}-${keepTarget.value}`}
                type="button"
                className="ai-conflict-btn"
                onClick={() => onResolveKeepExisting(others)}
              >
                Keep &ldquo;{keepTarget.value}&rdquo;
              </button>
            );
          })}
      </div>
    </div>
  );
}

interface AddTagControlProps {
  variant: 'creator' | 'desired';
  categories: Category[];
  existingAttributes: AttrMap;
  suggestedAttributes: AttrMap;
  customAdded: AttrMap;
  onAddCustom: (category: string, value: string) => void;
}

function AddTagControl({
  variant,
  categories,
  existingAttributes,
  suggestedAttributes,
  customAdded,
  onAddCustom,
}: Readonly<AddTagControlProps>) {
  const [open, setOpen] = useState(false);
  const [selectedCategory, setSelectedCategory] = useState(() => categories[0]?.id || 'role');
  const [draftValue, setDraftValue] = useState('');

  const activeCategory = categories.find((c) => c.id === selectedCategory) || categories[0];
  const activeCatId = activeCategory?.id || selectedCategory;

  const quickOptions = (activeCategory?.suggestions || []).filter(
    (opt) =>
      !hasAttrValue(existingAttributes, activeCatId, opt) &&
      !hasAttrValue(suggestedAttributes, activeCatId, opt) &&
      !hasAttrValue(customAdded, activeCatId, opt)
  );

  const handleSubmitAdd = () => {
    const trimmed = draftValue.trim();
    if (!trimmed) return;
    onAddCustom(activeCatId, trimmed);
    setDraftValue('');
  };

  if (!open) {
    return (
      <div className="ai-add-tag-trigger-row">
        <button
          type="button"
          className="ai-add-tag-toggle"
          onClick={() => setOpen(true)}
          aria-expanded={false}
        >
          + Add tag
        </button>
      </div>
    );
  }

  return (
    <div className="ai-add-tag-panel">
      <div className="ai-add-tag-controls">
        {categories.length > 0 && (
          <label className="sr-only" htmlFor={`ai-add-cat-${variant}`}>
            Attribute category
          </label>
        )}
        {categories.length > 0 && (
          <select
            id={`ai-add-cat-${variant}`}
            className="ai-add-tag-select"
            value={activeCatId}
            onChange={(e) => setSelectedCategory(e.target.value)}
          >
            {categories.map((cat) => (
              <option key={cat.id} value={cat.id}>
                {cat.label}
              </option>
            ))}
          </select>
        )}
        <input
          type="text"
          className="ai-add-tag-input"
          value={draftValue}
          onChange={(e) => setDraftValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              handleSubmitAdd();
            }
          }}
          placeholder={`Add ${activeCategory?.label || 'tag'}...`}
          aria-label={`Add custom ${variant} tag`}
        />
        <button
          type="button"
          className="secondary-button ai-add-tag-submit"
          onClick={handleSubmitAdd}
          disabled={!draftValue.trim()}
        >
          Add
        </button>
        <button
          type="button"
          className="ai-add-tag-close"
          onClick={() => setOpen(false)}
          aria-label="Close add tag panel"
        >
          Done
        </button>
      </div>

      {quickOptions.length > 0 && (
        <div className="ai-quick-options" aria-label="Quick taxonomy suggestions">
          {quickOptions.slice(0, 8).map((opt) => (
            <button
              key={opt}
              type="button"
              className="ai-quick-option-pill"
              onClick={() => onAddCustom(activeCatId, opt)}
            >
              + {opt}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export default function AiAttributeSection({
  variant,
  title,
  emptyLabel,
  categories,
  existingAttributes,
  suggestedAttributes,
  selectedSuggested,
  customAdded,
  removedExisting,
  conflicts,
  onToggleSuggested,
  onAddCustom,
  onRemoveCustom,
  onReplaceExisting,
  onRestoreExisting,
  onResolveKeepExisting,
  onResolveReplaceWithSuggested,
}: Readonly<AiAttributeSectionProps>) {
  const sectionCategories = collectSectionCategories(
    existingAttributes,
    suggestedAttributes,
    customAdded
  );

  const selectedAddedCombined: AttrMap = {};
  for (const map of [selectedSuggested, customAdded]) {
    for (const [cat, vals] of Object.entries(map)) {
      selectedAddedCombined[cat] = [...(selectedAddedCombined[cat] || []), ...vals];
    }
  }

  const activeDesiredSummary = Object.entries(selectedAddedCombined)
    .filter(([, vals]) => vals.length > 0)
    .map(([cat, vals]) => `${formatCategoryLabel(cat, categories)}: ${vals.join(', ')}`);

  const hasSuggestedOrCustom =
    Object.values(suggestedAttributes).some((v) => v.length > 0) ||
    Object.values(customAdded).some((v) => v.length > 0);

  return (
    <section
      className={`ai-section ai-section--${variant}`}
      aria-labelledby={`ai-section-title-${variant}`}
    >
      <div className="ai-section-header">
        <h3 id={`ai-section-title-${variant}`} className="ai-section-title">
          {title}
        </h3>
        <span className="ai-section-hint">
          {variant === 'creator' ? 'Tap to toggle' : 'Opt-in filter'}
        </span>
      </div>

      {variant === 'desired' && hasSuggestedOrCustom && (
        <div className="ai-guardrail-note" role="note">
          <span aria-hidden="true">🧭</span>
          <span>
            <strong>Matching Engine Tip:</strong> Leaving &ldquo;Looking For&rdquo; unchecked lets
            Wishboard automatically match compatible profiles using inclusive orientation and
            complementary role rules. Only select tags below if this card requires a strict filter.
          </span>
        </div>
      )}

      {sectionCategories.length === 0 ? (
        <p className="ai-section-empty">{emptyLabel}</p>
      ) : (
        <div className="ai-category-groups">
          {sectionCategories.map((cat) => {
            const existingVals = existingAttributes[cat] || [];
            const suggestedVals = suggestedAttributes[cat] || [];
            const customVals = customAdded[cat] || [];

            return (
              <div key={cat} className="ai-category-group">
                <div className="ai-category-label">{formatCategoryLabel(cat, categories)}</div>
                <div className="ai-chip-list">
                  {existingVals.map((val) => {
                    const isRemoved = hasAttrValue(removedExisting, cat, val);
                    const hasConflict =
                      !isRemoved &&
                      isChipConflicting(
                        cat,
                        val,
                        conflicts,
                        existingAttributes,
                        selectedAddedCombined
                      );
                    return (
                      <button
                        key={`existing-${cat}-${val}`}
                        type="button"
                        className={`ai-chip ai-chip--existing ${isRemoved ? 'ai-chip--removed' : ''} ${hasConflict ? 'ai-chip--conflict' : ''}`}
                        onClick={() =>
                          isRemoved ? onRestoreExisting(cat, val) : onReplaceExisting(cat, val)
                        }
                        title={
                          isRemoved
                            ? `Restore existing ${val}`
                            : `Existing attribute on this wish (tap to remove)`
                        }
                        aria-pressed={!isRemoved}
                      >
                        <span className="ai-chip-icon" aria-hidden="true">
                          {isRemoved ? '↺' : '•'}
                        </span>
                        <span>{val}</span>
                        <span className="ai-chip-meta">{isRemoved ? 'removed' : 'existing'}</span>
                      </button>
                    );
                  })}

                  {suggestedVals.map((val) => {
                    const isSelected = hasAttrValue(selectedSuggested, cat, val);
                    const hasConflict =
                      isSelected &&
                      isChipConflicting(
                        cat,
                        val,
                        conflicts,
                        existingAttributes,
                        selectedAddedCombined
                      );
                    return (
                      <button
                        key={`sugg-${cat}-${val}`}
                        type="button"
                        className={`ai-chip ai-chip--suggested ai-chip--${variant} ${isSelected ? 'ai-chip--selected' : ''} ${hasConflict ? 'ai-chip--conflict' : ''}`}
                        aria-pressed={isSelected}
                        onClick={() => onToggleSuggested(cat, val)}
                      >
                        <span className="ai-chip-icon" aria-hidden="true">
                          {hasConflict ? '⚠️' : isSelected ? '✓' : '+'}
                        </span>
                        <span>{val}</span>
                      </button>
                    );
                  })}

                  {customVals.map((val) => {
                    const hasConflict = isChipConflicting(
                      cat,
                      val,
                      conflicts,
                      existingAttributes,
                      selectedAddedCombined
                    );
                    return (
                      <button
                        key={`custom-${cat}-${val}`}
                        type="button"
                        className={`ai-chip ai-chip--selected ai-chip--custom ${hasConflict ? 'ai-chip--conflict' : ''}`}
                        aria-pressed={true}
                        onClick={() => onRemoveCustom(cat, val)}
                        title={`Remove added tag ${val}`}
                      >
                        <span className="ai-chip-icon" aria-hidden="true">
                          {hasConflict ? '⚠️' : '✓'}
                        </span>
                        <span>{val}</span>
                        <span className="ai-chip-meta" aria-hidden="true">
                          ✕
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {variant === 'desired' && activeDesiredSummary.length > 0 && (
        <div className="ai-desired-impact" role="status">
          <span aria-hidden="true">ℹ️</span>
          <span>
            <strong>Strict filter active:</strong> This card will only match attendees matching{' '}
            <strong>{activeDesiredSummary.join(' • ')}</strong>.
          </span>
        </div>
      )}

      {conflicts.map((conflict) => (
        <ConflictBanner
          key={`${conflict.rule_id || 'rule'}-${conflict.trigger_attribute}-${conflict.trigger_value}-${conflict.target_attribute}-${conflict.target_value}`}
          conflict={conflict}
          existingAttributes={existingAttributes}
          selectedAdded={selectedAddedCombined}
          onResolveKeepExisting={onResolveKeepExisting}
          onResolveReplaceWithSuggested={onResolveReplaceWithSuggested}
        />
      ))}

      <AddTagControl
        variant={variant}
        categories={categories}
        existingAttributes={existingAttributes}
        suggestedAttributes={suggestedAttributes}
        customAdded={customAdded}
        onAddCustom={onAddCustom}
      />
    </section>
  );
}
