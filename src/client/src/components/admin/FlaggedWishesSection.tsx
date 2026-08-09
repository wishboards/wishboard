import React, { useState, useEffect } from 'react';
import { useWebSocket } from '../../hooks/useWebSocket';

interface FlaggedWish {
  id: string;
  content: string;
  flagged: number;
  user_id: string | null;
}

interface FlaggedWishesSectionProps {
  authHeader: Record<string, string>;
  setMessage: (msg: string | null) => void;
  setError: (err: string | null) => void;
  refreshCounter: number;
}

function useFlaggedWishes(
  authHeader: Record<string, string>,
  setError: (err: string | null) => void,
  refreshCounter: number
) {
  const [flags, setFlags] = useState<Array<FlaggedWish>>([]);

  const loadFlags = React.useCallback(async () => {
    setError(null);
    const response = await fetch('/api/admin/flags', { headers: authHeader });
    if (!response.ok) {
      setError('Unable to load flagged wishes.');
      return;
    }
    setFlags(await response.json());
  }, [authHeader, setError]);

  useEffect(() => {
    loadFlags();
  }, [refreshCounter, loadFlags]);

  const { socket } = useWebSocket();

  const addFlag = React.useCallback((wish: FlaggedWish) => {
    setFlags((prev) => (prev.some((w) => w.id === wish.id) ? prev : [wish, ...prev]));
  }, []);

  const removeFlag = React.useCallback((wishId: string) => {
    setFlags((prev) => prev.filter((w) => w.id !== wishId));
  }, []);

  useEffect(() => {
    if (!socket) return;

    socket.emit('subscribe', { channel: 'wish:*' });
    socket.on('wish:flagged', addFlag);
    socket.on('wish:deleted', removeFlag);

    return () => {
      socket.emit('unsubscribe', { channel: 'wish:*' });
      socket.off('wish:flagged', addFlag);
      socket.off('wish:deleted', removeFlag);
    };
  }, [socket, addFlag, removeFlag]);

  return { flags, loadFlags };
}

interface FlaggedWishCardProps {
  wish: FlaggedWish;
  clearFlag: (id: string) => void;
  removeWish: (id: string) => void;
}

function FlaggedWishCard({ wish, clearFlag, removeWish }: Readonly<FlaggedWishCardProps>) {
  return (
    <article className="wish-card" key={wish.id}>
      <p>{wish.content}</p>
      <p className="microtext">Submitted by {wish.user_id || 'anonymous'}</p>
      <div className="wish-actions">
        <button type="button" className="secondary-button" onClick={() => clearFlag(wish.id)}>
          Clear Flag
        </button>
        <button type="button" onClick={() => removeWish(wish.id)}>
          Remove
        </button>
      </div>
    </article>
  );
}

export default function FlaggedWishesSection({
  authHeader,
  setMessage,
  setError,
  refreshCounter,
}: Readonly<FlaggedWishesSectionProps>) {
  const { flags, loadFlags } = useFlaggedWishes(authHeader, setError, refreshCounter);

  const removeWish = async (id: string) => {
    setMessage(null);
    setError(null);
    const response = await fetch(`/api/admin/wishes/${encodeURIComponent(id)}/remove`, {
      method: 'POST',
      headers: authHeader,
    });
    if (!response.ok) {
      setError('Failed to remove wish.');
      return;
    }
    setMessage(`Removed wish ${id}`);
    loadFlags();
  };

  const clearFlag = async (id: string) => {
    setMessage(null);
    setError(null);
    const response = await fetch(`/api/admin/wishes/${encodeURIComponent(id)}/clear-flag`, {
      method: 'POST',
      headers: authHeader,
    });
    if (!response.ok) {
      setError('Failed to clear flag.');
      return;
    }
    setMessage(`Cleared flag for wish ${id}`);
    loadFlags();
  };

  const clearAllFlags = async () => {
    if (!globalThis.confirm('Are you sure you want to clear flags for all remaining wishes?'))
      return;
    setMessage(null);
    setError(null);
    const response = await fetch('/api/admin/wishes/clear-all-flags', {
      method: 'POST',
      headers: authHeader,
    });
    if (!response.ok) {
      setError('Failed to clear all flags.');
      return;
    }
    setMessage('Cleared all flags successfully.');
    loadFlags();
  };

  return (
    <section>
      <h2>Flagged Wishes</h2>
      <div className="wish-grid">
        {flags.length === 0 ? (
          <p>No flagged wishes at the moment.</p>
        ) : (
          flags.map((wish) => (
            <FlaggedWishCard
              key={wish.id}
              wish={wish}
              clearFlag={clearFlag}
              removeWish={removeWish}
            />
          ))
        )}
      </div>
      {flags.length > 0 && (
        <div className="admin-bulk-actions">
          <button type="button" className="secondary-button" onClick={clearAllFlags}>
            Clear All Flags
          </button>
        </div>
      )}
    </section>
  );
}
