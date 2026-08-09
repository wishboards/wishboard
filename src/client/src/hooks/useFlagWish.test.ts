import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import useFlagWish from './useFlagWish';

describe('useFlagWish', () => {
  let confirmSpy: any;
  let alertSpy: any;
  let fetchSpy: any;
  let onSuccessMock: any;

  beforeEach(() => {
    confirmSpy = vi.spyOn(globalThis.window, 'confirm').mockImplementation(() => true);
    alertSpy = vi.spyOn(globalThis.window, 'alert').mockImplementation(() => {});
    fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue({ ok: true } as any);
    onSuccessMock = vi.fn();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('aborts if user cancels confirmation', async () => {
    confirmSpy.mockReturnValue(false);
    const flagWish = useFlagWish(onSuccessMock);
    await flagWish('wish-123');

    expect(confirmSpy).toHaveBeenCalledWith('Are you sure you want to flag this wish as inappropriate?');
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(onSuccessMock).not.toHaveBeenCalled();
  });

  it('calls fetch and onSuccess when confirmed and successful', async () => {
    const flagWish = useFlagWish(onSuccessMock);
    await flagWish('wish-456');

    expect(confirmSpy).toHaveBeenCalled();
    expect(fetchSpy).toHaveBeenCalledWith('/api/wishes/wish-456/flag', { method: 'POST' });
    expect(onSuccessMock).toHaveBeenCalledWith('wish-456');
  });

  it('alerts error if response is not ok', async () => {
    fetchSpy.mockResolvedValue({ ok: false } as any);

    const flagWish = useFlagWish(onSuccessMock);
    await flagWish('wish-789');

    expect(fetchSpy).toHaveBeenCalled();
    expect(onSuccessMock).not.toHaveBeenCalled();
    expect(alertSpy).toHaveBeenCalledWith('Failed to flag the wish.');
  });

  it('alerts error if fetch throws', async () => {
    fetchSpy.mockRejectedValue(new Error('Network error'));

    const flagWish = useFlagWish(onSuccessMock);
    await flagWish('wish-999');

    expect(fetchSpy).toHaveBeenCalled();
    expect(onSuccessMock).not.toHaveBeenCalled();
    expect(alertSpy).toHaveBeenCalledWith('Network error');
  });
});
