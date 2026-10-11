import { useLayoutEffect, useRef, useState } from 'react';

interface UseTextFitProps {
  minFontSize?: number;
  maxFontSize?: number;
  step?: number;
  /**
   * When provided and the actual container is *smaller* than this size,
   * `isOverflowing` is determined by whether the text would overflow the
   * notional dimensions at `minFontSize` — not the tiny preview container.
   *
   * This lets the editor preview "smoosh" text freely while still warning
   * the user if the text wouldn't fit on a real search-result card.
   *
   * Units are CSS pixels (content area, excluding card padding).
   */
  notionalSize?: { width: number; height: number };
}

export function useTextFit<
  T extends HTMLElement = HTMLElement,
  U extends HTMLElement = HTMLElement,
>(
  { minFontSize = 12, maxFontSize = 24, step = 1, notionalSize }: UseTextFitProps = {},
  deps: React.DependencyList = []
) {
  const containerRef = useRef<T>(null);
  const contentRef = useRef<U>(null);
  const [isOverflowing, setIsOverflowing] = useState(false);

  useLayoutEffect(() => {
    const container = containerRef.current;
    const content = contentRef.current;

    if (!container || !content) return;

    const performFit = () => {
      let currentFontSize = maxFontSize;
      content.style.fontSize = `${currentFontSize}px`;

      // Synchronously scale down until it fits the actual container.
      // When notionalSize is provided and the container is smaller, we
      // allow scaling all the way to 1px so the preview "smooshes" rather
      // than falsely triggering overflow at the tiny preview size.
      const fitMinSize =
        notionalSize && container.clientWidth < notionalSize.width ? 1 : minFontSize;
      while (
        // NOSONAR
        currentFontSize > fitMinSize &&
        (container.scrollHeight > container.clientHeight ||
          container.scrollWidth > container.clientWidth)
      ) {
        currentFontSize -= step;
        content.style.fontSize = `${currentFontSize}px`;
      }

      let isStillOverflowing: boolean;

      if (notionalSize && container.clientWidth < notionalSize.width) {
        // The preview is smaller than a real card. Check overflow against the
        // notional card content area at the real minimum font size, so the
        // warning reflects whether the wish would fit on an actual search result.
        const prevFontSize = content.style.fontSize;
        const prevWidth = content.style.width;
        const prevWhiteSpace = content.style.whiteSpace;

        content.style.fontSize = `${minFontSize}px`;
        content.style.width = `${notionalSize.width}px`;
        content.style.whiteSpace = 'normal'; // ensure word-wrap at notional width

        isStillOverflowing = content.scrollHeight > notionalSize.height;

        // Restore visual state
        content.style.fontSize = prevFontSize;
        content.style.width = prevWidth;
        content.style.whiteSpace = prevWhiteSpace;
      } else {
        // Normal case: check overflow against the actual container.
        isStillOverflowing =
          container.scrollHeight > container.clientHeight ||
          container.scrollWidth > container.clientWidth;
      }

      // eslint-disable-next-line @eslint-react/set-state-in-effect -- DOM measurement in useLayoutEffect requires updating layout state
      setIsOverflowing(isStillOverflowing);
    };

    performFit();

    // Use ResizeObserver to respond only to container layout changes
    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        if (entry.target === container) {
          performFit();
          break;
        }
      }
    });

    observer.observe(container);

    return () => {
      observer.disconnect();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps, @eslint-react/exhaustive-deps -- Custom hook accepts dynamic caller dependency list to re-trigger layout fit
  }, [minFontSize, maxFontSize, step, notionalSize, ...deps]);

  return { containerRef, contentRef, isOverflowing };
}
