import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';
import MatchingRulesSection from './MatchingRulesSection';
import { createRule } from '../../../../../tests/testUtils';

describe('MatchingRulesSection', () => {
  const mockAuthHeader = { Authorization: 'Bearer test-token' };
  const mockSetMessage = vi.fn();
  const mockSetError = vi.fn();

  const mockRules = [
    createRule('rule-1', 'expansion', 'role', 'role', 'pup', 'pet', {
      context_attribute: '',
      context_value: '',
      created_at: '2026-01-01T00:00:00Z',
    }),
    createRule('rule-2', 'cross_match', 'role', 'role', 'handler', 'pet', {
      context_attribute: 'location',
      context_value: 'main_hall',
      created_at: '2026-01-02T00:00:00Z',
    }),
  ];

  const renderSection = (propsOverrides = {}) =>
    render(
      <MatchingRulesSection
        authHeader={mockAuthHeader}
        setMessage={mockSetMessage}
        setError={mockSetError}
        refreshCounter={0}
        {...propsOverrides}
      />
    );

  beforeEach(() => {
    vi.resetAllMocks();
    if (!window.HTMLElement.prototype.scrollIntoView) {
      window.HTMLElement.prototype.scrollIntoView = vi.fn();
    }
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith('/api/rules')) {
        return {
          ok: true,
          json: async () => mockRules,
        } as Response;
      }
      return { ok: true, json: async () => ({}) } as Response;
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('fetches and renders matching rules table', async () => {
    renderSection();

    await waitFor(() => {
      expect(screen.getByRole('cell', { name: /role = pup/i })).toBeInTheDocument();
      expect(screen.getByRole('cell', { name: /role = handler/i })).toBeInTheDocument();
    });
  });

  it('filters rules by text input', async () => {
    renderSection();

    await waitFor(() =>
      expect(screen.getByRole('cell', { name: /role = pup/i })).toBeInTheDocument()
    );

    const filterInput = screen.getByPlaceholderText('Filter rules...');
    fireEvent.change(filterInput, { target: { value: 'handler' } });

    expect(screen.queryByRole('cell', { name: /role = pup/i })).not.toBeInTheDocument();
    expect(screen.getByRole('cell', { name: /role = handler/i })).toBeInTheDocument();
  });

  it('sorts rules when clicking table column headers', async () => {
    renderSection();

    await waitFor(() =>
      expect(screen.getByRole('cell', { name: /role = pup/i })).toBeInTheDocument()
    );

    const headers = screen.getAllByText(/^Type/i);
    // Click table header (first element matching ^Type)
    fireEvent.click(headers[0]);
    fireEvent.click(headers[0]);

    const triggerHeader = screen.getAllByText(/^Trigger/i)[0];
    fireEvent.click(triggerHeader);

    expect(screen.getByRole('cell', { name: /role = pup/i })).toBeInTheDocument();
  });

  it('creates a new rule successfully', async () => {
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith('/api/rules') && init?.method === 'POST') {
        return { ok: true, json: async () => ({ id: 'new-rule-id' }) } as Response;
      }
      return { ok: true, json: async () => mockRules } as Response;
    });

    renderSection();

    await waitFor(() =>
      expect(screen.getByRole('cell', { name: /role = pup/i })).toBeInTheDocument()
    );

    const triggerValueInput = screen.getByLabelText(/Trigger Value/i);
    fireEvent.change(triggerValueInput, { target: { value: 'kitten' } });

    const targetValueInput = screen.getByLabelText(/Target Value/i);
    fireEvent.change(targetValueInput, { target: { value: 'cat' } });

    const submitBtn = screen.getByRole('button', { name: /Add Rule/i });
    fireEvent.click(submitBtn);

    await waitFor(() => {
      expect(mockSetMessage).toHaveBeenCalledWith('Rule created successfully.');
    });
  });

  it('handles error when rule creation fails', async () => {
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith('/api/rules') && init?.method === 'POST') {
        return { ok: false, status: 400 } as Response;
      }
      return { ok: true, json: async () => mockRules } as Response;
    });

    renderSection();

    await waitFor(() =>
      expect(screen.getByRole('cell', { name: /role = pup/i })).toBeInTheDocument()
    );

    const triggerValueInput = screen.getByLabelText(/Trigger Value/i);
    fireEvent.change(triggerValueInput, { target: { value: 'kitten' } });

    const targetValueInput = screen.getByLabelText(/Target Value/i);
    fireEvent.change(targetValueInput, { target: { value: 'cat' } });

    const submitBtn = screen.getByRole('button', { name: /Add Rule/i });
    fireEvent.click(submitBtn);

    await waitFor(() => {
      expect(mockSetError).toHaveBeenCalledWith('Failed to create rule.');
    });
  });

  it('allows editing an existing rule and saving changes', async () => {
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.includes('/api/rules/') && init?.method === 'PUT') {
        return { ok: true, json: async () => ({}) } as Response;
      }
      return { ok: true, json: async () => mockRules } as Response;
    });

    renderSection();

    await waitFor(() =>
      expect(screen.getByRole('cell', { name: /role = pup/i })).toBeInTheDocument()
    );

    const editButtons = screen.getAllByRole('button', { name: /Edit/i });
    fireEvent.click(editButtons[0]);

    expect(screen.getByRole('button', { name: /Save Changes/i })).toBeInTheDocument();

    const cancelBtn = screen.getByRole('button', { name: /Cancel/i });
    fireEvent.click(cancelBtn);

    expect(screen.getByRole('button', { name: /Add Rule/i })).toBeInTheDocument();

    // Click edit again and submit update
    fireEvent.click(editButtons[0]);
    const updateBtn = screen.getByRole('button', { name: /Save Changes/i });
    fireEvent.click(updateBtn);

    await waitFor(() => {
      expect(mockSetMessage).toHaveBeenCalledWith('Rule updated successfully.');
    });
  });

  it('handles rule deletion with confirmation', async () => {
    const confirmSpy = vi.spyOn(globalThis, 'confirm').mockReturnValue(true);
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.includes('/api/rules/') && init?.method === 'DELETE') {
        return { ok: true } as Response;
      }
      return { ok: true, json: async () => mockRules } as Response;
    });

    renderSection();

    await waitFor(() =>
      expect(screen.getByRole('cell', { name: /role = pup/i })).toBeInTheDocument()
    );

    const deleteButtons = screen.getAllByRole('button', { name: /Delete/i });
    fireEvent.click(deleteButtons[0]);

    expect(confirmSpy).toHaveBeenCalled();
    await waitFor(() => {
      expect(mockSetMessage).toHaveBeenCalledWith(expect.stringContaining('Deleted rule'));
    });
  });

  it('cancels deletion if confirm is rejected or handles delete failure', async () => {
    vi.spyOn(globalThis, 'confirm').mockReturnValue(false);

    renderSection();

    await waitFor(() =>
      expect(screen.getByRole('cell', { name: /role = pup/i })).toBeInTheDocument()
    );

    const deleteButtons = screen.getAllByRole('button', { name: /Delete/i });
    fireEvent.click(deleteButtons[0]);

    expect(mockSetMessage).not.toHaveBeenCalledWith(expect.stringContaining('Deleted rule'));

    // Test delete API failure
    vi.spyOn(globalThis, 'confirm').mockReturnValue(true);
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.includes('/api/rules/') && init?.method === 'DELETE') {
        return { ok: false, status: 500 } as Response;
      }
      return { ok: true, json: async () => mockRules } as Response;
    });

    fireEvent.click(deleteButtons[0]);

    await waitFor(() => {
      expect(mockSetError).toHaveBeenCalledWith('Failed to delete rule.');
    });
  });

  it('allows sorting by context and target attributes and updating rule form select fields', async () => {
    renderSection();

    await waitFor(() =>
      expect(screen.getByRole('cell', { name: /role = pup/i })).toBeInTheDocument()
    );

    // Header sort clicks
    fireEvent.click(screen.getByRole('columnheader', { name: /Context/i }));
    fireEvent.click(screen.getByRole('columnheader', { name: /Target/i }));

    // Form inputs and selects
    const selects = screen.getAllByRole('combobox');
    // selects: Type (0), Trigger Attr (1), Target Attr (2), Context Attr (3)
    if (selects.length >= 4) {
      fireEvent.change(selects[0], { target: { value: 'enrichment' } });
      fireEvent.change(selects[1], { target: { value: 'gender' } });
      fireEvent.change(selects[2], { target: { value: 'orientation' } });
      fireEvent.change(selects[3], { target: { value: 'role' } });
    }

    const contextValInput = screen.getByLabelText(/Context Value/i);
    fireEvent.change(contextValInput, { target: { value: 'VIP' } });
    expect(contextValInput).toHaveValue('VIP');
  });
});
