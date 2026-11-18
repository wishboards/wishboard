import type { Meta, StoryObj } from '@storybook/react-vite';
import React, { useState } from 'react';
import WishPreview from './WishPreview';
import { Wish, CardPaperColor, CardPinColor } from './WishCard';

const meta: Meta<typeof WishPreview> = {
  title: 'Components/WishPreview',
  component: WishPreview,
  parameters: {
    layout: 'centered',
  },
  tags: ['autodocs'],
};

export default meta;
type Story = StoryObj<typeof WishPreview>;

function WishPreviewDemo() {
  const [paperColor, setPaperColor] = useState<CardPaperColor>('canary');
  const [pinColor, setPinColor] = useState<CardPinColor>('amber');

  const wish: Wish = {
    id: 'preview-wish-1',
    content: 'Live preview of a tactile convention wish card! Tap the pushpin to cycle pin colors.',
    creator_attributes: {
      orientation: ['Queer'],
      gender: ['Nonbinary'],
      interests: ['Cosplay', 'Gaming', 'Board Games'],
    },
    contacts: [{ type: 'Telegram', value: '@convention_goer' }],
    wishmail_enabled: true,
    card_style: {
      paperColor,
      pinColor,
    },
  };

  return (
    <div style={{ width: '560px', maxWidth: '95vw', margin: '0 auto' }}>
      <WishPreview
        wish={wish}
        onOverflowChange={() => {}}
        onPaperColorChange={setPaperColor}
        onPinColorChange={setPinColor}
      />
    </div>
  );
}

export const Default: Story = {
  render: () => <WishPreviewDemo />,
};
