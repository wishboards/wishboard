import type { Meta, StoryObj } from '@storybook/react-vite';
import React, { useState } from 'react';
import BottomSheet from './BottomSheet';

const meta: Meta<typeof BottomSheet> = {
  title: 'Components/BottomSheet',
  component: BottomSheet,
  parameters: {
    layout: 'fullscreen',
  },
  tags: ['autodocs'],
};

export default meta;
type Story = StoryObj<typeof BottomSheet>;

function BottomSheetDemo() {
  const [open, setOpen] = useState(true);
  return (
    <div style={{ padding: '2rem', textAlign: 'center' }}>
      <button
        type="button"
        onClick={() => setOpen(true)}
        style={{
          padding: '10px 20px',
          background: 'var(--wb-accent-primary, #f59e0b)',
          color: 'var(--wb-accent-contrast, #0f172a)',
          border: 'none',
          borderRadius: '8px',
          fontWeight: 'bold',
          cursor: 'pointer',
        }}
      >
        Open Bottom Sheet Drawer
      </button>
      <BottomSheet isOpen={open} onClose={() => setOpen(false)} title="Mobile Companion Drawer">
        <div style={{ padding: '16px 0', lineHeight: 1.6 }}>
          <p>
            This is the tactile bottom sheet drawer designed for mobile companion UX (Design 0003 /
            ADR 0011). It features swipe-to-dismiss gesture support, focus trapping, and backdrop
            dimming.
          </p>
          <div
            style={{ marginTop: '20px', display: 'flex', gap: '12px', justifyContent: 'flex-end' }}
          >
            <button
              type="button"
              onClick={() => setOpen(false)}
              style={{
                padding: '8px 16px',
                borderRadius: '6px',
                border: '1px solid var(--wb-border-subtle)',
                background: 'transparent',
                color: 'var(--wb-text-primary)',
                cursor: 'pointer',
              }}
            >
              Close
            </button>
          </div>
        </div>
      </BottomSheet>
    </div>
  );
}

export const Interactive: Story = {
  render: () => <BottomSheetDemo />,
};
