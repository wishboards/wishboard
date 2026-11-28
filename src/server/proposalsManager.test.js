/** @vitest-environment node */
import { describe, it, expect, beforeEach, vi } from 'vitest';

const importFresh = async () => {
  vi.resetModules();
  const db = (await import('./db.js')).default;
  const rm = await import('./rulesManager.js');
  const cm = await import('./configManager.js');
  const pm = await import('./proposalsManager.js');
  return { db, rm, cm, pm };
};

describe('proposalsManager', () => {
  let db;
  let rm;
  let cm;
  let pm;

  beforeEach(async () => {
    ({ db, rm, cm, pm } = await importFresh());
    await db.execute('DELETE FROM taxonomy_proposals');
    await cm.clearProfileOverrides();
  });

  it('enforces the privacy invariant on taxonomy_proposals schema and payload sanitization', async () => {
    const rs = await db.execute('PRAGMA table_info(taxonomy_proposals)');
    const colNames = rs.rows.map((r) => String(r.name).toLowerCase());
    expect(colNames).not.toContain('wish_id');
    expect(colNames).not.toContain('user_id');
    expect(colNames).not.toContain('content');
    expect(colNames).not.toContain('raw_text');
    expect(colNames).not.toContain('prose');

    const malicious = JSON.parse(
      '{"wishId":"w-1","wish_id":"w-1","userId":"u-1","user_id":"u-1","rawText":"secret prose","raw_text":"x","content":"my wish","prose":"hi","secret":"abc","email":"a@b.com","phone":"555-1234","username":"alice","author":"bob","text":"raw","body":"raw","quote":"raw","note":"raw","urlField":"https://evil.example.com","handleField":"@alice","phoneField":"555-9999","tags":["ok","a@b.com"],"__proto__":{"polluted":true},"constructor":"bad","prototype":"bad","categoryId":"interests","nested":{"user_id":"u-2","quote":"no","term":"fire-play"}}'
    );
    const cleaned = pm.sanitizeProposalPayload(malicious);
    expect(cleaned).toEqual({
      tags: ['ok'],
      categoryId: 'interests',
      nested: { term: 'fire-play' },
    });
    expect(Object.prototype.hasOwnProperty.call(cleaned, '__proto__')).toBe(false);
    expect({}.polluted).toBeUndefined();
    expect(pm.sanitizeProposalPayload(['not-plain'])).toEqual({});

    const piiHarvested = await pm.harvestSignals([
      { proposal_type: 'suggestion', key: 'alice@example.com' },
      { proposal_type: 'suggestion', key: '555-1234' },
      { proposal_type: 'suggestion', key: 'https://example.org/profile' },
      { proposal_type: 'suggestion', key: '@handle' },
    ]);
    expect(piiHarvested).toBe(0);
  });

  it('normalizes keys, deduplicates within a batch, and increments occurrence_count across harvests', async () => {
    expect(pm.normalizeProposalKey('  Fire   Play \n ')).toBe('fire play');

    const count1 = await pm.harvestSignals([
      {
        proposal_type: 'suggestion',
        key: '  Fire   Play ',
        payload: { categoryId: 'interests', content: 'leak' },
      },
      { proposal_type: 'suggestion', key: 'fire play', payload: { categoryId: 'interests' } },
      { proposal_type: 'invalid_type', key: 'ignored' },
      { proposal_type: 'suggestion', key: '   ' },
    ]);
    expect(count1).toBe(1);

    await pm.harvestSignals([
      { proposal_type: 'suggestion', key: 'fire play', payload: { categoryId: 'interests' } },
    ]);
    await pm.harvestSignals([
      { proposal_type: 'suggestion', key: 'FIRE PLAY', payload: { categoryId: 'interests' } },
    ]);

    const { proposals, quorumThreshold, belowQuorumCount } = await pm.listProposals();
    expect(quorumThreshold).toBe(3);
    expect(belowQuorumCount).toBe(0);
    expect(proposals).toHaveLength(1);
    expect(proposals[0].normalized_key).toBe('fire play');
    expect(proposals[0].occurrence_count).toBe(3);
    expect(proposals[0].proposed_payload).toEqual({ categoryId: 'interests' });
  });

  it('ranks by occurrence_count DESC and filters by quorum unless includeBelowQuorum is true', async () => {
    await pm.harvestSignals([{ proposal_type: 'suggestion', key: 'low-term' }]);
    for (let i = 0; i < 3; i++) {
      await pm.harvestSignals([{ proposal_type: 'suggestion', key: 'mid-term' }]);
    }
    for (let i = 0; i < 5; i++) {
      await pm.harvestSignals([{ proposal_type: 'suggestion', key: 'top-term' }]);
    }

    const defaultRes = await pm.listProposals();
    expect(defaultRes.belowQuorumCount).toBe(1);
    expect(defaultRes.proposals.map((p) => p.normalized_key)).toEqual(['top-term', 'mid-term']);

    const allRes = await pm.listProposals({ includeBelowQuorum: true });
    expect(allRes.belowQuorumCount).toBe(1);
    expect(allRes.proposals.map((p) => p.normalized_key)).toEqual([
      'top-term',
      'mid-term',
      'low-term',
    ]);
  });

  it('updates proposal payload and dismisses proposals (without incrementing dismissed proposals)', async () => {
    await pm.harvestSignals([
      { proposal_type: 'suggestion', key: 'wax-play', payload: { categoryId: 'interests' } },
    ]);
    const { proposals } = await pm.listProposals({ includeBelowQuorum: true });
    const id = proposals[0].id;

    const updated = await pm.updateProposalPayload(id, {
      categoryId: 'interests',
      term: 'wax-play',
      rawText: 'should strip',
    });
    expect(updated.proposed_payload).toEqual({ categoryId: 'interests', term: 'wax-play' });
    expect(await pm.updateProposalPayload(999999, {})).toBeNull();

    const dismissed = await pm.dismissProposal(id);
    expect(dismissed.status).toBe('dismissed');
    expect(await pm.dismissProposal(999999)).toBeNull();

    // Re-harvesting a dismissed proposal must NOT increment or re-open it
    await pm.harvestSignals([{ proposal_type: 'suggestion', key: 'wax-play' }]);
    const after = await pm.getProposalById(id);
    expect(after.status).toBe('dismissed');
    expect(after.occurrence_count).toBe(1);
  });

  it('gates rule proposals with validateRuleset (422 on conflict/cycle, promotes valid rules)', async () => {
    // 1. Conflicting expansion cycle: nonbinary -> enby already exists in exp_nonbinary,
    // so adding enby -> nonbinary as expansion triggers EXPANSION_CYCLE.
    await pm.harvestSignals([
      {
        proposal_type: 'rule',
        key: 'cycle-rule',
        payload: {
          rule_type: 'expansion',
          trigger_attribute: 'gender',
          trigger_value: 'enby',
          target_attribute: 'gender',
          target_value: 'nonbinary',
        },
      },
    ]);
    const list1 = await pm.listProposals({ includeBelowQuorum: true });
    const badId = list1.proposals[0].id;

    await expect(pm.approveProposal(badId)).rejects.toMatchObject({
      status: 422,
    });
    expect((await pm.getProposalById(badId)).status).toBe('pending');

    // 2. Valid rule promotion
    await pm.harvestSignals([
      {
        proposal_type: 'rule',
        key: 'rope-shibari',
        payload: {
          rule_type: 'enrichment',
          trigger_attribute: 'interests',
          trigger_value: 'kinbaku',
          target_attribute: 'interests',
          target_value: 'bondage',
        },
      },
    ]);
    const list2 = await pm.listProposals({ includeBelowQuorum: true });
    const goodProposal = list2.proposals.find((p) => p.normalized_key === 'rope-shibari');
    const approved = await pm.approveProposal(goodProposal.id);
    expect(approved.proposal.status).toBe('approved');
    expect(approved.promoted.type).toBe('rule');
    expect(rm.getRules().some((r) => r.id === approved.promoted.rule.id)).toBe(true);
  });

  it('promotes category, suggestion, and sanitized sticker proposals into configManager overrides', async () => {
    await pm.harvestSignals([
      {
        proposal_type: 'category',
        key: 'kinks',
        payload: { id: 'kinks', label: 'Kinks', suggestions: ['rope'] },
      },
      {
        proposal_type: 'suggestion',
        key: 'fire-play',
        payload: { categoryId: 'interests', term: 'fire-play' },
      },
      {
        proposal_type: 'sticker',
        key: 'fire-play',
        payload: {
          categoryId: 'interests',
          term: 'fire-play',
          type: 'svg',
          svg: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="8" /></svg>',
        },
      },
      {
        proposal_type: 'sticker',
        key: 'xss-sticker',
        payload: {
          categoryId: 'interests',
          term: 'xss-sticker',
          type: 'svg',
          svg: '<svg viewBox="0 0 24 24"><script>alert(1)</script></svg>',
        },
      },
    ]);

    const { proposals } = await pm.listProposals({ includeBelowQuorum: true });
    const catProp = proposals.find((p) => p.proposal_type === 'category');
    const suggProp = proposals.find((p) => p.proposal_type === 'suggestion');
    const goodSticker = proposals.find(
      (p) => p.proposal_type === 'sticker' && p.normalized_key === 'fire-play'
    );
    const badSticker = proposals.find(
      (p) => p.proposal_type === 'sticker' && p.normalized_key === 'xss-sticker'
    );

    await pm.approveProposal(catProp.id);
    await pm.approveProposal(suggProp.id);
    await pm.approveProposal(goodSticker.id);
    await expect(pm.approveProposal(badSticker.id)).rejects.toMatchObject({ status: 400 });

    const effective = await cm.getEffectiveEventProfile();
    expect(effective.categories.some((c) => c.id === 'kinks')).toBe(true);
    const interestsCat = effective.categories.find((c) => c.id === 'interests');
    expect(interestsCat.suggestions).toContain('fire-play');
    expect(effective.stickers.interests['fire-play'].type).toBe('svg');
  });

  it('maps proposals as expansion alias rules with validateRuleset gating', async () => {
    await pm.harvestSignals([
      { proposal_type: 'suggestion', key: 'kinbaku' },
      { proposal_type: 'suggestion', key: 'enby' },
    ]);
    const { proposals } = await pm.listProposals({ includeBelowQuorum: true });
    const prop = proposals.find((p) => p.normalized_key === 'kinbaku');
    const cycleProp = proposals.find((p) => p.normalized_key === 'enby');

    // Conflicting alias (enby -> nonbinary creates EXPANSION_CYCLE with exp_nonbinary)
    await expect(
      pm.mapProposalAsAlias(cycleProp.id, {
        triggerAttribute: 'gender',
        targetAttribute: 'gender',
        targetValue: 'nonbinary',
      })
    ).rejects.toMatchObject({ status: 422 });
    expect((await pm.getProposalById(cycleProp.id)).status).toBe('pending');

    const res = await pm.mapProposalAsAlias(prop.id, {
      triggerAttribute: 'interests',
      targetAttribute: 'interests',
      targetValue: 'bondage',
    });
    expect(res.proposal.status).toBe('approved');
    expect(res.promoted.rule.rule_type).toBe('expansion');
    expect(res.promoted.rule.trigger_value).toBe('kinbaku');
    expect(rm.getRules().some((r) => r.id === res.promoted.rule.id)).toBe(true);
  });

  it('enforces 409 idempotency guard on approveProposal and mapProposalAsAlias for non-pending proposals', async () => {
    await pm.harvestSignals([
      { proposal_type: 'suggestion', key: 'rope-art', payload: { categoryId: 'interests' } },
      { proposal_type: 'suggestion', key: 'wax-art', payload: { categoryId: 'interests' } },
    ]);
    const { proposals } = await pm.listProposals({ includeBelowQuorum: true });
    const approvedProp = proposals.find((p) => p.normalized_key === 'rope-art');
    const dismissedProp = proposals.find((p) => p.normalized_key === 'wax-art');

    await pm.approveProposal(approvedProp.id);
    await expect(pm.approveProposal(approvedProp.id)).rejects.toMatchObject({ status: 409 });
    await expect(
      pm.mapProposalAsAlias(approvedProp.id, {
        triggerAttribute: 'interests',
        targetAttribute: 'interests',
        targetValue: 'bondage',
      })
    ).rejects.toMatchObject({ status: 409 });

    await pm.dismissProposal(dismissedProp.id);
    await expect(pm.approveProposal(dismissedProp.id)).rejects.toMatchObject({ status: 409 });
    await expect(
      pm.mapProposalAsAlias(dismissedProp.id, {
        triggerAttribute: 'interests',
        targetAttribute: 'interests',
        targetValue: 'bondage',
      })
    ).rejects.toMatchObject({ status: 409 });
  });

  it('exempts svg and src sticker fields from PII_PATTERN while enforcing SVG/src sanitization', async () => {
    const sanitized = pm.sanitizeProposalPayload({
      categoryId: 'interests',
      label: 'Star Badge',
      svg: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 120"><circle cx="60" cy="60" r="40" fill="#6366f1" /><script>alert(1)</script></svg>',
      src: '/assets/stickers/nonbinary.svg',
      notes: 'contact 5551234',
    });

    expect(sanitized.svg).toContain('viewBox="0 0 120 120"');
    expect(sanitized.svg).not.toContain('<script');
    expect(sanitized.src).toBe('/assets/stickers/nonbinary.svg');
    expect(sanitized.notes).toBeUndefined();

    await pm.harvestSignals([
      {
        proposal_type: 'suggestion',
        key: 'star-badge',
        payload: { categoryId: 'interests', label: 'Star Badge' },
      },
    ]);
    const { proposals } = await pm.listProposals({ includeBelowQuorum: true });
    const prop = proposals.find((p) => p.normalized_key === 'star-badge');

    const res = await pm.approveProposal(prop.id, {
      sticker: {
        type: 'svg',
        svg: '<svg viewBox="0 0 100 100"><circle cx="50" cy="50" r="30" fill="#ec4899" /></svg>',
      },
    });

    expect(res.proposal.status).toBe('approved');
    expect(res.sticker?.type).toBe('svg');
    expect(res.sticker?.svg).toContain('viewBox="0 0 100 100"');

    const effective = await cm.getEffectiveEventProfile();
    expect(effective.stickers.interests['Star Badge']?.type).toBe('svg');
  });

  it('serializes concurrent approveProposal on the same rule proposal so only one succeeds (409 on second)', async () => {
    await pm.harvestSignals([
      {
        proposal_type: 'rule',
        key: 'concurrent-rule-test',
        payload: {
          rule_type: 'expansion',
          trigger_attribute: 'interests',
          trigger_value: 'concurrent-a',
          target_attribute: 'interests',
          target_value: 'concurrent-b',
        },
      },
    ]);
    const { proposals } = await pm.listProposals({ includeBelowQuorum: true });
    const prop = proposals.find((p) => p.normalized_key === 'concurrent-rule-test');

    const results = await Promise.allSettled([
      pm.approveProposal(prop.id),
      pm.approveProposal(prop.id),
    ]);
    const fulfilled = results.filter((r) => r.status === 'fulfilled');
    const rejected = results.filter((r) => r.status === 'rejected');

    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect(rejected[0].reason).toMatchObject({ status: 409 });
    expect(rm.getRules().filter((r) => r.trigger_value === 'concurrent-a')).toHaveLength(1);
  });

  it('serializes concurrent suggestion approvals without losing profile_override updates', async () => {
    await pm.harvestSignals([
      {
        proposal_type: 'suggestion',
        key: 'sugg-alpha',
        payload: { categoryId: 'interests', term: 'sugg-alpha' },
      },
      {
        proposal_type: 'suggestion',
        key: 'sugg-beta',
        payload: { categoryId: 'interests', term: 'sugg-beta' },
      },
    ]);
    const { proposals } = await pm.listProposals({ includeBelowQuorum: true });
    const alpha = proposals.find((p) => p.normalized_key === 'sugg-alpha');
    const beta = proposals.find((p) => p.normalized_key === 'sugg-beta');

    const [r1, r2] = await Promise.all([pm.approveProposal(alpha.id), pm.approveProposal(beta.id)]);
    expect(r1.proposal.status).toBe('approved');
    expect(r2.proposal.status).toBe('approved');

    const effective = await cm.getEffectiveEventProfile();
    const interestSuggestions = effective.categories.find((c) => c.id === 'interests')?.suggestions;
    expect(interestSuggestions).toContain('sugg-alpha');
    expect(interestSuggestions).toContain('sugg-beta');
  });

  it('does not drop legitimate terms like kink.community, poly.network, or b.organic via PII_PATTERN', async () => {
    const count = await pm.harvestSignals([
      { proposal_type: 'suggestion', key: 'kink.community', payload: { categoryId: 'interests' } },
      { proposal_type: 'suggestion', key: 'poly.network', payload: { categoryId: 'interests' } },
      { proposal_type: 'suggestion', key: 'b.organic', payload: { categoryId: 'interests' } },
      { proposal_type: 'suggestion', key: 'spam.com', payload: { categoryId: 'interests' } },
      { proposal_type: 'suggestion', key: 'evil.net', payload: { categoryId: 'interests' } },
      { proposal_type: 'suggestion', key: 'bad.org/path', payload: { categoryId: 'interests' } },
    ]);
    expect(count).toBe(3);
  });

  it('rejects dismissProposal and updateProposalPayload on non-pending proposals with 409', async () => {
    await pm.harvestSignals([
      { proposal_type: 'suggestion', key: 'locked-prop', payload: { categoryId: 'interests' } },
    ]);
    const { proposals } = await pm.listProposals({ includeBelowQuorum: true });
    const prop = proposals.find((p) => p.normalized_key === 'locked-prop');

    await pm.approveProposal(prop.id);
    await expect(pm.dismissProposal(prop.id)).rejects.toMatchObject({ status: 409 });
    await expect(pm.updateProposalPayload(prop.id, { label: 'New' })).rejects.toMatchObject({
      status: 409,
    });
  });

  it('validates image sticker src and disallowed keys in promoteStickerProposal', async () => {
    await pm.harvestSignals([
      { proposal_type: 'sticker', key: 'bad-img-sticker', payload: { categoryId: 'interests' } },
      { proposal_type: 'sticker', key: 'good-img-sticker', payload: { categoryId: 'interests' } },
    ]);
    const { proposals } = await pm.listProposals({ includeBelowQuorum: true });
    const badProp = proposals.find((p) => p.normalized_key === 'bad-img-sticker');
    const goodProp = proposals.find((p) => p.normalized_key === 'good-img-sticker');

    await expect(
      pm.approveProposal(badProp.id, {
        payloadOverride: { categoryId: 'interests', type: 'image', src: 'https://evil.com/x.png' },
      })
    ).rejects.toMatchObject({ status: 400 });

    await expect(
      pm.approveProposal(badProp.id, {
        payloadOverride: { categoryId: 'constructor', type: 'image', src: '/assets/a.svg' },
      })
    ).rejects.toMatchObject({ status: 400 });

    const ok = await pm.approveProposal(goodProp.id, {
      payloadOverride: {
        categoryId: 'interests',
        label: 'Good Img',
        type: 'image',
        src: '/assets/stickers/nonbinary.svg',
      },
    });
    expect(ok.promoted.sticker).toEqual({
      label: 'Good Img',
      type: 'image',
      src: '/assets/stickers/nonbinary.svg',
    });
  });
});
