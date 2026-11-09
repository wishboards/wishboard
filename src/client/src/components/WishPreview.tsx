import React from 'react';
import InfoToggle from './InfoToggle';
import WishCard, {
  Wish,
  CardPaperColor,
  CardPinColor,
  PIN_COLORS,
  DEFAULT_PIN_COLOR,
} from './WishCard';

interface WishPreviewProps {
  wish: Wish;
  onOverflowChange: (isOverflowing: boolean) => void;
  onPaperColorChange?: (color: CardPaperColor) => void;
  onPinColorChange?: (color: CardPinColor) => void;
}

export default function WishPreview({
  wish,
  onOverflowChange,
  onPaperColorChange,
  onPinColorChange,
}: Readonly<WishPreviewProps>) {
  const currentPin: CardPinColor = React.useMemo(() => {
    if (!wish.card_style) return DEFAULT_PIN_COLOR;
    if (typeof wish.card_style === 'string') {
      try {
        const parsed = JSON.parse(wish.card_style);
        return typeof parsed?.pinColor === 'string' &&
          (PIN_COLORS as readonly string[]).includes(parsed.pinColor)
          ? (parsed.pinColor as CardPinColor)
          : DEFAULT_PIN_COLOR;
      } catch {
        return DEFAULT_PIN_COLOR;
      }
    }
    if (
      typeof wish.card_style === 'object' &&
      typeof wish.card_style.pinColor === 'string' &&
      (PIN_COLORS as readonly string[]).includes(wish.card_style.pinColor)
    ) {
      return wish.card_style.pinColor as CardPinColor;
    }
    return DEFAULT_PIN_COLOR;
  }, [wish.card_style]);

  const handlePinClick = onPinColorChange
    ? () => {
        const currentIndex = PIN_COLORS.indexOf(currentPin);
        const nextIndex = (currentIndex + 1) % PIN_COLORS.length;
        onPinColorChange(PIN_COLORS[nextIndex]);
      }
    : undefined;

  return (
    <div className="wish-preview-container" style={{ position: 'sticky', top: '24px' }}>
      <div
        className="label-with-info"
        style={{ borderBottom: '2px solid #e4e9f0', paddingBottom: '8px', marginBottom: '8px' }}
      >
        <h3 style={{ margin: 0 }}>Card Preview</h3>
        <InfoToggle>
          Watch your card scale automatically! If text turns red, it won't fit on the board.
        </InfoToggle>
      </div>
      <div style={{ maxWidth: '400px', margin: '0 auto' }}>
        <WishCard
          wish={wish}
          showFlag={false}
          onOverflowChange={onOverflowChange}
          isEditorPreview={true}
          onPinClick={handlePinClick}
          onPaperColorChange={onPaperColorChange}
        />
      </div>
    </div>
  );
}
