import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import React from 'react';
import AiSuggestionModal from './AiSuggestionModal';
import { createContractFetchMock } from '../utils/contractFetch';

describe('AiSuggestionModal', () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('loads and renders pending AI suggestions', async () => {
    globalThis.fetch = createContractFetchMock([
      {
        method: 'GET',
        path: '/api/wishes/{id}/suggestions',
        response: () => [
          {
            id: 'sugg-1',
            wish_id: 'test-wish-id',
            suggested_creator_attributes: { roles: ['switch'] },
            suggested_desired_attributes: { roles: ['top'] },
            status: 'pending',
            created_at: new Date().toISOString(),
          },
        ],
      },
    ]);

    render(<AiSuggestionModal wishId="test-wish-id" secret="test-secret" onClose={vi.fn()} />);

    expect(screen.getByText('Loading suggestions...')).toBeInTheDocument();

    await waitFor(() => {
      expect(screen.getByText('switch')).toBeInTheDocument();
      expect(screen.getByText('top')).toBeInTheDocument();
    });

    expect(screen.getByRole('button', { name: 'Accept All' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Reject' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Modify' })).toBeInTheDocument();
  });

  it('renders empty message when no suggestions found', async () => {
    globalThis.fetch = createContractFetchMock([
      {
        method: 'GET',
        path: '/api/wishes/{id}/suggestions',
        response: () => [],
      },
    ]);

    render(<AiSuggestionModal wishId="test-wish-id" onClose={vi.fn()} />);

    await waitFor(() => {
      expect(screen.getByText('No AI suggestions found for this wish.')).toBeInTheDocument();
    });
  });

  it('accepts suggestions when Accept All is clicked', async () => {
    const onApplied = vi.fn();
    const onClose = vi.fn();

    globalThis.fetch = createContractFetchMock([
      {
        method: 'GET',
        path: '/api/wishes/{id}/suggestions',
        response: () => [
          {
            id: 'sugg-1',
            wish_id: 'test-wish-id',
            suggested_creator_attributes: { roles: ['switch'] },
            suggested_desired_attributes: { roles: ['top'] },
            status: 'pending',
            created_at: new Date().toISOString(),
          },
        ],
      },
      {
        method: 'POST',
        path: '/api/wishes/{id}/suggestions/{action}',
        response: () => ({ success: true, message: 'Suggestion accepted successfully.' }),
      },
    ]);

    render(
      <AiSuggestionModal
        wishId="test-wish-id"
        secret="test-secret"
        onClose={onClose}
        onApplied={onApplied}
      />
    );

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Accept All' })).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole('button', { name: 'Accept All' }));

    await waitFor(() => {
      expect(screen.getByText('Suggestion accepted successfully.')).toBeInTheDocument();
      expect(onApplied).toHaveBeenCalledTimes(1);
    });
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
            suggested_creator_attributes: { roles: ['switch'] },
            suggested_desired_attributes: { roles: ['top'] },
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

    render(
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

  it('allows modifying suggestions and submitting changes', async () => {
    const onApplied = vi.fn();

    globalThis.fetch = createContractFetchMock([
      {
        method: 'GET',
        path: '/api/wishes/{id}/suggestions',
        response: () => [
          {
            id: 'sugg-1',
            wish_id: 'test-wish-id',
            suggested_creator_attributes: { roles: ['switch'] },
            suggested_desired_attributes: { roles: ['top'] },
            status: 'pending',
            created_at: new Date().toISOString(),
          },
        ],
      },
      {
        method: 'POST',
        path: '/api/wishes/{id}/suggestions/{action}',
        response: () => ({ success: true, message: 'Suggestion modified successfully.' }),
      },
    ]);

    render(
      <AiSuggestionModal
        wishId="test-wish-id"
        secret="test-secret"
        onClose={vi.fn()}
        onApplied={onApplied}
      />
    );

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Modify' })).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole('button', { name: 'Modify' }));

    expect(screen.getByRole('button', { name: 'Save & Apply' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Cancel Edit' })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Save & Apply' }));

    await waitFor(() => {
      expect(screen.getByText('Suggestion modified successfully.')).toBeInTheDocument();
      expect(onApplied).toHaveBeenCalledTimes(1);
    });
  });
});
