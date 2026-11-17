import type { Meta, StoryObj } from '@storybook/react-vite';
import React, { useState } from 'react';
import MobileBottomBar, { MobilePageId } from './MobileBottomBar';

const meta: Meta<typeof MobileBottomBar> = {
  title: 'Components/MobileBottomBar',
  component: MobileBottomBar,
  parameters: {
    layout: 'fullscreen',
  },
  tags: ['autodocs'],
};

export default meta;
type Story = StoryObj<typeof MobileBottomBar>;

function MobileBottomBarDemo() {
  const [page, setPage] = useState<MobilePageId>('home');
  return (
    <div
      style={{
        height: '200px',
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'flex-end',
      }}
    >
      <MobileBottomBar page={page} navigate={setPage} unreadCount={3} />
    </div>
  );
}

export const Default: Story = {
  render: () => <MobileBottomBarDemo />,
};

export const SearchActive: Story = {
  args: {
    page: 'search',
    navigate: () => {},
    unreadCount: 0,
  },
};

export const WithUnreadWishmail: Story = {
  args: {
    page: 'wishmail-dashboard',
    navigate: () => {},
    unreadCount: 5,
  },
};
