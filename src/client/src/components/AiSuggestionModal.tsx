import React, { useEffect, useState, useCallback, useMemo } from 'react';
import { apiClient, bearerHeader } from '../api/client';
import type { components } from '../api/schema';
import { useEventProfile } from '../EventProfileContext';
import BottomSheet from './common/BottomSheet';
import WishCard, { type CardStyle, type Wish } from './WishCard';
import AiAttributeSection from './AiAttributeSection';
import { countMatchingStickers } from '../utils/stickers';
import {
  type AttrMap,
  addAttrValue,
  areAttrMapsEqual,
  countAttrValues,
  detectAttributeConflicts,
  isExactFullAccept,
  mergeAttributeMaps,
  normalizeAttrMap,
  removeAttrValue,
  toggleAttrValue,
} from '../utils/aiSuggestions';

type WishAiSuggestion = components['schemas']['WishAiSuggestion'];

export interface AiSuggestionWishContext {
  id: string;
  content: string;
  creator_attributes?: Record<string, string[]>;
  desired_attributes?: Record<string, string[]>;
  contacts?: { type?: string; value?: string }[];
  wishmail_enabled?: boolean;
  image_id?: string | null;
  image_url?: string;
  card_style?: CardStyle | string | null;
}

export interface AiSuggestionModalProps {
  wishId: string;
  wish?: AiSuggestionWishContext;
  secret?: string;
  token?: string | null;
  onClose: () => void;
  onApplied?: () => void;
}

function useIsMobileViewport(): boolean {
  const [isMobile, setIsMobile] = useState(() =>
    Boolean(globalThis.matchMedia?.('(max-width: 639px)').matches)
  );

  useEffect(() => {
    const mql = globalThis.matchMedia?.('(max-width: 639px)');
    if (!mql) return;
    const handleChange = (e: MediaQueryListEvent) => setIsMobile(e.matches);
    mql.addEventListener?.('change', handleChange);
    return () => mql.removeEventListener?.('change', handleChange);
  }, []);

  return isMobile;
}

function getEmptySuggestionMessage(suggestions: WishAiSuggestion[]): string {
  if (suggestions.length > 0) {
    return `All suggestions have already been reviewed (Status: ${suggestions[0]?.status}).`;
  }
  return 'No AI suggestions found for this wish.';
}

interface PreviewPanelProps {
  previewWish: Wish;
  stickerCount: number;
  isMobile: boolean;
  mobilePreviewOpen: boolean;
  onToggleMobilePreview: () => void;
}

function LiveCardPreviewPanel({
  previewWish,
  stickerCount,
  isMobile,
  mobilePreviewOpen,
  onToggleMobilePreview,
}: Readonly<PreviewPanelProps>) {
  const stickerLabel = `${stickerCount} ${stickerCount === 1 ? 'sticker' : 'stickers'}`;

  if (isMobile) {
    return (
      <div className="ai-mobile-preview-accordion">
        <button
          type="button"
          className="ai-mobile-preview-toggle"
          onClick={onToggleMobilePreview}
          aria-expanded={mobilePreviewOpen}
        >
          <span>Live Card Preview ({stickerLabel})</span>
          <span aria-hidden="true">{mobilePreviewOpen ? '▴' : '▾'}</span>
        </button>
        {mobilePreviewOpen && (
          <div className="ai-preview-card-wrap">
            <WishCard wish={previewWish} showFlag={false} isEditorPreview={true} />
          </div>
        )}
      </div>
    );
  }

  return (
    <aside className="ai-modal-preview-column" aria-label="Live card preview">
      <div className="ai-preview-header">
        <span className="ai-preview-title">Live Card Preview</span>
        <span className="ai-preview-badge">{stickerLabel}</span>
      </div>
      <div className="ai-preview-card-wrap">
        <WishCard wish={previewWish} showFlag={false} isEditorPreview={true} />
      </div>
      <p className="ai-preview-caption">
        Updates in real time as you toggle attributes. Stickers reflect your creator attributes on
        this card.
      </p>
    </aside>
  );
}

interface ModalFooterActionsProps {
  pendingSuggestion: WishAiSuggestion | undefined;
  submitting: boolean;
  hasConflicts: boolean;
  hasChanges: boolean;
  selectedCount: number;
  onClose: () => void;
  onReject: () => void;
  onApply: () => void;
}

function ModalFooterActions({
  pendingSuggestion,
  submitting,
  hasConflicts,
  hasChanges,
  selectedCount,
  onClose,
  onReject,
  onApply,
}: Readonly<ModalFooterActionsProps>) {
  const applyLabel = selectedCount > 0 ? `Apply Selected (${selectedCount})` : 'Apply Changes';

  return (
    <div className="ai-modal-footer">
      {pendingSuggestion && hasConflicts && (
        <p className="ai-footer-warning" role="status">
          Resolve the highlighted attribute conflicts above before applying.
        </p>
      )}
      {pendingSuggestion && !hasConflicts && !hasChanges && (
        <p className="ai-footer-hint">
          Select at least one attribute chip above, or tap Reject to dismiss this suggestion.
        </p>
      )}
      <div className="kiosk-modal-actions ai-modal-actions">
        <button type="button" className="secondary-button" onClick={onClose} disabled={submitting}>
          Close
        </button>

        {pendingSuggestion && (
          <>
            <button
              type="button"
              className="secondary-button ai-reject-btn"
              onClick={onReject}
              disabled={submitting}
            >
              Reject
            </button>
            <button
              type="button"
              className="primary-button ai-apply-btn"
              onClick={onApply}
              disabled={submitting || hasConflicts || !hasChanges}
            >
              {submitting ? 'Applying...' : applyLabel}
            </button>
          </>
        )}
      </div>
    </div>
  );
}

export default function AiSuggestionModal({
  wishId,
  wish,
  secret,
  token,
  onClose,
  onApplied,
}: Readonly<AiSuggestionModalProps>) {
  const { categories = [], rules = [], stickers } = useEventProfile();
  const isMobile = useIsMobileViewport();

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [suggestions, setSuggestions] = useState<WishAiSuggestion[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [mobilePreviewOpen, setMobilePreviewOpen] = useState(false);

  const [selectedCreator, setSelectedCreator] = useState<AttrMap>({});
  const [selectedDesired, setSelectedDesired] = useState<AttrMap>({});
  const [customCreator, setCustomCreator] = useState<AttrMap>({});
  const [customDesired, setCustomDesired] = useState<AttrMap>({});
  const [removedCreator, setRemovedCreator] = useState<AttrMap>({});
  const [removedDesired, setRemovedDesired] = useState<AttrMap>({});

  const existingCreator = useMemo(
    () => normalizeAttrMap(wish?.creator_attributes as Record<string, unknown> | undefined),
    [wish?.creator_attributes]
  );
  const existingDesired = useMemo(
    () => normalizeAttrMap(wish?.desired_attributes as Record<string, unknown> | undefined),
    [wish?.desired_attributes]
  );

  const loadSuggestions = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const queryParams: { secret?: string } = {};
      if (secret) {
        queryParams.secret = secret;
      }
      const { data, response } = await apiClient.GET('/api/wishes/{id}/suggestions', {
        params: {
          path: { id: wishId },
          query: queryParams,
        },
        headers: bearerHeader(token),
      });

      if (!response.ok || !data) {
        setError('Failed to load AI suggestions.');
        return;
      }

      setSuggestions(data);
      const pending = data.find((s) => s.status === 'pending');
      if (pending) {
        const sugCreator = normalizeAttrMap(
          pending.suggested_creator_attributes as Record<string, unknown> | undefined
        );
        // Creator attributes default to selected (opt-out); desired attributes default to unselected (opt-in guardrail).
        setSelectedCreator(sugCreator);
        setSelectedDesired({});
        setCustomCreator({});
        setCustomDesired({});
        setRemovedCreator({});
        setRemovedDesired({});
      }
    } catch (err) {
      console.error('Failed to load suggestions:', err);
      setError('An unexpected error occurred while loading suggestions.');
    } finally {
      setLoading(false);
    }
  }, [wishId, secret, token]);

  useEffect(() => {
    void loadSuggestions();
  }, [loadSuggestions]);

  useEffect(() => {
    if (isMobile) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !submitting) {
        onClose();
      }
    };
    globalThis.document?.addEventListener('keydown', handleKeyDown);
    return () => globalThis.document?.removeEventListener('keydown', handleKeyDown);
  }, [isMobile, submitting, onClose]);

  const pendingSuggestion = suggestions.find((s) => s.status === 'pending');

  const suggestedCreator = useMemo(
    () =>
      normalizeAttrMap(
        pendingSuggestion?.suggested_creator_attributes as Record<string, unknown> | undefined
      ),
    [pendingSuggestion]
  );

  const suggestedDesired = useMemo(
    () =>
      normalizeAttrMap(
        pendingSuggestion?.suggested_desired_attributes as Record<string, unknown> | undefined
      ),
    [pendingSuggestion]
  );

  const allAddedCreator = useMemo(
    () => mergeAttributeMaps(selectedCreator, customCreator),
    [selectedCreator, customCreator]
  );
  const allAddedDesired = useMemo(
    () => mergeAttributeMaps(selectedDesired, customDesired),
    [selectedDesired, customDesired]
  );

  const finalCreator = useMemo(
    () => mergeAttributeMaps(existingCreator, allAddedCreator, removedCreator),
    [existingCreator, allAddedCreator, removedCreator]
  );
  const finalDesired = useMemo(
    () => mergeAttributeMaps(existingDesired, allAddedDesired, removedDesired),
    [existingDesired, allAddedDesired, removedDesired]
  );

  const creatorConflicts = useMemo(
    () => detectAttributeConflicts(finalCreator, rules),
    [finalCreator, rules]
  );
  const desiredConflicts = useMemo(
    () => detectAttributeConflicts(finalDesired, rules),
    [finalDesired, rules]
  );

  const hasConflicts = creatorConflicts.length > 0 || desiredConflicts.length > 0;
  const selectedCount = countAttrValues(allAddedCreator) + countAttrValues(allAddedDesired);
  const hasChanges =
    !areAttrMapsEqual(finalCreator, existingCreator) ||
    !areAttrMapsEqual(finalDesired, existingDesired);

  const previewWish: Wish | null = useMemo(() => {
    if (!wish) return null;
    const normalizedContacts = (wish.contacts || [])
      .filter((c): c is { type: string; value: string } => Boolean(c.type && c.value))
      .map((c) => ({ type: c.type, value: c.value }));
    return {
      id: wish.id,
      content: wish.content,
      creator_attributes: finalCreator,
      contacts: normalizedContacts,
      wishmail_enabled: wish.wishmail_enabled,
      image_id: wish.image_id || undefined,
      image_url: wish.image_url,
      card_style: wish.card_style,
    };
  }, [wish, finalCreator]);

  const stickerCount = useMemo(
    () => (previewWish ? countMatchingStickers(previewWish.creator_attributes, stickers) : 0),
    [previewWish, stickers]
  );

  const submitReview = async (action: 'accept' | 'reject' | 'modify') => {
    setSubmitting(true);
    setError(null);
    setMessage(null);

    try {
      const bodyPayload: {
        secret?: string;
        creator_attributes?: Record<string, string[]>;
        desired_attributes?: Record<string, string[]>;
      } = {};

      if (secret) {
        bodyPayload.secret = secret;
      }

      if (action === 'modify') {
        bodyPayload.creator_attributes = finalCreator;
        bodyPayload.desired_attributes = finalDesired;
      }

      const { response, error: resErr } = await apiClient.POST(
        '/api/wishes/{id}/suggestions/{action}',
        {
          params: {
            path: { id: wishId, action },
          },
          headers: bearerHeader(token),
          body: bodyPayload,
        }
      );

      if (!response.ok) {
        setError(
          (resErr as { error?: string } | undefined)?.error || `Failed to ${action} suggestion.`
        );
        return;
      }

      const actionPastTense = {
        accept: 'accepted',
        reject: 'rejected',
        modify: 'modified',
      }[action];
      setMessage(`Suggestion ${actionPastTense} successfully.`);
      onApplied?.();
      setTimeout(() => {
        onClose();
      }, 1000);
    } catch (err) {
      console.error(`Failed to ${action} suggestion:`, err);
      setError('An unexpected error occurred while processing the suggestion.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleApply = () => {
    if (hasConflicts || !hasChanges) return;
    const exactAccept = isExactFullAccept({
      existingCreator,
      existingDesired,
      suggestedCreator,
      suggestedDesired,
      finalCreator,
      finalDesired,
    });
    void submitReview(exactAccept ? 'accept' : 'modify');
  };

  const resolveKeepExisting = (
    setterSelected: React.Dispatch<React.SetStateAction<AttrMap>>,
    setterCustom: React.Dispatch<React.SetStateAction<AttrMap>>,
    targets: Array<{ category: string; value: string }>
  ) => {
    setterSelected((prev) =>
      targets.reduce((acc, t) => removeAttrValue(acc, t.category, t.value), prev)
    );
    setterCustom((prev) =>
      targets.reduce((acc, t) => removeAttrValue(acc, t.category, t.value), prev)
    );
  };

  const resolveReplaceExisting = (
    setterRemoved: React.Dispatch<React.SetStateAction<AttrMap>>,
    targets: Array<{ category: string; value: string }>
  ) => {
    setterRemoved((prev) =>
      targets.reduce((acc, t) => addAttrValue(acc, t.category, t.value), prev)
    );
  };

  const renderMainBody = () => {
    if (loading) {
      return <div className="ai-modal-state-message">Loading suggestions...</div>;
    }

    if (!pendingSuggestion) {
      return <div className="ai-modal-state-message">{getEmptySuggestionMessage(suggestions)}</div>;
    }

    return (
      <div className={`ai-modal-layout ${previewWish ? 'ai-modal-layout--with-preview' : ''}`}>
        {previewWish && isMobile && (
          <LiveCardPreviewPanel
            previewWish={previewWish}
            stickerCount={stickerCount}
            isMobile={true}
            mobilePreviewOpen={mobilePreviewOpen}
            onToggleMobilePreview={() => setMobilePreviewOpen((prev) => !prev)}
          />
        )}

        <div className="ai-modal-controls-column">
          {pendingSuggestion.reasoning && (
            <p className="ai-reasoning-note">
              <strong>AI Note:</strong> {pendingSuggestion.reasoning}
            </p>
          )}

          <AiAttributeSection
            variant="creator"
            title="About You (This Wish)"
            emptyLabel="No creator attributes suggested."
            categories={categories}
            existingAttributes={existingCreator}
            suggestedAttributes={suggestedCreator}
            selectedSuggested={selectedCreator}
            customAdded={customCreator}
            removedExisting={removedCreator}
            conflicts={creatorConflicts}
            onToggleSuggested={(cat, val) =>
              setSelectedCreator((prev) => toggleAttrValue(prev, cat, val))
            }
            onAddCustom={(cat, val) => setCustomCreator((prev) => addAttrValue(prev, cat, val))}
            onRemoveCustom={(cat, val) =>
              setCustomCreator((prev) => removeAttrValue(prev, cat, val))
            }
            onReplaceExisting={(cat, val) =>
              setRemovedCreator((prev) => addAttrValue(prev, cat, val))
            }
            onRestoreExisting={(cat, val) =>
              setRemovedCreator((prev) => removeAttrValue(prev, cat, val))
            }
            onResolveKeepExisting={(targets) =>
              resolveKeepExisting(setSelectedCreator, setCustomCreator, targets)
            }
            onResolveReplaceWithSuggested={(targets) =>
              resolveReplaceExisting(setRemovedCreator, targets)
            }
          />

          <AiAttributeSection
            variant="desired"
            title="Looking For (Match Filter)"
            emptyLabel="No desired match criteria suggested."
            categories={categories}
            existingAttributes={existingDesired}
            suggestedAttributes={suggestedDesired}
            selectedSuggested={selectedDesired}
            customAdded={customDesired}
            removedExisting={removedDesired}
            conflicts={desiredConflicts}
            onToggleSuggested={(cat, val) =>
              setSelectedDesired((prev) => toggleAttrValue(prev, cat, val))
            }
            onAddCustom={(cat, val) => setCustomDesired((prev) => addAttrValue(prev, cat, val))}
            onRemoveCustom={(cat, val) =>
              setCustomDesired((prev) => removeAttrValue(prev, cat, val))
            }
            onReplaceExisting={(cat, val) =>
              setRemovedDesired((prev) => addAttrValue(prev, cat, val))
            }
            onRestoreExisting={(cat, val) =>
              setRemovedDesired((prev) => removeAttrValue(prev, cat, val))
            }
            onResolveKeepExisting={(targets) =>
              resolveKeepExisting(setSelectedDesired, setCustomDesired, targets)
            }
            onResolveReplaceWithSuggested={(targets) =>
              resolveReplaceExisting(setRemovedDesired, targets)
            }
          />
        </div>

        {previewWish && !isMobile && (
          <LiveCardPreviewPanel
            previewWish={previewWish}
            stickerCount={stickerCount}
            isMobile={false}
            mobilePreviewOpen={false}
            onToggleMobilePreview={() => {}}
          />
        )}
      </div>
    );
  };

  const titleNode = (
    <span className="ai-modal-title-inline">
      <span aria-hidden="true">✨</span>
      <span>Review AI Suggestions</span>
    </span>
  );

  const innerContent = (
    <>
      <p className="ai-modal-subtitle">
        Tap chips to choose which tags apply to this wish. Nothing changes until you tap Apply.
      </p>

      {error && (
        <div className="kiosk-modal-error" role="alert">
          {error}
        </div>
      )}
      {message && (
        <div className="message success" role="status">
          {message}
        </div>
      )}

      {renderMainBody()}

      <ModalFooterActions
        pendingSuggestion={pendingSuggestion}
        submitting={submitting}
        hasConflicts={hasConflicts}
        hasChanges={hasChanges}
        selectedCount={selectedCount}
        onClose={onClose}
        onReject={() => void submitReview('reject')}
        onApply={handleApply}
      />
    </>
  );

  if (isMobile) {
    return (
      <BottomSheet
        isOpen={true}
        onClose={onClose}
        id="ai-suggestions-sheet"
        title={titleNode}
        className="ai-suggestions-sheet"
      >
        {innerContent}
      </BottomSheet>
    );
  }

  return (
    <dialog
      open
      className="kiosk-modal-backdrop ai-modal-backdrop"
      aria-labelledby="ai-suggestions-title"
      onClick={(e) => {
        if (e.target === e.currentTarget && !submitting) {
          onClose();
        }
      }}
    >
      <div
        className={`ai-modal-surface ${previewWish ? 'ai-modal-surface--wide' : ''}`}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="ai-modal-header">
          <h2 id="ai-suggestions-title" className="ai-modal-heading">
            {titleNode}
          </h2>
          <button
            type="button"
            className="ai-modal-close-icon"
            onClick={onClose}
            disabled={submitting}
            aria-label="Close AI suggestions modal"
          >
            ✕
          </button>
        </div>
        <div className="ai-modal-scroll-body">{innerContent}</div>
      </div>
    </dialog>
  );
}
