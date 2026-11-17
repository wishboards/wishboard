import type { Meta, StoryObj } from '@storybook/react-vite';
import FlagButton from './FlagButton';

const meta: Meta<typeof FlagButton> = {
  title: 'Components/FlagButton',
  component: FlagButton,
  parameters: {
    layout: 'centered',
  },
  tags: ['autodocs'],
};

export default meta;
type Story = StoryObj<typeof FlagButton>;

export const Default: Story = {
  args: {
    title: 'Flag as inappropriate',
    onFlag: () => alert('Wish flagged!'),
  },
};
