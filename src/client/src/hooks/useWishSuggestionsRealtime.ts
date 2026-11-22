import { useEffect } from 'react';
import { apiClient, bearerHeader } from '../api/client';
import { useWebSocket } from './useWebSocket';

export async function fetchPendingSuggestionsCount(
  wishId: string,
  { secret, token }: { secret?: string; token?: string | null }
): Promise<number | null> {
  try {
    const queryParams: { secret?: string } = {};
    if (secret) {
      queryParams.secret = secret;
    }
    const { data, response } = await apiClient.GET('/api/wishes/{id}/suggestions', {
      params: { path: { id: wishId }, query: queryParams },
      headers: bearerHeader(token),
    });
    if (response.ok && Array.isArray(data)) {
      return data.filter((s) => s.status === 'pending').length;
    }
  } catch {
    // Ignore transient network errors
  }
  return null;
}

export interface UseWishSuggestionsRealtimeOptions {
  wishId?: string | null;
  secret?: string;
  token?: string | null;
  aiEnabled?: boolean;
  onPendingCountChange: (updater: number | ((prev: number) => number)) => void;
  onCheckingDone?: () => void;
}

export function useWishSuggestionsRealtime({
  wishId,
  secret,
  token,
  aiEnabled = false,
  onPendingCountChange,
  onCheckingDone,
}: UseWishSuggestionsRealtimeOptions): void {
  const { socket } = useWebSocket();

  useEffect(() => {
    if (!wishId) return;
    const channel = `wish:suggestions:${wishId}`;
    let active = true;

    const handleSuggestionsReady = (payload?: { wish_id?: string }) => {
      if (payload?.wish_id === wishId) {
        onPendingCountChange((prev) => Math.max(prev, 1));
        onCheckingDone?.();
        void fetchPendingSuggestionsCount(wishId, { secret, token }).then((count) => {
          if (active && count !== null) {
            onPendingCountChange(count);
          }
        });
      }
    };

    socket.on('wish:ai_suggestions_ready', handleSuggestionsReady);
    socket.emit('subscribe', {
      channel,
      token: token || undefined,
      secret: secret || undefined,
    });

    let t1: ReturnType<typeof globalThis.setTimeout> | undefined;
    let t2: ReturnType<typeof globalThis.setTimeout> | undefined;
    let t3: ReturnType<typeof globalThis.setTimeout> | undefined;
    let doneTimer: ReturnType<typeof globalThis.setTimeout> | undefined;

    if (aiEnabled) {
      const checkNow = () => {
        void fetchPendingSuggestionsCount(wishId, { secret, token }).then((count) => {
          if (active && count !== null) {
            onPendingCountChange(count);
            if (count > 0) {
              onCheckingDone?.();
            }
          }
        });
      };
      t1 = globalThis.setTimeout(checkNow, 350);
      t2 = globalThis.setTimeout(checkNow, 2500);
      t3 = globalThis.setTimeout(checkNow, 6000);
      doneTimer = globalThis.setTimeout(() => {
        if (active) onCheckingDone?.();
      }, 8000);
    }

    return () => {
      active = false;
      clearTimeout(t1);
      clearTimeout(t2);
      clearTimeout(t3);
      clearTimeout(doneTimer);
      socket.off('wish:ai_suggestions_ready', handleSuggestionsReady);
      socket.emit('unsubscribe', { channel });
    };
  }, [wishId, secret, token, aiEnabled, socket, onPendingCountChange, onCheckingDone]);
}
