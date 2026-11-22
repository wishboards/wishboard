import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import React from 'react';
import type { Rule } from '@wishboards/matching-engine';
import AiSuggestionModal from './AiSuggestionModal';
import AiStreamlineCard from './AiStreamlineCard';
import { useEventProfile, type EventProfile } from '../EventProfileContext';
import { createContractFetchMock } from '../utils/contractFetch';

const SAMPLE_RULES: Rule[] = [
  {
    id: 'excl_gay_straight',
    rule_type: 'exclusion',
    trigger_attribute: 'orientation',
    trigger_value: 'gay',
    target_attribute: 'orientation',
    target_value: 'straight',
  },
];

const TEST_PROFILE: EventProfile = {
  profile: 'lifestyle',
  contact_methods: ['Email'],
  categories: [
    { id: 'gender', label: 'Gender', suggestions: ['Trans Man', 'Cis Woman', 'Nonbinary'] },
    {
      id: 'orientation',
      label: 'Orientation',
      suggestions: ['Queer', 'Gay', 'Straight', 'Bisexual'],
    },
    { id: 'role', label: 'Role', suggestions: ['Switch', 'Top', 'Bottom', 'Dominant'] },
  ],
  rules: SAMPLE_RULES,
  stickers: {
    orientation: {
      queer: { type: 'heart', class: 'flag-rainbow' },
      gay: { type: 'heart', class: 'flag-rainbow' },
      straight: { type: 'heart', class: 'flag-straight' },
    },
    gender: {
      trans: { type: 'flag', class: 'flag-trans' },
    },
  },
  realtimeProvider: 'socketio',
  apIp: '',
  isServerless: false,
};

function renderWithProfile(ui: React.ReactElement, profile: EventProfile = TEST_PROFILE) {
  vi.mocked(useEventProfile).mockReturnValue(profile);
  return render(ui);
}

describe('AiSuggestionModal', () => {
  const originalFetch = globalThis.fetch;
  const originalMatchMedia = globalThis.matchMedia;

  beforeEach(() => {
    vi.restoreAllMocks();
    vi.mocked(useEventProfile).mockReturnValue(TEST_PROFILE);
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    globalThis.matchMedia = originalMatchMedia;
  });

  it('defaults creator chips to selected and desired chips to opt-in unselected with guardrail copy', async () => {
    globalThis.fetch = createContractFetchMock([
      {
        method: 'GET',
        path: '/api/wishes/{id}/suggestions',
        response: () => [
          {
            id: 'sugg-1',
            wish_id: 'test-wish-id',
            suggested_creator_attributes: { role: ['Switch'] },
            suggested_desired_attributes: { role: ['Top'] },
            reasoning: 'Found role keywords in wish text.',
            status: 'pending',
            created_at: new Date().toISOString(),
          },
        ],
      },
    ]);

    renderWithProfile(
      <AiSuggestionModal
        wishId="test-wish-id"
        wish={{
          id: 'test-wish-id',
          content: 'Looking for a top to hang out with!',
          creator_attributes: {},
          desired_attributes: {},
        }}
        secret="test-secret"
        onClose={vi.fn()}
      />
    );

    expect(screen.getByText('Loading suggestions...')).toBeInTheDocument();

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /Switch/i })).toHaveAttribute(
        'aria-pressed',
        'true'
      );
    });

    const topChip = screen.getByRole('button', { name: /Top/i });
    expect(topChip).toHaveAttribute('aria-pressed', 'false');
    expect(screen.getByText(/Matching Engine Tip:/i)).toBeInTheDocument();
    expect(screen.getByText(/Found role keywords in wish text./i)).toBeInTheDocument();
    expect(screen.getByText(/Live Card Preview/i)).toBeInTheDocument();

    // Tapping desired chip opts in and reveals strict filter impact banner
    fireEvent.click(topChip);
    expect(topChip).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByText(/Strict filter active:/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Apply Selected (2)' })).toBeInTheDocument();
  });

  it('renders empty and already-reviewed messages cleanly', async () => {
    globalThis.fetch = createContractFetchMock([
      {
        method: 'GET',
        path: '/api/wishes/{id}/suggestions',
        response: () => [],
      },
    ]);

    renderWithProfile(<AiSuggestionModal wishId="test-wish-id" onClose={vi.fn()} />);

    await waitFor(() => {
      expect(screen.getByText('No AI suggestions found for this wish.')).toBeInTheDocument();
    });
  });

  it('calls accept when all creator and desired suggestions are selected, and modify when desired is left opt-in unselected', async () => {
    const onApplied = vi.fn();
    let capturedAction = '';
    let capturedBody: unknown = null;

    globalThis.fetch = createContractFetchMock([
      {
        method: 'GET',
        path: '/api/wishes/{id}/suggestions',
        response: () => [
          {
            id: 'sugg-1',
            wish_id: 'test-wish-id',
            suggested_creator_attributes: { role: ['Switch'] },
            suggested_desired_attributes: { role: ['Top'] },
            status: 'pending',
            created_at: new Date().toISOString(),
          },
        ],
      },
      {
        method: 'POST',
        path: '/api/wishes/{id}/suggestions/{action}',
        response: ({ url, body }) => {
          capturedAction = url.split('?')[0].split('/').pop() || '';
          capturedBody = body;
          return { success: true, message: `Suggestion ${capturedAction}ed successfully.` };
        },
      },
    ]);

    renderWithProfile(
      <AiSuggestionModal
        wishId="test-wish-id"
        wish={{ id: 'test-wish-id', content: 'Switch seeking top', creator_attributes: {} }}
        secret="test-secret"
        onClose={vi.fn()}
        onApplied={onApplied}
      />
    );

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Apply Selected (1)' })).toBeInTheDocument();
    });

    // Leaving desired unselected triggers 'modify' with empty desired_attributes
    fireEvent.click(screen.getByRole('button', { name: 'Apply Selected (1)' }));

    await waitFor(() => {
      expect(onApplied).toHaveBeenCalledTimes(1);
    });
    expect(capturedAction).toBe('modify');
    expect(capturedBody).toEqual({
      secret: 'test-secret',
      creator_attributes: { role: ['Switch'] },
      desired_attributes: {},
    });
  });

  it('calls accept endpoint directly when exact full suggestion matches selection', async () => {
    const onApplied = vi.fn();
    let capturedAction = '';

    globalThis.fetch = createContractFetchMock([
      {
        method: 'GET',
        path: '/api/wishes/{id}/suggestions',
        response: () => [
          {
            id: 'sugg-1',
            wish_id: 'test-wish-id',
            suggested_creator_attributes: { role: ['Switch'] },
            suggested_desired_attributes: {},
            status: 'pending',
            created_at: new Date().toISOString(),
          },
        ],
      },
      {
        method: 'POST',
        path: '/api/wishes/{id}/suggestions/{action}',
        response: ({ url }) => {
          capturedAction = url.split('?')[0].split('/').pop() || '';
          return { success: true, message: 'Suggestion accepted successfully.' };
        },
      },
    ]);

    renderWithProfile(
      <AiSuggestionModal
        wishId="test-wish-id"
        secret="test-secret"
        onClose={vi.fn()}
        onApplied={onApplied}
      />
    );

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Apply Selected (1)' })).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole('button', { name: 'Apply Selected (1)' }));

    await waitFor(() => {
      expect(screen.getByText('Suggestion accepted successfully.')).toBeInTheDocument();
      expect(onApplied).toHaveBeenCalledTimes(1);
    });
    expect(capturedAction).toBe('accept');
  });

  it('rejects suggestions when Reject is clicked', async () => {
    const onApplied = vi.fn();

    globalThis.fetch = createContractFetchMock([
      {
        method: 'GET',
        path: '/api/wishes/{id}/suggestions',
        response: () => [
          {
            id: 'sugg-1',
            wish_id: 'test-wish-id',
            suggested_creator_attributes: { role: ['Switch'] },
            suggested_desired_attributes: {},
            status: 'pending',
            created_at: new Date().toISOString(),
          },
        ],
      },
      {
        method: 'POST',
        path: '/api/wishes/{id}/suggestions/{action}',
        response: () => ({ success: true, message: 'Suggestion rejected successfully.' }),
      },
    ]);

    renderWithProfile(
      <AiSuggestionModal
        wishId="test-wish-id"
        secret="test-secret"
        onClose={vi.fn()}
        onApplied={onApplied}
      />
    );

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Reject' })).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole('button', { name: 'Reject' }));

    await waitFor(() => {
      expect(screen.getByText('Suggestion rejected successfully.')).toBeInTheDocument();
      expect(onApplied).toHaveBeenCalledTimes(1);
    });
  });

  it('pre-validates exclusion conflicts client-side and supports one-tap Keep vs Replace resolution', async () => {
    let submittedBody: unknown = null;

    globalThis.fetch = createContractFetchMock([
      {
        method: 'GET',
        path: '/api/wishes/{id}/suggestions',
        response: () => [
          {
            id: 'sugg-conflict',
            wish_id: 'test-wish-id',
            suggested_creator_attributes: { orientation: ['Straight'] },
            suggested_desired_attributes: {},
            status: 'pending',
            created_at: new Date().toISOString(),
          },
        ],
      },
      {
        method: 'POST',
        path: '/api/wishes/{id}/suggestions/{action}',
        response: ({ body }) => {
          submittedBody = body;
          return { success: true, message: 'Suggestion modified successfully.' };
        },
      },
    ]);

    renderWithProfile(
      <AiSuggestionModal
        wishId="test-wish-id"
        wish={{
          id: 'test-wish-id',
          content: 'Coffee chat',
          creator_attributes: { orientation: ['Gay'] },
          desired_attributes: {},
        }}
        secret="test-secret"
        onClose={vi.fn()}
      />
    );

    // Conflict detected immediately without round-trip; Apply button disabled
    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent(/mutually exclusive/i);
    });
    expect(screen.getByRole('button', { name: /Apply Selected/i })).toBeDisabled();

    // Tap "Keep Gay" -> deselects Straight and clears conflict
    fireEvent.click(screen.getByRole('button', { name: /Keep .*Gay/i }));
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();

    // Re-select Straight to test "Replace with Straight"
    fireEvent.click(screen.getByRole('button', { name: /Straight/i }));
    expect(screen.getByRole('alert')).toHaveTextContent(/mutually exclusive/i);

    fireEvent.click(screen.getByRole('button', { name: /Replace with .*Straight/i }));
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();

    const applyBtn = screen.getByRole('button', { name: /Apply Selected/i });
    expect(applyBtn).not.toBeDisabled();
    fireEvent.click(applyBtn);

    await waitFor(() => {
      expect(screen.getByText('Suggestion modified successfully.')).toBeInTheDocument();
    });
    expect(submittedBody).toEqual({
      secret: 'test-secret',
      creator_attributes: { orientation: ['Straight'] },
      desired_attributes: {},
    });
  });

  it('supports adding custom tags and quick taxonomy chips in the modal', async () => {
    let submittedBody: unknown = null;

    globalThis.fetch = createContractFetchMock([
      {
        method: 'GET',
        path: '/api/wishes/{id}/suggestions',
        response: () => [
          {
            id: 'sugg-add',
            wish_id: 'test-wish-id',
            suggested_creator_attributes: { role: ['Switch'] },
            suggested_desired_attributes: {},
            status: 'pending',
            created_at: new Date().toISOString(),
          },
        ],
      },
      {
        method: 'POST',
        path: '/api/wishes/{id}/suggestions/{action}',
        response: ({ body }) => {
          submittedBody = body;
          return { success: true, message: 'Suggestion modified successfully.' };
        },
      },
    ]);

    renderWithProfile(
      <AiSuggestionModal wishId="test-wish-id" secret="test-secret" onClose={vi.fn()} />
    );

    await waitFor(() => {
      expect(screen.getAllByRole('button', { name: '+ Add tag' })).toHaveLength(2);
    });

    // Open Add tag panel for creator section
    fireEvent.click(screen.getAllByRole('button', { name: '+ Add tag' })[0]);

    // Click quick option pill for Gender: Trans Man
    fireEvent.click(screen.getByRole('button', { name: '+ Trans Man' }));

    // Add custom tag via input
    const input = screen.getByLabelText('Add custom creator tag');
    fireEvent.change(input, { target: { value: 'Genderfluid' } });
    fireEvent.keyDown(input, { key: 'Enter' });

    fireEvent.click(screen.getByRole('button', { name: 'Apply Selected (3)' }));

    await waitFor(() => {
      expect(screen.getByText('Suggestion modified successfully.')).toBeInTheDocument();
    });
    expect(submittedBody).toEqual({
      secret: 'test-secret',
      creator_attributes: { role: ['Switch'], gender: ['Trans Man', 'Genderfluid'] },
      desired_attributes: {},
    });
  });

  it('renders inside BottomSheet with collapsible card preview on mobile viewports', async () => {
    globalThis.matchMedia = vi.fn().mockImplementation((query: string) => ({
      matches: query === '(max-width: 639px)',
      media: query,
      onchange: null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
    }));

    globalThis.fetch = createContractFetchMock([
      {
        method: 'GET',
        path: '/api/wishes/{id}/suggestions',
        response: () => [
          {
            id: 'sugg-mobile',
            wish_id: 'test-wish-id',
            suggested_creator_attributes: { orientation: ['Queer'] },
            suggested_desired_attributes: {},
            status: 'pending',
            created_at: new Date().toISOString(),
          },
        ],
      },
    ]);

    renderWithProfile(
      <AiSuggestionModal
        wishId="test-wish-id"
        wish={{
          id: 'test-wish-id',
          content: 'Coffee and tabletop games!',
          creator_attributes: {},
        }}
        secret="test-secret"
        onClose={vi.fn()}
      />
    );

    await waitFor(() => {
      expect(screen.getByTestId('bottom-sheet-overlay')).toBeInTheDocument();
    });

    const toggleBtn = screen.getByRole('button', { name: /Live Card Preview \(1 sticker\)/i });
    expect(toggleBtn).toHaveAttribute('aria-expanded', 'false');

    fireEvent.click(toggleBtn);
    expect(toggleBtn).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByText('Coffee and tabletop games!')).toBeInTheDocument();
  });

  it('resolves conflicts between two suggested chips and supports restoring removed existing chips', async () => {
    globalThis.fetch = createContractFetchMock([
      {
        method: 'GET',
        path: '/api/wishes/{id}/suggestions',
        response: () => [
          {
            id: 'sugg-dual-conflict',
            wish_id: 'test-wish-id',
            suggested_creator_attributes: { orientation: ['Gay', 'Straight'] },
            suggested_desired_attributes: {},
            status: 'pending',
            created_at: new Date().toISOString(),
          },
        ],
      },
    ]);

    renderWithProfile(
      <AiSuggestionModal
        wishId="test-wish-id"
        wish={{
          id: 'test-wish-id',
          content: 'Hanging out',
          creator_attributes: { role: ['Switch'] },
        }}
        secret="test-secret"
        onClose={vi.fn()}
      />
    );

    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent(/mutually exclusive/i);
    });

    // Keep Gay resolves dual-suggested conflict
    fireEvent.click(screen.getByRole('button', { name: /Keep .*Gay/i }));
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();

    // Tap existing chip Switch to mark removed, then tap again to restore
    const existingSwitch = screen.getByRole('button', { name: /Switch/i });
    fireEvent.click(existingSwitch);
    expect(existingSwitch).toHaveAttribute('aria-pressed', 'false');
    fireEvent.click(existingSwitch);
    expect(existingSwitch).toHaveAttribute('aria-pressed', 'true');
  });

  it('handles already-reviewed suggestions, API errors, custom tag removal, and Escape key', async () => {
    const onClose = vi.fn();
    globalThis.fetch = createContractFetchMock([
      {
        method: 'GET',
        path: '/api/wishes/{id}/suggestions',
        response: () => [
          {
            id: 'sugg-done',
            wish_id: 'test-wish-id',
            suggested_creator_attributes: { role: ['Switch'] },
            suggested_desired_attributes: {},
            status: 'accepted',
            created_at: new Date().toISOString(),
          },
        ],
      },
    ]);

    renderWithProfile(
      <AiSuggestionModal wishId="test-wish-id" secret="test-secret" onClose={onClose} />
    );

    await waitFor(() => {
      expect(
        screen.getByText('All suggestions have already been reviewed (Status: accepted).')
      ).toBeInTheDocument();
    });

    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('shows server error message when suggestion action fails and allows removing custom tag', async () => {
    globalThis.fetch = createContractFetchMock([
      {
        method: 'GET',
        path: '/api/wishes/{id}/suggestions',
        response: () => [
          {
            id: 'sugg-err',
            wish_id: 'test-wish-id',
            suggested_creator_attributes: { role: ['Switch'] },
            suggested_desired_attributes: {},
            status: 'pending',
            created_at: new Date().toISOString(),
          },
        ],
      },
      {
        method: 'POST',
        path: '/api/wishes/{id}/suggestions/{action}',
        status: 400,
        response: () => ({ error: 'Validation failed on server.' }),
      },
    ]);

    renderWithProfile(
      <AiSuggestionModal wishId="test-wish-id" secret="test-secret" onClose={vi.fn()} />
    );

    await waitFor(() => {
      expect(screen.getAllByRole('button', { name: '+ Add tag' })).toHaveLength(2);
    });

    // Add and remove custom tag
    fireEvent.click(screen.getAllByRole('button', { name: '+ Add tag' })[0]);
    fireEvent.click(screen.getByRole('button', { name: '+ Trans Man' }));
    const customBtn = screen.getByTitle('Remove added tag Trans Man');
    fireEvent.click(customBtn);
    expect(screen.queryByTitle('Remove added tag Trans Man')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Close add tag panel' }));

    // Trigger error response
    fireEvent.click(screen.getByRole('button', { name: 'Apply Selected (1)' }));
    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent('Validation failed on server.');
    });
  });

  it('shows signed-in scope control defaulting to This Wish Only with missing-category nudge and profile sync', async () => {
    const onProfileUpdated = vi.fn();
    let submittedBody: unknown = null;

    globalThis.fetch = createContractFetchMock([
      {
        method: 'GET',
        path: '/api/wishes/{id}/suggestions',
        response: () => [
          {
            id: 'sugg-scope',
            wish_id: 'test-wish-id',
            suggested_creator_attributes: { orientation: ['Queer'] },
            suggested_desired_attributes: {},
            status: 'pending',
            created_at: new Date().toISOString(),
          },
        ],
      },
      {
        method: 'POST',
        path: '/api/wishes/{id}/suggestions/{action}',
        response: ({ body }) => {
          submittedBody = body;
          return {
            success: true,
            message: 'Suggestion accepted successfully.',
            profile_updated: true,
            identity_attributes: { role: ['Switch'], orientation: ['Queer'] },
          };
        },
      },
    ]);

    renderWithProfile(
      <AiSuggestionModal
        wishId="test-wish-id"
        wish={{
          id: 'test-wish-id',
          content: 'Queer switch looking for coffee',
          creator_attributes: {},
        }}
        token="valid-user-token"
        userProfileAttributes={{ role: ['Switch'] }}
        onClose={vi.fn()}
        onProfileUpdated={onProfileUpdated}
      />
    );

    await waitFor(() => {
      expect(screen.getByText('This Wish Only')).toBeInTheDocument();
    });

    // Missing category nudge appears because profile has no orientation set
    expect(screen.getByText(/Your Account Profile doesn’t have/i)).toBeInTheDocument();
    expect(screen.getByText(/Orientation/i, { selector: 'strong' })).toBeInTheDocument();

    const checkbox = screen.getByRole('checkbox', { name: /Also update my Account Profile/i });
    expect(checkbox).not.toBeChecked();

    fireEvent.click(checkbox);
    expect(checkbox).toBeChecked();
    expect(screen.getByText('Wish + Profile')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Apply Selected (1)' }));

    await waitFor(() => {
      expect(screen.getByText(/Account Profile updated too/i)).toBeInTheDocument();
      expect(onProfileUpdated).toHaveBeenCalledWith({
        role: ['Switch'],
        orientation: ['Queer'],
      });
    });

    expect(submittedBody).toEqual({
      update_profile: true,
      profile_attributes: { role: ['Switch'], orientation: ['Queer'] },
    });
  });

  it('detects Account Profile-only conflicts and lets signed-in users resolve them inline', async () => {
    let submittedBody: unknown = null;

    globalThis.fetch = createContractFetchMock([
      {
        method: 'GET',
        path: '/api/wishes/{id}/suggestions',
        response: () => [
          {
            id: 'sugg-prof-conflict',
            wish_id: 'test-wish-id',
            suggested_creator_attributes: { orientation: ['Straight'] },
            suggested_desired_attributes: {},
            status: 'pending',
            created_at: new Date().toISOString(),
          },
        ],
      },
      {
        method: 'POST',
        path: '/api/wishes/{id}/suggestions/{action}',
        response: ({ body }) => {
          submittedBody = body;
          return {
            success: true,
            message: 'Suggestion accepted successfully.',
            profile_updated: true,
            identity_attributes: { orientation: ['Straight'] },
          };
        },
      },
    ]);

    renderWithProfile(
      <AiSuggestionModal
        wishId="test-wish-id"
        wish={{ id: 'test-wish-id', content: 'Testing profile conflict', creator_attributes: {} }}
        token="valid-user-token"
        userProfileAttributes={{ orientation: ['Gay'] }}
        onClose={vi.fn()}
      />
    );

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Apply Selected (1)' })).not.toBeDisabled();
    });

    // No wish-level conflict yet; enabling Account Profile update reveals profile conflict
    const checkbox = screen.getByRole('checkbox', { name: /Also update my Account Profile/i });
    fireEvent.click(checkbox);

    expect(screen.getByRole('alert')).toHaveTextContent(/Account Profile conflict:/i);
    expect(screen.getByRole('button', { name: 'Apply Selected (1)' })).toBeDisabled();

    // Clicking "Apply to this wish only" unchecks update_profile and clears conflict
    fireEvent.click(screen.getByRole('button', { name: 'Apply to this wish only' }));
    expect(checkbox).not.toBeChecked();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();

    // Re-check and click "Replace Gay in Profile" -> clears conflict and allows undo
    fireEvent.click(checkbox);
    fireEvent.click(screen.getByRole('button', { name: /Replace .*Gay.* in Profile/i }));
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();

    // Undo replacing Gay brings conflict back, then replace again
    fireEvent.click(screen.getByTitle('Undo replacing Gay in Account Profile'));
    expect(screen.getByRole('alert')).toHaveTextContent(/Account Profile conflict:/i);
    fireEvent.click(screen.getByRole('button', { name: /Replace .*Gay.* in Profile/i }));

    fireEvent.click(screen.getByRole('button', { name: 'Apply Selected (1)' }));

    await waitFor(() => {
      expect(screen.getByText(/Account Profile updated too/i)).toBeInTheDocument();
    });
    expect(submittedBody).toEqual({
      update_profile: true,
      profile_attributes: { orientation: ['Straight'] },
    });
  });

  it('supports optional non-lossy streamlined card text comparison, inline editing, sticker reminder, and submission', async () => {
    const onApplied = vi.fn();
    let capturedAction = '';
    let capturedBody: unknown = null;

    globalThis.fetch = createContractFetchMock([
      {
        method: 'GET',
        path: '/api/wishes/{id}/suggestions',
        response: () => [
          {
            id: 'sugg-streamline',
            wish_id: 'test-wish-id',
            suggested_creator_attributes: { orientation: ['Queer'], role: ['Switch'] },
            suggested_desired_attributes: {},
            suggested_content: '30yo switch looking for board games at the hotel lounge!',
            reasoning: 'Trimmed greeting filler and stickered orientation label.',
            status: 'pending',
            created_at: new Date().toISOString(),
          },
        ],
      },
      {
        method: 'POST',
        path: '/api/wishes/{id}/suggestions/{action}',
        response: ({ url, body }) => {
          capturedAction = url.split('?')[0].split('/').pop() || '';
          capturedBody = body;
          return {
            success: true,
            message: 'Suggestion modified successfully.',
            content_updated: true,
          };
        },
      },
    ]);

    renderWithProfile(
      <AiSuggestionModal
        wishId="test-wish-id"
        wish={{
          id: 'test-wish-id',
          content: 'Hey all, 30yo queer switch looking for board games at the hotel lounge!',
          creator_attributes: {},
        }}
        secret="test-secret"
        onClose={vi.fn()}
        onApplied={onApplied}
      />
    );

    await waitFor(() => {
      expect(screen.getByText(/Polish & Streamline Card Text/i)).toBeInTheDocument();
    });

    // Defaults to Keep Original with savings indicator
    const keepBtn = screen.getByRole('button', { name: 'Keep Original' });
    const useBtn = screen.getByRole('button', { name: 'Use Streamlined' });
    expect(keepBtn).toHaveAttribute('aria-pressed', 'true');
    expect(useBtn).toHaveAttribute('aria-pressed', 'false');
    expect(screen.getByText(/−15 chars/)).toBeInTheDocument();

    // Switch to Use Streamlined -> shows editable textarea and updates live preview
    fireEvent.click(useBtn);
    expect(useBtn).toHaveAttribute('aria-pressed', 'true');
    const textarea = screen.getByLabelText('Streamlined Text (Editable)');
    expect(textarea).toHaveValue('30yo switch looking for board games at the hotel lounge!');

    // Deselect stickered tag (Queer) -> shows deselected-sticker reminder
    fireEvent.click(screen.getByRole('button', { name: /Queer/i }));
    expect(screen.getByText(/You deselected stickered tag\(s\)/i)).toBeInTheDocument();
    expect(screen.getByText('Queer', { selector: 'strong' })).toBeInTheDocument();

    // Deselecting non-stickered Switch does not add Switch to the sticker reminder
    fireEvent.click(screen.getByRole('button', { name: /Switch/i }));
    expect(screen.queryByText(/Queer, Switch/)).not.toBeInTheDocument();

    // Re-select both creator tags -> reminder clears
    fireEvent.click(screen.getByRole('button', { name: /Queer/i }));
    fireEvent.click(screen.getByRole('button', { name: /Switch/i }));
    expect(screen.queryByText(/You deselected stickered tag\(s\)/i)).not.toBeInTheDocument();

    // Edit streamlined text -> shows Reset to AI draft button
    fireEvent.change(textarea, {
      target: { value: '30yo switch looking for tabletop games tonight!' },
    });
    const resetBtn = screen.getByRole('button', { name: /Reset to AI draft/i });
    expect(resetBtn).toBeInTheDocument();

    // Blank text disables Apply and shows empty-draft warning
    fireEvent.change(textarea, { target: { value: '   ' } });
    expect(screen.getByText(/Card text cannot be empty/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Apply Selected (2)' })).toBeDisabled();

    // Reset restores AI draft and re-enables Apply
    fireEvent.click(resetBtn);
    expect(textarea).toHaveValue('30yo switch looking for board games at the hotel lounge!');
    const applyBtn = screen.getByRole('button', { name: 'Apply Selected (2)' });
    expect(applyBtn).not.toBeDisabled();

    // Submit -> sends modify with content
    fireEvent.click(applyBtn);

    await waitFor(() => {
      expect(screen.getByText(/Card text updated\./i)).toBeInTheDocument();
      expect(onApplied).toHaveBeenCalledTimes(1);
    });
    expect(capturedAction).toBe('modify');
    expect(capturedBody).toEqual({
      secret: 'test-secret',
      creator_attributes: { orientation: ['Queer'], role: ['Switch'] },
      desired_attributes: {},
      content: '30yo switch looking for board games at the hotel lounge!',
    });
  });

  it('can toggle back to Keep Original and omits content from payload', async () => {
    let capturedBody: unknown = null;

    globalThis.fetch = createContractFetchMock([
      {
        method: 'GET',
        path: '/api/wishes/{id}/suggestions',
        response: () => [
          {
            id: 'sugg-keep-orig',
            wish_id: 'test-wish-id',
            suggested_creator_attributes: { role: ['Switch'] },
            suggested_desired_attributes: {},
            suggested_content: '30yo switch looking for coffee',
            status: 'pending',
            created_at: new Date().toISOString(),
          },
        ],
      },
      {
        method: 'POST',
        path: '/api/wishes/{id}/suggestions/{action}',
        response: ({ body }) => {
          capturedBody = body;
          return { success: true, message: 'Suggestion accepted successfully.' };
        },
      },
    ]);

    renderWithProfile(
      <AiSuggestionModal
        wishId="test-wish-id"
        wish={{
          id: 'test-wish-id',
          content: 'Hey all, 30yo switch looking for coffee',
          creator_attributes: {},
        }}
        secret="test-secret"
        onClose={vi.fn()}
      />
    );

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Use Streamlined' })).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole('button', { name: 'Use Streamlined' }));
    fireEvent.click(screen.getByRole('button', { name: 'Keep Original' }));
    fireEvent.click(screen.getByRole('button', { name: 'Apply Selected (1)' }));

    await waitFor(() => {
      expect(screen.getByText('Suggestion accepted successfully.')).toBeInTheDocument();
    });
    expect(capturedBody).toEqual({ secret: 'test-secret' });
  });

  it('displays 3x5 overflow nudge on AiStreamlineCard when original text overflows', () => {
    render(
      <AiStreamlineCard
        originalContent="Hey all, this is a very long wish card that overflows a standard 3x5 index card."
        suggestedContent="This is a streamlined version that fits cleanly on the card."
        useStreamlined={false}
        draftContent="This is a streamlined version that fits cleanly on the card."
        isPreviewOverflowing={true}
        deselectedStickeredTags={[]}
        onToggleUseStreamlined={vi.fn()}
        onChangeDraft={vi.fn()}
        onResetDraft={vi.fn()}
      />
    );

    expect(screen.getByText(/Your original text overflows a 3×5 card/i)).toBeInTheDocument();
  });
});
