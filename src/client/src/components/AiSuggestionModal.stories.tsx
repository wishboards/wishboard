import type { Meta, StoryObj } from '@storybook/react-vite';
import React from 'react';
import AiSuggestionModal from './AiSuggestionModal';

const meta: Meta<typeof AiSuggestionModal> = {
  title: 'Components/AiSuggestionModal',
  component: AiSuggestionModal,
  parameters: { layout: 'fullscreen' },
  tags: ['autodocs'],
};

export default meta;
type Story = StoryObj<typeof AiSuggestionModal>;

interface DemoSuggestion {
  suggested_creator_attributes: Record<string, string[]>;
  suggested_desired_attributes: Record<string, string[]>;
  suggested_content?: string | null;
  reasoning: string;
}

let activeSuggestion: DemoSuggestion | null = null;

function resolveRequestUrl(input: RequestInfo | URL): string {
  if (typeof input === 'string') return input;
  if (input instanceof URL) return input.href;
  return input.url;
}

/** One-time fetch stub: only intercepts the demo wish's suggestion endpoints. */
const baseFetch = globalThis.fetch?.bind(globalThis);
globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = resolveRequestUrl(input);
  if (activeSuggestion && url.includes('/api/wishes/story-wish/suggestions')) {
    const method = (init?.method || 'GET').toUpperCase();
    const body =
      method === 'GET'
        ? [
            {
              id: 'story-sugg',
              wish_id: 'story-wish',
              status: 'pending',
              created_at: new Date().toISOString(),
              ...activeSuggestion,
            },
          ]
        : { success: true, message: 'Suggestion modified successfully.' };
    return new Response(JSON.stringify(body), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  }
  return baseFetch(input, init);
}) as typeof globalThis.fetch;

function StubbedModal({
  suggestion,
  originalContent,
  existingCreator = {},
  signedIn = false,
}: Readonly<{
  suggestion: DemoSuggestion;
  originalContent: string;
  existingCreator?: Record<string, string[]>;
  signedIn?: boolean;
}>) {
  activeSuggestion = suggestion;
  return (
    <AiSuggestionModal
      wishId="story-wish"
      secret="story-secret"
      token={signedIn ? 'story-token' : undefined}
      userProfileAttributes={signedIn ? {} : undefined}
      wish={{
        id: 'story-wish',
        content: originalContent,
        creator_attributes: existingCreator,
        desired_attributes: {},
      }}
      onClose={() => {}}
    />
  );
}

export const DefaultReview: Story = {
  render: () => (
    <StubbedModal
      originalContent="Looking for board game buddies Saturday night!"
      suggestion={{
        suggested_creator_attributes: { orientation: ['Queer'], gender: ['Nonbinary'] },
        suggested_desired_attributes: { interests: ['Board Games'] },
        reasoning: 'Found identity and interest keywords in the wish text.',
      }}
    />
  ),
};

export const SignedInProfileScope: Story = {
  render: () => (
    <StubbedModal
      signedIn
      originalContent="Queer nonbinary cosplayer looking for coffee"
      suggestion={{
        suggested_creator_attributes: { orientation: ['Queer'], gender: ['Nonbinary'] },
        suggested_desired_attributes: {},
        reasoning: 'Signed-in users can also save these to their Account Profile.',
      }}
    />
  ),
};

export const ConflictResolution: Story = {
  render: () => (
    <StubbedModal
      originalContent="Coffee chat"
      existingCreator={{ orientation: ['Gay'] }}
      suggestion={{
        suggested_creator_attributes: { orientation: ['Straight'] },
        suggested_desired_attributes: {},
        reasoning: 'Suggested orientation conflicts with an existing attribute.',
      }}
    />
  ),
};

export const StreamlinedTextComparison: Story = {
  render: () => (
    <StubbedModal
      originalContent="Hey all, 30yo queer switch looking for indie tabletop games at the lounge!"
      suggestion={{
        suggested_creator_attributes: { orientation: ['Queer'] },
        suggested_desired_attributes: {},
        suggested_content: '30yo switch looking for indie tabletop games at the lounge!',
        reasoning: 'Removed greeting filler and a self-label already shown as a sticker.',
      }}
    />
  ),
};
