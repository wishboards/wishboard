import React, { useCallback, useEffect, useState } from 'react';
import InfoToggle from '../components/InfoToggle';
import WishPreview from '../components/WishPreview';
import WishFormFields from '../components/WishFormFields';
import AttributeInput from '../components/AttributeInput';
import { useAuth } from '../AuthContext';
import { useEventProfile } from '../EventProfileContext';
import PassphraseInput from '../components/PassphraseInput';
import { apiClient, bearerHeader } from '../api/client';
import AiSuggestionBadge from '../components/AiSuggestionBadge';
import AiSuggestionModal from '../components/AiSuggestionModal';
import { useWishSuggestionsRealtime } from '../hooks/useWishSuggestionsRealtime';

function formatAttributeMapToStrings(
  attrs?: Record<string, string[] | string>
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

function parseAttributeStringsToArrays(attrs: Record<string, string>): Record<string, string[]> {
  const result: Record<string, string[]> = {};
  for (const [key, val] of Object.entries(attrs)) {
    const items = val
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    if (items.length > 0) {
      result[key] = items;
    }
  }
  return result;
}

function parseInitialManageParams(): {
  initialError: string | null;
  wishId: string | null;
  secret: string;
} {
  const hashIndex = globalThis.location.hash.indexOf('?');
  if (hashIndex === -1) {
    return { initialError: 'No wish ID provided.', wishId: null, secret: '' };
  }

  const params = new URLSearchParams(globalThis.location.hash.substring(hashIndex));
  const wishId = params.get('id');
  const wishSecret = params.get('secret') || '';

  if (wishSecret && !/^[a-zA-Z0-9_-]+$/.test(wishSecret)) {
    return { initialError: 'Invalid secret format.', wishId: null, secret: '' };
  }

  if (!wishId) {
    return { initialError: 'No wish ID provided.', wishId: null, secret: wishSecret };
  }

  if (!/^[a-zA-Z0-9-]+$/.test(wishId)) {
    return { initialError: 'Invalid wish ID format.', wishId: null, secret: wishSecret };
  }

  return { initialError: null, wishId, secret: wishSecret };
}

export default function ManageWishPage() {
  const { token, user } = useAuth();
  const { categories } = useEventProfile();
  const [initialParams] = useState(parseInitialManageParams);
  const [wish, setWish] = useState<{
    id: string;
    content: string;
    contacts: Array<{ type?: string; value?: string }>;
    wishmail_enabled: boolean;
    creator_attributes?: Record<string, string[]>;
    desired_attributes?: Record<string, string[]>;
    created_at: string;
    is_active: boolean;
    image_url?: string;
    image_id?: string;
  } | null>(null);
  const [content, setContent] = useState('');
  const [contacts, setContacts] = useState<{ type: string; value: string }[]>([]);
  const [wishmailEnabled, setWishmailEnabled] = useState(false);
  const [creatorAttributes, setCreatorAttributes] = useState<Record<string, string>>({});
  const [desiredAttributes, setDesiredAttributes] = useState<Record<string, string>>({});
  const [attributesDirty, setAttributesDirty] = useState(false);
  const [isOverflowing, setIsOverflowing] = useState(false);
  const [secret, setSecret] = useState(initialParams.secret);
  const [newPassphrase, setNewPassphrase] = useState(initialParams.secret);
  const [error, setError] = useState<string | null>(initialParams.initialError);
  const [message, setMessage] = useState<string | null>(null);
  const [pendingSuggestionsCount, setPendingSuggestionsCount] = useState(0);
  const [showAiModal, setShowAiModal] = useState(false);

  const loadWish = useCallback(async (id: string, signal?: AbortSignal) => {
    const req = fetch(`/api/wishes/${encodeURIComponent(id)}`, signal ? { signal } : undefined);
    if (!req?.then) return;
    const res = await req;
    if (!res.ok) {
      throw new Error('Wish not found');
    }
    const data = await res.json();
    setWish(data);
    setContent(data.content);
    setContacts(data.contacts || []);
    setWishmailEnabled(data.wishmail_enabled || false);
    setCreatorAttributes(formatAttributeMapToStrings(data.creator_attributes));
    setDesiredAttributes(formatAttributeMapToStrings(data.desired_attributes));
    setAttributesDirty(false);
    if (typeof data.pending_suggestions_count === 'number') {
      setPendingSuggestionsCount(data.pending_suggestions_count);
    }
  }, []);

  const checkAiSuggestions = useCallback(
    async (id: string, currentSecret: string) => {
      try {
        const queryParams: { secret?: string } = {};
        if (currentSecret) {
          queryParams.secret = currentSecret;
        }
        const { data, response } = await apiClient.GET('/api/wishes/{id}/suggestions', {
          params: { path: { id }, query: queryParams },
          headers: bearerHeader(token),
        });
        if (response.ok && data) {
          const pendingCount = data.filter((s) => s.status === 'pending').length;
          setPendingSuggestionsCount(pendingCount);
        }
      } catch {
        // Ignore
      }
    },
    [token]
  );

  useEffect(() => {
    if (!initialParams.wishId || initialParams.initialError) {
      return;
    }

    const controller = new AbortController();

    loadWish(initialParams.wishId, controller.signal).catch((err) => {
      if (err.name !== 'AbortError') {
        setError(err.message);
      }
    });

    return () => controller.abort();
  }, [initialParams.wishId, initialParams.initialError, loadWish]);

  useWishSuggestionsRealtime({
    wishId: wish?.id,
    secret,
    token,
    onPendingCountChange: setPendingSuggestionsCount,
  });

  const handleUpdate = async (e: React.SyntheticEvent) => {
    e.preventDefault();
    if (!wish) return;
    setError(null);
    setMessage(null);

    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (token) {
      headers.Authorization = `Bearer ${token}`;
    }

    const payload: Record<string, unknown> = {
      secret,
      content,
      contacts,
      wishmail_enabled: wishmailEnabled,
      new_passphrase: newPassphrase,
      action: 'update',
    };

    if (attributesDirty) {
      payload.creator_attributes = creatorAttributes;
      payload.desired_attributes = desiredAttributes;
    }

    const response = await fetch(`/api/wishes/${encodeURIComponent(wish.id)}/manage`, {
      method: 'POST',
      headers,
      body: JSON.stringify(payload),
    });

    if (response.ok) {
      const data = await response.json();
      setMessage('Wish updated successfully!');
      setWish({
        ...wish,
        content,
        contacts,
        wishmail_enabled: wishmailEnabled,
        creator_attributes: attributesDirty
          ? parseAttributeStringsToArrays(creatorAttributes)
          : wish.creator_attributes,
        desired_attributes: attributesDirty
          ? parseAttributeStringsToArrays(desiredAttributes)
          : wish.desired_attributes,
      });
      setAttributesDirty(false);
      if (data.newSecret) {
        setSecret(data.newSecret);
        setNewPassphrase('');
        globalThis.location.hash = `#manage-wish?id=${wish.id}&secret=${encodeURIComponent(data.newSecret)}`;
      }
    } else {
      const data = await response.json();
      setError(data.error || 'Failed to update wish.');
    }
  };

  const handleDelete = async () => {
    if (!wish) return;
    if (!confirm('Are you sure you want to delete this wish?')) return;
    setError(null);
    setMessage(null);

    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (token) {
      headers.Authorization = `Bearer ${token}`;
    }

    const response = await fetch(`/api/wishes/${encodeURIComponent(wish.id)}/manage`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ secret, action: 'delete' }),
    });

    if (response.ok) {
      setMessage('Wish deleted successfully.');
      setWish(null);
    } else {
      const data = await response.json();
      setError(data.error || 'Failed to delete wish.');
    }
  };

  const toggleWishStatus = async () => {
    if (!wish) return;
    setError(null);
    setMessage(null);

    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (token) {
      headers.Authorization = `Bearer ${token}`;
    }

    const endpoint = wish.is_active
      ? `/api/wishes/${encodeURIComponent(wish.id)}/deactivate`
      : `/api/wishes/${encodeURIComponent(wish.id)}/reactivate`;

    const response = await fetch(endpoint, {
      method: 'POST',
      headers,
      body: JSON.stringify({ secret }),
    });

    if (response.ok) {
      setMessage(`Wish ${wish.is_active ? 'deactivated' : 'reactivated'} successfully.`);
      setWish({ ...wish, is_active: !wish.is_active });
    } else {
      const data = await response.json();
      setError(data.error || `Failed to ${wish.is_active ? 'deactivate' : 'reactivate'} wish.`);
    }
  };

  if (error && !wish) {
    return (
      <section>
        <h1>Manage Wish</h1>
        <div className="message error">{error}</div>
      </section>
    );
  }

  if (!wish) {
    if (message) {
      return (
        <section>
          <h1>Manage Wish</h1>
          <div className="message success">{message}</div>
        </section>
      );
    }
    return <section>Loading...</section>;
  }

  const parsedCreatorAttributes = parseAttributeStringsToArrays(creatorAttributes);

  const previewWish = {
    id: wish.id,
    content: content,
    creator_attributes:
      Object.keys(parsedCreatorAttributes).length > 0
        ? parsedCreatorAttributes
        : wish.creator_attributes,
    contacts: contacts.filter((c) => c.value.trim()),
    wishmail_enabled: wishmailEnabled,
    image_url: wish.image_url,
    image_id: wish.image_id,
  };

  return (
    <section>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          <h1 style={{ marginBottom: '8px', display: 'flex', alignItems: 'center', gap: '8px' }}>
            Manage Your Wish
            {!wish.is_active && (
              <span
                style={{
                  fontSize: '0.9rem',
                  color: '#e53e3e',
                  background: '#ffe5e5',
                  padding: '4px 8px',
                  borderRadius: '4px',
                  fontWeight: 'normal',
                }}
              >
                Inactive
              </span>
            )}
          </h1>
          <p style={{ marginTop: 0 }}>Edit the content of your wish or delete it permanently.</p>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <AiSuggestionBadge count={pendingSuggestionsCount} onClick={() => setShowAiModal(true)} />
          {wish.wishmail_enabled && (
            <a
              href={
                '#wishmail-dashboard?id=' +
                wish.id +
                (secret ? '&secret=' + encodeURIComponent(secret) : '')
              }
              className="compact-btn"
              style={{ background: '#1a73e8', textDecoration: 'none' }}
            >
              View Wishmail
            </a>
          )}
        </div>
      </div>

      <div className="wish-editor-layout">
        <form className="form-card" onSubmit={handleUpdate} style={{ marginTop: 0 }}>
          <WishFormFields
            content={content}
            setContent={setContent}
            contacts={contacts}
            setContacts={setContacts}
            wishmailEnabled={wishmailEnabled}
            setWishmailEnabled={setWishmailEnabled}
            isOverflowing={isOverflowing}
          />

          {categories.length > 0 && (
            <fieldset
              style={{
                border: '1px solid var(--wb-border-subtle, #cbd5e1)',
                borderRadius: '10px',
                padding: '14px 16px',
                display: 'grid',
                gap: '14px',
              }}
            >
              <legend style={{ fontWeight: 700, padding: '0 6px' }}>
                Wish Attribute Overrides &amp; Match Criteria
              </legend>
              <p style={{ margin: 0, fontSize: '0.88rem', color: 'var(--wb-text-muted, #64748b)' }}>
                {user
                  ? 'Signed-in wishes inherit your Account Profile attributes by default. Edit below to set or review per-wish attribute overrides (including accepted AI suggestions) for this wish.'
                  : 'Edit the attributes describing yourself and who you are looking to match with for this wish.'}
              </p>

              <div style={{ display: 'grid', gap: '10px' }}>
                <strong style={{ fontSize: '0.92rem' }}>Your Attributes (This Wish)</strong>
                {categories.map((cat) => {
                  const suggs = cat.suggestions || [];
                  return (
                    <div key={`manage-creator-${cat.id}`}>
                      <label
                        htmlFor={`manage-creator-${cat.id}`}
                        style={{ display: 'block', fontWeight: 600, fontSize: '0.88rem' }}
                      >
                        Your {cat.label}(s)
                      </label>
                      <AttributeInput
                        id={`manage-creator-${cat.id}`}
                        category={cat.id}
                        value={creatorAttributes[cat.id] || ''}
                        onChange={(val) => {
                          setCreatorAttributes((prev) => ({ ...prev, [cat.id]: val }));
                          setAttributesDirty(true);
                        }}
                        placeholder={suggs.length > 0 ? `e.g. ${suggs.slice(0, 2).join(', ')}` : ''}
                        suggestions={suggs}
                      />
                    </div>
                  );
                })}
              </div>

              <div style={{ display: 'grid', gap: '10px' }}>
                <strong style={{ fontSize: '0.92rem' }}>Looking For (Match Criteria)</strong>
                {categories.map((cat) => {
                  const suggs = cat.suggestions || [];
                  return (
                    <div key={`manage-desired-${cat.id}`}>
                      <label
                        htmlFor={`manage-desired-${cat.id}`}
                        style={{ display: 'block', fontWeight: 600, fontSize: '0.88rem' }}
                      >
                        Desired {cat.label}(s)
                      </label>
                      <AttributeInput
                        id={`manage-desired-${cat.id}`}
                        category={cat.id}
                        value={desiredAttributes[cat.id] || ''}
                        onChange={(val) => {
                          setDesiredAttributes((prev) => ({ ...prev, [cat.id]: val }));
                          setAttributesDirty(true);
                        }}
                        placeholder={suggs.length > 0 ? `e.g. ${suggs.slice(0, 2).join(', ')}` : ''}
                        suggestions={suggs}
                      />
                    </div>
                  );
                })}
              </div>
            </fieldset>
          )}

          {!user && (
            <div style={{ display: 'grid', gap: '8px' }}>
              <div className="label-with-info">
                <label htmlFor="passphrase-input">Change passphrase</label>
                <InfoToggle>
                  If you created this wish anonymously, you can change its passphrase here.
                </InfoToggle>
              </div>
              <PassphraseInput
                id="passphrase-input"
                value={newPassphrase}
                onChange={setNewPassphrase}
                placeholder="Change passphrase (leave blank to keep current)"
              />
            </div>
          )}

          <div style={{ display: 'flex', gap: '12px', marginTop: '8px', flexWrap: 'wrap' }}>
            <button type="submit">Save Changes</button>
            <button
              type="button"
              className="secondary-button"
              style={{
                color: wish.is_active ? '#e53e3e' : '#2b6cb0',
                borderColor: wish.is_active ? '#e53e3e' : '#2b6cb0',
              }}
              onClick={toggleWishStatus}
            >
              {wish.is_active ? 'Deactivate Wish' : 'Reactivate Wish'}
            </button>
            <button
              type="button"
              className="secondary-button"
              onClick={handleDelete}
              style={{ background: '#fee2e2', color: '#b91c1c' }}
            >
              Delete Wish
            </button>
          </div>
        </form>

        <WishPreview wish={previewWish} onOverflowChange={setIsOverflowing} />
      </div>

      {message && (
        <div className="message success" style={{ marginTop: '24px' }}>
          {message}
        </div>
      )}
      {error && (
        <div className="message error" style={{ marginTop: '24px' }}>
          {error}
        </div>
      )}

      {showAiModal && wish && (
        <AiSuggestionModal
          wishId={wish.id}
          wish={wish}
          secret={secret}
          token={token}
          onClose={() => setShowAiModal(false)}
          onApplied={() => {
            void checkAiSuggestions(wish.id, secret);
            void loadWish(wish.id);
          }}
        />
      )}
    </section>
  );
}
