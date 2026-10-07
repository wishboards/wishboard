import React, { useEffect, useState, useCallback } from 'react';
import { useAuth } from '../AuthContext';
import WishCard from '../components/WishCard';
import useFlagWish from '../hooks/useFlagWish';
import InfoToggle from '../components/InfoToggle';
import AttributeInput from '../components/AttributeInput';
import SendWishmailModal from '../components/SendWishmailModal';
import { useEventProfile } from '../EventProfileContext';
import { useWebSocket } from '../hooks/useWebSocket';
import { useExcludedWishes } from '../hooks/useExcludedWishes';

interface Wish {
  id: string;
  content: string;
  creator_attributes?: Record<string, string[]>;
  image_url?: string;
  image_id?: string;
}

interface UserProfile {
  attributes?: Record<string, string[]>;
  identity_attributes?: Record<string, string[]>;
  [key: string]: unknown;
}

interface SearchParamInput {
  query: string;
  user: UserProfile | null;
  useProfileAttributes: boolean;
  manualAttributes: Record<string, string>;
  excludedIds: string[];
}

function applyCompatibilityParams(
  params: URLSearchParams,
  user: UserProfile | null,
  useProfileAttributes: boolean,
  manualAttributes: Record<string, string>
) {
  if (user) {
    if (!useProfileAttributes) {
      params.set('ignore_attributes', '1');
    }
    return;
  }

  const manualValues = Object.fromEntries(
    Object.entries(manualAttributes).filter(([_, val]) => val.trim().length > 0)
  );

  if (Object.keys(manualValues).length > 0) {
    params.set('attributes', JSON.stringify(manualValues));
  } else {
    params.set('ignore_attributes', '1');
  }
}

function buildSearchParams({
  query,
  user,
  useProfileAttributes,
  manualAttributes,
  excludedIds,
}: Readonly<SearchParamInput>): URLSearchParams {
  const params = new URLSearchParams();
  const qTrim = query.trim();
  if (qTrim) {
    params.set('q', qTrim);
  }

  applyCompatibilityParams(params, user, useProfileAttributes, manualAttributes);

  if (!user && excludedIds.length > 0) {
    params.set('exclude', excludedIds.join(','));
  }

  return params;
}

export default function SearchPage() {
  const { user, token } = useAuth();
  const { excludedIds, excludeWish, unexcludeWish } = useExcludedWishes();
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<Wish[]>([]);
  const [justExcludedId, setJustExcludedId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [useProfileAttributes, setUseProfileAttributes] = useState<boolean>(Boolean(user));
  const [manualAttributes, setManualAttributes] = useState<Record<string, string>>({});
  const { categories } = useEventProfile();
  const [mailWishId, setMailWishId] = useState<string | null>(null);
  const [lastSearchParams, setLastSearchParams] = useState<string | null>(null);
  const { socket } = useWebSocket();

  const prependIfNotPresent = useCallback((newWish: Wish) => {
    setResults((prev) => (prev.some((w) => w.id === newWish.id) ? prev : [newWish, ...prev]));
  }, []);

  const handleNewWish = useCallback(
    async (newWish: Wish) => {
      if (lastSearchParams === null) return;
      try {
        const response = await fetch(`/api/wishes?${lastSearchParams}`);
        if (!response.ok) return;
        const data = await response.json();
        if (data.some((w: Wish) => w.id === newWish.id)) {
          prependIfNotPresent(newWish);
        }
      } catch (err) {
        console.debug('WebSocket wish:created check failed:', err);
      }
    },
    [lastSearchParams, prependIfNotPresent]
  );

  const handleDeletedWish = useCallback((deletedWishId: string) => {
    setResults((prev) => prev.filter((w) => w.id !== deletedWishId));
  }, []);

  useEffect(() => {
    if (!socket) return;
    socket.emit('subscribe', { channel: 'wish:*' });
    socket.on('wish:created', handleNewWish);
    socket.on('wish:reactivated', handleNewWish);
    socket.on('wish:deleted', handleDeletedWish);
    return () => {
      socket.emit('unsubscribe', { channel: 'wish:*' });
      socket.off('wish:created', handleNewWish);
      socket.off('wish:reactivated', handleNewWish);
      socket.off('wish:deleted', handleDeletedWish);
    };
  }, [socket, handleNewWish, handleDeletedWish]);

  useEffect(() => {
    setUseProfileAttributes(Boolean(user));
  }, [user]);

  const search = async (event: React.SyntheticEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(null);

    const params = buildSearchParams({
      query,
      user,
      useProfileAttributes,
      manualAttributes,
      excludedIds,
    });

    const paramsStr = params.toString();
    setLastSearchParams(paramsStr);

    const response = await fetch(`/api/wishes?${paramsStr}`);
    const data = await response.json();
    if (!response.ok) {
      setError('Unable to perform search.');
      return;
    }

    setResults(data);
  };

  const handleFlag = useFlagWish((id) =>
    setResults((prev) => prev.filter((wish) => wish.id !== id))
  );

  const handleAdminDelete = useCallback(
    async (id: string) => {
      if (!token) return;
      if (!globalThis.confirm('Are you sure you want to delete this wish as an admin?')) return;
      try {
        const response = await fetch(`/api/admin/wishes/${id}/remove`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${token}` },
        });
        if (response.ok) {
          setResults((prev) => prev.filter((w) => w.id !== id));
        } else {
          globalThis.alert('Failed to delete wish.');
        }
      } catch (err) {
        console.error(err);
        globalThis.alert('Error deleting wish.');
      }
    },
    [token]
  );

  const handleExclude = useCallback(
    (id: string) => {
      void excludeWish(id);
      setResults((prev) => prev.filter((w) => w.id !== id));
      setJustExcludedId(id);
      setTimeout(() => {
        setJustExcludedId((current) => (current === id ? null : current));
      }, 5000);
    },
    [excludeWish]
  );

  const handleUndoExclude = useCallback(() => {
    if (justExcludedId) {
      void unexcludeWish(justExcludedId);
      if (lastSearchParams !== null) {
        fetch(`/api/wishes?${lastSearchParams}`)
          .then((res) => (res.ok ? res.json() : []))
          .then((data) => setResults(data))
          .catch((err) => console.error('Failed to restore search results after undo:', err));
      }
      setJustExcludedId(null);
    }
  }, [justExcludedId, unexcludeWish, lastSearchParams]);

  return (
    <section>
      <h1 style={{ maxWidth: '800px', margin: '0 auto' }}>Search Wishes</h1>

      <form
        onSubmit={search}
        className="form-card"
        style={{ maxWidth: '800px', margin: '18px auto 24px' }}
      >
        <label>
          Search phrase{' '}
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search existing wishes"
          />
        </label>

        {user ? (
          <div className="label-with-info" style={{ marginTop: '8px' }}>
            <label
              className="checkbox-label"
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '8px',
                cursor: 'pointer',
                margin: 0,
              }}
            >
              <input
                type="checkbox"
                checked={useProfileAttributes}
                onChange={(e) => setUseProfileAttributes(e.target.checked)}
              />{' '}
              Filter results by my profile attributes
            </label>
            <InfoToggle>
              <p style={{ margin: 0, fontSize: '0.9rem', color: '#556275' }}>
                When checked, only wishes compatible with your saved gender, orientations, and roles
                will be displayed.
              </p>
            </InfoToggle>
          </div>
        ) : (
          <div style={{ marginTop: '16px' }}>
            <div className="label-with-info" style={{ marginBottom: '8px' }}>
              <span style={{ fontWeight: 'bold' }}>Your Attributes</span>
              <InfoToggle>
                <p style={{ margin: 0, fontSize: '0.9rem', color: '#556275' }}>
                  Select or type attributes to filter compatible wishes. Commas separate multiple
                  options.
                </p>
              </InfoToggle>
            </div>
            {categories.map((cat) => {
              const suggs = cat.suggestions || [];
              return (
                <div key={cat.id} style={{ marginTop: '16px' }}>
                  <label
                    htmlFor={`search-${cat.id}`}
                    style={{ fontWeight: 'bold', display: 'block' }}
                  >
                    Your {cat.label}(s)
                  </label>
                  <AttributeInput
                    id={`search-${cat.id}`}
                    category={cat.id}
                    value={manualAttributes[cat.id] || ''}
                    onChange={(val) => setManualAttributes((prev) => ({ ...prev, [cat.id]: val }))}
                    placeholder={suggs.length > 0 ? `e.g. ${suggs.slice(0, 2).join(', ')}` : ''}
                    suggestions={suggs}
                  />
                </div>
              );
            })}
          </div>
        )}

        {error && <div className="error-message">{error}</div>}

        <button type="submit">Search</button>
      </form>

      <div className="wish-grid">
        {results
          .filter((wish) => !excludedIds.includes(wish.id))
          .map((wish) => (
            <WishCard
              key={wish.id}
              wish={wish}
              onFlag={handleFlag}
              onSendMail={setMailWishId}
              onAdminDelete={user?.role === 'admin' ? handleAdminDelete : undefined}
              onExclude={handleExclude}
            />
          ))}
      </div>

      {mailWishId && <SendWishmailModal wishId={mailWishId} onClose={() => setMailWishId(null)} />}

      {justExcludedId && (
        <output className="toast-notification">
          Wish hidden.{' '}
          <button type="button" className="toast-undo-btn" onClick={handleUndoExclude}>
            Undo
          </button>
        </output>
      )}
    </section>
  );
}
