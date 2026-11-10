import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  handleScannerWorkerMessage,
  resetWorkerCvCacheForTests,
  type ScannerWorkerResponse,
} from './scanner.worker';
import * as cardProcessor from '../cardProcessor';

vi.mock('@techstark/opencv-js', () => ({
  default: Promise.resolve({
    Mat: class {
      delete = vi.fn();
    },
    MatVector: class {
      delete = vi.fn();
    },
  }),
}));

vi.mock('../cardProcessor', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../cardProcessor')>();
  return {
    ...actual,
    detectDocumentContour: vi.fn(),
    fallbackTextContour: vi.fn(),
    warpCardBuffer: vi.fn(),
  };
});

describe('scanner.worker message handler', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetWorkerCvCacheForTests();
  });

  it('responds with READY when receiving INIT', async () => {
    const postResponse = vi.fn<(res: ScannerWorkerResponse, transfer?: Transferable[]) => void>();
    await handleScannerWorkerMessage({ type: 'INIT' }, postResponse);
    expect(postResponse).toHaveBeenCalledWith({ type: 'READY' });
  });

  it('handles DETECT_CONTOUR when detectDocumentContour finds a primary polygon', async () => {
    const srcDelete = vi.fn();
    const contoursDelete = vi.fn();
    const hierarchyDelete = vi.fn();
    const bestPoly = [
      { x: 10, y: 10 },
      { x: 110, y: 10 },
      { x: 110, y: 70 },
      { x: 10, y: 70 },
    ];

    vi.mocked(cardProcessor.detectDocumentContour).mockReturnValue({
      src: { delete: srcDelete },
      contours: { delete: contoursDelete },
      hierarchy: { delete: hierarchyDelete },
      maxArea: 42000,
      bestPoly,
    });

    const postResponse = vi.fn();
    const buffer = new Uint8ClampedArray(40 * 30 * 4).buffer;

    await handleScannerWorkerMessage(
      {
        type: 'DETECT_CONTOUR',
        id: 7,
        buffer,
        pWidth: 40,
        pHeight: 30,
        processScale: 0.5,
        videoWidth: 80,
        videoHeight: 60,
      },
      postResponse
    );

    expect(cardProcessor.detectDocumentContour).toHaveBeenCalledTimes(1);
    expect(cardProcessor.fallbackTextContour).not.toHaveBeenCalled();
    expect(srcDelete).toHaveBeenCalledTimes(1);
    expect(contoursDelete).toHaveBeenCalledTimes(1);
    expect(hierarchyDelete).toHaveBeenCalledTimes(1);
    expect(postResponse).toHaveBeenCalledWith({
      type: 'CONTOUR_RESULT',
      id: 7,
      bestPoly,
      fallbackPoly: null,
      maxArea: 42000,
    });
  });

  it('invokes fallbackTextContour when detectDocumentContour returns null bestPoly', async () => {
    const fallbackPoly = [
      { x: 5, y: 5 },
      { x: 95, y: 5 },
      { x: 95, y: 55 },
      { x: 5, y: 55 },
    ];

    vi.mocked(cardProcessor.detectDocumentContour).mockReturnValue({
      src: { delete: vi.fn() },
      contours: { delete: vi.fn() },
      hierarchy: { delete: vi.fn() },
      maxArea: 0,
      bestPoly: null,
    });
    vi.mocked(cardProcessor.fallbackTextContour).mockReturnValue(fallbackPoly);

    const postResponse = vi.fn();
    await handleScannerWorkerMessage(
      {
        type: 'DETECT_CONTOUR',
        id: 8,
        buffer: new Uint8ClampedArray(16).buffer,
        pWidth: 2,
        pHeight: 2,
        processScale: 1,
        videoWidth: 2,
        videoHeight: 2,
      },
      postResponse
    );

    expect(cardProcessor.fallbackTextContour).toHaveBeenCalledTimes(1);
    expect(postResponse).toHaveBeenCalledWith({
      type: 'CONTOUR_RESULT',
      id: 8,
      bestPoly: null,
      fallbackPoly,
      maxArea: 0,
    });
  });

  it('handles WARP_CARD and transfers the warped buffer back', async () => {
    const warpedData = new Uint8ClampedArray(10 * 6 * 4);
    vi.mocked(cardProcessor.warpCardBuffer).mockReturnValue({
      width: 10,
      height: 6,
      data: warpedData,
    });

    const postResponse = vi.fn();
    await handleScannerWorkerMessage(
      {
        type: 'WARP_CARD',
        id: 12,
        buffer: new Uint8ClampedArray(20 * 12 * 4).buffer,
        width: 20,
        height: 12,
        corners: [
          { x: 0, y: 0 },
          { x: 20, y: 0 },
          { x: 20, y: 12 },
          { x: 0, y: 12 },
        ],
        warpW: 10,
        warpH: 6,
      },
      postResponse
    );

    expect(cardProcessor.warpCardBuffer).toHaveBeenCalledTimes(1);
    expect(postResponse).toHaveBeenCalledWith(
      {
        type: 'WARP_RESULT',
        id: 12,
        buffer: warpedData.buffer,
        width: 10,
        height: 6,
      },
      [warpedData.buffer]
    );
  });

  it('posts ERROR response with request id when processing throws', async () => {
    vi.mocked(cardProcessor.detectDocumentContour).mockImplementation(() => {
      throw new Error('WASM out of bounds');
    });

    const postResponse = vi.fn();
    await handleScannerWorkerMessage(
      {
        type: 'DETECT_CONTOUR',
        id: 99,
        buffer: new ArrayBuffer(16),
        pWidth: 2,
        pHeight: 2,
        processScale: 1,
        videoWidth: 2,
        videoHeight: 2,
      },
      postResponse
    );

    expect(postResponse).toHaveBeenCalledWith({
      type: 'ERROR',
      id: 99,
      message: 'WASM out of bounds',
    });
  });
});
