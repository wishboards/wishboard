import type { Meta, StoryObj } from '@storybook/react-vite';
import React from 'react';
import IdentityStickers from './IdentityStickers';

const meta: Meta<typeof IdentityStickers> = {
  title: 'Components/IdentityStickers',
  component: IdentityStickers,
  parameters: {
    layout: 'centered',
  },
  decorators: [
    (Story) => (
      <div
        style={{
          padding: '24px 32px',
          fontSize: '28px',
          background: 'var(--wb-bg-surface, rgba(30, 41, 59, 0.78))',
          borderRadius: '12px',
          border: '1px solid var(--wb-border-subtle, rgba(255, 255, 255, 0.12))',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <Story />
      </div>
    ),
  ],
  tags: ['autodocs'],
};

export default meta;
type Story = StoryObj<typeof IdentityStickers>;

export const Default: Story = {
  args: {
    attributes: {
      orientation: ['Queer', 'Bisexual'],
      gender: ['Nonbinary'],
      interests: ['Gaming', 'Cosplay'],
    },
  },
};

export const OrientationHearts: Story = {
  args: {
    attributes: {
      orientation: ['Gay', 'Lesbian', 'Bisexual', 'Pansexual', 'Asexual', 'Queer', 'Straight'],
    },
  },
};

export const GenderFlagsAndIcons: Story = {
  args: {
    attributes: {
      gender: ['Transgender', 'Nonbinary', 'Genderqueer', 'Woman', 'Man'],
    },
  },
};

export const InterestBadges: Story = {
  args: {
    attributes: {
      interests: ['Gaming', 'Cosplay', 'Board Games', 'Anime', 'VR'],
    },
  },
};

export const ProfessionalRoles: Story = {
  args: {
    attributes: {
      role: ['Presenter', 'Attendee'],
    },
  },
};

export const MultiCategory: Story = {
  args: {
    attributes: {
      orientation: ['Lesbian', 'Asexual'],
      gender: ['Woman'],
      interests: ['Board Games', 'VR'],
    },
  },
};
