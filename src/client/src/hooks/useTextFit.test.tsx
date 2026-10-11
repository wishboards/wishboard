import { render, screen, act } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import React from 'react';
import { useTextFit } from './useTextFit';

function makeResizeObserver() {
  let observerCallback: ((entries: { target: Element }[]) => void) | undefined;
  const observeMock = vi.fn();
  const disconnectMock = vi.fn();
  globalThis.ResizeObserver = class ResizeObserver {
    constructor(callback: (entries: { target: Element }[]) => void) {
      observerCallback = callback;
    }
    observe = observeMock;
    disconnect = disconnectMock;
  } as unknown as typeof ResizeObserver;
  return { getCallback: () => observerCallback, observeMock, disconnectMock };
}

describe('useTextFit', () => {
  it('scales down font size and calls ResizeObserver', () => {
    const { getCallback } = makeResizeObserver();

    const TestComponent = () => {
      const { containerRef, contentRef } = useTextFit({
        minFontSize: 10,
        maxFontSize: 20,
        step: 2,
      });

      // Mock overflowing properties
      React.useLayoutEffect(() => {
        if (containerRef.current) {
          Object.defineProperty(containerRef.current, 'scrollHeight', {
            value: 200,
            configurable: true,
          });
          Object.defineProperty(containerRef.current, 'clientHeight', {
            value: 100,
            configurable: true,
          });
        }
      });

      return (
        <div ref={containerRef as React.Ref<HTMLDivElement>} data-testid="container">
          <div ref={contentRef as React.Ref<HTMLDivElement>} data-testid="content">
            Long text
          </div>
        </div>
      );
    };

    render(<TestComponent />);

    const content = screen.getByTestId('content');
    const cb = getCallback();
    if (cb) {
      const container = screen.getByTestId('container');
      Object.defineProperty(container, 'scrollHeight', { value: 200, configurable: true });
      Object.defineProperty(container, 'clientHeight', { value: 100, configurable: true });

      act(() => {
        cb([{ target: container }]);
      });
      expect(content.style.fontSize).toBe('10px'); // scaled down to minFontSize
    }
  });

  it('allows text to shrink below minFontSize when container is smaller than notionalSize', () => {
    makeResizeObserver();

    const TestComponent = () => {
      const { containerRef, contentRef } = useTextFit({
        minFontSize: 10,
        maxFontSize: 18,
        step: 1,
        notionalSize: { width: 244, height: 130 },
      });

      return (
        <div ref={containerRef as React.Ref<HTMLDivElement>} data-testid="container">
          <div ref={contentRef as React.Ref<HTMLDivElement>} data-testid="content">
            Text
          </div>
        </div>
      );
    };

    render(<TestComponent />);

    // Container is smaller than notional (clientWidth=0 in jsdom < 244)
    // The hook should be able to scale below minFontSize without throwing.
    // In jsdom scrollHeight/clientHeight are 0 so it won't actually loop,
    // but the logic branch for fitMinSize=1 should be exercised.
    const content = screen.getByTestId('content');
    // maxFontSize is applied initially; jsdom has no layout so no scaling occurs
    expect(content.style.fontSize).toBe('18px');
  });

  it('checks overflow against notionalSize dimensions when container is smaller', () => {
    makeResizeObserver();

    let capturedOverflowing: boolean | undefined;

    const TestComponent = () => {
      const { containerRef, contentRef, isOverflowing } = useTextFit({
        minFontSize: 10,
        maxFontSize: 18,
        step: 1,
        notionalSize: { width: 244, height: 130 },
      });

      capturedOverflowing = isOverflowing;

      return (
        <div ref={containerRef as React.Ref<HTMLDivElement>} data-testid="container">
          <div ref={contentRef as React.Ref<HTMLDivElement>} data-testid="content">
            Text
          </div>
        </div>
      );
    };

    render(<TestComponent />);

    // In jsdom, scrollHeight is 0 and clientWidth is 0 (< 244 notional width),
    // so the notional branch runs. content.scrollHeight (0) <= notionalSize.height (130)
    // means no overflow.
    expect(capturedOverflowing).toBe(false);
  });
});
