import type { Meta, StoryObj } from '@storybook/react-vite';
import React, { useState } from 'react';
import PassphraseInput from './PassphraseInput';

const meta: Meta<typeof PassphraseInput> = {
  title: 'Components/PassphraseInput',
  component: PassphraseInput,
  parameters: {
    layout: 'centered',
  },
  tags: ['autodocs'],
};

export default meta;
type Story = StoryObj<typeof PassphraseInput>;

function PassphraseInputDefaultDemo() {
  const [val, setVal] = useState('correct-horse-battery-staple');
  return (
    <div style={{ width: '320px' }}>
      <PassphraseInput
        id="passphrase-story"
        value={val}
        onChange={setVal}
        placeholder="Enter passphrase..."
      />
    </div>
  );
}

export const Default: Story = {
  render: () => <PassphraseInputDefaultDemo />,
};

function PassphraseInputEmptyDemo() {
  const [val, setVal] = useState('');
  return (
    <div style={{ width: '320px' }}>
      <PassphraseInput
        id="passphrase-empty"
        value={val}
        onChange={setVal}
        placeholder="Type or generate a passphrase..."
      />
    </div>
  );
}

export const Empty: Story = {
  render: () => <PassphraseInputEmptyDemo />,
};
