import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createScannerWorkerClient } from './scannerWorkerClient';
import type { ScannerWorkerRequest, ScannerWorkerResponse } from './scanner.worker';

describe('createScannerWorkerClient', () => {
  let postedMessages: { msg: ScannerWorkerRequest; transfer?: Transferable[] }[];
  let mockWorker: {
    onmessage: ((event: MessageEvent<ScannerWorkerResponse>) => void) | null;
    postMessage: ReturnType<typeof vi.fn>;
    terminate: ReturnType<typeof vi.fn>;
  };

  beforeEach(() => {
    postedMessages = [];
    mockWorker = {
      onmessage: null,
      postMessage: vi.fn((msg: ScannerWorkerRequest, transfer?: Transferable[]) => {
        postedMessages.push({ msg, transfer });
        if (msg.type === 'INIT') {
          queueMicrotask(() => {
            mockWorker.onmessage?.({
              data: { type: 'READY' },
            } as MessageEvent<ScannerWorkerResponse>);
          });
        }
      }),
      terminate: vi.fn(),
    };
  });

  it('initializes worker via INIT -> READY handshake and reports isReady()', async () => {
    const client = createScannerWorkerClient({
      createWorker: () => mockWorker as unknown as Worker,
    });

    expect(client.isReady()).toBe(false);
    await client.init();
    expect(client.isReady()).toBe(true);
    expect(postedMessages).toHaveLength(1);
    expect(postedMessages[0].msg).toEqual({ type: 'INIT' });

    // Calling init() again when already ready is a no-op
    await client.init();
    expect(postedMessages).toHaveLength(1);
  });

  it('dispatches DETECT_CONTOUR with transferable buffer and throttles overlapping frames via isBusy()', async () => {
    const client = createScannerWorkerClient({
      createWorker: () => mockWorker as unknown as Worker,
    });
    await client.init();

    const fakeVideo = globalThis.document.createElement('canvas');
    fakeVideo.width = 400;
    fakeVideo.height = 300;

    // Start first frame detection (does not resolve until worker replies)
    const firstPromise = client.detectFrame(fakeVideo, 0.5, 200, 150, 400, 300);
    expect(client.isBusy()).toBe(true);

    // While first frame is in flight, a second frame call is dropped immediately (returns null)
    const droppedResult = await client.detectFrame(fakeVideo, 0.5, 200, 150, 400, 300);
    expect(droppedResult).toBeNull();

    const contourReq = postedMessages[1].msg;
    expect(contourReq.type).toBe('DETECT_CONTOUR');
    if (contourReq.type === 'DETECT_CONTOUR') {
      mockWorker.onmessage?.({
        data: {
          type: 'CONTOUR_RESULT',
          id: contourReq.id,
          bestPoly: [
            { x: 1, y: 2 },
            { x: 3, y: 2 },
            { x: 3, y: 4 },
            { x: 1, y: 4 },
          ],
          fallbackPoly: null,
          maxArea: 12345,
        },
      } as MessageEvent<ScannerWorkerResponse>);
    }

    const resolved = await firstPromise;
    expect(client.isBusy()).toBe(false);
    expect(resolved).toEqual({
      bestPoly: [
        { x: 1, y: 2 },
        { x: 3, y: 2 },
        { x: 3, y: 4 },
        { x: 1, y: 4 },
      ],
      fallbackPoly: null,
      maxArea: 12345,
    });
  });

  it('rejects pending detectFrame promise and clears busy state when worker emits ERROR', async () => {
    const client = createScannerWorkerClient({
      createWorker: () => mockWorker as unknown as Worker,
    });
    await client.init();

    const fakeVideo = globalThis.document.createElement('canvas');
    const pendingPromise = client.detectFrame(fakeVideo, 0.5, 100, 100, 200, 200);

    const contourReq = postedMessages[1].msg;
    if (contourReq.type === 'DETECT_CONTOUR') {
      mockWorker.onmessage?.({
        data: {
          type: 'ERROR',
          id: contourReq.id,
          message: 'Worker contour failure',
        },
      } as MessageEvent<ScannerWorkerResponse>);
    }

    await expect(pendingPromise).rejects.toThrow('Worker contour failure');
    expect(client.isBusy()).toBe(false);
  });

  it('terminates worker and resets ready/busy flags', async () => {
    const client = createScannerWorkerClient({
      createWorker: () => mockWorker as unknown as Worker,
    });
    await client.init();
    expect(client.isReady()).toBe(true);

    client.terminate();
    expect(mockWorker.terminate).toHaveBeenCalledTimes(1);
    expect(client.isReady()).toBe(false);
    expect(client.isBusy()).toBe(false);
  });
});
