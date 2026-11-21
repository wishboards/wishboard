import type { Meta, StoryObj } from '@storybook/react-vite';
import AiSuggestionBadge from './AiSuggestionBadge';

const meta: Meta<typeof AiSuggestionBadge> = {
  title: 'Components/AiSuggestionBadge',
  component: AiSuggestionBadge,
  parameters: {
    layout: 'centered',
  },
  tags: ['autodocs'],
};

export default meta;
type Story = StoryObj<typeof AiSuggestionBadge>;

export const SingleSuggestion: Story = {
  args: {
    count: 1,
    onClick: () => alert('Clicked AI Suggestion Badge'),
  },
};

export const MultipleSuggestions: Story = {
  args: {
    count: 3,
    onClick: () => alert('Clicked AI Suggestion Badge'),
  },
};
