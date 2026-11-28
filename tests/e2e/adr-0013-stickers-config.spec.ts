import { test, expect, type APIRequestContext, type Page } from '@playwright/test';

const ADMIN_USERNAME = 'admin';
const ADMIN_PASSPHRASE = 'e2e-admin-password'; // gitleaks:allow
const OVERRIDES_ENDPOINT = '/api/admin/profile-overrides';

const SAFE_SVG =
  '<svg viewBox="0 0 24 24"><path d="M2 12 L22 12" fill="none" stroke="#ff00aa" stroke-width="2" opacity="0.9" transform="translate(0,0)"/><circle cx="12" cy="12" r="5" fill="#ff00aa"/><rect x="4" y="4" width="6" height="6" fill="#00aaff"/><polygon points="12,2 22,20 2,20" fill="#ffaa00"/><line x1="0" y1="0" x2="24" y2="24" stroke="#ffffff" stroke-width="1"/></svg>';

async function getAdminToken(request: APIRequestContext): Promise<string> {
  const res = await request.post('/api/users/login', {
    data: {
      username: ADMIN_USERNAME,
      passphrase: ADMIN_PASSPHRASE, // gitleaks:allow
    },
  });
  expect(res.ok()).toBe(true);
  const body = await res.json();
  expect(typeof body.token).toBe('string');
  return body.token;
}

async function resetOverrides(request: APIRequestContext, token: string): Promise<void> {
  const res = await request.delete(OVERRIDES_ENDPOINT, {
    headers: { Authorization: `Bearer ${token}` },
  });
  expect([200, 204, 404]).toContain(res.status());
}

async function createWishViaApi(
  request: APIRequestContext,
  content: string,
  creatorAttributes: Record<string, string[]>,
  passphrase = 'E2EStickerSecretPass' // gitleaks:allow
): Promise<string> {
  const res = await request.post('/api/wishes', {
    data: {
      content,
      creator_attributes: creatorAttributes,
      passphrase,
    },
  });
  expect(res.ok()).toBe(true);
  const body = await res.json();
  expect(body.id).toBeTruthy();
  return body.id;
}

async function searchForWishCard(page: Page, uniqueText: string) {
  await page.goto('/#search');
  await expect(page.locator('h1')).toHaveText('Search Wishes');
  await page.fill('input[placeholder="Search existing wishes"]', uniqueText);
  await page.click('button[type="submit"]:has-text("Search")');
  const card = page.locator('.wish-card', { hasText: uniqueText });
  await expect(card).toBeVisible({ timeout: 10000 });
  return card;
}

test.describe('ADR 0013 Feature 5: Declarative SVG & Image Stickers', () => {
  test.afterEach(async ({ request }) => {
    const token = await getAdminToken(request);
    await resetOverrides(request, token);
  });

  test.describe('Tier 1 — Core Feature Coverage', () => {
    test('renders { type: "image", src } sticker on wish card', async ({ page, request }) => {
      const token = await getAdminToken(request);
      const overrideRes = await request.put(OVERRIDES_ENDPOINT, {
        headers: { Authorization: `Bearer ${token}` },
        data: {
          stickers: {
            role: {
              ropebunny: { type: 'image', src: '/assets/stickers/rope-bunny.svg' },
            },
          },
        },
      });
      expect(overrideRes.ok()).toBe(true);

      const uniqueText = `E2E Image Sticker ${Date.now()}`;
      await createWishViaApi(request, uniqueText, { role: ['RopeBunny'] });

      const card = await searchForWishCard(page, uniqueText);
      const imgSticker = card.locator('.identity-stickers .sticker-image img');
      await expect(imgSticker).toBeVisible();
      await expect(imgSticker).toHaveAttribute('src', '/assets/stickers/rope-bunny.svg');
    });

    test('renders sanitized inline/data SVG sticker on wish card', async ({ page, request }) => {
      const token = await getAdminToken(request);
      const overrideRes = await request.put(OVERRIDES_ENDPOINT, {
        headers: { Authorization: `Bearer ${token}` },
        data: {
          stickers: {
            orientation: {
              demisexual: { type: 'svg', svg: SAFE_SVG },
            },
          },
        },
      });
      expect(overrideRes.ok()).toBe(true);

      const uniqueText = `E2E Inline SVG Sticker ${Date.now()}`;
      await createWishViaApi(request, uniqueText, { orientation: ['Demisexual'] });

      const card = await searchForWishCard(page, uniqueText);
      const svgSticker = card.locator('.identity-stickers svg');
      await expect(svgSticker).toBeVisible();
      await expect(svgSticker).toHaveAttribute('viewBox', '0 0 24 24');
    });

    test('coexists with legacy heart, flag, and icon CSS stickers on the same card', async ({
      page,
      request,
    }) => {
      const token = await getAdminToken(request);
      const overrideRes = await request.put(OVERRIDES_ENDPOINT, {
        headers: { Authorization: `Bearer ${token}` },
        data: {
          stickers: {
            role: {
              rigger: { type: 'svg', svg: SAFE_SVG },
            },
          },
        },
      });
      expect(overrideRes.ok()).toBe(true);

      const uniqueText = `E2E Coexist Stickers ${Date.now()}`;
      await createWishViaApi(request, uniqueText, {
        orientation: ['bisexual'],
        gender: ['trans', 'woman'],
        role: ['rigger'],
      });

      const card = await searchForWishCard(page, uniqueText);
      const stickersContainer = card.locator('.identity-stickers');
      await expect(stickersContainer.locator('.sticker-heart')).toBeVisible();
      await expect(stickersContainer.locator('.sticker-flag')).toBeVisible();
      await expect(stickersContainer.locator('.sticker-icon')).toBeVisible();
      await expect(stickersContainer.locator('svg').last()).toBeVisible();
    });

    test('renders declarative stickers in both search and manage-wish views', async ({
      page,
      request,
    }) => {
      const token = await getAdminToken(request);
      const overrideRes = await request.put(OVERRIDES_ENDPOINT, {
        headers: { Authorization: `Bearer ${token}` },
        data: {
          stickers: {
            orientation: {
              polyamorous: { type: 'svg', svg: SAFE_SVG },
            },
          },
        },
      });
      expect(overrideRes.ok()).toBe(true);

      const passphrase = 'ManageViewStickerPass123'; // gitleaks:allow
      const uniqueText = `E2E Manage View Sticker ${Date.now()}`;
      const wishId = await createWishViaApi(
        request,
        uniqueText,
        { orientation: ['polyamorous'] },
        passphrase
      );

      const card = await searchForWishCard(page, uniqueText);
      await expect(card.locator('.identity-stickers svg')).toBeVisible();

      await page.goto(`/#manage-wish?id=${wishId}&secret=${passphrase}`);
      await expect(page.locator('h1')).toHaveText('Manage Your Wish');
      await expect(page.locator('textarea[placeholder="Type your wish here"]')).toHaveValue(
        uniqueText
      );
      await expect(page.locator('.identity-stickers svg')).toBeVisible();
    });

    test('respects .identity-stickers flex layout without clipping inside wish card', async ({
      page,
      request,
    }) => {
      const token = await getAdminToken(request);
      await request.put(OVERRIDES_ENDPOINT, {
        headers: { Authorization: `Bearer ${token}` },
        data: {
          stickers: {
            role: {
              rigger: { type: 'svg', svg: SAFE_SVG },
            },
          },
        },
      });

      const uniqueText = `E2E Sticker Layout ${Date.now()}`;
      await createWishViaApi(request, uniqueText, {
        orientation: ['queer'],
        role: ['rigger'],
      });

      const card = await searchForWishCard(page, uniqueText);
      const innerScale = card.locator('.wish-card-inner-scale');
      const stickers = card.locator('.identity-stickers');
      const innerBox = await innerScale.boundingBox();
      const stickersBox = await stickers.boundingBox();

      expect(innerBox).not.toBeNull();
      expect(stickersBox).not.toBeNull();
      if (innerBox && stickersBox) {
        expect(stickersBox.y).toBeGreaterThanOrEqual(innerBox.y - 1);
        expect(stickersBox.y + stickersBox.height).toBeLessThanOrEqual(
          innerBox.y + innerBox.height + 1
        );
      }
      const displayVal = await stickers.evaluate((el) => getComputedStyle(el).display);
      expect(['flex', 'inline-flex']).toContain(displayVal);
    });
  });

  test.describe('Tier 2 — Boundary & Corner Cases', () => {
    test('missing sticker key renders no broken image or empty sticker element', async ({
      page,
      request,
    }) => {
      const uniqueText = `E2E Missing Sticker Key ${Date.now()}`;
      await createWishViaApi(request, uniqueText, {
        role: ['unmapped_nonexistent_sticker_key_xyz'],
      });

      const card = await searchForWishCard(page, uniqueText);
      await expect(card.locator('.identity-stickers')).toHaveCount(0);
    });

    test('malformed image src (javascript: and data:text/html URIs) are blocked or not rendered as executable src', async ({
      page,
      request,
    }) => {
      const token = await getAdminToken(request);
      const overrideRes = await request.put(OVERRIDES_ENDPOINT, {
        headers: { Authorization: `Bearer ${token}` },
        data: {
          stickers: {
            role: {
              xssimg: { type: 'image', src: 'javascript:alert(1)' },
              xssdataimg: { type: 'image', src: 'data:text/html,<script>alert(1)</script>' },
            },
          },
        },
      });
      if (overrideRes.ok()) {
        const uniqueText = `E2E Malformed Image Src ${Date.now()}`;
        await createWishViaApi(request, uniqueText, { role: ['xssimg', 'xssdataimg'] });
        const card = await searchForWishCard(page, uniqueText);
        await expect(card.locator('img[src^="javascript:"]')).toHaveCount(0);
        await expect(card.locator('img[src^="data:text/html"]')).toHaveCount(0);
      } else {
        expect([400, 422]).toContain(overrideRes.status());
      }
    });

    test('empty attributes object renders zero stickers', async ({ page, request }) => {
      const uniqueText = `E2E Empty Attrs Sticker ${Date.now()}`;
      await createWishViaApi(request, uniqueText, {});

      const card = await searchForWishCard(page, uniqueText);
      await expect(card.locator('.identity-stickers')).toHaveCount(0);
    });

    test('duplicate attribute values do not crash or duplicate uncontrollably', async ({
      page,
      request,
    }) => {
      const uniqueText = `E2E Duplicate Attrs ${Date.now()}`;
      await createWishViaApi(request, uniqueText, {
        orientation: ['queer', 'queer', 'queer'],
      });

      const card = await searchForWishCard(page, uniqueText);
      await expect(card.locator('.identity-stickers')).toBeVisible();
      const count = await card.locator('.identity-stickers > *').count();
      expect(count).toBeGreaterThanOrEqual(1);
      expect(count).toBeLessThanOrEqual(3);
    });

    test('mobile viewport (375x667) preserves sticker layout without horizontal overflow', async ({
      page,
      request,
    }) => {
      await page.setViewportSize({ width: 375, height: 667 });
      const uniqueText = `E2E Mobile Sticker ${Date.now()}`;
      await createWishViaApi(request, uniqueText, {
        orientation: ['pansexual'],
        gender: ['nonbinary'],
      });

      const card = await searchForWishCard(page, uniqueText);
      const stickersBox = await card.locator('.identity-stickers').boundingBox();
      expect(stickersBox).not.toBeNull();
      if (stickersBox) {
        expect(stickersBox.x + stickersBox.width).toBeLessThanOrEqual(376);
      }
      const hasOverflow = await page.evaluate(
        () => globalThis.document.documentElement.scrollWidth > globalThis.innerWidth
      );
      expect(hasOverflow).toBe(false);
    });
  });
});

test.describe('ADR 0013 Feature 6: Strict SVG Allowlist Sanitizer', () => {
  test.afterEach(async ({ request }) => {
    const token = await getAdminToken(request);
    await resetOverrides(request, token);
  });

  test.describe('Tier 1 — Core Feature Coverage', () => {
    test('preserves <svg viewBox="..."> root element and viewBox attribute', async ({
      page,
      request,
    }) => {
      const token = await getAdminToken(request);
      const res = await request.put(OVERRIDES_ENDPOINT, {
        headers: { Authorization: `Bearer ${token}` },
        data: {
          stickers: {
            role: {
              svgtest1: {
                type: 'svg',
                svg: '<svg viewBox="0 0 32 32"><circle cx="16" cy="16" r="10" fill="#f59e0b"/></svg>',
              },
            },
          },
        },
      });
      expect(res.ok()).toBe(true);

      const uniqueText = `E2E SVG ViewBox ${Date.now()}`;
      await createWishViaApi(request, uniqueText, { role: ['svgtest1'] });
      const card = await searchForWishCard(page, uniqueText);
      const svg = card.locator('.identity-stickers svg');
      await expect(svg).toHaveAttribute('viewBox', '0 0 32 32');
    });

    test('preserves <path> with safe geometric attributes (d, fill, stroke, stroke-width, opacity, transform)', async ({
      page,
      request,
    }) => {
      const token = await getAdminToken(request);
      const res = await request.put(OVERRIDES_ENDPOINT, {
        headers: { Authorization: `Bearer ${token}` },
        data: {
          stickers: {
            role: {
              svgpath: {
                type: 'svg',
                svg: '<svg viewBox="0 0 24 24"><path d="M4 12 L20 12" fill="none" stroke="#10b981" stroke-width="3" opacity="0.8" transform="rotate(45 12 12)"/></svg>',
              },
            },
          },
        },
      });
      expect(res.ok()).toBe(true);

      const uniqueText = `E2E SVG Path ${Date.now()}`;
      await createWishViaApi(request, uniqueText, { role: ['svgpath'] });
      const card = await searchForWishCard(page, uniqueText);
      const pathEl = card.locator('.identity-stickers svg path');
      await expect(pathEl).toHaveAttribute('d', 'M4 12 L20 12');
      await expect(pathEl).toHaveAttribute('stroke', '#10b981');
    });

    test('preserves <circle> with cx, cy, r attributes', async ({ page, request }) => {
      const token = await getAdminToken(request);
      await request.put(OVERRIDES_ENDPOINT, {
        headers: { Authorization: `Bearer ${token}` },
        data: {
          stickers: {
            role: {
              svgcircle: {
                type: 'svg',
                svg: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="8" fill="#ec4899"/></svg>',
              },
            },
          },
        },
      });

      const uniqueText = `E2E SVG Circle ${Date.now()}`;
      await createWishViaApi(request, uniqueText, { role: ['svgcircle'] });
      const card = await searchForWishCard(page, uniqueText);
      const circleEl = card.locator('.identity-stickers svg circle');
      await expect(circleEl).toHaveAttribute('cx', '12');
      await expect(circleEl).toHaveAttribute('r', '8');
    });

    test('preserves <rect> with x, y, width, height attributes', async ({ page, request }) => {
      const token = await getAdminToken(request);
      await request.put(OVERRIDES_ENDPOINT, {
        headers: { Authorization: `Bearer ${token}` },
        data: {
          stickers: {
            role: {
              svgrect: {
                type: 'svg',
                svg: '<svg viewBox="0 0 24 24"><rect x="2" y="4" width="20" height="16" fill="#6366f1"/></svg>',
              },
            },
          },
        },
      });

      const uniqueText = `E2E SVG Rect ${Date.now()}`;
      await createWishViaApi(request, uniqueText, { role: ['svgrect'] });
      const card = await searchForWishCard(page, uniqueText);
      const rectEl = card.locator('.identity-stickers svg rect');
      await expect(rectEl).toHaveAttribute('width', '20');
      await expect(rectEl).toHaveAttribute('height', '16');
    });

    test('preserves <polygon> and <line> geometric elements', async ({ page, request }) => {
      const token = await getAdminToken(request);
      await request.put(OVERRIDES_ENDPOINT, {
        headers: { Authorization: `Bearer ${token}` },
        data: {
          stickers: {
            role: {
              svgpoly: {
                type: 'svg',
                svg: '<svg viewBox="0 0 24 24"><polygon points="12,2 22,20 2,20" fill="#eab308"/><line x1="2" y1="22" x2="22" y2="22" stroke="#ffffff" stroke-width="2"/></svg>',
              },
            },
          },
        },
      });

      const uniqueText = `E2E SVG PolyLine ${Date.now()}`;
      await createWishViaApi(request, uniqueText, { role: ['svgpoly'] });
      const card = await searchForWishCard(page, uniqueText);
      await expect(card.locator('.identity-stickers svg polygon')).toHaveAttribute(
        'points',
        '12,2 22,20 2,20'
      );
      await expect(card.locator('.identity-stickers svg line')).toHaveAttribute('x2', '22');
    });
  });

  test.describe('Tier 2 — Boundary & Corner Cases (XSS & Injection)', () => {
    test('strips <script> and mixed-case <ScRiPt> tags from SVG payloads while preserving safe sibling geometry', async ({
      page,
      request,
    }) => {
      const token = await getAdminToken(request);
      const res = await request.put(OVERRIDES_ENDPOINT, {
        headers: { Authorization: `Bearer ${token}` },
        data: {
          stickers: {
            role: {
              xssscript: {
                type: 'svg',
                svg: '<svg viewBox="0 0 24 24"><script>globalThis.__xssFired=true</script><ScRiPt>globalThis.__xssFired=true</ScRiPt><circle cx="12" cy="12" r="6" fill="#fff"/></svg>',
              },
            },
          },
        },
      });
      if (res.ok()) {
        const uniqueText = `E2E XSS Script ${Date.now()}`;
        await createWishViaApi(request, uniqueText, { role: ['xssscript'] });
        const card = await searchForWishCard(page, uniqueText);
        await expect(card.locator('.identity-stickers script')).toHaveCount(0);
        await expect(card.locator('.identity-stickers svg circle')).toBeVisible();
        const xssFired = await page.evaluate(() =>
          Boolean((globalThis as Record<string, unknown>).__xssFired)
        );
        expect(xssFired).toBe(false);
      } else {
        expect([400, 422]).toContain(res.status());
      }
    });

    test('strips onload, onclick, onbegin, onfocus, and all on* event handler attributes while preserving safe sibling geometry', async ({
      page,
      request,
    }) => {
      const token = await getAdminToken(request);
      const res = await request.put(OVERRIDES_ENDPOINT, {
        headers: { Authorization: `Bearer ${token}` },
        data: {
          stickers: {
            role: {
              xsson: {
                type: 'svg',
                svg: '<svg viewBox="0 0 24 24" onload="alert(1)" onfocus="alert(4)"><circle cx="12" cy="12" r="6" onclick="alert(2)" onmouseover="alert(3)" onbegin="alert(5)" fill="#fff"/></svg>',
              },
            },
          },
        },
      });
      if (res.ok()) {
        const uniqueText = `E2E XSS OnEvent ${Date.now()}`;
        await createWishViaApi(request, uniqueText, { role: ['xsson'] });
        const card = await searchForWishCard(page, uniqueText);
        await expect(card.locator('.identity-stickers svg circle')).toBeVisible();
        const svgHtml = await card.locator('.identity-stickers').innerHTML();
        expect(svgHtml.toLowerCase()).not.toMatch(
          /\bonload\b|\bonclick\b|\bonmouseover\b|\bonerror\b|\bonbegin\b|\bonfocus\b/
        );
      } else {
        expect([400, 422]).toContain(res.status());
      }
    });

    test('strips <foreignObject> elements and nested HTML payloads while preserving safe sibling geometry', async ({
      page,
      request,
    }) => {
      const token = await getAdminToken(request);
      const res = await request.put(OVERRIDES_ENDPOINT, {
        headers: { Authorization: `Bearer ${token}` },
        data: {
          stickers: {
            role: {
              xssfo: {
                type: 'svg',
                svg: '<svg viewBox="0 0 24 24"><foreignObject width="24" height="24"><body><img src="x" onerror="alert(1)"/></body></foreignObject><rect x="2" y="2" width="10" height="10" fill="#fff"/></svg>',
              },
            },
          },
        },
      });
      if (res.ok()) {
        const uniqueText = `E2E XSS ForeignObject ${Date.now()}`;
        await createWishViaApi(request, uniqueText, { role: ['xssfo'] });
        const card = await searchForWishCard(page, uniqueText);
        await expect(card.locator('.identity-stickers foreignObject')).toHaveCount(0);
        await expect(card.locator('.identity-stickers svg rect')).toBeVisible();
      } else {
        expect([400, 422]).toContain(res.status());
      }
    });

    test('strips style="...url(...)" and external href / xlink:href URLs while preserving safe sibling geometry', async ({
      page,
      request,
    }) => {
      const token = await getAdminToken(request);
      const res = await request.put(OVERRIDES_ENDPOINT, {
        headers: { Authorization: `Bearer ${token}` },
        data: {
          stickers: {
            role: {
              xssurl: {
                type: 'svg',
                svg: '<svg viewBox="0 0 24 24"><path d="M0 0 L24 24" style="background:url(https://evil.example/track.png)" href="https://evil.example/x" xlink:href="https://evil.example/y"/></svg>',
              },
            },
          },
        },
      });
      if (res.ok()) {
        const uniqueText = `E2E XSS ExternalURL ${Date.now()}`;
        await createWishViaApi(request, uniqueText, { role: ['xssurl'] });
        const card = await searchForWishCard(page, uniqueText);
        await expect(card.locator('.identity-stickers svg path')).toBeVisible();
        const html = await card.locator('.identity-stickers').innerHTML();
        expect(html.toLowerCase()).not.toContain('evil.example');
        expect(html.toLowerCase()).not.toMatch(/url\s*\(/);
      } else {
        expect([400, 422]).toContain(res.status());
      }
    });

    test('rejects or strips non-allowlisted tags (<iframe>, <object>, <embed>) while preserving safe sibling geometry', async ({
      page,
      request,
    }) => {
      const token = await getAdminToken(request);
      const res = await request.put(OVERRIDES_ENDPOINT, {
        headers: { Authorization: `Bearer ${token}` },
        data: {
          stickers: {
            role: {
              xssiframe: {
                type: 'svg',
                svg: '<svg viewBox="0 0 24 24"><iframe src="https://evil.example"></iframe><object data="https://evil.example"></object><embed src="https://evil.example"/><circle cx="12" cy="12" r="4" fill="#fff"/></svg>',
              },
            },
          },
        },
      });
      if (res.ok()) {
        const uniqueText = `E2E XSS Iframe ${Date.now()}`;
        await createWishViaApi(request, uniqueText, { role: ['xssiframe'] });
        const card = await searchForWishCard(page, uniqueText);
        await expect(card.locator('.identity-stickers iframe')).toHaveCount(0);
        await expect(card.locator('.identity-stickers object')).toHaveCount(0);
        await expect(card.locator('.identity-stickers embed')).toHaveCount(0);
        await expect(card.locator('.identity-stickers svg circle')).toBeVisible();
      } else {
        expect([400, 422]).toContain(res.status());
      }
    });
  });
});

test.describe('ADR 0013 Feature 7: DB-over-YAML Profile Override Layer', () => {
  test.afterEach(async ({ request }) => {
    const token = await getAdminToken(request);
    await resetOverrides(request, token);
  });

  test.describe('Tier 1 — Core Feature Coverage', () => {
    test('GET /api/config serves merged YAML + DB overrides for categories, suggestions, and stickers', async ({
      request,
    }) => {
      const token = await getAdminToken(request);
      const customSuggestion = `E2E Custom Role ${Date.now()}`;
      const putRes = await request.put(OVERRIDES_ENDPOINT, {
        headers: { Authorization: `Bearer ${token}` },
        data: {
          categories: [
            {
              id: 'role',
              label: 'Role',
              suggestions: [customSuggestion],
            },
          ],
          stickers: {
            role: {
              e2ecustom: { type: 'svg', svg: SAFE_SVG },
            },
          },
        },
      });
      expect(putRes.ok()).toBe(true);

      const cfgRes = await request.get('/api/config');
      expect(cfgRes.ok()).toBe(true);
      const cfg = await cfgRes.json();
      const roleCat = cfg.categories?.find((c: { id: string }) => c.id === 'role');
      expect(roleCat?.suggestions).toContain(customSuggestion);
      expect(cfg.stickers?.role?.e2ecustom).toBeDefined();
    });

    test('admin override persists across requests and browser page reloads', async ({
      page,
      request,
    }) => {
      const token = await getAdminToken(request);
      const customSuggestion = `E2E Persist Role ${Date.now()}`;
      const putRes = await request.put(OVERRIDES_ENDPOINT, {
        headers: { Authorization: `Bearer ${token}` },
        data: {
          categories: [{ id: 'role', label: 'Role', suggestions: [customSuggestion] }],
        },
      });
      expect(putRes.ok()).toBe(true);

      await page.goto('/#enter');
      await page.reload();
      const cfgRes = await request.get('/api/config');
      const cfg = await cfgRes.json();
      const roleCat = cfg.categories?.find((c: { id: string }) => c.id === 'role');
      expect(roleCat?.suggestions).toContain(customSuggestion);
    });

    test('base YAML fallback works when DB overrides are absent', async ({ request }) => {
      const token = await getAdminToken(request);
      await resetOverrides(request, token);

      const cfgRes = await request.get('/api/config');
      expect(cfgRes.ok()).toBe(true);
      const cfg = await cfgRes.json();
      const genderCat = cfg.categories?.find((c: { id: string }) => c.id === 'gender');
      expect(genderCat?.suggestions).toEqual(expect.arrayContaining(['Nonbinary', 'Genderqueer']));
      expect(cfg.stickers?.orientation?.bisexual).toBeDefined();
    });

    test('cache invalidates immediately on admin override write without waiting 60s TTL', async ({
      request,
    }) => {
      const token = await getAdminToken(request);
      const beforeRes = await request.get('/api/config');
      expect(beforeRes.ok()).toBe(true);

      const tag = `E2E Immediate Invalidate ${Date.now()}`;
      const putRes = await request.put(OVERRIDES_ENDPOINT, {
        headers: { Authorization: `Bearer ${token}` },
        data: {
          categories: [{ id: 'orientation', label: 'Orientation', suggestions: [tag] }],
        },
      });
      expect(putRes.ok()).toBe(true);

      const afterRes = await request.get('/api/config');
      expect(afterRes.ok()).toBe(true);
      const afterCfg = await afterRes.json();
      const orientationCat = afterCfg.categories?.find(
        (c: { id: string }) => c.id === 'orientation'
      );
      expect(orientationCat?.suggestions).toContain(tag);
    });

    test('effective merged profile is reflected in AI/wish suggestion flow and /#enter UI', async ({
      page,
      request,
    }) => {
      const token = await getAdminToken(request);
      const overrideSuggestion = 'Kitchen Table Poly';
      const putRes = await request.put(OVERRIDES_ENDPOINT, {
        headers: { Authorization: `Bearer ${token}` },
        data: {
          categories: [
            { id: 'orientation', label: 'Orientation', suggestions: [overrideSuggestion] },
          ],
        },
      });
      expect(putRes.ok()).toBe(true);

      const cfgRes = await request.get('/api/config');
      const cfg = await cfgRes.json();
      const orientationCat = cfg.categories?.find((c: { id: string }) => c.id === 'orientation');
      expect(orientationCat?.suggestions).toContain(overrideSuggestion);

      await page.goto('/#enter');
      await expect(page.locator('h1')).toHaveText('Enter a Wish');
      const wishContent = `E2E Override Wish ${Date.now()}`;
      const createRes = await request.post('/api/wishes', {
        data: {
          content: wishContent,
          creator_attributes: { orientation: [overrideSuggestion] },
        },
      });
      expect(createRes.ok()).toBe(true);
    });
  });

  test.describe('Tier 2 — Boundary & Corner Cases', () => {
    test('invalid override payload is rejected with 400 or 422', async ({ request }) => {
      const token = await getAdminToken(request);
      const res = await request.put(OVERRIDES_ENDPOINT, {
        headers: { Authorization: `Bearer ${token}` },
        data: {
          categories: 'not-an-array',
          stickers: ['invalid-stickers-shape'],
        },
      });
      expect([400, 422]).toContain(res.status());
    });

    test('empty override payload does not wipe base YAML categories', async ({ request }) => {
      const token = await getAdminToken(request);
      const res = await request.put(OVERRIDES_ENDPOINT, {
        headers: { Authorization: `Bearer ${token}` },
        data: {},
      });
      expect([200, 400]).toContain(res.status());

      const cfgRes = await request.get('/api/config');
      expect(cfgRes.ok()).toBe(true);
      const cfg = await cfgRes.json();
      expect(Array.isArray(cfg.categories)).toBe(true);
      expect(cfg.categories.length).toBeGreaterThanOrEqual(3);
    });

    test('concurrent/repeated GET /api/config reads remain consistent', async ({ request }) => {
      const responses = await Promise.all([
        request.get('/api/config'),
        request.get('/api/config'),
        request.get('/api/config'),
        request.get('/api/config'),
        request.get('/api/config'),
      ]);
      const payloads = await Promise.all(responses.map((r) => r.json()));
      const firstCategories = JSON.stringify(payloads[0].categories);
      for (const payload of payloads) {
        expect(JSON.stringify(payload.categories)).toBe(firstCategories);
      }
    });

    test('unauthorized user cannot write DB overrides (401/403)', async ({ request }) => {
      const unauthRes = await request.put(OVERRIDES_ENDPOINT, {
        data: {
          categories: [{ id: 'role', label: 'Role', suggestions: ['Hacker'] }],
        },
      });
      expect([401, 403]).toContain(unauthRes.status());

      const regularUsername = `e2e_nonadmin_${Date.now()}`;
      const regRes = await request.post('/api/users/register', {
        data: {
          username: regularUsername,
          passphrase: 'non-admin-passphrase', // gitleaks:allow
        },
      });
      expect(regRes.ok()).toBe(true);
      const regBody = await regRes.json();

      const nonAdminRes = await request.put(OVERRIDES_ENDPOINT, {
        headers: { Authorization: `Bearer ${regBody.token}` },
        data: {
          categories: [{ id: 'role', label: 'Role', suggestions: ['Hacker'] }],
        },
      });
      expect([401, 403]).toContain(nonAdminRes.status());
    });

    test('deleting overrides restores base YAML categories, suggestions, and stickers', async ({
      request,
    }) => {
      const token = await getAdminToken(request);
      const tempSuggestion = `E2E Temporary Override ${Date.now()}`;
      await request.put(OVERRIDES_ENDPOINT, {
        headers: { Authorization: `Bearer ${token}` },
        data: {
          categories: [{ id: 'role', label: 'Role', suggestions: [tempSuggestion] }],
        },
      });

      const delRes = await request.delete(OVERRIDES_ENDPOINT, {
        headers: { Authorization: `Bearer ${token}` },
      });
      expect(delRes.ok()).toBe(true);

      const cfgRes = await request.get('/api/config');
      const cfg = await cfgRes.json();
      const roleCat = cfg.categories?.find((c: { id: string }) => c.id === 'role');
      expect(roleCat?.suggestions).not.toContain(tempSuggestion);
      expect(roleCat?.suggestions).toEqual(expect.arrayContaining(['Top', 'Bottom', 'Switch']));
    });
  });
});
