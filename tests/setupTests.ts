import '@testing-library/jest-dom';
import { vi } from 'vitest';
import { extractUrl } from './testUtils';

const MOCK_DOMAIN = {
  domain: 'default',
  categories: [
    { id: 'gender', label: 'Gender', suggestions: [] },
    { id: 'orientation', label: 'Orientation', suggestions: [] },
    { id: 'role', label: 'Role', suggestions: [] },
  ],
  stickers: {
    orientation: {
      straight: { type: 'heart', class: 'flag-straight' },
      gay: { type: 'heart', class: 'flag-rainbow' },
      lesbian: { type: 'heart', class: 'flag-lesbian' },
      bi: { type: 'heart', class: 'flag-bisexual' },
      pan: { type: 'heart', class: 'flag-pansexual' },
      asexual: { type: 'heart', class: 'flag-asexual' },
      queer: { type: 'heart', class: 'flag-rainbow' },
    },
    gender: {
      trans: { type: 'flag', class: 'flag-trans' },
      nonbinary: { type: 'flag', class: 'flag-nonbinary' },
      'non-binary': { type: 'flag', class: 'flag-nonbinary' },
      woman: { type: 'icon', class: 'female-icon', iconType: 'female' },
      man: { type: 'icon', class: 'male-icon', iconType: 'male' },
    },
    role: {
      speaker: { type: 'icon', class: 'speaker-icon', iconType: 'microphone' },
      attendee: { type: 'icon', class: 'attendee-icon', iconType: 'ticket' },
      top: { type: 'icon', class: 'top-icon', iconType: 'arrow-up' },
    },
  },
  realtimeProvider: 'socketio',
  apIp: '',
  isServerless: false,
};

const originalFetch = globalThis.fetch;
globalThis.fetch = vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
  const urlStr = extractUrl(url);
  if (urlStr === '/api/config' || urlStr.endsWith('/api/config')) {
    return {
      ok: true,
      json: async () => MOCK_DOMAIN,
    } as Response;
  }
  if (originalFetch) {
    return originalFetch(url, init);
  }
  return { ok: true, json: async () => ({}) } as Response;
});

// Mock EventProfileContext so it renders children immediately without waiting for fetch in tests
vi.mock('../src/client/src/EventProfileContext', async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  return {
    ...actual,
    EventProfileProvider: ({ children }: { children: React.ReactNode }) =>
      children as React.ReactElement,
    useEventProfile: vi.fn(() => MOCK_DOMAIN),
  };
});

vi.mock('@techstark/opencv-js', () => ({
  default: {
    Mat: vi.fn().mockImplementation(() => ({
      delete: vi.fn(),
      rows: 4,
      data32S: [0, 0, 800, 0, 800, 600, 0, 600],
    })),
    MatVector: vi.fn().mockImplementation(() => ({
      delete: vi.fn(),
      size: () => 1,
      get: () => ({ delete: vi.fn() }),
    })),
    imread: vi.fn().mockReturnValue({ delete: vi.fn() }),
    cvtColor: vi.fn(),
    COLOR_RGBA2GRAY: 'COLOR_RGBA2GRAY',
    medianBlur: vi.fn(),
    adaptiveThreshold: vi.fn(),
    threshold: vi.fn(),
    THRESH_BINARY: 'THRESH_BINARY',
    THRESH_OTSU: 'THRESH_OTSU',
    findContours: vi.fn(),
    RETR_EXTERNAL: 'RETR_EXTERNAL',
    CHAIN_APPROX_SIMPLE: 'CHAIN_APPROX_SIMPLE',
    contourArea: vi.fn().mockReturnValue(500000),
    boundingRect: vi.fn().mockReturnValue({ x: 0, y: 0, width: 100, height: 100 }),
    drawContours: vi.fn(),
    imshow: vi.fn(),
    approxPolyDP: vi.fn(),
    arcLength: vi.fn().mockReturnValue(10),
    getPerspectiveTransform: vi.fn().mockReturnValue({ delete: vi.fn() }),
    warpPerspective: vi.fn(),
    matFromArray: vi.fn().mockReturnValue({ delete: vi.fn() }),
    Size: vi.fn(),
    Point: vi.fn(),
    GaussianBlur: vi.fn(),
    Canny: vi.fn(),
    BORDER_DEFAULT: 'BORDER_DEFAULT',
    RETR_LIST: 'RETR_LIST',
  },
}));

vi.mock('tesseract.js', () => ({
  default: {
    recognize: vi.fn().mockResolvedValue({ data: { text: 'Mocked OCR Text' } }),
  },
}));
import ResizeObserver from 'resize-observer-polyfill';

// Mock socket.io-client so component tests don't try to open a real WebSocket
vi.mock('socket.io-client', () => {
  const socket = {
    connected: false,
    on: vi.fn(),
    off: vi.fn(),
    emit: vi.fn(),
    disconnect: vi.fn(),
  };
  return {
    default: { io: vi.fn(() => socket) },
    io: vi.fn(() => socket),
  };
});

if (typeof HTMLCanvasElement !== 'undefined') {
  HTMLCanvasElement.prototype.getContext =
    vi.fn() as unknown as typeof HTMLCanvasElement.prototype.getContext;
  HTMLCanvasElement.prototype.toBlob = vi.fn(function (
    this: HTMLCanvasElement,
    callback: BlobCallback
  ) {
    callback(new Blob(['mock data'], { type: 'image/jpeg' }));
  }) as unknown as typeof HTMLCanvasElement.prototype.toBlob;
}

globalThis.ResizeObserver = ResizeObserver;
if (globalThis.window !== undefined) {
  Object.defineProperty(globalThis.window, 'matchMedia', {
    writable: true,
    value: vi.fn().mockImplementation((query) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  });
}
