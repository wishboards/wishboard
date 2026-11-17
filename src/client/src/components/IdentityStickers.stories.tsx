import type { Meta, StoryObj } from '@storybook/react-vite';
import IdentityStickers from './IdentityStickers';

const meta: Meta<typeof IdentityStickers> = {
  title: 'Components/IdentityStickers',
  component: IdentityStickers,
  parameters: {
    layout: 'centered',
  },
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

export const SingleAttribute: Story = {
  args: {
    attributes: {
      orientation: ['Gay'],
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
