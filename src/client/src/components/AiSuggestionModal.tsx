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

  // Editable attribute states for modification mode
  const [modifiedCreator, setModifiedCreator] = useState<Record<string, string>>({});
  const [modifiedDesired, setModifiedDesired] = useState<Record<string, string>>({});

  const formatAttributesForEdit = (attrs: Record<string, unknown> | undefined) => {
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
  };

  const parseAttributesFromEdit = (attrs: Record<string, string>) => {
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
  };

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
      setError(`An unexpected error occurred while processing the suggestion.`);
    } finally {
      setSubmitting(false);
    }
  };

  const pendingSuggestion = suggestions.find((s) => s.status === 'pending');

  return (
    <div
      className="kiosk-modal-backdrop"
      style={{ zIndex: 100000 }}
      role="dialog"
      aria-modal="true"
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

        {loading ? (
          <div style={{ textAlign: 'center', padding: '24px', color: '#64748b' }}>
            Loading suggestions...
          </div>
        ) : !pendingSuggestion ? (
          <div style={{ padding: '16px 0', textAlign: 'center', color: '#64748b' }}>
            {suggestions.length > 0
              ? `All suggestions have already been reviewed (Status: ${suggestions[0]?.status}).`
              : 'No AI suggestions found for this wish.'}
          </div>
        ) : isModifying ? (
          <div style={{ display: 'grid', gap: '14px', marginTop: '12px' }}>
            <div>
              <h3 style={{ fontSize: '0.95rem', margin: '0 0 6px 0', color: '#1e293b' }}>
                Your Attributes (Comma-separated)
              </h3>
              {Object.keys(modifiedCreator).length === 0 ? (
                <div style={{ fontStyle: 'italic', fontSize: '0.85rem', color: '#64748b' }}>
                  No creator attributes suggested.
                </div>
              ) : (
                Object.entries(modifiedCreator).map(([category, val]) => (
                  <div key={category} style={{ marginBottom: '8px' }}>
                    <label
                      style={{ fontSize: '0.85rem', textTransform: 'capitalize', fontWeight: 600 }}
                    >
                      {category}
                      <input
                        type="text"
                        value={val}
                        onChange={(e) =>
                          setModifiedCreator((prev) => ({ ...prev, [category]: e.target.value }))
                        }
                        style={{ marginTop: '4px', width: '100%', boxSizing: 'border-box' }}
                      />
                    </label>
                  </div>
                ))
              )}
            </div>

            <div>
              <h3 style={{ fontSize: '0.95rem', margin: '0 0 6px 0', color: '#1e293b' }}>
                Looking For / Desired Attributes (Comma-separated)
              </h3>
              {Object.keys(modifiedDesired).length === 0 ? (
                <div style={{ fontStyle: 'italic', fontSize: '0.85rem', color: '#64748b' }}>
                  No desired attributes suggested.
                </div>
              ) : (
                Object.entries(modifiedDesired).map(([category, val]) => (
                  <div key={category} style={{ marginBottom: '8px' }}>
                    <label
                      style={{ fontSize: '0.85rem', textTransform: 'capitalize', fontWeight: 600 }}
                    >
                      {category}
                      <input
                        type="text"
                        value={val}
                        onChange={(e) =>
                          setModifiedDesired((prev) => ({ ...prev, [category]: e.target.value }))
                        }
                        style={{ marginTop: '4px', width: '100%', boxSizing: 'border-box' }}
                      />
                    </label>
                  </div>
                ))
              )}
            </div>
          </div>
        ) : (
          <div style={{ display: 'grid', gap: '16px', marginTop: '8px' }}>
            <div
              style={{
                backgroundColor: 'rgba(139, 92, 246, 0.05)',
                border: '1px solid rgba(139, 92, 246, 0.2)',
                borderRadius: '10px',
                padding: '12px 16px',
              }}
            >
              <h3 style={{ fontSize: '0.9rem', margin: '0 0 8px 0', color: '#5b21b6' }}>
                Suggested Attributes For You
              </h3>
              {Object.keys(pendingSuggestion.suggested_creator_attributes || {}).length === 0 ? (
                <span style={{ fontSize: '0.85rem', color: '#64748b' }}>None</span>
              ) : (
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
                  {Object.entries(
                    pendingSuggestion.suggested_creator_attributes as Record<string, string[]>
                  ).flatMap(([cat, items]) =>
                    (Array.isArray(items) ? items : []).map((item) => (
                      <span
                        key={`${cat}-${item}`}
                        style={{
                          padding: '3px 8px',
                          backgroundColor: '#ede9fe',
                          color: '#6d28d9',
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

            <div
              style={{
                backgroundColor: 'rgba(59, 130, 246, 0.05)',
                border: '1px solid rgba(59, 130, 246, 0.2)',
                borderRadius: '10px',
                padding: '12px 16px',
              }}
            >
              <h3 style={{ fontSize: '0.9rem', margin: '0 0 8px 0', color: '#1d4ed8' }}>
                Suggested Matches You Are Seeking
              </h3>
              {Object.keys(pendingSuggestion.suggested_desired_attributes || {}).length === 0 ? (
                <span style={{ fontSize: '0.85rem', color: '#64748b' }}>None</span>
              ) : (
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
                  {Object.entries(
                    pendingSuggestion.suggested_desired_attributes as Record<string, string[]>
                  ).flatMap(([cat, items]) =>
                    (Array.isArray(items) ? items : []).map((item) => (
                      <span
                        key={`${cat}-${item}`}
                        style={{
                          padding: '3px 8px',
                          backgroundColor: '#dbeafe',
                          color: '#1e40af',
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
          </div>
        )}

        <div className="kiosk-modal-actions" style={{ marginTop: '20px', flexWrap: 'wrap' }}>
          <button
            type="button"
            className="secondary-button"
            onClick={onClose}
            disabled={submitting}
          >
            Close
          </button>

          {pendingSuggestion && !isModifying && (
            <>
              <button
                type="button"
                className="secondary-button"
                onClick={() => handleAction('reject')}
                disabled={submitting}
                style={{ color: '#b91c1c' }}
              >
                Reject
              </button>
              <button
                type="button"
                className="secondary-button"
                onClick={() => setIsModifying(true)}
                disabled={submitting}
              >
                Modify
              </button>
              <button
                type="button"
                className="primary-button"
                onClick={() => handleAction('accept')}
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
                onClick={() => setIsModifying(false)}
                disabled={submitting}
              >
                Cancel Edit
              </button>
              <button
                type="button"
                className="primary-button"
                onClick={() => handleAction('modify')}
                disabled={submitting}
                style={{ backgroundColor: '#7c3aed' }}
              >
                Save &amp; Apply
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
