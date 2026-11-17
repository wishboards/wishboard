import type { Meta, StoryObj } from '@storybook/react-vite';
import React from 'react';
import InfoToggle from './InfoToggle';

const meta: Meta<typeof InfoToggle> = {
  title: 'Components/InfoToggle',
  component: InfoToggle,
  parameters: {
    layout: 'centered',
  },
  tags: ['autodocs'],
};

export default meta;
type Story = StoryObj<typeof InfoToggle>;

export const Default: Story = {
  args: {
    children: (
      <div>
        <p>
          Wishmail enables direct anonymous peer-to-peer messaging through the Wishboard without
          revealing your contact info up-front!
        </p>
      </div>
    ),
  },
};
