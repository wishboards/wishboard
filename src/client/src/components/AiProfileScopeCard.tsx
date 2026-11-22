import React from 'react';
import type { Conflict } from '@wishboards/matching-engine';
import { type AttrMap, findConflictTargets } from '../utils/aiSuggestions';

export interface AiProfileScopeCardProps {
  updateProfile: boolean;
  onToggleUpdateProfile: (next: boolean) => void;
  missingCategoryLabels: string[];
  profileAttributes: AttrMap;
  addedCreatorAttributes: AttrMap;
  removedProfileAttributes: AttrMap;
  profileConflicts: Conflict[];
  onReplaceProfileValues: (targets: Array<{ category: string; value: string }>) => void;
  onRestoreProfileValue: (category: string, value: string) => void;
}

export default function AiProfileScopeCard({
  updateProfile,
  onToggleUpdateProfile,
  missingCategoryLabels,
  profileAttributes,
  addedCreatorAttributes,
  removedProfileAttributes,
  profileConflicts,
  onReplaceProfileValues,
  onRestoreProfileValue,
}: Readonly<AiProfileScopeCardProps>) {
  const removedEntries = Object.entries(removedProfileAttributes).flatMap(([category, values]) =>
    values.map((value) => ({ category, value }))
  );

  return (
    <section className="ai-scope-card" aria-labelledby="ai-scope-title">
      <div className="ai-scope-header">
        <h3 id="ai-scope-title" className="ai-scope-title">
          Where Should Your Attributes Apply?
        </h3>
        <span className="ai-scope-pill">{updateProfile ? 'Wish + Profile' : 'This Wish Only'}</span>
      </div>

      <label htmlFor="ai-scope-update-profile" className="ai-scope-checkbox-label">
        <input
          id="ai-scope-update-profile"
          type="checkbox"
          className="ai-scope-checkbox"
          checked={updateProfile}
          onChange={(e) => onToggleUpdateProfile(e.target.checked)}
        />
        <span className="ai-scope-checkbox-copy">
          <strong>Also update my Account Profile</strong>
          <span className="ai-scope-checkbox-sub">
            {updateProfile
              ? 'Selected creator attributes will be saved to this wish and your Account Profile for future wishes.'
              : 'By default, changes apply only to this wish (ideal for situational wishes).'}
          </span>
        </span>
      </label>

      {!updateProfile && missingCategoryLabels.length > 0 && (
        <div className="ai-scope-nudge" role="note">
          <span aria-hidden="true">💡</span>
          <span>
            Your Account Profile doesn&rsquo;t have{' '}
            <strong>{missingCategoryLabels.join(', ')}</strong> set yet. Check the box above to save
            it for future wishes too.
          </span>
        </div>
      )}

      {updateProfile && removedEntries.length > 0 && (
        <div className="ai-scope-replaced-row">
          <span className="ai-scope-replaced-label">Replacing in Account Profile:</span>
          {removedEntries.map(({ category, value }) => (
            <button
              key={`restore-profile-${category}-${value}`}
              type="button"
              className="ai-chip ai-chip--existing ai-chip--removed"
              onClick={() => onRestoreProfileValue(category, value)}
              title={`Undo replacing ${value} in Account Profile`}
            >
              <span className="ai-chip-icon" aria-hidden="true">
                ↺
              </span>
              <span>{value}</span>
              <span className="ai-chip-meta">undo</span>
            </button>
          ))}
        </div>
      )}

      {updateProfile &&
        profileConflicts.map((conflict) => {
          const { existingMatches, suggestedMatches } = findConflictTargets(
            conflict,
            profileAttributes,
            addedCreatorAttributes
          );
          const hasProfileExisting = existingMatches.length > 0;
          const existingText = existingMatches.map((m) => m.value).join(', ');
          const suggestedText = suggestedMatches.map((m) => m.value).join(', ');

          return (
            <div
              key={`profile-conflict-${conflict.rule_id || 'rule'}-${conflict.trigger_attribute}-${conflict.trigger_value}-${conflict.target_attribute}-${conflict.target_value}`}
              className="ai-conflict-callout"
              role="alert"
            >
              <div className="ai-conflict-message">
                <span aria-hidden="true">⚠️</span>
                <span>
                  <strong>Account Profile conflict:</strong> {conflict.message}
                </span>
              </div>
              <div className="ai-conflict-actions">
                <button
                  type="button"
                  className="ai-conflict-btn"
                  onClick={() => onToggleUpdateProfile(false)}
                >
                  Apply to this wish only
                </button>
                {hasProfileExisting && (
                  <button
                    type="button"
                    className="ai-conflict-btn ai-conflict-btn--replace"
                    onClick={() => onReplaceProfileValues(existingMatches)}
                  >
                    Replace &ldquo;{existingText}&rdquo; in Profile
                    {suggestedText ? ` with "${suggestedText}"` : ''}
                  </button>
                )}
              </div>
            </div>
          );
        })}
    </section>
  );
}
