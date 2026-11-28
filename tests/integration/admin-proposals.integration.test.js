/** @vitest-environment node */
import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import app from '../../src/server/index.js';
import db from '../../src/server/db.js';
import { harvestSignals } from '../../src/server/proposalsManager.js';
import { getRules } from '../../src/server/rulesManager.js';
import { clearProfileOverrides, getEffectiveEventProfile } from '../../src/server/configManager.js';

describe('Admin Taxonomy Governance Queue API (/api/admin/proposals)', () => {
  let adminToken;
  let userToken;

  beforeEach(async () => {
    await db.execute('DELETE FROM taxonomy_proposals');
    await db.execute("DELETE FROM users WHERE username = 'regular-user-gov'");
    await clearProfileOverrides();

    const adminLogin = await request(app)
      .post('/api/users/login')
      .send({ username: 'admin', passphrase: process.env.WISHBOARD_ADMIN_SECRET || 'admin-board' });
    adminToken = adminLogin.body.token;

    await request(app)
      .post('/api/users/register')
      .send({ username: 'regular-user-gov', passphrase: 'apple-river-forest' });
    const userLogin = await request(app)
      .post('/api/users/login')
      .send({ username: 'regular-user-gov', passphrase: 'apple-river-forest' });
    userToken = userLogin.body.token;
  });

  it('requires admin authentication (401 unauthenticated, 403 non-admin)', async () => {
    const unauth = await request(app).get('/api/admin/proposals');
    expect(unauth.status).toBe(401);

    const nonAdmin = await request(app)
      .get('/api/admin/proposals')
      .set('Authorization', `Bearer ${userToken}`);
    expect(nonAdmin.status).toBe(403);
  });

  it('supports listing with quorum filter, editing payload, approving suggestion, aliasing, dismissing, and 422 conflict gating', async () => {
    // Seed 2 proposals: one at quorum (3), one below quorum (1)
    for (let i = 0; i < 3; i++) {
      await harvestSignals([
        {
          proposal_type: 'suggestion',
          key: 'fire-play',
          payload: { categoryId: 'interests', term: 'fire-play' },
        },
      ]);
    }
    await harvestSignals([
      {
        proposal_type: 'rule',
        key: 'bad-cycle',
        payload: {
          rule_type: 'expansion',
          trigger_attribute: 'gender',
          trigger_value: 'enby',
          target_attribute: 'gender',
          target_value: 'nonbinary',
        },
      },
    ]);
    await harvestSignals([
      {
        proposal_type: 'suggestion',
        key: 'wax-play',
        payload: { categoryId: 'interests', term: 'wax-play' },
      },
    ]);
    await harvestSignals([
      {
        proposal_type: 'suggestion',
        key: 'spam-term',
        payload: { categoryId: 'interests', term: 'spam-term' },
      },
    ]);

    // Default GET filters to quorum >= 3
    const listDefault = await request(app)
      .get('/api/admin/proposals')
      .set('Authorization', `Bearer ${adminToken}`);
    expect(listDefault.status).toBe(200);
    expect(listDefault.body.quorumThreshold).toBe(3);
    expect(listDefault.body.belowQuorumCount).toBe(3);
    expect(listDefault.body.proposals.map((p) => p.normalized_key)).toEqual(['fire-play']);

    // includeBelowQuorum=true returns all
    const listAll = await request(app)
      .get('/api/admin/proposals?includeBelowQuorum=true')
      .set('Authorization', `Bearer ${adminToken}`);
    expect(listAll.status).toBe(200);
    expect(listAll.body.proposals).toHaveLength(4);

    const fireProp = listAll.body.proposals.find((p) => p.normalized_key === 'fire-play');
    const badCycleProp = listAll.body.proposals.find((p) => p.normalized_key === 'bad-cycle');
    const waxProp = listAll.body.proposals.find((p) => p.normalized_key === 'wax-play');
    const spamProp = listAll.body.proposals.find((p) => p.normalized_key === 'spam-term');

    // PATCH payload
    const patchRes = await request(app)
      .patch(`/api/admin/proposals/${fireProp.id}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ payload: { categoryId: 'interests', term: 'fire-play', notes: 'curated' } });
    expect(patchRes.status).toBe(200);
    expect(patchRes.body.proposal.proposed_payload.notes).toBe('curated');

    // POST approve suggestion -> promotes to configManager runtime profile
    const approveRes = await request(app)
      .post(`/api/admin/proposals/${fireProp.id}/approve`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({});
    expect(approveRes.status).toBe(200);
    expect(approveRes.body.proposal.status).toBe('approved');
    const effective = await getEffectiveEventProfile();
    expect(effective.categories.find((c) => c.id === 'interests').suggestions).toContain(
      'fire-play'
    );

    // POST approve conflicting rule -> 422
    const badApproveRes = await request(app)
      .post(`/api/admin/proposals/${badCycleProp.id}/approve`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({});
    expect(badApproveRes.status).toBe(422);
    expect(Array.isArray(badApproveRes.body.errors)).toBe(true);
    expect(badApproveRes.body.errors.length).toBeGreaterThan(0);

    // POST alias -> creates expansion rule in rulesManager
    const aliasRes = await request(app)
      .post(`/api/admin/proposals/${waxProp.id}/alias`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        triggerAttribute: 'interests',
        targetAttribute: 'interests',
        targetValue: 'bondage',
      });
    expect(aliasRes.status).toBe(200);
    expect(aliasRes.body.proposal.status).toBe('approved');
    expect(getRules().some((r) => r.trigger_value === 'wax-play')).toBe(true);

    // POST dismiss
    const dismissRes = await request(app)
      .post(`/api/admin/proposals/${spamProp.id}/dismiss`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect(dismissRes.status).toBe(200);
    expect(dismissRes.body.proposal.status).toBe('dismissed');
  });

  it('supports sticker matching, SVG synthesis, and deterministic taxonomy export with admin auth', async () => {
    const unauthMatch = await request(app)
      .post('/api/admin/stickers/match')
      .send({ label: 'Nonbinary', category: 'gender' });
    expect([401, 403]).toContain(unauthMatch.status);

    const unauthExport = await request(app).get('/api/admin/taxonomy/export');
    expect([401, 403]).toContain(unauthExport.status);

    const matchBundled = await request(app)
      .post('/api/admin/stickers/match')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ label: 'Nonbinary', category: 'gender' });
    expect(matchBundled.status).toBe(200);
    expect(matchBundled.body.source).toBe('bundled');
    expect(matchBundled.body.src).toBe('/assets/stickers/nonbinary.svg');
    expect(['CC0-1.0', 'MIT']).toContain(matchBundled.body.license);

    const matchFallback = await request(app)
      .post('/api/admin/stickers/match')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ label: 'Custom Tea Lounge', category: 'interests' });
    expect(matchFallback.status).toBe(200);
    expect(matchFallback.body.source).toBe('synthesized');
    expect(matchFallback.body.svg).toContain('<svg');

    const synthRes = await request(app)
      .post('/api/admin/stickers/synthesize')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ label: '"><script>alert(1)</script>', category: 'interests' });
    expect(synthRes.status).toBe(200);
    expect(synthRes.body.svg).toContain('<svg');
    expect(synthRes.body.svg).not.toContain('<script');

    const exportRes = await request(app)
      .get('/api/admin/taxonomy/export')
      .set('Authorization', `Bearer ${adminToken}`);
    expect(exportRes.status).toBe(200);
    expect(exportRes.body.validation.valid).toBe(true);
    expect(exportRes.body.rulesYaml).toBeTruthy();
    expect(exportRes.body.stickersYaml).toBeTruthy();
    expect(Object.keys(exportRes.body.assets).length).toBeGreaterThan(0);
  });
});
