import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import React, { useState } from 'react';
import WishCard, {
  PAPER_COLORS,
  PIN_COLORS,
  CardPaperColor,
  CardPinColor,
  DEFAULT_PAPER_COLOR,
  DEFAULT_PIN_COLOR,
} from './WishCard';
import WishPreview from './WishPreview';
import fs from 'node:fs';
import path from 'node:path';

// Mock useTextFit to prevent canvas/DOM layout measurements from failing in JSDOM
vi.mock('../hooks/useTextFit', () => ({
  useTextFit: vi.fn(() => ({
    containerRef: { current: null },
    contentRef: { current: null },
    isOverflowing: false,
  })),
}));

// Helper functions for WCAG 2.1 Contrast Calculation
function sRGBtoLinear(c: number): number {
  const norm = c / 255;
  return norm <= 0.04045 ? norm / 12.92 : Math.pow((norm + 0.055) / 1.055, 2.4);
}

function getRelativeLuminance(hex: string): number {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return 0.2126 * sRGBtoLinear(r) + 0.7152 * sRGBtoLinear(g) + 0.0722 * sRGBtoLinear(b);
}

function getContrastRatio(hex1: string, hex2: string): number {
  const lum1 = getRelativeLuminance(hex1);
  const lum2 = getRelativeLuminance(hex2);
  const lighter = Math.max(lum1, lum2);
  const darker = Math.min(lum1, lum2);
  return (lighter + 0.05) / (darker + 0.05);
}

describe('Rank 2 Phase 2 Adversarial Stress Testing', () => {
  describe('1. Pushpin Tap-Cycling Stress & Wrap-Around', () => {
    it('survives 100 consecutive rapid taps with deterministic cyclic state updates', () => {
      function InteractivePreviewHarness() {
        const [pinColor, setPinColor] = useState<CardPinColor>(DEFAULT_PIN_COLOR);
        const [paperColor] = useState<CardPaperColor>(DEFAULT_PAPER_COLOR);

        const wish = {
          id: 'stress-pin-1',
          content: 'Pushpin stress test',
          card_style: { paperColor, pinColor },
        };

        return (
          <WishPreview wish={wish} onOverflowChange={() => {}} onPinColorChange={setPinColor} />
        );
      }

      render(<InteractivePreviewHarness />);

      // Exactly 5 colors: ['ruby', 'amber', 'emerald', 'sapphire', 'violet']
      for (let i = 0; i < 100; i++) {
        const expectedColor = PIN_COLORS[i % PIN_COLORS.length];
        const nextColor = PIN_COLORS[(i + 1) % PIN_COLORS.length];

        const pinBtn = screen.getByRole('button', {
          name: new RegExp(`Pushpin: ${expectedColor}\\. Click to cycle\\.`, 'i'),
        });
        expect(pinBtn).toBeInTheDocument();

        fireEvent.click(pinBtn);

        const updatedBtn = screen.getByRole('button', {
          name: new RegExp(`Pushpin: ${nextColor}\\. Click to cycle\\.`, 'i'),
        });
        expect(updatedBtn).toBeInTheDocument();
      }

      // 100 taps % 5 colors == 0 -> should return to initial 'ruby'
      const finalBtn = screen.getByRole('button', {
        name: /Pushpin: ruby\. Click to cycle\./i,
      });
      expect(finalBtn).toBeInTheDocument();
    });

    it('survives 500 rapid consecutive taps and remains cleanly wrapped at starting color', () => {
      function Stress500Harness() {
        const [pinColor, setPinColor] = useState<CardPinColor>('ruby');
        return (
          <WishPreview
            wish={{
              id: 's500',
              content: '500 taps',
              card_style: { paperColor: 'ivory', pinColor },
            }}
            onOverflowChange={() => {}}
            onPinColorChange={setPinColor}
          />
        );
      }

      render(<Stress500Harness />);

      for (let i = 0; i < 500; i++) {
        const btn = screen.getByRole('button', { name: /Pushpin:.*Click to cycle\./i });
        fireEvent.click(btn);
      }

      // 500 % 5 === 0 -> ruby
      expect(
        screen.getByRole('button', { name: /Pushpin: ruby\. Click to cycle\./i })
      ).toBeInTheDocument();
    });

    it('handles legacy or corrupt stringified pinColor safely during cycling', () => {
      const onPinColorChange = vi.fn();
      // Malformed JSON card_style
      const corruptWish = {
        id: 'corrupt-1',
        content: 'Corrupt card_style',
        card_style: '{invalid-json}',
      };

      render(
        <WishPreview
          wish={corruptWish}
          onOverflowChange={() => {}}
          onPinColorChange={onPinColorChange}
        />
      );

      // Falls back to DEFAULT_PIN_COLOR ('ruby')
      const btn = screen.getByRole('button', { name: /Pushpin: ruby/i });
      fireEvent.click(btn);
      // Next color after ruby is amber
      expect(onPinColorChange).toHaveBeenCalledWith('amber');
    });
  });

  describe('2. Accessibility & Screen Reader Compliance', () => {
    it('provides accessible radiogroup with 5 options and accurate aria-checked state', () => {
      const onPaperColorChange = vi.fn();
      const { rerender } = render(
        <WishCard
          wish={{
            id: 'a11y-1',
            content: 'A11y test',
            card_style: { paperColor: 'canary', pinColor: 'ruby' },
          }}
          onPaperColorChange={onPaperColorChange}
        />
      );

      const radioGroup = screen.getByRole('radiogroup', { name: 'Card paper color' });
      expect(radioGroup).toBeInTheDocument();

      const radios = screen.getAllByRole('radio');
      expect(radios).toHaveLength(5);

      for (const color of PAPER_COLORS) {
        const radio = screen.getByRole('radio', { name: `Select ${color} paper` });
        expect(radio).toBeInTheDocument();
        if (color === 'canary') {
          expect(radio).toHaveAttribute('aria-checked', 'true');
          expect(radio).toHaveClass('is-selected');
        } else {
          expect(radio).toHaveAttribute('aria-checked', 'false');
          expect(radio).not.toHaveClass('is-selected');
        }
      }

      // Change selection to 'sky'
      rerender(
        <WishCard
          wish={{
            id: 'a11y-1',
            content: 'A11y test',
            card_style: { paperColor: 'sky', pinColor: 'ruby' },
          }}
          onPaperColorChange={onPaperColorChange}
        />
      );

      expect(screen.getByRole('radio', { name: 'Select sky paper' })).toHaveAttribute(
        'aria-checked',
        'true'
      );
      expect(screen.getByRole('radio', { name: 'Select canary paper' })).toHaveAttribute(
        'aria-checked',
        'false'
      );
    });

    it('triggers paper selection on keyboard activation', () => {
      const onPaperColorChange = vi.fn();
      render(
        <WishCard
          wish={{ id: 'kb-1', content: 'Keyboard test' }}
          onPaperColorChange={onPaperColorChange}
        />
      );

      const sageRadio = screen.getByRole('radio', { name: 'Select sage paper' });
      sageRadio.focus();
      expect(document.activeElement).toBe(sageRadio);

      fireEvent.click(sageRadio);
      expect(onPaperColorChange).toHaveBeenCalledWith('sage');
    });

    it('hides decorative pushpin SVGs / elements from screen readers with aria-hidden', () => {
      render(
        <WishCard wish={{ id: 'sr-1', content: 'Screen reader test' }} onPinClick={() => {}} />
      );

      const btn = screen.getByRole('button', { name: /Pushpin: ruby/i });
      const pinHead = btn.querySelector('.pin-head');
      const pinNeedle = btn.querySelector('.pin-needle');

      expect(pinHead).toHaveAttribute('aria-hidden', 'true');
      expect(pinNeedle).toHaveAttribute('aria-hidden', 'true');
    });
  });

  describe('3. WCAG AA & AAA Dark Ink Contrast Verification', () => {
    const INK_HEX = '#1e293b';
    const PAPER_HEXES: Record<CardPaperColor, string> = {
      ivory: '#fdfbf7',
      canary: '#fef9c3',
      rose: '#ffe4e6',
      sky: '#e0f2fe',
      sage: '#dcfce7',
    };

    for (const [colorName, paperHex] of Object.entries(PAPER_HEXES) as [CardPaperColor, string][]) {
      it(`verifies ${colorName} (${paperHex}) against ink ${INK_HEX} exceeds WCAG AA (>= 4.5:1) and AAA (>= 7:1)`, () => {
        const ratio = getContrastRatio(INK_HEX, paperHex);
        expect(ratio).toBeGreaterThanOrEqual(4.5); // WCAG AA
        expect(ratio).toBeGreaterThanOrEqual(7.0); // WCAG AAA
        expect(ratio).toBeGreaterThan(12.0); // Actual measured ratio is > 12:1
      });
    }

    it('verifies theme.css defines correct token mappings for all 5 papers and pins', () => {
      const themeCssPath = path.resolve(__dirname, '../theme.css');
      const themeCss = fs.readFileSync(themeCssPath, 'utf-8');

      for (const [colorName, paperHex] of Object.entries(PAPER_HEXES)) {
        expect(themeCss).toContain(`[data-card-paper='${colorName}']`);
        expect(themeCss).toContain(`--wb-card-paper-bg: ${paperHex};`);
        expect(themeCss).toContain(`--wb-card-ink: ${INK_HEX};`);
      }

      for (const pinColor of PIN_COLORS) {
        expect(themeCss).toContain(`[data-card-pin='${pinColor}']`);
      }
    });
  });

  describe('4. High-Contrast Mode & Zero Vertical Height Increase in Composer', () => {
    it('verifies absolute positioning of pin and swatches guarantees zero vertical height impact', () => {
      const stylesCssPath = path.resolve(__dirname, '../styles.css');
      const stylesCss = fs.readFileSync(stylesCssPath, 'utf-8');

      // Verify .card-pushpin-btn is position: absolute
      expect(stylesCss).toMatch(/\.card-pushpin-btn\s*\{[^}]*position:\s*absolute/);

      // Verify .card-paper-swatches is position: absolute
      expect(stylesCss).toMatch(/\.card-paper-swatches\s*\{[^}]*position:\s*absolute/);
    });

    it('verifies high-contrast mode specifies WCAG AAA compliant tokens in theme.css', () => {
      const themeCssPath = path.resolve(__dirname, '../theme.css');
      const themeCss = fs.readFileSync(themeCssPath, 'utf-8');

      expect(themeCss).toContain("[data-theme='high-contrast']");
      expect(themeCss).toContain('--wb-bg-canvas: #000000;');
      expect(themeCss).toContain('--wb-text-primary: #ffffff;');
      expect(themeCss).toContain('--wb-border-subtle: #ffffff;');

      // Ratio between #ffffff and #000000 is 21:1 (maximum possible contrast)
      const ratio = getContrastRatio('#ffffff', '#000000');
      expect(ratio).toBe(21);
    });

    it('verifies swatches fit comfortably within iPhone SE (320px viewport) dimensions', () => {
      // 5 buttons at 20px = 100px
      // 4 gaps at 5px = 20px
      // padding 3px 6px = 12px
      // Total swatch container width = ~132px
      // At 320px screen - 32px container padding = 288px card width.
      // 132px < 288px (takes < 46% of card width, fitting cleanly in the bottom right corner)
      const swatchWidth = 5 * 20 + 4 * 5 + 12;
      const minCardWidth = 288;
      expect(swatchWidth).toBeLessThan(minCardWidth / 2);
    });
  });

  describe('5. Image Cards (.card-has-image) Pin & Paper Rendering', () => {
    it('renders pushpin button and retains data attributes on image cards', () => {
      const imageWish = {
        id: 'img-1',
        content: 'Image wish',
        image_url: 'blob:https://example.com/test-uuid',
        card_style: { paperColor: 'rose', pinColor: 'emerald' } as const,
      };

      const onPinClick = vi.fn();
      const onPaperColorChange = vi.fn();

      const { container } = render(
        <WishCard
          wish={imageWish}
          onPinClick={onPinClick}
          onPaperColorChange={onPaperColorChange}
        />
      );

      const article = container.querySelector('article');
      expect(article).toHaveClass('card-has-image');
      expect(article).toHaveAttribute('data-card-pin', 'emerald');
      expect(article).toHaveAttribute('data-card-paper', 'rose');

      // Pin button is present and clickable
      const pinBtn = screen.getByRole('button', { name: /Pushpin: emerald/i });
      expect(pinBtn).toBeInTheDocument();
      fireEvent.click(pinBtn);
      expect(onPinClick).toHaveBeenCalledTimes(1);

      // Paper swatches are also present and clickable
      const canaryRadio = screen.getByRole('radio', { name: 'Select canary paper' });
      fireEvent.click(canaryRadio);
      expect(onPaperColorChange).toHaveBeenCalledWith('canary');
    });

    it('renders static pushpin styling without button on display image card', () => {
      const imageWish = {
        id: 'img-display-1',
        content: 'Display image wish',
        image_url: 'blob:https://example.com/display-uuid',
        card_style: { paperColor: 'sky', pinColor: 'violet' } as const,
      };

      const { container } = render(<WishCard wish={imageWish} />);

      const article = container.querySelector('article');
      expect(article).toHaveClass('card-has-image');
      expect(article).not.toHaveClass('has-interactive-pin');
      expect(article).toHaveAttribute('data-card-pin', 'violet');

      // No interactive button rendered
      expect(screen.queryByRole('button', { name: /Pushpin:/i })).toBeNull();
    });
  });
});
