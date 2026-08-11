import React, { useRef, useState, useEffect } from 'react';
import cvPromise from '@techstark/opencv-js';
import {
  Point,
  calculateDrawDimensions,
  detectDocumentContour,
  fallbackTextContour,
  getDefaultPoly,
  applyTemporalSmoothing,
  processCardImage,
} from '../cardProcessor';

interface WishScannerProps {
  onCapture: (content: string, imageBlob: Blob) => void;
  onCancel: () => void;
  stickerZoneHeightPercentage?: number;
}

interface DrawConfig {
  x: number;
  y: number;
  w: number;
  h: number;
}

function renderOverlay(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- OpenCV WASM instance for perspective transform matrices
  cv: any,
  ctx: CanvasRenderingContext2D,
  canvas: HTMLCanvasElement,
  video: HTMLVideoElement,
  pts: Point[],
  draw: DrawConfig,
  stickerZoneHeightPercentage: number
) {
  const mapPt = (p: Point) => ({
    x: draw.x + (p.x / video.videoWidth) * draw.w,
    y: draw.y + (p.y / video.videoHeight) * draw.h,
  });

  const p0 = mapPt(pts[0]);
  const p1 = mapPt(pts[1]);
  const p2 = mapPt(pts[2]);
  const p3 = mapPt(pts[3]);

  drawDocumentOutline(ctx, canvas, p0, p1, p2, p3);
  drawStickerZone(cv, ctx, p0, p1, p2, p3, stickerZoneHeightPercentage);
}

function drawDocumentOutline(
  ctx: CanvasRenderingContext2D,
  canvas: HTMLCanvasElement,
  p0: Point,
  p1: Point,
  p2: Point,
  p3: Point
) {
  ctx.fillStyle = 'rgba(0,0,0,0.5)';
  ctx.beginPath();
  ctx.rect(0, 0, canvas.width, canvas.height);
  ctx.moveTo(p0.x, p0.y);
  ctx.lineTo(p3.x, p3.y);
  ctx.lineTo(p2.x, p2.y);
  ctx.lineTo(p1.x, p1.y);
  ctx.closePath();
  ctx.fill('evenodd');

  ctx.strokeStyle = '#1a73e8';
  ctx.lineWidth = 3;
  ctx.setLineDash([]);
  ctx.beginPath();
  ctx.moveTo(p0.x, p0.y);
  ctx.lineTo(p1.x, p1.y);
  ctx.lineTo(p2.x, p2.y);
  ctx.lineTo(p3.x, p3.y);
  ctx.closePath();
  ctx.stroke();
}

function drawStickerZone(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- OpenCV WASM instance for perspective transform matrices
  cv: any,
  ctx: CanvasRenderingContext2D,
  p0: Point,
  p1: Point,
  p2: Point,
  p3: Point,
  stickerZoneHeightPercentage: number
) {
  const srcTri = cv.matFromArray(4, 1, cv.CV_32FC2, [0, 0, 1000, 0, 1000, 600, 0, 600]);
  const dstTri = cv.matFromArray(4, 1, cv.CV_32FC2, [
    p0.x,
    p0.y,
    p1.x,
    p1.y,
    p2.x,
    p2.y,
    p3.x,
    p3.y,
  ]);
  const transform = cv.getPerspectiveTransform(srcTri, dstTri);

  const pad = 20;
  const szW = 1000 * (stickerZoneHeightPercentage / 100);
  const szH = 600 * 0.15;
  const szX1 = 1000 - szW - pad;
  const szY1 = 600 - szH - pad;
  const szX2 = 1000 - pad;
  const szY2 = 600 - pad;

  const zonePtsMat = cv.matFromArray(4, 1, cv.CV_32FC2, [
    szX1,
    szY1,
    szX2,
    szY1,
    szX2,
    szY2,
    szX1,
    szY2,
  ]);
  const outPtsMat = new cv.Mat();
  cv.perspectiveTransform(zonePtsMat, outPtsMat, transform);

  const zp0 = { x: outPtsMat.data32F[0], y: outPtsMat.data32F[1] };
  const zp1 = { x: outPtsMat.data32F[2], y: outPtsMat.data32F[3] };
  const zp2 = { x: outPtsMat.data32F[4], y: outPtsMat.data32F[5] };
  const zp3 = { x: outPtsMat.data32F[6], y: outPtsMat.data32F[7] };

  ctx.strokeStyle = 'rgba(255, 255, 255, 0.8)';
  ctx.lineWidth = 2;
  ctx.setLineDash([4, 4]);
  ctx.beginPath();
  ctx.moveTo(zp0.x, zp0.y);
  ctx.lineTo(zp1.x, zp1.y);
  ctx.lineTo(zp2.x, zp2.y);
  ctx.lineTo(zp3.x, zp3.y);
  ctx.closePath();
  ctx.stroke();

  ctx.fillStyle = 'rgba(255, 255, 255, 0.8)';
  ctx.font = '14px sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';

  const zcx = (zp0.x + zp1.x + zp2.x + zp3.x) / 4;
  const zcy = (zp0.y + zp1.y + zp2.y + zp3.y) / 4;
  const angle = Math.atan2(zp1.y - zp0.y, zp1.x - zp0.x);

  ctx.save();
  ctx.translate(zcx, zcy);
  ctx.rotate(angle);
  ctx.fillText('Stickers go here', 0, 0);
  ctx.restore();

  srcTri.delete();
  dstTri.delete();
  transform.delete();
  zonePtsMat.delete();
  outPtsMat.delete();
}

async function getCameraStream(): Promise<MediaStream> {
  if (!navigator.mediaDevices?.getUserMedia) {
    throw new Error('Camera API not available. Make sure you are using HTTPS or localhost.');
  }
  return navigator.mediaDevices.getUserMedia({
    video: { facingMode: 'environment', width: { ideal: 1920 }, height: { ideal: 1080 } },
  });
}

function handleCameraError(
  err: unknown,
  setIsProcessing: (val: boolean) => void,
  setProcessingStatus: (msg: string) => void
) {
  console.error('Error accessing camera', err);
  setIsProcessing(true);
  const message = err instanceof Error ? err.message : 'Permissions denied or insecure context';
  setProcessingStatus(`Camera Error: ${message}`);
}

export default function WishScanner({
  onCapture,
  onCancel,
  stickerZoneHeightPercentage = 30,
}: Readonly<WishScannerProps>) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [processingStatus, setProcessingStatus] = useState<string>('');

  const smoothedCornersRef = useRef<{ x: number; y: number }[] | null>(null);
  const animationFrameRef = useRef<number | null>(null);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- OpenCV.js Emscripten C++ WASM module instance
  const cvRef = useRef<any>(null);
  const [cvReady, setCvReady] = useState(false);

  useEffect(() => {
    let active = true;
    async function loadOpenCV() {
      try {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any -- cvPromise resolves dynamically-bound C++ Emscripten WASM module
        const resolved = await (cvPromise as any);
        if (active) {
          cvRef.current = resolved.default || resolved;
          setCvReady(true);
        }
      } catch (err) {
        console.error('Error loading OpenCV', err);
      }
    }
    loadOpenCV();
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    let activeStream: MediaStream | null = null;
    async function setupCamera() {
      try {
        const mediaStream = await getCameraStream();
        activeStream = mediaStream;
        setStream(mediaStream);
        if (videoRef.current) {
          videoRef.current.srcObject = mediaStream;
        }
      } catch (err: unknown) {
        handleCameraError(err, setIsProcessing, setProcessingStatus);
      }
    }
    setupCamera();

    return () => {
      if (activeStream) {
        activeStream.getTracks().forEach((track) => track.stop());
      }
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
      }
    };
  }, []);

  const drawOverlay = () => {
    if (!videoRef.current || !canvasRef.current || isProcessing) return;
    const cv = cvRef.current;
    if (!cv) {
      animationFrameRef.current = requestAnimationFrame(drawOverlay);
      return;
    }
    const video = videoRef.current;
    const canvas = canvasRef.current;

    if (video.videoWidth === 0) {
      animationFrameRef.current = requestAnimationFrame(drawOverlay);
      return;
    }

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const { drawW, drawH, drawX, drawY } = calculateDrawDimensions(video, canvas);
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    const debugLines: string[] = [
      `Video: ${video.videoWidth}x${video.videoHeight}`,
      `Canvas: ${canvas.width}x${canvas.height}`,
    ];

    try {
      const processScale = 400 / video.videoWidth;
      const pWidth = 400;
      const pHeight = Math.floor(video.videoHeight * processScale);

      const {
        src,
        contours,
        hierarchy,
        maxArea,
        bestPoly: detectedPoly,
      } = detectDocumentContour(cv, video, processScale, pWidth, pHeight);
      let bestPoly = detectedPoly;

      if (bestPoly) {
        debugLines.push(`State: Tracked (${Math.floor(maxArea)}px)`);
      } else {
        bestPoly = fallbackTextContour(cv, video, contours, processScale, pWidth, pHeight);
        if (bestPoly) {
          debugLines.push('State: Center Crop Fallback');
        }
      }

      src.delete();
      contours.delete();
      hierarchy.delete();

      bestPoly ??= getDefaultPoly(video);

      smoothedCornersRef.current = applyTemporalSmoothing(
        bestPoly,
        smoothedCornersRef.current,
        debugLines
      );

      renderOverlay(
        cv,
        ctx,
        canvas,
        video,
        smoothedCornersRef.current,
        { x: drawX, y: drawY, w: drawW, h: drawH },
        stickerZoneHeightPercentage
      );
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      debugLines.push(`Error: ${msg}`);
      console.warn('Live OpenCV processing error', err);
    }

    // Render Debug Text
    ctx.fillStyle = 'rgba(0, 0, 0, 0.5)';
    ctx.fillRect(0, 0, 250, debugLines.length * 16 + 10);
    ctx.fillStyle = 'lime';
    ctx.font = '12px monospace';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    debugLines.forEach((line, idx) => {
      ctx.fillText(line, 10, 5 + idx * 16);
    });

    animationFrameRef.current = requestAnimationFrame(drawOverlay);
  };

  const processImage = async () => {
    if (
      !videoRef.current ||
      !smoothedCornersRef.current ||
      smoothedCornersRef.current.some((p) => Number.isNaN(p.x))
    )
      return;
    setIsProcessing(true);
    setProcessingStatus('Reading text (this may take a few moments)...');

    if (animationFrameRef.current) cancelAnimationFrame(animationFrameRef.current);
    const video = videoRef.current;

    try {
      const canvas = document.createElement('canvas');
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      canvas.getContext('2d')?.drawImage(video, 0, 0);

      if (stream) stream.getTracks().forEach((t) => t.stop());

      const img = new Image();
      img.src = canvas.toDataURL('image/jpeg');
      await new Promise((r) => {
        img.onload = r;
      });

      const { blob, text } = await processCardImage(img);

      onCapture(text, blob);
    } catch (err) {
      console.error(err);
      setProcessingStatus('Error processing image');
      setIsProcessing(false);
    }
  };

  return (
    <div
      className="wish-scanner"
      style={{
        position: 'relative',
        width: '100%',
        maxWidth: '800px',
        margin: '0 auto',
        background: '#000',
        borderRadius: '12px',
        overflow: 'hidden',
        aspectRatio: '16/9',
      }}
    >
      <video
        ref={videoRef}
        autoPlay
        playsInline
        muted
        onPlay={drawOverlay}
        style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
      />
      <canvas
        ref={canvasRef}
        style={{
          position: 'absolute',
          top: 0,
          left: 0,
          width: '100%',
          height: '100%',
          display: 'block',
          pointerEvents: 'none',
        }}
      />

      {isProcessing ? (
        <div
          style={{
            position: 'absolute',
            inset: 0,
            background: 'rgba(0,0,0,0.7)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: 'white',
            flexFlow: 'column',
            zIndex: 10,
          }}
        >
          <div className="spinner" style={{ marginBottom: '16px' }}></div>
          <p>{processingStatus}</p>
        </div>
      ) : (
        <div
          style={{
            position: 'absolute',
            bottom: '20px',
            left: 0,
            right: 0,
            display: 'flex',
            justifyContent: 'center',
            gap: '16px',
            zIndex: 10,
          }}
        >
          <button
            type="button"
            onClick={onCancel}
            style={{
              background: 'rgba(255,255,255,0.2)',
              color: 'white',
              border: 'none',
              padding: '12px 24px',
              borderRadius: '24px',
              cursor: 'pointer',
            }}
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={processImage}
            disabled={!cvReady}
            style={{
              background: cvReady ? 'white' : 'rgba(255,255,255,0.4)',
              color: 'black',
              border: 'none',
              padding: '12px 32px',
              borderRadius: '24px',
              fontWeight: 'bold',
              cursor: cvReady ? 'pointer' : 'not-allowed',
            }}
          >
            {cvReady ? 'Take Photo' : 'Loading Scanner...'}
          </button>
        </div>
      )}
    </div>
  );
}
