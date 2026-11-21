import React, { useEffect, useState, useCallback } from 'react';
import { apiClient, bearerHeader } from '../api/client';
import type { components } from '../api/schema';

type WishAiSuggestion = components['schemas']['WishAiSuggestion'];

export interface AiSuggestionModalProps {
  wishId: string;
  secret?: string;
  token?: string | null;
  onClose: () => void;
  onApplied?: () => void;
}

function formatAttributesForEdit(
  attrs: Record<string, unknown> | undefined
): Record<string, string> {
  const result: Record<string, string> = {};
  if (!attrs) return result;
  for (const [key, val] of Object.entries(attrs)) {
    if (Array.isArray(val)) {
      result[key] = val.join(', ');
    } else if (typeof val === 'string') {
      result[key] = val;
    }
  }
  return result;
}

function parseAttributesFromEdit(attrs: Record<string, string>): Record<string, string[]> {
  const result: Record<string, string[]> = {};
  for (const [key, val] of Object.entries(attrs)) {
    const items = val
      .split(',')
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean);
    if (items.length > 0) {
      result[key] = items;
    }
  }
  return result;
}

function getEmptySuggestionMessage(suggestions: WishAiSuggestion[]): string {
  if (suggestions.length > 0) {
    return `All suggestions have already been reviewed (Status: ${suggestions[0]?.status}).`;
  }
  return 'No AI suggestions found for this wish.';
}

interface AttributeFieldInputsProps {
  title: string;
  emptyLabel: string;
  values: Record<string, string>;
  onChange: (category: string, value: string) => void;
}

function AttributeFieldInputs({
  title,
  emptyLabel,
  values,
  onChange,
}: Readonly<AttributeFieldInputsProps>) {
  const entries = Object.entries(values);
  return (
    <div>
      <h3 style={{ fontSize: '0.95rem', margin: '0 0 6px 0', color: '#1e293b' }}>{title}</h3>
      {entries.length === 0 ? (
        <div style={{ fontStyle: 'italic', fontSize: '0.85rem', color: '#64748b' }}>
          {emptyLabel}
        </div>
      ) : (
        entries.map(([category, val]) => (
          <div key={category} style={{ marginBottom: '8px' }}>
            <label style={{ fontSize: '0.85rem', textTransform: 'capitalize', fontWeight: 600 }}>
              {category}
              <input
                type="text"
                value={val}
                onChange={(e) => onChange(category, e.target.value)}
                style={{ marginTop: '4px', width: '100%', boxSizing: 'border-box' }}
              />
            </label>
          </div>
        ))
      )}
    </div>
  );
}

interface EditAttributesFormProps {
  modifiedCreator: Record<string, string>;
  setModifiedCreator: React.Dispatch<React.SetStateAction<Record<string, string>>>;
  modifiedDesired: Record<string, string>;
  setModifiedDesired: React.Dispatch<React.SetStateAction<Record<string, string>>>;
}

function EditAttributesForm({
  modifiedCreator,
  setModifiedCreator,
  modifiedDesired,
  setModifiedDesired,
}: Readonly<EditAttributesFormProps>) {
  return (
    <div style={{ display: 'grid', gap: '14px', marginTop: '12px' }}>
      <AttributeFieldInputs
        title="Your Attributes (Comma-separated)"
        emptyLabel="No creator attributes suggested."
        values={modifiedCreator}
        onChange={(cat, val) => setModifiedCreator((prev) => ({ ...prev, [cat]: val }))}
      />
      <AttributeFieldInputs
        title="Looking For / Desired Attributes (Comma-separated)"
        emptyLabel="No desired attributes suggested."
        values={modifiedDesired}
        onChange={(cat, val) => setModifiedDesired((prev) => ({ ...prev, [cat]: val }))}
      />
    </div>
  );
}

interface SuggestionCardSectionProps {
  title: string;
  titleColor: string;
  bgColor: string;
  borderColor: string;
  badgeBg: string;
  badgeColor: string;
  attributes: Record<string, unknown> | undefined;
}

function SuggestionCardSection({
  title,
  titleColor,
  bgColor,
  borderColor,
  badgeBg,
  badgeColor,
  attributes,
}: Readonly<SuggestionCardSectionProps>) {
  const entries = Object.entries((attributes as Record<string, string[]>) || {});
  const hasItems = entries.some(([, items]) => Array.isArray(items) && items.length > 0);

  return (
    <div
      style={{
        backgroundColor: bgColor,
        border: `1px solid ${borderColor}`,
        borderRadius: '10px',
        padding: '12px 16px',
      }}
    >
      <h3 style={{ fontSize: '0.9rem', margin: '0 0 8px 0', color: titleColor }}>{title}</h3>
      {!hasItems ? (
        <span style={{ fontSize: '0.85rem', color: '#64748b' }}>None</span>
      ) : (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
          {entries.flatMap(([cat, items]) =>
            (Array.isArray(items) ? items : []).map((item) => (
              <span
                key={`${cat}-${item}`}
                style={{
                  padding: '3px 8px',
                  backgroundColor: badgeBg,
                  color: badgeColor,
                  borderRadius: '9999px',
                  fontSize: '0.8rem',
                  fontWeight: 500,
                }}
              >
                {item}
              </span>
            ))
          )}
        </div>
      )}
    </div>
  );
}

interface ReviewAttributesDisplayProps {
  suggestion: WishAiSuggestion;
}

function ReviewAttributesDisplay({ suggestion }: Readonly<ReviewAttributesDisplayProps>) {
  return (
    <div style={{ display: 'grid', gap: '16px', marginTop: '8px' }}>
      <SuggestionCardSection
        title="Suggested Attributes For You"
        titleColor="#5b21b6"
        bgColor="rgba(139, 92, 246, 0.05)"
        borderColor="rgba(139, 92, 246, 0.2)"
        badgeBg="#ede9fe"
        badgeColor="#6d28d9"
        attributes={suggestion.suggested_creator_attributes as Record<string, unknown> | undefined}
      />
      <SuggestionCardSection
        title="Suggested Matches You Are Seeking"
        titleColor="#1d4ed8"
        bgColor="rgba(59, 130, 246, 0.05)"
        borderColor="rgba(59, 130, 246, 0.2)"
        badgeBg="#dbeafe"
        badgeColor="#1e40af"
        attributes={suggestion.suggested_desired_attributes as Record<string, unknown> | undefined}
      />
    </div>
  );
}

interface ModalActionsProps {
  pendingSuggestion: WishAiSuggestion | undefined;
  isModifying: boolean;
  submitting: boolean;
  onClose: () => void;
  onReject: () => void;
  onModifyStart: () => void;
  onCancelEdit: () => void;
  onAccept: () => void;
  onSaveModify: () => void;
}

function ModalActions({
  pendingSuggestion,
  isModifying,
  submitting,
  onClose,
  onReject,
  onModifyStart,
  onCancelEdit,
  onAccept,
  onSaveModify,
}: Readonly<ModalActionsProps>) {
  return (
    <div className="kiosk-modal-actions" style={{ marginTop: '20px', flexWrap: 'wrap' }}>
      <button type="button" className="secondary-button" onClick={onClose} disabled={submitting}>
        Close
      </button>

      {pendingSuggestion && !isModifying && (
        <>
          <button
            type="button"
            className="secondary-button"
            onClick={onReject}
            disabled={submitting}
            style={{ color: '#b91c1c' }}
          >
            Reject
          </button>
          <button
            type="button"
            className="secondary-button"
            onClick={onModifyStart}
            disabled={submitting}
          >
            Modify
          </button>
          <button
            type="button"
            className="primary-button"
            onClick={onAccept}
            disabled={submitting}
            style={{ backgroundColor: '#7c3aed' }}
          >
            Accept All
          </button>
        </>
      )}

      {pendingSuggestion && isModifying && (
        <>
          <button
            type="button"
            className="secondary-button"
            onClick={onCancelEdit}
            disabled={submitting}
          >
            Cancel Edit
          </button>
          <button
            type="button"
            className="primary-button"
            onClick={onSaveModify}
            disabled={submitting}
            style={{ backgroundColor: '#7c3aed' }}
          >
            Save &amp; Apply
          </button>
        </>
      )}
    </div>
  );
}

export default function AiSuggestionModal({
  wishId,
  secret,
  token,
  onClose,
  onApplied,
}: Readonly<AiSuggestionModalProps>) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [suggestions, setSuggestions] = useState<WishAiSuggestion[]>([]);
  const [isModifying, setIsModifying] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const [modifiedCreator, setModifiedCreator] = useState<Record<string, string>>({});
  const [modifiedDesired, setModifiedDesired] = useState<Record<string, string>>({});

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
      const pending = data.find((s) => s.status === 'pending') || data[0];
      if (pending) {
        setModifiedCreator(
          formatAttributesForEdit(
            pending.suggested_creator_attributes as Record<string, unknown> | undefined
          )
        );
        setModifiedDesired(
          formatAttributesForEdit(
            pending.suggested_desired_attributes as Record<string, unknown> | undefined
          )
        );
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

  const handleAction = async (action: 'accept' | 'reject' | 'modify') => {
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
        bodyPayload.creator_attributes = parseAttributesFromEdit(modifiedCreator);
        bodyPayload.desired_attributes = parseAttributesFromEdit(modifiedDesired);
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
      if (onApplied) {
        onApplied();
      }
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

  const pendingSuggestion = suggestions.find((s) => s.status === 'pending');

  const renderContent = () => {
    if (loading) {
      return (
        <div style={{ textAlign: 'center', padding: '24px', color: '#64748b' }}>
          Loading suggestions...
        </div>
      );
    }

    if (!pendingSuggestion) {
      return (
        <div style={{ padding: '16px 0', textAlign: 'center', color: '#64748b' }}>
          {getEmptySuggestionMessage(suggestions)}
        </div>
      );
    }

    if (isModifying) {
      return (
        <EditAttributesForm
          modifiedCreator={modifiedCreator}
          setModifiedCreator={setModifiedCreator}
          modifiedDesired={modifiedDesired}
          setModifiedDesired={setModifiedDesired}
        />
      );
    }

    return <ReviewAttributesDisplay suggestion={pendingSuggestion} />;
  };

  return (
    <dialog
      open
      className="kiosk-modal-backdrop"
      style={{
        zIndex: 100000,
        border: 'none',
        padding: 0,
        margin: 0,
        width: '100vw',
        height: '100vh',
        maxWidth: '100vw',
        maxHeight: '100vh',
      }}
      aria-labelledby="ai-suggestions-title"
    >
      <div className="kiosk-modal" style={{ maxWidth: '560px', width: '92%' }}>
        <h2 id="ai-suggestions-title" style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <span>✨</span>
          <span>Review AI Suggestions</span>
        </h2>
        <p className="kiosk-modal-sub" style={{ marginBottom: '16px' }}>
          Suggestions were automatically extracted from your wish content. Review, edit, or reject
          them below.
        </p>

        {error && <div className="kiosk-modal-error">{error}</div>}
        {message && <div className="message success">{message}</div>}

        {renderContent()}

        <ModalActions
          pendingSuggestion={pendingSuggestion}
          isModifying={isModifying}
          submitting={submitting}
          onClose={onClose}
          onReject={() => void handleAction('reject')}
          onModifyStart={() => setIsModifying(true)}
          onCancelEdit={() => setIsModifying(false)}
          onAccept={() => void handleAction('accept')}
          onSaveModify={() => void handleAction('modify')}
        />
      </div>
    </dialog>
  );
}
