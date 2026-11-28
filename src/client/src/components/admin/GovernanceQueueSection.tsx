import React, { useState, useEffect, useCallback } from 'react';
import { apiClient, type ApiSchemas } from '../../api/client';
import { sanitizeStickerImageSrc, sanitizeSvg } from '../../../../shared/svgSanitizer';

type TaxonomyProposal = ApiSchemas['TaxonomyProposal'];
type StickerMatchResponse = ApiSchemas['StickerMatchResponse'];
type TaxonomyExportResponse = ApiSchemas['TaxonomyExportResponse'];

interface StickerCandidateState {
  source: 'bundled' | 'synthesized';
  license: string;
  sticker: {
    type: 'svg' | 'image';
    src?: string;
    svg?: string;
  };
}

interface ValidationIssue {
  severity?: string;
  code?: string;
  message: string;
}

interface ValidationErrorState {
  proposalId: number;
  message: string;
  errors: ValidationIssue[];
  warnings: ValidationIssue[];
}

interface GovernanceQueueSectionProps {
  authHeader: Record<string, string>;
  setMessage: (msg: string | null) => void;
  setError: (err: string | null) => void;
  refreshCounter: number;
  onSessionExpired?: () => void;
}

export default function GovernanceQueueSection({
  authHeader,
  setMessage,
  setError,
  refreshCounter,
  onSessionExpired,
}: Readonly<GovernanceQueueSectionProps>) {
  const [proposals, setProposals] = useState<TaxonomyProposal[]>([]);
  const [quorumThreshold, setQuorumThreshold] = useState<number>(3);
  const [belowQuorumCount, setBelowQuorumCount] = useState<number>(0);
  const [statusFilter, setStatusFilter] = useState<'pending' | 'approved' | 'dismissed'>('pending');
  const [includeBelowQuorum, setIncludeBelowQuorum] = useState<boolean>(false);
  const [loading, setLoading] = useState<boolean>(false);
  const [validationBanner, setValidationBanner] = useState<ValidationErrorState | null>(null);

  const [editingId, setEditingId] = useState<number | null>(null);
  const [editPayloadText, setEditPayloadText] = useState<string>('{}');

  const [aliasingId, setAliasingId] = useState<number | null>(null);
  const [aliasTriggerAttr, setAliasTriggerAttr] = useState<string>('interests');
  const [aliasTargetAttr, setAliasTargetAttr] = useState<string>('interests');
  const [aliasTargetValue, setAliasTargetValue] = useState<string>('');

  const [stickerCandidates, setStickerCandidates] = useState<Record<number, StickerCandidateState>>(
    {}
  );
  const [exportBundle, setExportBundle] = useState<TaxonomyExportResponse | null>(null);
  const [exporting, setExporting] = useState<boolean>(false);

  const loadProposals = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const { data, response } = await apiClient.GET('/api/admin/proposals', {
        headers: authHeader,
        params: {
          query: {
            status: statusFilter,
            minQuorum: 3,
            includeBelowQuorum,
          },
        },
      });
      if (response.status === 401) {
        onSessionExpired?.();
        return;
      }
      if (!response.ok || !data) {
        setError('Unable to load taxonomy governance proposals.');
        return;
      }
      setProposals(data.proposals);
      setQuorumThreshold(data.quorumThreshold);
      setBelowQuorumCount(data.belowQuorumCount);
    } finally {
      setLoading(false);
    }
  }, [authHeader, statusFilter, includeBelowQuorum, setError, onSessionExpired]);

  useEffect(() => {
    void loadProposals();
  }, [loadProposals, refreshCounter]);

  const handleValidationFailure = (
    proposalId: number,
    errorPayload: {
      error?: string;
      errors?: ValidationIssue[];
      warnings?: ValidationIssue[];
    } | null
  ) => {
    const message = errorPayload?.error || 'Rule validation failed.';
    setValidationBanner({
      proposalId,
      message,
      errors: Array.isArray(errorPayload?.errors) ? errorPayload.errors : [],
      warnings: Array.isArray(errorPayload?.warnings) ? errorPayload.warnings : [],
    });
    setError(message);
  };

  const handleApprove = async (proposal: TaxonomyProposal) => {
    setError(null);
    setMessage(null);
    setValidationBanner(null);

    const candidate = stickerCandidates[proposal.id];
    const { response, error: apiErr } = await apiClient.POST('/api/admin/proposals/{id}/approve', {
      headers: authHeader,
      params: { path: { id: String(proposal.id) } },
      body: candidate ? { sticker: candidate.sticker } : {},
    });

    if (response.status === 401) {
      onSessionExpired?.();
      return;
    }

    if (response.status === 422) {
      handleValidationFailure(
        proposal.id,
        apiErr as unknown as {
          error?: string;
          errors?: ValidationIssue[];
          warnings?: ValidationIssue[];
        }
      );
      return;
    }

    if (!response.ok) {
      const errObj = apiErr as unknown as { error?: string } | undefined;
      setError(errObj?.error || 'Failed to approve proposal.');
      return;
    }

    setMessage(`Approved "${proposal.normalized_key}" (${proposal.proposal_type}).`);
    await loadProposals();
  };

  const handleDismiss = async (proposal: TaxonomyProposal) => {
    setError(null);
    setMessage(null);
    setValidationBanner(null);

    const { response, error: apiErr } = await apiClient.POST('/api/admin/proposals/{id}/dismiss', {
      headers: authHeader,
      params: { path: { id: String(proposal.id) } },
    });

    if (response.status === 401) {
      onSessionExpired?.();
      return;
    }
    if (!response.ok) {
      const errObj = apiErr as unknown as { error?: string } | undefined;
      setError(errObj?.error || 'Failed to dismiss proposal.');
      return;
    }

    setMessage(`Dismissed "${proposal.normalized_key}".`);
    await loadProposals();
  };

  const startEdit = (proposal: TaxonomyProposal) => {
    setAliasingId(null);
    setEditingId(proposal.id);
    setEditPayloadText(JSON.stringify(proposal.proposed_payload ?? {}, null, 2));
  };

  const submitEdit = async (proposalId: number) => {
    setError(null);
    setMessage(null);
    let parsed: Record<string, unknown>;
    try {
      const raw = JSON.parse(editPayloadText);
      if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
        setError('Payload must be a JSON object.');
        return;
      }
      parsed = raw as Record<string, unknown>;
    } catch {
      setError('Invalid JSON payload.');
      return;
    }

    const { response, error: apiErr } = await apiClient.PATCH('/api/admin/proposals/{id}', {
      headers: authHeader,
      params: { path: { id: String(proposalId) } },
      body: { payload: parsed },
    });

    if (response.status === 401) {
      onSessionExpired?.();
      return;
    }
    if (!response.ok) {
      const errObj = apiErr as unknown as { error?: string } | undefined;
      setError(errObj?.error || 'Failed to update proposal payload.');
      return;
    }

    setEditingId(null);
    setMessage('Proposal payload updated.');
    await loadProposals();
  };

  const startAlias = (proposal: TaxonomyProposal) => {
    setEditingId(null);
    setAliasingId(proposal.id);
    const defaultAttr =
      typeof proposal.proposed_payload?.categoryId === 'string' &&
      proposal.proposed_payload.categoryId.trim()
        ? proposal.proposed_payload.categoryId.trim()
        : 'interests';
    setAliasTriggerAttr(defaultAttr);
    setAliasTargetAttr(defaultAttr);
    setAliasTargetValue('');
  };

  const submitAlias = async (proposal: TaxonomyProposal) => {
    setError(null);
    setMessage(null);
    setValidationBanner(null);

    if (!aliasTargetAttr.trim() || !aliasTargetValue.trim()) {
      setError('Target attribute and target value are required.');
      return;
    }

    const { response, error: apiErr } = await apiClient.POST('/api/admin/proposals/{id}/alias', {
      headers: authHeader,
      params: { path: { id: String(proposal.id) } },
      body: {
        triggerAttribute: aliasTriggerAttr.trim(),
        targetAttribute: aliasTargetAttr.trim(),
        targetValue: aliasTargetValue.trim(),
      },
    });

    if (response.status === 401) {
      onSessionExpired?.();
      return;
    }

    if (response.status === 422) {
      handleValidationFailure(
        proposal.id,
        apiErr as unknown as {
          error?: string;
          errors?: ValidationIssue[];
          warnings?: ValidationIssue[];
        }
      );
      return;
    }

    if (!response.ok) {
      const errObj = apiErr as unknown as { error?: string } | undefined;
      setError(errObj?.error || 'Failed to map proposal as alias.');
      return;
    }

    setAliasingId(null);
    setMessage(`Mapped "${proposal.normalized_key}" as alias to "${aliasTargetValue.trim()}".`);
    await loadProposals();
  };

  const resolveProposalStickerInput = (proposal: TaxonomyProposal) => {
    const payload = proposal.proposed_payload ?? {};
    const label =
      typeof payload.label === 'string' && payload.label.trim()
        ? payload.label.trim()
        : proposal.normalized_key;
    let category = 'interests';
    if (typeof payload.category === 'string' && payload.category.trim()) {
      category = payload.category.trim();
    } else if (typeof payload.categoryId === 'string' && payload.categoryId.trim()) {
      category = payload.categoryId.trim();
    }
    return { label, tag: proposal.normalized_key, category };
  };

  const requestStickerCandidate = async (
    proposal: TaxonomyProposal,
    endpoint: '/api/admin/stickers/match' | '/api/admin/stickers/synthesize',
    failureMessage: string,
    buildResult: (data: Record<string, unknown>) => StickerCandidateState & { message: string }
  ) => {
    setError(null);
    setMessage(null);
    const { data, response } = await apiClient.POST(endpoint, {
      headers: authHeader,
      body: resolveProposalStickerInput(proposal),
    });

    if (response.status === 401) {
      onSessionExpired?.();
      return;
    }
    if (!response.ok || !data) {
      setError(failureMessage);
      return;
    }

    const mapped = buildResult(data as Record<string, unknown>);
    setStickerCandidates((prev) => ({
      ...prev,
      [proposal.id]: {
        source: mapped.source,
        license: mapped.license,
        sticker: mapped.sticker,
      },
    }));
    setMessage(mapped.message);
  };

  const handleMatchSticker = (proposal: TaxonomyProposal) =>
    requestStickerCandidate(
      proposal,
      '/api/admin/stickers/match',
      'Failed to match sticker.',
      (raw) => {
        const matchData = raw as unknown as StickerMatchResponse;
        return {
          source: matchData.source,
          license: matchData.license,
          sticker: matchData.sticker,
          message: `Matched ${matchData.source} sticker (${matchData.license}) for "${proposal.normalized_key}".`,
        };
      }
    );

  const handleSynthesizeSticker = (proposal: TaxonomyProposal) =>
    requestStickerCandidate(
      proposal,
      '/api/admin/stickers/synthesize',
      'Failed to synthesize geometric SVG sticker.',
      (raw) => {
        const synthData = raw as { license: string; sticker: StickerCandidateState['sticker'] };
        return {
          source: 'synthesized',
          license: synthData.license,
          sticker: synthData.sticker,
          message: `Synthesized CC0-1.0 geometric SVG for "${proposal.normalized_key}".`,
        };
      }
    );

  const handleExportYaml = async () => {
    setError(null);
    setMessage(null);
    setExporting(true);
    try {
      const { data, response } = await apiClient.GET('/api/admin/taxonomy/export', {
        headers: authHeader,
        params: { query: { overridesOnly: false } },
      });
      if (response.status === 401) {
        onSessionExpired?.();
        return;
      }
      if (!response.ok || !data) {
        setError('Failed to export taxonomy YAML bundle.');
        return;
      }
      setExportBundle(data);
      setMessage('Exported taxonomy YAML/SVG patch bundle.');

      if (typeof globalThis.URL?.createObjectURL === 'function' && typeof Blob !== 'undefined') {
        const blob = new Blob([data.yaml], { type: 'text/yaml;charset=utf-8' });
        const url = globalThis.URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = 'taxonomy-export.yaml';
        link.click();
        globalThis.URL.revokeObjectURL?.(url);
      }
    } finally {
      setExporting(false);
    }
  };

  return (
    <section aria-label="Taxonomy Governance Queue">
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          flexWrap: 'wrap',
          gap: '12px',
          marginBottom: '16px',
        }}
      >
        <div>
          <h2 style={{ margin: 0 }}>Taxonomy Governance Queue</h2>
          <p className="microtext" style={{ margin: '4px 0 0' }}>
            Review anonymized taxonomy gaps ranked by recurrence (default quorum &ge;{' '}
            {quorumThreshold}).
          </p>
        </div>

        <div style={{ display: 'flex', gap: '12px', alignItems: 'center', flexWrap: 'wrap' }}>
          <label style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
            Status
            <select
              aria-label="Proposal status filter"
              value={statusFilter}
              onChange={(e) =>
                setStatusFilter(e.target.value as 'pending' | 'approved' | 'dismissed')
              }
            >
              <option value="pending">Pending</option>
              <option value="approved">Approved</option>
              <option value="dismissed">Dismissed</option>
            </select>
          </label>

          <label style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
            <input
              type="checkbox"
              checked={includeBelowQuorum}
              onChange={(e) => setIncludeBelowQuorum(e.target.checked)}
            />
            Show below-quorum ({belowQuorumCount} below &ge; {quorumThreshold})
          </label>

          <button
            type="button"
            className="secondary-button"
            onClick={handleExportYaml}
            disabled={exporting}
          >
            {exporting ? 'Exporting...' : 'Export YAML'}
          </button>
        </div>
      </div>

      {exportBundle && (
        <div className="wish-card" style={{ marginBottom: '16px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <strong>Exported YAML/SVG Bundle</strong>
            <button
              type="button"
              className="secondary-button"
              onClick={() => setExportBundle(null)}
            >
              Close
            </button>
          </div>
          <pre
            data-testid="taxonomy-export-preview"
            className="microtext"
            style={{
              marginTop: '8px',
              padding: '8px',
              background: 'rgba(0,0,0,0.2)',
              borderRadius: '4px',
              maxHeight: '220px',
              overflow: 'auto',
            }}
          >
            {exportBundle.yaml}
          </pre>
        </div>
      )}

      {validationBanner && (
        <div
          role="alert"
          className="message error"
          style={{ marginBottom: '16px', padding: '12px' }}
        >
          <strong>Rule Validation Blocked Promotion: {validationBanner.message}</strong>
          {validationBanner.errors.length > 0 && (
            <ul style={{ margin: '8px 0 0 18px' }}>
              {validationBanner.errors.map((issue) => (
                <li key={`${issue.code ?? 'err'}-${issue.message}`}>
                  {issue.code ? `[${issue.code}] ` : ''}
                  {issue.message}
                </li>
              ))}
            </ul>
          )}
          {validationBanner.warnings.length > 0 && (
            <ul style={{ margin: '6px 0 0 18px' }}>
              {validationBanner.warnings.map((issue) => (
                <li key={`${issue.code ?? 'warn'}-${issue.message}`}>
                  Warning{issue.code ? ` [${issue.code}]` : ''}: {issue.message}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {loading && <p>Loading proposals...</p>}

      {!loading && proposals.length === 0 && (
        <div className="wish-card">
          <p>
            No {statusFilter} proposals
            {!includeBelowQuorum && belowQuorumCount > 0
              ? ` meeting quorum (>= ${quorumThreshold}). ${belowQuorumCount} below-quorum item(s) hidden.`
              : '.'}
          </p>
        </div>
      )}

      <div style={{ display: 'grid', gap: '12px' }}>
        {proposals.map((proposal) => {
          const candidate = stickerCandidates[proposal.id];
          const payloadSvg =
            typeof proposal.proposed_payload?.svg === 'string'
              ? proposal.proposed_payload.svg
              : null;
          const payloadSrc =
            typeof proposal.proposed_payload?.src === 'string'
              ? proposal.proposed_payload.src
              : null;
          const toSafeSvgDataUri = (rawSvg: string | null | undefined): string | null => {
            if (typeof rawSvg !== 'string') return null;
            const cleanSvg = sanitizeSvg(rawSvg);
            if (!cleanSvg) return null;
            const withXmlns = /xmlns\s*=/.test(cleanSvg)
              ? cleanSvg
              : cleanSvg.replace('<svg', '<svg xmlns="http://www.w3.org/2000/svg"');
            return `data:image/svg+xml;utf8,${encodeURIComponent(withXmlns)}`;
          };

          const resolvePreviewSrc = () => {
            if (candidate?.sticker.type === 'image') {
              return sanitizeStickerImageSrc(candidate.sticker.src ?? '');
            }
            if (candidate?.sticker.type === 'svg') {
              return toSafeSvgDataUri(candidate.sticker.svg);
            }
            if (payloadSrc) {
              return sanitizeStickerImageSrc(payloadSrc);
            }
            if (payloadSvg) {
              return toSafeSvgDataUri(payloadSvg);
            }
            return null;
          };
          const previewSrc = resolvePreviewSrc();

          return (
            <article
              key={proposal.id}
              className="wish-card"
              data-testid="governance-proposal-row"
              data-key={proposal.normalized_key}
            >
              <div
                data-testid={`proposal-card-${proposal.id}`}
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  gap: '8px',
                  flexWrap: 'wrap',
                }}
              >
                <div>
                  <strong>{proposal.normalized_key}</strong>{' '}
                  <span className="microtext">[{proposal.proposal_type}]</span>
                </div>
                <span className="microtext">
                  Occurrences: <strong>{proposal.occurrence_count}</strong> &middot; Status:{' '}
                  {proposal.status}
                </span>
              </div>

              <div
                data-testid="candidate-sticker-preview"
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '8px',
                  marginTop: '8px',
                }}
              >
                {previewSrc ? (
                  <img
                    src={previewSrc}
                    alt={`${proposal.normalized_key} sticker preview`}
                    width={32}
                    height={32}
                  />
                ) : (
                  <span className="microtext">No sticker selected</span>
                )}
                {candidate && (
                  <span className="microtext">
                    {candidate.source} ({candidate.license})
                  </span>
                )}
              </div>

              <pre
                className="microtext"
                style={{
                  marginTop: '8px',
                  padding: '8px',
                  background: 'rgba(0,0,0,0.2)',
                  borderRadius: '4px',
                  overflowX: 'auto',
                }}
              >
                {JSON.stringify(proposal.proposed_payload ?? {}, null, 2)}
              </pre>

              {editingId === proposal.id && (
                <div style={{ marginTop: '10px', display: 'grid', gap: '8px' }}>
                  <label>
                    Edit Payload JSON
                    <textarea
                      rows={4}
                      aria-label="Edit proposal payload JSON"
                      value={editPayloadText}
                      onChange={(e) => setEditPayloadText(e.target.value)}
                      style={{ width: '100%', fontFamily: 'monospace' }}
                    />
                  </label>
                  <div style={{ display: 'flex', gap: '8px' }}>
                    <button type="button" onClick={() => submitEdit(proposal.id)}>
                      Save Payload
                    </button>
                    <button
                      type="button"
                      className="secondary-button"
                      onClick={() => setEditingId(null)}
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              )}

              {aliasingId === proposal.id && (
                <div
                  style={{
                    marginTop: '10px',
                    display: 'grid',
                    gap: '8px',
                    padding: '10px',
                    border: '1px solid #444',
                    borderRadius: '4px',
                  }}
                >
                  <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                    <label>
                      Trigger Attribute
                      <input
                        aria-label="Alias trigger attribute"
                        value={aliasTriggerAttr}
                        onChange={(e) => setAliasTriggerAttr(e.target.value)}
                      />
                    </label>
                    <label>
                      Target Attribute
                      <input
                        aria-label="Alias target attribute"
                        value={aliasTargetAttr}
                        onChange={(e) => setAliasTargetAttr(e.target.value)}
                      />
                    </label>
                    <label>
                      Target Value
                      <input
                        aria-label="Alias target value"
                        placeholder="e.g. bondage"
                        value={aliasTargetValue}
                        onChange={(e) => setAliasTargetValue(e.target.value)}
                      />
                    </label>
                  </div>
                  <div style={{ display: 'flex', gap: '8px' }}>
                    <button type="button" onClick={() => submitAlias(proposal)}>
                      Save Alias Rule
                    </button>
                    <button
                      type="button"
                      className="secondary-button"
                      onClick={() => setAliasingId(null)}
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              )}

              {proposal.status === 'pending' && (
                <div className="wish-actions" style={{ marginTop: '10px', flexWrap: 'wrap' }}>
                  <button type="button" onClick={() => handleApprove(proposal)}>
                    {proposal.proposal_type === 'rule' ? 'Approve Rule' : 'Approve'}
                  </button>
                  <button
                    type="button"
                    className="secondary-button"
                    onClick={() => handleMatchSticker(proposal)}
                  >
                    Match Sticker
                  </button>
                  <button
                    type="button"
                    className="secondary-button"
                    onClick={() => handleSynthesizeSticker(proposal)}
                  >
                    Synthesize SVG
                  </button>
                  <button
                    type="button"
                    className="secondary-button"
                    onClick={() => startAlias(proposal)}
                  >
                    Map as Alias
                  </button>
                  <button
                    type="button"
                    className="secondary-button"
                    onClick={() => startEdit(proposal)}
                  >
                    Edit Payload
                  </button>
                  <button
                    type="button"
                    className="secondary-button"
                    onClick={() => handleDismiss(proposal)}
                  >
                    Dismiss
                  </button>
                </div>
              )}
            </article>
          );
        })}
      </div>
    </section>
  );
}
