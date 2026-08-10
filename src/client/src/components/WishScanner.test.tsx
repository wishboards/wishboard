import { delay } from '../utils/testUtils';
import { describe, expect, it, vi, beforeEach, afterEach, afterAll } from 'vitest';
import { render, screen, fireEvent, act, waitFor } from '@testing-library/react';
import WishScanner from './WishScanner';
import * as cardProcessor from '../cardProcessor';

vi.mock('@techstark/opencv-js', () => ({
  default: Promise.resolve({
    COLOR_RGBA2GRAY: 1,
    BORDER_DEFAULT: 2,
    RETR_LIST: 3,
    CHAIN_APPROX_SIMPLE: 4,
    CV_32FC2: 5,
    INTER_LINEAR: 6,
    BORDER_CONSTANT: 7,
    MatVector: class {
      size() {
        return 0;
      }
      get() {
        return {};
      }
      delete() {}
    },
    Mat: class {
      data32F = new Float32Array(8);
      data32S = new Int32Array(8);
      rows = 0;
      cols = 0;
      delete() {}
    },
    Size: class {},
    Scalar: class {},
    imread: vi.fn(),
    cvtColor: vi.fn(),
    GaussianBlur: vi.fn(),
    Canny: vi.fn(),
    findContours: vi.fn(),
    contourArea: vi.fn(),
    approxPolyDP: vi.fn(),
    arcLength: vi.fn(),
    boundingRect: vi.fn(),
    matFromArray: vi.fn().mockReturnValue({ delete: vi.fn() }),
    getPerspectiveTransform: vi.fn().mockReturnValue({ delete: vi.fn() }),
    perspectiveTransform: vi.fn((src, dst, _transform) => {
      dst.data32F = new Float32Array([0, 0, 100, 0, 100, 100, 0, 100]);
    }),
    warpPerspective: vi.fn(),
    imshow: vi.fn(),
  }),
}));

vi.mock('tesseract.js', () => ({
  default: {
    recognize: vi.fn().mockResolvedValue({ data: { text: 'Mocked OCR Text' } }),
  },
}));

vi.mock('../cardProcessor', () => ({
  calculateDrawDimensions: vi.fn(),
  detectDocumentContour: vi.fn(),
  fallbackTextContour: vi.fn(),
  getDefaultPoly: vi.fn(),
  applyTemporalSmoothing: vi.fn(),
  processCardImage: vi.fn(),
  Point: undefined,
}));

const originalMediaDevices = globalThis.navigator.mediaDevices;

Object.defineProperty(globalThis.navigator, 'mediaDevices', {
  value: {
    getUserMedia: vi.fn().mockResolvedValue({
      getTracks: () => [{ stop: vi.fn() }],
    }),
  },
  writable: true,
  configurable: true,
});

describe('WishScanner', () => {
  let mockCtx: any;

  beforeEach(() => {
    vi.clearAllMocks();

    const timers = new Map<number, NodeJS.Timeout>();
    let nextId = 1;

    vi.spyOn(globalThis, 'requestAnimationFrame').mockImplementation((cb: FrameRequestCallback) => {
      const id = nextId++;
      timers.set(
        id,
        setTimeout(() => cb(0), 16)
      );
      return id;
    });
    vi.spyOn(globalThis, 'cancelAnimationFrame').mockImplementation((id: number) => {
      const timer = timers.get(id);
      if (timer) {
        clearTimeout(timer);
        timers.delete(id);
      }
    });

    mockCtx = {
      clearRect: vi.fn(),
      set fillStyle(val: string) {
        this._fillStyle = val;
        this.fillStyles.push(val);
      },
      get fillStyle() {
        return this._fillStyle;
      },
      set strokeStyle(val: string) {
        this._strokeStyle = val;
        this.strokeStyles.push(val);
      },
      get strokeStyle() {
        return this._strokeStyle;
      },
      _fillStyle: '',
      _strokeStyle: '',
      fillStyles: [],
      strokeStyles: [],
      fillRect: vi.fn(),
      font: '',
      textAlign: '',
      textBaseline: '',
      fillText: vi.fn(),
      beginPath: vi.fn(),
      rect: vi.fn(),
      moveTo: vi.fn(),
      lineTo: vi.fn(),
      closePath: vi.fn(),
      fill: vi.fn(),
      lineWidth: 0,
      setLineDash: vi.fn(),
      stroke: vi.fn(),
      save: vi.fn(),
      translate: vi.fn(),
      rotate: vi.fn(),
      restore: vi.fn(),
      drawImage: vi.fn(),
    };

    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(mockCtx as any);
    vi.spyOn(HTMLCanvasElement.prototype, 'toDataURL').mockReturnValue(
      'data:image/jpeg;base64,mock'
    );
    vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation(function (
      this: any,
      cb: any
    ) {
      cb(new Blob(['test']));
    });

    vi.mocked(cardProcessor.calculateDrawDimensions).mockReturnValue({
      drawW: 800,
      drawH: 600,
      drawX: 0,
      drawY: 0,
    });
    vi.mocked(cardProcessor.detectDocumentContour).mockReturnValue({
      src: { delete: vi.fn() },
      contours: { delete: vi.fn() },
      hierarchy: { delete: vi.fn() },
      maxArea: 1000,
      bestPoly: [
        { x: 10, y: 10 },
        { x: 20, y: 10 },
        { x: 20, y: 20 },
        { x: 10, y: 20 },
      ],
    } as any);
    vi.mocked(cardProcessor.applyTemporalSmoothing).mockReturnValue([
      { x: 10, y: 10 },
      { x: 20, y: 10 },
      { x: 20, y: 20 },
      { x: 10, y: 20 },
    ]);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  afterAll(() => {
    if (originalMediaDevices) {
      Object.defineProperty(globalThis.navigator, 'mediaDevices', {
        value: originalMediaDevices,
        writable: true,
        configurable: true,
      });
    } else {
      delete (globalThis.navigator as any).mediaDevices;
    }
  });

  it('renders correctly and matches snapshot', async () => {
    const onCancel = vi.fn();
    const { container } = render(<WishScanner onCapture={vi.fn()} onCancel={onCancel} />);

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Cancel' })).toBeInTheDocument();
    });

    expect(container).toMatchSnapshot();

    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(onCancel).toHaveBeenCalled();
  });

  it('drawOverlay handles tracked-poly state and renders geometry', async () => {
    render(<WishScanner onCapture={vi.fn()} onCancel={vi.fn()} stickerZoneHeightPercentage={30} />);

    const video = document.querySelector('video') as HTMLVideoElement;
    Object.defineProperty(video, 'videoWidth', { get: () => 1920, configurable: true });
    Object.defineProperty(video, 'videoHeight', { get: () => 1080, configurable: true });

    await act(async () => {
      fireEvent.play(video);
      await delay(50);
    });

    expect(cardProcessor.detectDocumentContour).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      400 / 1920,
      400,
      Math.floor(1080 * (400 / 1920))
    );
    expect(mockCtx.fillText).toHaveBeenCalledWith('Stickers go here', 0, 0);
    expect(mockCtx.fillText).toHaveBeenCalledWith(
      expect.stringContaining('State: Tracked'),
      expect.any(Number),
      expect.any(Number)
    );

    // Verify renderOverlay math
    expect(mockCtx.fillStyles).toContain('rgba(0,0,0,0.5)');
    expect(mockCtx.fillStyles).toContain('rgba(255, 255, 255, 0.8)');
    expect(mockCtx.strokeStyles).toContain('#1a73e8');
    expect(mockCtx.strokeStyles).toContain('rgba(255, 255, 255, 0.8)');

    // Check mapPt outputs for pt0 = {x: 10, y: 10}
    // drawX=0, drawY=0, drawW=800, drawH=600
    // x = 0 + (10 / 1920) * 800 = 4.166666666666667
    // y = 0 + (10 / 1080) * 600 = 5.555555555555555
    expect(mockCtx.moveTo).toHaveBeenCalledWith((10 / 1920) * 800, (10 / 1080) * 600);
  });

  it('drawOverlay handles fallback-contour state', async () => {
    vi.mocked(cardProcessor.detectDocumentContour).mockReturnValue({
      src: { delete: vi.fn() },
      contours: { delete: vi.fn() },
      hierarchy: { delete: vi.fn() },
      maxArea: 0,
      bestPoly: null,
    } as any);
    vi.mocked(cardProcessor.fallbackTextContour).mockReturnValue([
      { x: 5, y: 5 },
      { x: 15, y: 5 },
      { x: 15, y: 15 },
      { x: 5, y: 15 },
    ]);

    render(<WishScanner onCapture={vi.fn()} onCancel={vi.fn()} />);
    const video = document.querySelector('video') as HTMLVideoElement;
    Object.defineProperty(video, 'videoWidth', { get: () => 1920, configurable: true });
    Object.defineProperty(video, 'videoHeight', { get: () => 1080, configurable: true });

    await act(async () => {
      fireEvent.play(video);
      await delay(50);
    });

    expect(mockCtx.fillText).toHaveBeenCalledWith(
      expect.stringContaining('State: Center Crop Fallback'),
      expect.any(Number),
      expect.any(Number)
    );
  });

  it('drawOverlay handles default-poly state', async () => {
    vi.mocked(cardProcessor.detectDocumentContour).mockReturnValue({
      src: { delete: vi.fn() },
      contours: { delete: vi.fn() },
      hierarchy: { delete: vi.fn() },
      maxArea: 0,
      bestPoly: null,
    } as any);
    vi.mocked(cardProcessor.fallbackTextContour).mockReturnValue(null);
    vi.mocked(cardProcessor.getDefaultPoly).mockReturnValue([
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 10, y: 10 },
      { x: 0, y: 10 },
    ]);

    render(<WishScanner onCapture={vi.fn()} onCancel={vi.fn()} />);
    const video = document.querySelector('video') as HTMLVideoElement;
    Object.defineProperty(video, 'videoWidth', { get: () => 1920, configurable: true });
    Object.defineProperty(video, 'videoHeight', { get: () => 1080, configurable: true });

    await act(async () => {
      fireEvent.play(video);
      await delay(50);
    });

    expect(cardProcessor.getDefaultPoly).toHaveBeenCalled();
  });

  it('drawOverlay handles error path', async () => {
    vi.mocked(cardProcessor.detectDocumentContour).mockImplementation(() => {
      throw new Error('Test OpenCV Error');
    });

    render(<WishScanner onCapture={vi.fn()} onCancel={vi.fn()} />);
    const video = document.querySelector('video') as HTMLVideoElement;
    Object.defineProperty(video, 'videoWidth', { get: () => 1920, configurable: true });
    Object.defineProperty(video, 'videoHeight', { get: () => 1080, configurable: true });

    await act(async () => {
      fireEvent.play(video);
      await delay(50);
    });

    expect(mockCtx.fillText).toHaveBeenCalledWith(
      'Error: Test OpenCV Error',
      expect.any(Number),
      expect.any(Number)
    );
  });

  it('drawOverlay early returns when isProcessing is true', async () => {
    // We can simulate isProcessing=true by triggering processImage which sets it to true
    render(<WishScanner onCapture={vi.fn()} onCancel={vi.fn()} />);
    const video = document.querySelector('video') as HTMLVideoElement;
    Object.defineProperty(video, 'videoWidth', { get: () => 1920, configurable: true });
    Object.defineProperty(video, 'videoHeight', { get: () => 1080, configurable: true });

    // trigger draw to set smoothedCornersRef
    await act(async () => {
      fireEvent.play(video);
      await delay(50);
    });

    const takePhotoBtn = screen.getByRole('button', { name: 'Take Photo' });
    vi.clearAllMocks(); // clear mocks before triggering processImage

    await act(async () => {
      fireEvent.click(takePhotoBtn);
    });

    // isProcessing should now be true
    // Try to trigger drawOverlay again
    await act(async () => {
      fireEvent.play(video);
      await delay(50);
    });

    expect(cardProcessor.detectDocumentContour).not.toHaveBeenCalled();
  });

  it('drawOverlay early returns when videoWidth === 0', async () => {
    render(<WishScanner onCapture={vi.fn()} onCancel={vi.fn()} />);
    const video = document.querySelector('video') as HTMLVideoElement;
    Object.defineProperty(video, 'videoWidth', { get: () => 0, configurable: true });
    Object.defineProperty(video, 'videoHeight', { get: () => 0, configurable: true });

    await act(async () => {
      fireEvent.play(video);
      await delay(50);
    });

    expect(cardProcessor.detectDocumentContour).not.toHaveBeenCalled();
  });

  it('drawOverlay early returns when missing 2D context', async () => {
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);

    render(<WishScanner onCapture={vi.fn()} onCancel={vi.fn()} />);
    const video = document.querySelector('video') as HTMLVideoElement;
    vi.spyOn(video, 'videoWidth', 'get').mockReturnValue(1920);

    await act(async () => {
      fireEvent.play(video);
      await delay(50);
    });

    expect(cardProcessor.detectDocumentContour).not.toHaveBeenCalled();
  });

  it('processImage handles happy path capture', async () => {
    const originalImage = global.Image;
    global.Image = class extends originalImage {
      onload: any;
      constructor() {
        super();
        setTimeout(() => {
          Object.defineProperty(this, 'naturalWidth', { get: () => 1920 });
          Object.defineProperty(this, 'naturalHeight', { get: () => 1080 });
          if (this.onload) this.onload();
        }, 0);
      }
    } as any;

    const onCapture = vi.fn();
    vi.mocked(cardProcessor.processCardImage).mockResolvedValue({
      blob: new Blob(['test']),
      text: 'Extracted Text',
    });

    render(<WishScanner onCapture={onCapture} onCancel={vi.fn()} />);

    const video = document.querySelector('video') as HTMLVideoElement;
    vi.spyOn(video, 'videoWidth', 'get').mockReturnValue(1920);
    vi.spyOn(video, 'videoHeight', 'get').mockReturnValue(1080);

    await act(async () => {
      fireEvent.play(video);
      await delay(50);
    });

    const takePhotoBtn = screen.getByRole('button', { name: 'Take Photo' });

    await act(async () => {
      fireEvent.click(takePhotoBtn);
    });

    expect(screen.getByText('Reading text (this may take a few moments)...')).toBeInTheDocument();

    await waitFor(() => {
      expect(onCapture).toHaveBeenCalledWith('Extracted Text', expect.any(Blob));
    });

    global.Image = originalImage;
  });

  it('processImage returns early if corners have NaN', async () => {
    const onCapture = vi.fn();
    vi.mocked(cardProcessor.applyTemporalSmoothing).mockReturnValue([
      { x: NaN, y: NaN },
      { x: 20, y: 10 },
      { x: 20, y: 20 },
      { x: 10, y: 20 },
    ]);

    render(<WishScanner onCapture={onCapture} onCancel={vi.fn()} />);

    const video = document.querySelector('video') as HTMLVideoElement;
    Object.defineProperty(video, 'videoWidth', { value: 1920 });
    Object.defineProperty(video, 'videoHeight', { value: 1080 });

    await act(async () => {
      fireEvent.play(video);
      await delay(50);
    });

    const takePhotoBtn = screen.getByRole('button', { name: 'Take Photo' });

    await act(async () => {
      fireEvent.click(takePhotoBtn);
    });

    expect(
      screen.queryByText('Reading text (this may take a few moments)...')
    ).not.toBeInTheDocument();
    expect(cardProcessor.processCardImage).not.toHaveBeenCalled();
  });
});
