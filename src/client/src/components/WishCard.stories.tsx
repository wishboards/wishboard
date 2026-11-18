import type { Meta, StoryObj } from '@storybook/react-vite';
import React from 'react';
import WishCard, { Wish, PAPER_COLORS, PIN_COLORS } from './WishCard';

const baseWish: Wish = {
  id: 'wish-sample-1',
  content: 'Looking for a squad to run board games and cooperative VR on Saturday evening!',
  creator_attributes: {
    interests: ['Board Games', 'Gaming', 'VR'],
    orientation: ['Queer'],
    gender: ['Nonbinary'],
  },
  contacts: [
    { type: 'Discord', value: '@game_fan' },
    { type: 'Telegram', value: '@boardgamequest' },
  ],
  wishmail_enabled: true,
  card_style: {
    paperColor: 'ivory',
    pinColor: 'ruby',
  },
};

const meta: Meta<typeof WishCard> = {
  title: 'Components/WishCard',
  component: WishCard,
  parameters: {
    layout: 'centered',
  },
  decorators: [
    (Story) => (
      <div style={{ width: '520px', maxWidth: '95vw' }}>
        <Story />
      </div>
    ),
  ],
  tags: ['autodocs'],
};

export default meta;
type Story = StoryObj<typeof WishCard>;

export const Default: Story = {
  args: {
    wish: baseWish,
    showFlag: true,
  },
};

export const IvoryPaper: Story = {
  args: {
    wish: {
      ...baseWish,
      id: 'wish-ivory',
      card_style: { paperColor: 'ivory', pinColor: 'ruby' },
    },
    showFlag: true,
  },
};

export const CanaryPaper: Story = {
  args: {
    wish: {
      ...baseWish,
      id: 'wish-canary',
      content: 'Morning tea meetup! Looking for chill conversations before the main expo opens.',
      card_style: { paperColor: 'canary', pinColor: 'amber' },
    },
    showFlag: true,
  },
};

export const RosePaper: Story = {
  args: {
    wish: {
      ...baseWish,
      id: 'wish-rose',
      content: 'Seeking fellow romance anime and manga enthusiasts to swap recommendations.',
      card_style: { paperColor: 'rose', pinColor: 'emerald' },
    },
    showFlag: true,
  },
};

export const SkyPaper: Story = {
  args: {
    wish: {
      ...baseWish,
      id: 'wish-sky',
      content: 'Any sci-fi writers around? Let us assemble for a speed-writing brainstorm!',
      card_style: { paperColor: 'sky', pinColor: 'sapphire' },
    },
    showFlag: true,
  },
};

export const SagePaper: Story = {
  args: {
    wish: {
      ...baseWish,
      id: 'wish-sage',
      content: 'Nature walk & photo expedition around convention center gardens!',
      card_style: { paperColor: 'sage', pinColor: 'violet' },
    },
    showFlag: true,
  },
};

export const AllPaperTints: Story = {
  render: () => (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))',
        gap: '24px',
        maxWidth: '1200px',
      }}
    >
      {PAPER_COLORS.map((paper, idx) => (
        <WishCard
          key={paper}
          wish={{
            ...baseWish,
            id: `wish-${paper}`,
            content: `Tactile card swatch rendered on "${paper}" index card paper with ${PIN_COLORS[idx % PIN_COLORS.length]} pushpin.`,
            card_style: {
              paperColor: paper,
              pinColor: PIN_COLORS[idx % PIN_COLORS.length],
            },
          }}
          showFlag={true}
        />
      ))}
    </div>
  ),
};

export const AllPushpinColors: Story = {
  render: () => (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))',
        gap: '24px',
        maxWidth: '1200px',
      }}
    >
      {PIN_COLORS.map((pin) => (
        <WishCard
          key={pin}
          wish={{
            ...baseWish,
            id: `wish-pin-${pin}`,
            content: `Card pinned with "${pin}" acrylic head pushpin on ivory paper.`,
            card_style: {
              paperColor: 'ivory',
              pinColor: pin,
            },
          }}
          showFlag={true}
        />
      ))}
    </div>
  ),
};

export const WithImage: Story = {
  args: {
    wish: {
      ...baseWish,
      id: 'wish-image',
      content: 'Cosplay showcase meetup at Booth B-12!',
      image_url:
        'data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="300" height="150" viewBox="0 0 300 150"><rect fill="%23f59e0b" width="300" height="150"/><text fill="%23ffffff" font-family="sans-serif" font-size="20" font-weight="bold" x="50%25" y="50%25" text-anchor="middle" dominant-baseline="middle">Convention Photo</text></svg>',
    },
    showFlag: true,
  },
};

export const DisplayMode: Story = {
  args: {
    wish: baseWish,
    cardClass: 'display-card',
    showFlag: false,
  },
};
