import { useCallback } from 'react';

export default function useFlagWish(onSuccess: (id: string) => void) {
  return useCallback(
    async (id: string) => {
      if (!globalThis.window.confirm('Are you sure you want to flag this wish as inappropriate?')) {
        return;
      }
      try {
        const response = await fetch(`/api/wishes/${encodeURIComponent(id)}/flag`, {
          method: 'POST',
        });
        if (!response.ok) {
          throw new Error('Failed to flag the wish.');
        }
        onSuccess(id);
      } catch (err) {
        globalThis.window.alert((err as Error).message);
      }
    },
    [onSuccess]
  );
}
