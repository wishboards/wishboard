import React, { useEffect, useState } from 'react';
import InfoToggle from '../components/InfoToggle';
import WishPreview from '../components/WishPreview';
import WishFormFields from '../components/WishFormFields';
import { useAuth } from '../AuthContext';
import PassphraseInput from '../components/PassphraseInput';

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
  const [initialParams] = useState(parseInitialManageParams);
  const [wish, setWish] = useState<{
    id: string;
    content: string;
    contacts: Array<{ type?: string; value?: string }>;
    wishmail_enabled: boolean;
    created_at: string;
    is_active: boolean;
    image_url?: string;
    image_id?: string;
  } | null>(null);
  const [content, setContent] = useState('');
  const [contacts, setContacts] = useState<{ type: string; value: string }[]>([]);
  const [wishmailEnabled, setWishmailEnabled] = useState(false);
  const [isOverflowing, setIsOverflowing] = useState(false);
  const [secret, setSecret] = useState(initialParams.secret);
  const [newPassphrase, setNewPassphrase] = useState(initialParams.secret);
  const [error, setError] = useState<string | null>(initialParams.initialError);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    if (!initialParams.wishId || initialParams.initialError) {
      return;
    }

    const controller = new AbortController();

    fetch(`/api/wishes/${encodeURIComponent(initialParams.wishId)}`, {
      signal: controller.signal,
    })
      .then((res) => {
        if (res.ok) return res.json();
        throw new Error('Wish not found');
      })
      .then((data) => {
        setWish(data);
        setContent(data.content);
        setContacts(data.contacts || []);
        setWishmailEnabled(data.wishmail_enabled || false);
      })
      .catch((err) => {
        if (err.name !== 'AbortError') {
          setError(err.message);
        }
      });

    return () => controller.abort();
  }, [initialParams.wishId, initialParams.initialError]);

  const handleUpdate = async (e: React.SyntheticEvent) => {
    e.preventDefault();
    if (!wish) return;
    setError(null);
    setMessage(null);

    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (token) {
      headers.Authorization = `Bearer ${token}`;
    }

    const response = await fetch(`/api/wishes/${encodeURIComponent(wish.id)}/manage`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        secret,
        content,
        contacts,
        wishmail_enabled: wishmailEnabled,
        new_passphrase: newPassphrase,
        action: 'update',
      }),
    });

    if (response.ok) {
      const data = await response.json();
      setMessage('Wish updated successfully!');
      setWish({ ...wish, content, contacts, wishmail_enabled: wishmailEnabled });
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

  const previewWish = {
    id: wish.id,
    content: content,
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
    </section>
  );
}
