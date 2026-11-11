/* eslint-disable @typescript-eslint/no-explicit-any -- OpenCV WASM runtime in Web Worker uses dynamic C++ bindings */
import cvPromise from '@techstark/opencv-js';
import {
  detectDocumentContour,
  fallbackTextContour,
  warpCardBuffer,
  type FramePixelBuffer,
  type Point,
} from '../cardProcessor';

export type ScannerWorkerRequest =
  | { type: 'INIT' }
  | {
      type: 'DETECT_CONTOUR';
      id: number;
      buffer: ArrayBuffer;
      pWidth: number;
      pHeight: number;
      processScale: number;
      videoWidth: number;
      videoHeight: number;
    }
  | {
      type: 'WARP_CARD';
      id: number;
      buffer: ArrayBuffer;
      width: number;
      height: number;
      corners: Point[];
      warpW?: number;
      warpH?: number;
    };

export type ScannerWorkerResponse =
  | { type: 'READY' }
  | {
      type: 'CONTOUR_RESULT';
      id: number;
      bestPoly: Point[] | null;
      fallbackPoly: Point[] | null;
      maxArea: number;
    }
  | {
      type: 'WARP_RESULT';
      id: number;
      buffer: ArrayBuffer;
      width: number;
      height: number;
    }
  | {
      type: 'ERROR';
      id?: number;
      message: string;
    };

let cvInstance: any = null;

async function ensureOpenCV(): Promise<any> {
  if (cvInstance) return cvInstance;
  const resolved = await (cvPromise as any);
  cvInstance = resolved.default || resolved;
  return cvInstance;
}

export async function handleScannerWorkerMessage(
  msg: ScannerWorkerRequest,
  postResponse: (res: ScannerWorkerResponse, transfer?: Transferable[]) => void
): Promise<void> {
  try {
    const cv = await ensureOpenCV();

    if (msg.type === 'INIT') {
      postResponse({ type: 'READY' });
      return;
    }

    if (msg.type === 'DETECT_CONTOUR') {
      const pixelBuffer: FramePixelBuffer = {
        width: msg.pWidth,
        height: msg.pHeight,
        data: new Uint8ClampedArray(msg.buffer),
      };

      const {
        src,
        contours,
        hierarchy,
        maxArea,
        bestPoly: detectedPoly,
      } = detectDocumentContour(cv, pixelBuffer, msg.processScale, msg.pWidth, msg.pHeight);

      let fallbackPoly: Point[] | null = null;
      if (!detectedPoly) {
        fallbackPoly = fallbackTextContour(
          cv,
          { width: msg.videoWidth, height: msg.videoHeight },
          contours,
          msg.processScale,
          msg.pWidth,
          msg.pHeight
        );
      }

      src.delete();
      contours.delete();
      hierarchy.delete();

      postResponse({
        type: 'CONTOUR_RESULT',
        id: msg.id,
        bestPoly: detectedPoly,
        fallbackPoly,
        maxArea,
      });
      return;
    }

    if (msg.type === 'WARP_CARD') {
      const pixelBuffer: FramePixelBuffer = {
        width: msg.width,
        height: msg.height,
        data: new Uint8ClampedArray(msg.buffer),
      };

      const warped = warpCardBuffer(
        cv,
        pixelBuffer,
        msg.corners,
        msg.warpW ?? 1000,
        msg.warpH ?? 600
      );

      postResponse(
        {
          type: 'WARP_RESULT',
          id: msg.id,
          buffer: warped.data.buffer as ArrayBuffer,
          width: warped.width,
          height: warped.height,
        },
        [warped.data.buffer as ArrayBuffer]
      );
    }
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    postResponse({
      type: 'ERROR',
      id: 'id' in msg ? msg.id : undefined,
      message,
    });
  }
}

export function resetWorkerCvCacheForTests(): void {
  cvInstance = null;
}

export function attachScannerWorkerListener(target: {
  onmessage: ((event: MessageEvent<ScannerWorkerRequest>) => void) | null;
  postMessage: (message: ScannerWorkerResponse, transfer?: Transferable[]) => void;
  location?: { origin?: string };
}): void {
  target.onmessage = (event: MessageEvent<ScannerWorkerRequest>) => {
    const expectedOrigin = target.location?.origin ?? '';
    if (event.origin !== '' && event.origin !== expectedOrigin) {
      return;
    }
    void handleScannerWorkerMessage(event.data, (res, transfer) => {
      target.postMessage(res, transfer ?? []);
    });
  };
}

// Attach message listener when executing inside a Web Worker scope
if (
  typeof (globalThis as { postMessage?: unknown }).postMessage === 'function' &&
  globalThis.document === undefined
) {
  attachScannerWorkerListener(
    globalThis as unknown as {
      onmessage: ((event: MessageEvent<ScannerWorkerRequest>) => void) | null;
      postMessage: (message: ScannerWorkerResponse, transfer?: Transferable[]) => void;
      location?: { origin?: string };
    }
  );
}
