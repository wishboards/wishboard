/* eslint-disable @typescript-eslint/no-explicit-any -- OpenCV fallback in JSDOM/Vitest uses dynamic C++ bindings */
import cvPromise from '@techstark/opencv-js';
import {
  createProcessingCanvas,
  detectDocumentContour,
  fallbackTextContour,
  type Point,
  type ProcessableElement,
} from '../cardProcessor';
import type { ScannerWorkerRequest, ScannerWorkerResponse } from './scanner.worker';

export interface ContourDetectionResult {
  bestPoly: Point[] | null;
  fallbackPoly: Point[] | null;
  maxArea: number;
}

export interface ScannerWorkerClient {
  init(): Promise<void>;
  isReady(): boolean;
  isBusy(): boolean;
  detectFrame(
    video: ProcessableElement,
    processScale: number,
    pWidth: number,
    pHeight: number,
    videoWidth: number,
    videoHeight: number
  ): Promise<ContourDetectionResult | null>;
  terminate(): void;
}

export interface ScannerWorkerClientOptions {
  createWorker?: () => Worker | null;
}

function defaultCreateWorker(): Worker | null {
  if (typeof globalThis.Worker !== 'function') {
    return null;
  }
  // When cardProcessor is mocked in unit tests (e.g. WishScanner.test.tsx), prefer in-process fallback
  if (typeof (detectDocumentContour as { mock?: unknown }).mock === 'object') {
    return null;
  }
  try {
    return new Worker(new URL('./scanner.worker.ts', import.meta.url), {
      type: 'module',
    });
  } catch {
    return null;
  }
}

export function createScannerWorkerClient(
  options: ScannerWorkerClientOptions = {}
): ScannerWorkerClient {
  const workerFactory = options.createWorker ?? defaultCreateWorker;
  let worker: Worker | null = null;
  let fallbackCv: any = null;
  let ready = false;
  let busy = false;
  let nextRequestId = 1;
  let frameCanvas: OffscreenCanvas | HTMLCanvasElement | null = null;

  const pendingContours = new Map<
    number,
    {
      resolve: (res: ContourDetectionResult) => void;
      reject: (err: Error) => void;
    }
  >();

  let readyResolve: (() => void) | null = null;

  const handleWorkerMessage = (event: MessageEvent<ScannerWorkerResponse>) => {
    const msg = event.data;
    if (!msg) return;

    if (msg.type === 'READY') {
      ready = true;
      readyResolve?.();
      readyResolve = null;
      return;
    }

    if (msg.type === 'CONTOUR_RESULT') {
      busy = false;
      const pending = pendingContours.get(msg.id);
      if (pending) {
        pendingContours.delete(msg.id);
        pending.resolve({
          bestPoly: msg.bestPoly,
          fallbackPoly: msg.fallbackPoly,
          maxArea: msg.maxArea,
        });
      }
      return;
    }

    if (msg.type === 'ERROR') {
      busy = false;
      if (msg.id !== undefined) {
        const pending = pendingContours.get(msg.id);
        if (pending) {
          pendingContours.delete(msg.id);
          pending.reject(new Error(msg.message));
        }
      }
    }
  };

  const init = async (): Promise<void> => {
    if (ready) return;
    worker = workerFactory();
    if (worker) {
      worker.onmessage = handleWorkerMessage;
      await new Promise<void>((resolve) => {
        readyResolve = resolve;
        const req: ScannerWorkerRequest = { type: 'INIT' };
        worker!.postMessage(req);
      });
      return;
    }

    // Fallback when Worker is unavailable (JSDOM / unit tests)
    const resolved = await (cvPromise as any);
    fallbackCv = resolved.default || resolved;
    ready = true;
  };

  const detectFrame = async (
    video: ProcessableElement,
    processScale: number,
    pWidth: number,
    pHeight: number,
    videoWidth: number,
    videoHeight: number
  ): Promise<ContourDetectionResult | null> => {
    if (!ready || busy) {
      return null;
    }
    busy = true;

    try {
      if (worker) {
        if (!frameCanvas || frameCanvas.width !== pWidth || frameCanvas.height !== pHeight) {
          frameCanvas = createProcessingCanvas(pWidth, pHeight);
        }
        const ctx = frameCanvas.getContext('2d', {
          willReadFrequently: true,
        }) as CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D | null;
        ctx?.drawImage(video, 0, 0, pWidth, pHeight);
        const imageData = ctx?.getImageData?.(0, 0, pWidth, pHeight);
        const rawBuffer = imageData?.data?.buffer
          ? (imageData.data.buffer as ArrayBuffer)
          : new Uint8ClampedArray(pWidth * pHeight * 4).buffer;

        const id = nextRequestId++;
        return await new Promise<ContourDetectionResult>((resolve, reject) => {
          pendingContours.set(id, { resolve, reject });
          const req: ScannerWorkerRequest = {
            type: 'DETECT_CONTOUR',
            id,
            buffer: rawBuffer,
            pWidth,
            pHeight,
            processScale,
            videoWidth,
            videoHeight,
          };
          worker!.postMessage(req, [rawBuffer]);
        });
      }

      // Synchronous/in-process fallback for JSDOM unit tests
      const {
        src,
        contours,
        hierarchy,
        maxArea,
        bestPoly: detectedPoly,
      } = detectDocumentContour(fallbackCv, video, processScale, pWidth, pHeight);

      let fallbackPoly: Point[] | null = null;
      if (!detectedPoly) {
        fallbackPoly = fallbackTextContour(
          fallbackCv,
          video,
          contours,
          processScale,
          pWidth,
          pHeight
        );
      }

      src.delete();
      contours.delete();
      hierarchy.delete();

      busy = false;
      return {
        bestPoly: detectedPoly,
        fallbackPoly,
        maxArea,
      };
    } catch (err) {
      busy = false;
      throw err;
    }
  };

  const terminate = () => {
    if (worker) {
      worker.terminate();
      worker = null;
    }
    pendingContours.clear();
    busy = false;
    ready = false;
  };

  return {
    init,
    isReady: () => ready,
    isBusy: () => busy,
    detectFrame,
    terminate,
  };
}
