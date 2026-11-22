import React from 'react';

export interface AiStreamlineCardProps {
  originalContent: string;
  suggestedContent: string;
  useStreamlined: boolean;
  draftContent: string;
  isPreviewOverflowing: boolean;
  deselectedStickeredTags: string[];
  onToggleUseStreamlined: (use: boolean) => void;
  onChangeDraft: (next: string) => void;
  onResetDraft: () => void;
}

export default function AiStreamlineCard({
  originalContent,
  suggestedContent,
  useStreamlined,
  draftContent,
  isPreviewOverflowing,
  deselectedStickeredTags,
  onToggleUseStreamlined,
  onChangeDraft,
  onResetDraft,
}: Readonly<AiStreamlineCardProps>) {
  const charDiff = originalContent.trim().length - draftContent.trim().length;
  const isDraftEdited = draftContent.trim() !== suggestedContent.trim();
  const isDraftBlank = !draftContent.trim();

  return (
    <section className="ai-streamline-card" aria-labelledby="ai-streamline-title">
      <div className="ai-section-header">
        <h3 id="ai-streamline-title" className="ai-section-title">
          Polish &amp; Streamline Card Text (Optional)
        </h3>
        {charDiff > 0 && <span className="ai-streamline-savings">−{charDiff} chars</span>}
      </div>

      <p className="ai-streamline-desc">
        Trims redundant card greetings (like &ldquo;Hey all&rdquo;) and self-labels already shown as
        visual stickers, while keeping details like age, non-stickered roles, and what you&rsquo;re
        looking for.
      </p>

      {isPreviewOverflowing && !useStreamlined && (
        <output className="ai-guardrail-note">
          <span aria-hidden="true">📏</span>
          <span>
            Your original text overflows a 3×5 card. Try switching to{' '}
            <strong>Use Streamlined</strong> to improve readability.
          </span>
        </output>
      )}

      <fieldset className="ai-streamline-toggle-group" aria-label="Card text choice">
        <button
          type="button"
          className={`ai-streamline-option-btn ${useStreamlined ? '' : 'is-active'}`}
          aria-pressed={!useStreamlined}
          onClick={() => onToggleUseStreamlined(false)}
        >
          Keep Original
        </button>
        <button
          type="button"
          className={`ai-streamline-option-btn ${useStreamlined ? 'is-active' : ''}`}
          aria-pressed={useStreamlined}
          onClick={() => onToggleUseStreamlined(true)}
        >
          Use Streamlined
        </button>
      </fieldset>

      <div className="ai-streamline-comparison">
        {originalContent && (
          <div className={`ai-streamline-box ${useStreamlined ? 'is-muted' : 'is-selected'}`}>
            <div className="ai-streamline-box-label">Original Text</div>
            <p className="ai-streamline-text">{originalContent}</p>
          </div>
        )}

        {useStreamlined ? (
          <div className="ai-streamline-box is-selected">
            <div className="ai-streamline-box-header">
              <label htmlFor="ai-streamlined-textarea" className="ai-streamline-box-label">
                Streamlined Text (Editable)
              </label>
              <span className="ai-streamline-counter">{draftContent.length}/500</span>
            </div>
            <textarea
              id="ai-streamlined-textarea"
              className="ai-streamline-textarea"
              rows={3}
              maxLength={500}
              value={draftContent}
              onChange={(e) => onChangeDraft(e.target.value)}
            />
            {isDraftBlank && (
              <output className="ai-footer-warning">
                Card text cannot be empty. Enter text or switch back to Keep Original.
              </output>
            )}
            {isDraftEdited && (
              <div className="ai-streamline-reset-row">
                <button type="button" className="ai-add-tag-toggle" onClick={onResetDraft}>
                  ↺ Reset to AI draft
                </button>
              </div>
            )}
          </div>
        ) : (
          <div className="ai-streamline-box is-muted">
            <div className="ai-streamline-box-label">Suggested Streamlined Text</div>
            <p className="ai-streamline-text">{suggestedContent}</p>
          </div>
        )}
      </div>

      {useStreamlined && deselectedStickeredTags.length > 0 && (
        <output className="ai-guardrail-note">
          <span aria-hidden="true">💡</span>
          <span>
            You deselected stickered tag(s) (<strong>{deselectedStickeredTags.join(', ')}</strong>).
            Review the streamlined text above to make sure nothing important is missing from your
            card.
          </span>
        </output>
      )}
    </section>
  );
}
