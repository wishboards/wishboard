import type { Meta, StoryObj } from '@storybook/react-vite';
import React, { useState } from 'react';
import AttributeInput from './AttributeInput';

const meta: Meta<typeof AttributeInput> = {
  title: 'Components/AttributeInput',
  component: AttributeInput,
  parameters: {
    layout: 'centered',
  },
  tags: ['autodocs'],
};

export default meta;
type Story = StoryObj<typeof AttributeInput>;

function OrientationDemo() {
  const [val, setVal] = useState('Queer, Bisexual');
  return (
    <div style={{ width: '420px' }}>
      <AttributeInput
        id="attr-orientation"
        category="orientation"
        value={val}
        onChange={setVal}
        placeholder="Select or type orientation tags..."
        suggestions={['Gay', 'Lesbian', 'Bisexual', 'Pansexual', 'Asexual', 'Queer']}
      />
    </div>
  );
}

export const Orientation: Story = {
  render: () => <OrientationDemo />,
};

function InterestsDemo() {
  const [val, setVal] = useState('Gaming');
  return (
    <div style={{ width: '420px' }}>
      <AttributeInput
        id="attr-interests"
        category="interests"
        value={val}
        onChange={setVal}
        placeholder="Select interests..."
        suggestions={['Gaming', 'Cosplay', 'Board Games', 'Anime', 'VR', 'Karaoke']}
        warning="Adding more interests improves matching accuracy!"
      />
    </div>
  );
}

export const InterestsWithWarning: Story = {
  render: () => <InterestsDemo />,
};
