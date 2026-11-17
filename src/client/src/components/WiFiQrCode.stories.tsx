import type { Meta, StoryObj } from '@storybook/react-vite';
import WiFiQrCode from './WiFiQrCode';

const meta: Meta<typeof WiFiQrCode> = {
  title: 'Components/WiFiQrCode',
  component: WiFiQrCode,
  parameters: {
    layout: 'centered',
  },
  tags: ['autodocs'],
};

export default meta;
type Story = StoryObj<typeof WiFiQrCode>;

export const Floating: Story = {
  args: {
    variant: 'floating',
  },
};

export const Sidebar: Story = {
  args: {
    variant: 'sidebar',
  },
};
