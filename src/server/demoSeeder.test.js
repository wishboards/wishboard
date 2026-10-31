/** @vitest-environment node */
process.env.WISHBOARD_DB_PATH = ':memory:';

import { describe, expect, it, vi, beforeEach } from 'vitest';

// Mock configManager to control profile data in tests
const mockLifestyleConfig = {
  profile: 'lifestyle',
  contact_methods: ['FetLife', 'Phone', 'Email'],
  categories: [
    {
      id: 'gender',
      label: 'Gender',
      suggestions: ['Cis Man', 'Cis Woman', 'Nonbinary', 'Genderqueer', 'Agender'],
    },
    {
      id: 'orientation',
      label: 'Orientation',
      suggestions: ['Straight', 'Gay', 'Lesbian', 'Bisexual', 'Pansexual', 'Asexual', 'Queer'],
    },
    {
      id: 'role',
      label: 'Role',
      suggestions: ['Dominant', 'Submissive', 'Switch', 'Top', 'Bottom', 'Versatile'],
    },
  ],
  rules: [],
  demo_seeds: {
    actions: [
      'I wish to find someone to explore',
      'I wish to connect with people who share my love for',
    ],
    subjects: ['local hiking trails', 'indie tabletop games'],
    contexts: ['over the weekend.', 'in a safe, communicative environment.'],
  },
};

vi.mock('./configManager.js', () => ({
  getEventProfile: vi.fn(() => mockLifestyleConfig),
  getDomainConfig: vi.fn(() => mockLifestyleConfig),
  DEFAULT_EVENT_PROFILE: 'lifestyle',
  clearConfigCache: vi.fn(),
}));

const { getEventProfile } = await import('./configManager.js');
const db = (await import('./db.js')).default;
/** @type {typeof import('./demoSeeder.js').generateDemoData} */
const generateDemoData = (await import('./demoSeeder.js')).generateDemoData;

describe('generateDemoData', () => {
  beforeEach(() => {
    vi.mocked(getEventProfile).mockReturnValue(mockLifestyleConfig);
  });

  it('creates demo users and wishes from profile categories, and clears old data on consecutive runs', async () => {
    // Run first time
    const stats1 = await generateDemoData();
    expect(stats1).toEqual({ usersCreated: 50, wishesCreated: 100 });

    const profileCategories = mockLifestyleConfig.categories;
    const categoryIds = profileCategories.map((c) => c.id);

    // Verify users
    const users = await db.prepare("SELECT * FROM users WHERE role != 'admin'").all();
    expect(users.length).toBe(50);

    let hasWishmailEnabled = false;
    let hasWishmailDisabled = false;
    let hasContacts = false;
    let hasNoContacts = false;

    for (const user of users) {
      expect(user.username).toMatch(/^demo_user_\d+$/);
      expect(user.passphrase_hash).toMatch(/^[0-9a-f]{128}$/); // 64 bytes = 128 hex chars
      expect(user.passphrase_salt).toMatch(/^[0-9a-f]{32}$/); // 16 bytes = 32 hex chars
      expect(user.role).toBe('user');

      // Verify identity attributes use dynamic category keys
      const identityAttributes = JSON.parse(user.identity_attributes);
      for (const catId of categoryIds) {
        expect(Array.isArray(identityAttributes[catId])).toBe(true);
      }

      const contacts = JSON.parse(user.contacts);
      expect(Array.isArray(contacts)).toBe(true);

      if (user.wishmail_enabled === 1) hasWishmailEnabled = true;
      if (user.wishmail_enabled === 0) hasWishmailDisabled = true;

      if (contacts.length > 0) {
        hasContacts = true;
        for (const contact of contacts) {
          // Contacts should come from the profile's contact_methods
          expect(mockLifestyleConfig.contact_methods).toContain(contact.type);
          if (contact.type === 'Phone') {
            expect(contact.value).toMatch(/^555-010\d+$/);
          } else {
            expect(contact.value).toMatch(/^demo_\w+_\d+$/);
          }
        }
      } else {
        hasNoContacts = true;
      }
    }

    // Verify there is a mix of randomized values
    expect(hasWishmailEnabled).toBe(true);
    expect(hasWishmailDisabled).toBe(true);
    expect(hasContacts).toBe(true);
    expect(hasNoContacts).toBe(true);

    // Verify wishes
    const wishes = await db.prepare('SELECT * FROM wishes').all();
    expect(wishes.length).toBe(100);

    let hasWishmailWishEnabled = false;
    let hasWishmailWishDisabled = false;

    const now = Date.now();
    const thirtyDaysAgo = now - 30 * 24 * 60 * 60 * 1000;

    for (const wish of wishes) {
      expect(wish.content.length).toBeGreaterThan(0);
      expect(wish.creator_attributes).toBeDefined();
      expect(wish.desired_attributes).toBeDefined();
      expect(wish.flagged).toBe(0);

      // Verify desired fields are valid JSON with dynamic category keys
      const desiredAttrs = JSON.parse(wish.desired_attributes);
      for (const catId of categoryIds) {
        expect(Array.isArray(desiredAttrs[catId])).toBe(true);
      }

      const contacts = JSON.parse(wish.contacts);
      expect(Array.isArray(contacts)).toBe(true);

      if (wish.wishmail_enabled === 1) hasWishmailWishEnabled = true;
      if (wish.wishmail_enabled === 0) hasWishmailWishDisabled = true;

      const createdTime = new Date(wish.created_at).getTime();
      expect(createdTime).toBeGreaterThanOrEqual(thirtyDaysAgo);
      expect(createdTime).toBeLessThanOrEqual(now);
    }

    expect(hasWishmailWishEnabled).toBe(true);
    expect(hasWishmailWishDisabled).toBe(true);

    // Verify admin exists and was preserved
    const adminCount = (
      await db.prepare("SELECT COUNT(*) AS count FROM users WHERE role = 'admin'").get()
    ).count;
    expect(adminCount).toBe(1);

    // Run a second time to test the clearDemoData functionality
    const stats2 = await generateDemoData();
    expect(stats2).toEqual({ usersCreated: 50, wishesCreated: 100 });

    // Assert counts did not double (correctly cleared)
    expect(
      (await db.prepare("SELECT COUNT(*) AS count FROM users WHERE role != 'admin'").get()).count
    ).toBe(50);
    expect((await db.prepare('SELECT COUNT(*) AS count FROM wishes').get()).count).toBe(100);
    expect(
      (await db.prepare("SELECT COUNT(*) AS count FROM users WHERE role = 'admin'").get()).count
    ).toBe(1);
  }, 15000);

  it('respects custom user_count and wish_count from demo_seeds', async () => {
    vi.mocked(getEventProfile).mockReturnValue({
      ...mockLifestyleConfig,
      demo_seeds: {
        ...mockLifestyleConfig.demo_seeds,
        user_count: 5,
        wish_count: 10,
      },
    });

    const stats = await generateDemoData();
    expect(stats).toEqual({ usersCreated: 5, wishesCreated: 10 });

    expect(
      (await db.prepare("SELECT COUNT(*) AS count FROM users WHERE role != 'admin'").get()).count
    ).toBe(5);
    expect((await db.prepare('SELECT COUNT(*) AS count FROM wishes').get()).count).toBe(10);
  }, 15000);

  it('throws an error when demo_seeds is null', async () => {
    vi.mocked(getEventProfile).mockReturnValue({
      ...mockLifestyleConfig,
      demo_seeds: null,
    });

    await expect(generateDemoData()).rejects.toThrow('No demo seed data found');
  });

  it('throws an error when demo_seeds arrays are empty', async () => {
    vi.mocked(getEventProfile).mockReturnValue({
      ...mockLifestyleConfig,
      demo_seeds: { actions: [], subjects: ['topic'], contexts: ['now.'] },
    });

    await expect(generateDemoData()).rejects.toThrow(
      'demo_seeds must contain non-empty actions, subjects, and contexts arrays'
    );
  });

  it('executes clear, user, and wish statements in a single atomic db.batch write transaction and waits for it to settle', async () => {
    vi.mocked(getEventProfile).mockReturnValue({
      ...mockLifestyleConfig,
      demo_seeds: {
        ...mockLifestyleConfig.demo_seeds,
        user_count: 3,
        wish_count: 6,
      },
    });

    const originalBatch = db.batch.bind(db);
    let batchSettled = false;
    let capturedStmts = [];
    let capturedMode = '';

    const batchSpy = vi.spyOn(db, 'batch').mockImplementation(async (stmts, mode) => {
      capturedStmts = stmts;
      capturedMode = mode;
      await new Promise((resolve) => setTimeout(resolve, 25));
      const res = await originalBatch(stmts, mode);
      batchSettled = true;
      return res;
    });

    try {
      await generateDemoData();
      expect(batchSettled).toBe(true);
      expect(capturedMode).toBe('write');
      // 3 delete stmts + 3 user insert stmts + 6 wish insert stmts = 12 statements
      expect(capturedStmts).toHaveLength(12);
      expect(capturedStmts.slice(0, 3).every((s) => s.sql.startsWith('DELETE FROM'))).toBe(true);
      expect(capturedStmts.slice(3, 6).every((s) => s.sql.includes('INSERT INTO users'))).toBe(
        true
      );
      expect(capturedStmts.slice(6, 12).every((s) => s.sql.includes('INSERT INTO wishes'))).toBe(
        true
      );
    } finally {
      batchSpy.mockRestore();
    }
  });
});
