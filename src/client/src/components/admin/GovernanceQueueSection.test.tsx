import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import React from 'react';
import GovernanceQueueSection from './GovernanceQueueSection';

const SAMPLE_PROPOSALS = [
  {
    id: 1,
    normalized_key: 'fire-play',
    proposal_type: 'suggestion',
    proposed_payload_json: '{"categoryId":"interests","term":"fire-play"}',
    proposed_payload: { categoryId: 'interests', term: 'fire-play' },
    occurrence_count: 5,
    status: 'pending',
    created_at: '2026-11-26T12:00:00.000Z',
    updated_at: '2026-11-26T12:00:00.000Z',
  },
  {
    id: 2,
    normalized_key: 'bad-rule',
    proposal_type: 'rule',
    proposed_payload_json: '{"rule_type":"expansion"}',
    proposed_payload: { rule_type: 'expansion' },
    occurrence_count: 3,
    status: 'pending',
    created_at: '2026-11-26T12:00:00.000Z',
    updated_at: '2026-11-26T12:00:00.000Z',
  },
];

describe('GovernanceQueueSection', () => {
  const setMessageMock = vi.fn();
  const setErrorMock = vi.fn();
  const onSessionExpiredMock = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('loads proposals, toggles includeBelowQuorum, switches status filter, and renders empty-state message', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async (url) => {
      const urlStr = String(url);
      if (urlStr.includes('status=approved')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            proposals: [],
            quorumThreshold: 3,
            belowQuorumCount: 2,
          }),
        } as Response;
      }
      if (urlStr.includes('includeBelowQuorum=true')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            proposals: [
              ...SAMPLE_PROPOSALS,
              {
                id: 3,
                normalized_key: 'wax-play',
                proposal_type: 'suggestion',
                proposed_payload_json: '{}',
                proposed_payload: {},
                occurrence_count: 1,
                status: 'pending',
                created_at: '2026-11-26T12:00:00.000Z',
                updated_at: '2026-11-26T12:00:00.000Z',
              },
            ],
            quorumThreshold: 3,
            belowQuorumCount: 1,
          }),
        } as Response;
      }
      return {
        ok: true,
        status: 200,
        json: async () => ({
          proposals: SAMPLE_PROPOSALS,
          quorumThreshold: 3,
          belowQuorumCount: 1,
        }),
      } as Response;
    });

    render(
      <GovernanceQueueSection
        authHeader={{ Authorization: 'Bearer admin-token' }}
        setMessage={setMessageMock}
        setError={setErrorMock}
        refreshCounter={0}
        onSessionExpired={onSessionExpiredMock}
      />
    );

    expect(await screen.findByText('fire-play')).toBeTruthy();
    expect(screen.queryByText('wax-play')).toBeNull();

    fireEvent.click(screen.getByRole('checkbox'));
    expect(await screen.findByText('wax-play')).toBeTruthy();

    fireEvent.click(screen.getByRole('checkbox'));
    fireEvent.change(screen.getByLabelText('Proposal status filter'), {
      target: { value: 'approved' },
    });
    expect(
      await screen.findByText(
        /No approved proposals meeting quorum.*2 below-quorum item\(s\) hidden/
      )
    ).toBeTruthy();
    expect(fetchSpy).toHaveBeenCalledTimes(4);
  });

  it('handles 200 approve for non-rule proposal and 422 validation errors + warnings', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (url) => {
      const urlStr = String(url);
      if (urlStr.includes('/1/approve')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            success: true,
            proposal: { ...SAMPLE_PROPOSALS[0], status: 'approved' },
          }),
        } as Response;
      }
      if (urlStr.includes('/2/approve')) {
        return {
          ok: false,
          status: 422,
          json: async () => ({
            error: 'Rule validation failed',
            errors: [{ code: 'EXPANSION_CYCLE', message: 'Cycle detected on role' }],
            warnings: [{ code: 'REDUNDANT_RULE', message: 'Duplicate coverage' }],
          }),
        } as Response;
      }
      return {
        ok: true,
        status: 200,
        json: async () => ({
          proposals: SAMPLE_PROPOSALS,
          quorumThreshold: 3,
          belowQuorumCount: 0,
        }),
      } as Response;
    });

    render(
      <GovernanceQueueSection
        authHeader={{ Authorization: 'Bearer admin-token' }}
        setMessage={setMessageMock}
        setError={setErrorMock}
        refreshCounter={0}
      />
    );

    const approveBtn = await screen.findByRole('button', { name: 'Approve' });
    fireEvent.click(approveBtn);
    await waitFor(() =>
      expect(setMessageMock).toHaveBeenCalledWith('Approved "fire-play" (suggestion).')
    );

    const approveRuleBtn = screen.getByRole('button', { name: 'Approve Rule' });
    fireEvent.click(approveRuleBtn);

    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('EXPANSION_CYCLE');
    expect(alert.textContent).toContain('Cycle detected on role');
    expect(alert.textContent).toContain('REDUNDANT_RULE');
    expect(alert.textContent).toContain('Duplicate coverage');
  });

  it('validates edit JSON, supports cancel buttons, validates alias inputs, and handles alias 422', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (url, init) => {
      const urlStr = String(url);
      const method = init?.method || 'GET';
      if (method === 'PATCH') {
        return {
          ok: true,
          status: 200,
          json: async () => ({ success: true, proposal: SAMPLE_PROPOSALS[0] }),
        } as Response;
      }
      if (urlStr.includes('/alias')) {
        return {
          ok: false,
          status: 422,
          json: async () => ({
            error: 'Alias rule validation failed',
            errors: [{ code: 'EXPANSION_CYCLE', message: 'Alias cycle' }],
            warnings: [],
          }),
        } as Response;
      }
      if (urlStr.includes('/dismiss')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            success: true,
            proposal: { ...SAMPLE_PROPOSALS[0], status: 'dismissed' },
          }),
        } as Response;
      }
      return {
        ok: true,
        status: 200,
        json: async () => ({
          proposals: [SAMPLE_PROPOSALS[0]],
          quorumThreshold: 3,
          belowQuorumCount: 0,
        }),
      } as Response;
    });

    render(
      <GovernanceQueueSection
        authHeader={{ Authorization: 'Bearer admin-token' }}
        setMessage={setMessageMock}
        setError={setErrorMock}
        refreshCounter={0}
      />
    );

    // Edit Payload: invalid JSON, non-object JSON, cancel, then valid save
    fireEvent.click(await screen.findByRole('button', { name: 'Edit Payload' }));
    const textarea = screen.getByLabelText('Edit proposal payload JSON');
    fireEvent.change(textarea, { target: { value: '{bad-json' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save Payload' }));
    expect(setErrorMock).toHaveBeenCalledWith('Invalid JSON payload.');

    fireEvent.change(textarea, { target: { value: '["not-object"]' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save Payload' }));
    expect(setErrorMock).toHaveBeenCalledWith('Payload must be a JSON object.');

    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByLabelText('Edit proposal payload JSON')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Edit Payload' }));
    fireEvent.change(screen.getByLabelText('Edit proposal payload JSON'), {
      target: { value: '{"categoryId":"interests","term":"fire"}' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save Payload' }));
    await waitFor(() => expect(setMessageMock).toHaveBeenCalledWith('Proposal payload updated.'));

    // Alias: empty targetValue validation, cancel, then 422 error banner
    fireEvent.click(screen.getByRole('button', { name: 'Map as Alias' }));
    fireEvent.click(screen.getByRole('button', { name: 'Save Alias Rule' }));
    expect(setErrorMock).toHaveBeenCalledWith('Target attribute and target value are required.');

    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByLabelText('Alias target value')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Map as Alias' }));
    fireEvent.change(screen.getByLabelText('Alias trigger attribute'), {
      target: { value: 'interests' },
    });
    fireEvent.change(screen.getByLabelText('Alias target attribute'), {
      target: { value: 'interests' },
    });
    fireEvent.change(screen.getByLabelText('Alias target value'), {
      target: { value: 'bondage' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save Alias Rule' }));
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('Alias cycle');

    // Dismiss
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }));
    await waitFor(() => expect(setMessageMock).toHaveBeenCalledWith('Dismissed "fire-play".'));
  });

  it('handles non-422 API errors across load, approve, edit, alias, and dismiss', async () => {
    let phase = 'load-fail';
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (url, init) => {
      const urlStr = String(url);
      const method = init?.method || 'GET';
      if (phase === 'load-fail' && method === 'GET') {
        return {
          ok: false,
          status: 500,
          json: async () => ({ error: 'Server error' }),
        } as Response;
      }
      if (method === 'GET') {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            proposals: [SAMPLE_PROPOSALS[0]],
            quorumThreshold: 3,
            belowQuorumCount: 0,
          }),
        } as Response;
      }
      if (urlStr.includes('/approve')) {
        return { ok: false, status: 400, json: async () => ({ error: 'Bad approve' }) } as Response;
      }
      if (method === 'PATCH') {
        return { ok: false, status: 400, json: async () => ({ error: 'Bad patch' }) } as Response;
      }
      if (urlStr.includes('/alias')) {
        return { ok: false, status: 400, json: async () => ({ error: 'Bad alias' }) } as Response;
      }
      return { ok: false, status: 400, json: async () => ({ error: 'Bad dismiss' }) } as Response;
    });

    const { rerender } = render(
      <GovernanceQueueSection
        authHeader={{ Authorization: 'Bearer admin-token' }}
        setMessage={setMessageMock}
        setError={setErrorMock}
        refreshCounter={0}
      />
    );

    await waitFor(() =>
      expect(setErrorMock).toHaveBeenCalledWith('Unable to load taxonomy governance proposals.')
    );

    phase = 'mutations-fail';
    rerender(
      <GovernanceQueueSection
        authHeader={{ Authorization: 'Bearer admin-token' }}
        setMessage={setMessageMock}
        setError={setErrorMock}
        refreshCounter={1}
      />
    );

    fireEvent.click(await screen.findByRole('button', { name: 'Approve' }));
    await waitFor(() => expect(setErrorMock).toHaveBeenCalledWith('Bad approve'));

    fireEvent.click(screen.getByRole('button', { name: 'Edit Payload' }));
    fireEvent.click(screen.getByRole('button', { name: 'Save Payload' }));
    await waitFor(() => expect(setErrorMock).toHaveBeenCalledWith('Bad patch'));

    fireEvent.click(screen.getByRole('button', { name: 'Map as Alias' }));
    fireEvent.change(screen.getByLabelText('Alias target value'), {
      target: { value: 'bondage' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save Alias Rule' }));
    await waitFor(() => expect(setErrorMock).toHaveBeenCalledWith('Bad alias'));

    fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }));
    await waitFor(() => expect(setErrorMock).toHaveBeenCalledWith('Bad dismiss'));
  });

  it('calls onSessionExpired when 401 is returned on load or mutations', async () => {
    let return401OnGet = true;
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (_url, init) => {
      const method = init?.method || 'GET';
      if (method === 'GET' && return401OnGet) {
        return {
          ok: false,
          status: 401,
          json: async () => ({ error: 'Unauthorized' }),
        } as Response;
      }
      if (method === 'GET') {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            proposals: [SAMPLE_PROPOSALS[0]],
            quorumThreshold: 3,
            belowQuorumCount: 0,
          }),
        } as Response;
      }
      return { ok: false, status: 401, json: async () => ({ error: 'Unauthorized' }) } as Response;
    });

    const { rerender } = render(
      <GovernanceQueueSection
        authHeader={{ Authorization: 'Bearer expired' }}
        setMessage={setMessageMock}
        setError={setErrorMock}
        refreshCounter={0}
        onSessionExpired={onSessionExpiredMock}
      />
    );

    await waitFor(() => expect(onSessionExpiredMock).toHaveBeenCalledTimes(1));

    return401OnGet = false;
    rerender(
      <GovernanceQueueSection
        authHeader={{ Authorization: 'Bearer expired' }}
        setMessage={setMessageMock}
        setError={setErrorMock}
        refreshCounter={1}
        onSessionExpired={onSessionExpiredMock}
      />
    );

    fireEvent.click(await screen.findByRole('button', { name: 'Approve' }));
    await waitFor(() => expect(onSessionExpiredMock).toHaveBeenCalledTimes(2));

    fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }));
    await waitFor(() => expect(onSessionExpiredMock).toHaveBeenCalledTimes(3));

    fireEvent.click(screen.getByRole('button', { name: 'Edit Payload' }));
    fireEvent.click(screen.getByRole('button', { name: 'Save Payload' }));
    await waitFor(() => expect(onSessionExpiredMock).toHaveBeenCalledTimes(4));

    fireEvent.click(screen.getByRole('button', { name: 'Map as Alias' }));
    fireEvent.change(screen.getByLabelText('Alias target value'), {
      target: { value: 'bondage' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save Alias Rule' }));
    await waitFor(() => expect(onSessionExpiredMock).toHaveBeenCalledTimes(5));
  });
});
