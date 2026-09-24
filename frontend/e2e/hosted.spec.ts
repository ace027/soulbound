import { fileURLToPath } from 'node:url';

import { expect, test, type Page, type Route } from '@playwright/test';

/**
 * Hosted-mode UI end to end (Phase 6, 06-06): `ModeGate`, `SignIn` and
 * `AccountPanel` in a real browser against stubbed routes. No backend and no
 * Better Auth server run: every `/api/*` request this page makes is answered
 * here, and any request that isn't is recorded and fails the test (the same
 * no-paid-call guard as smoke.spec.ts, widened to "unstubbed").
 *
 * The dev server runs React in StrictMode, so mount effects run twice. The
 * "exactly once" counts below therefore also prove the guards against that.
 *
 * Screenshots for the plan's evidence are taken only when
 * SOULBOUND_E2E_EVIDENCE=1, so a normal run never rewrites tracked files.
 */

const CODE = 'Abc_def-ghijklmnopqrst'; // 22 chars, INVITE_CODE_PATTERN
const MODE = { 'Soulbound-Mode': 'hosted' };
const EVIDENCE = process.env.SOULBOUND_E2E_EVIDENCE === '1';
// Resolved from this file, not the working directory, so it lands in the repo wherever the runner starts.
const EVIDENCE_DIR = fileURLToPath(new URL('../../.planning/phases/06-hosted-mode-accounts/evidence/', import.meta.url));

const MOBILE = { width: 390, height: 844 };
const DESKTOP = { width: 1280, height: 800 };

interface Stubs {
  access: 'signin' | 'ok';
  redeemStatus: number;
  counts: Record<string, number>;
  bodies: Record<string, string[]>;
  unstubbed: string[];
}

const stubsFor = new WeakMap<Page, Stubs>();

function count(stubs: Stubs, key: string, body?: string | null) {
  stubs.counts[key] = (stubs.counts[key] ?? 0) + 1;
  if (body) (stubs.bodies[key] ??= []).push(body);
}

async function installStubs(page: Page): Promise<Stubs> {
  const stubs: Stubs = { access: 'signin', redeemStatus: 204, counts: {}, bodies: {}, unstubbed: [] };
  stubsFor.set(page, stubs);

  await page.route('**/api/**', async (route: Route) => {
    const req = route.request();
    const path = new URL(req.url()).pathname;
    const key = `${req.method()} ${path}`;
    count(stubs, key, req.postData());

    switch (key) {
      case 'GET /api/access':
        return stubs.access === 'ok'
          ? route.fulfill({ status: 204, headers: MODE })
          : route.fulfill({
              status: 401,
              headers: MODE,
              contentType: 'application/json',
              body: JSON.stringify({ error: { message: 'Sign in required', code: 'SIGN_IN_REQUIRED' } }),
            });
      case 'POST /api/invites/redeem':
        return stubs.redeemStatus === 204
          ? route.fulfill({ status: 204 })
          : route.fulfill({
              status: stubs.redeemStatus,
              contentType: 'application/json',
              body: JSON.stringify({ error: { message: 'This invite code is not valid', code: 'INVITE_INVALID' } }),
            });
      case 'POST /api/auth/sign-in/magic-link':
        return route.fulfill({ status: 200, contentType: 'application/json', body: '{"status":true}' });
      case 'GET /api/auth/get-session':
        return route.fulfill({ status: 200, contentType: 'application/json', body: 'null' });
      case 'DELETE /api/account':
        return route.fulfill({ status: 204 });
      default:
        stubs.unstubbed.push(key);
        return route.abort();
    }
  });

  // Anything straight to the provider is a bug, whatever the path.
  page.on('request', (req) => {
    if (/anthropic\.com/.test(req.url())) stubs.unstubbed.push(`${req.method()} ${req.url()}`);
  });
  return stubs;
}

test.beforeEach(async ({ page }) => {
  await installStubs(page);
});

test.afterEach(({ page }) => {
  expect(stubsFor.get(page)?.unstubbed ?? [], 'unstubbed /api or provider request').toEqual([]);
});

async function shot(page: Page, name: string) {
  if (EVIDENCE) await page.screenshot({ path: `${EVIDENCE_DIR}${name}.png`, fullPage: false, animations: 'disabled' });
}

// ─── Tests ──────────────────────────────────────────────────────────────────

test('invite link: SignIn shows, the code leaves the URL, and it is redeemed once', async ({ page }) => {
  const stubs = stubsFor.get(page)!;
  await page.goto(`/#invite=${CODE}`);
  await expect(page.getByText('Your invite is ready')).toBeVisible();
  await expect(page.getByLabel('Email address')).toBeVisible();
  expect(page.url()).not.toContain('invite');
  expect(page.url()).not.toContain(CODE);
  expect(stubs.counts['POST /api/invites/redeem']).toBe(1);
  expect(JSON.parse(stubs.bodies['POST /api/invites/redeem']![0]!)).toEqual({ code: CODE });
  // Signed out: the rolling-session refresh never runs.
  expect(stubs.counts['GET /api/auth/get-session']).toBeUndefined();
});

test('an invite pasted into an already-open tab is still stripped and redeemed', async ({ page }) => {
  const stubs = stubsFor.get(page)!;
  await page.goto('/');
  await expect(page.getByLabel('Email address')).toBeVisible();
  await page.goto(`/#invite=${CODE}`); // same document: only the fragment changes
  await expect(page.getByText('Your invite is ready')).toBeVisible();
  expect(page.url()).not.toContain(CODE);
  expect(stubs.counts['POST /api/invites/redeem']).toBe(1);
});

test('email submit shows the check-your-email text', async ({ page }) => {
  const stubs = stubsFor.get(page)!;
  await page.goto(`/#invite=${CODE}`);
  await expect(page.getByText('Your invite is ready')).toBeVisible();
  await page.getByLabel('Email address').fill('friend@example.com');
  await page.getByRole('button', { name: 'Send me a sign-in link' }).click();
  await expect(page.getByText('Check your email — open the link in this browser', { exact: false })).toBeVisible();
  expect(stubs.counts['POST /api/auth/sign-in/magic-link']).toBe(1);
  const body = JSON.parse(stubs.bodies['POST /api/auth/sign-in/magic-link']![0]!) as Record<string, unknown>;
  expect(body.email).toBe('friend@example.com');
  expect(body.callbackURL).toBe('/');
});

test('once signed in: the game title and the account button; the session is refreshed', async ({ page }) => {
  const stubs = stubsFor.get(page)!;
  await page.goto('/');
  await expect(page.getByLabel('Email address')).toBeVisible();
  stubs.access = 'ok';
  await page.reload();
  await expect(page.getByRole('heading', { name: 'The Soulbound Chronicles' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Account' })).toBeVisible();
  await expect.poll(() => stubs.counts['GET /api/auth/get-session'] ?? 0).toBeGreaterThanOrEqual(1);
});

test('delete: inline confirm, DELETE exactly once, then back to sign-in', async ({ page }) => {
  const stubs = stubsFor.get(page)!;
  stubs.access = 'ok';
  await page.goto('/');
  await page.getByRole('button', { name: 'Account' }).click();
  page.on('dialog', (d) => {
    throw new Error(`native dialog opened: ${d.type()}`);
  });
  await page.getByRole('button', { name: 'Delete account' }).click();
  await expect(page.getByText('This deletes your account after 7 days.', { exact: false })).toBeVisible();
  expect(stubs.counts['DELETE /api/account']).toBeUndefined();
  await page.getByRole('button', { name: 'Confirm' }).click();
  await expect(page.getByLabel('Email address')).toBeVisible();
  expect(stubs.counts['DELETE /api/account']).toBe(1);
});

test('an invalid invite says so, and an error redirect never shows its raw text', async ({ page }) => {
  const stubs = stubsFor.get(page)!;
  stubs.redeemStatus = 400;
  await page.goto(`/#invite=${CODE}`);
  await expect(page.getByText("That invite link isn't valid or has expired.", { exact: false })).toBeVisible();

  await page.goto('/?error=INVITE_REQUIRED&error_description=RAW-DESCRIPTION-TEXT');
  await expect(page.getByText('Open the sign-in link in the same browser', { exact: false })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Send me a new link' })).toBeVisible();
  expect(page.url()).not.toContain('error');
  await expect(page.locator('body')).not.toContainText('RAW-DESCRIPTION-TEXT');
  await expect(page.locator('body')).not.toContainText('INVITE_REQUIRED');
});

// ─── Evidence screenshots (only with SOULBOUND_E2E_EVIDENCE=1) ─────────────

for (const [label, viewport] of [
  ['390', MOBILE],
  ['1280', DESKTOP],
] as const) {
  test(`screenshots and placement at ${label}px`, async ({ page }) => {
    const stubs = stubsFor.get(page)!;
    await page.setViewportSize(viewport);

    // 1. SignIn after a valid invite.
    await page.goto(`/#invite=${CODE}`);
    await expect(page.getByText('Your invite is ready')).toBeVisible();
    await shot(page, `signin-${label}`);

    // 2. The check-email state.
    await page.getByLabel('Email address').fill('friend@example.com');
    await page.getByRole('button', { name: 'Send me a sign-in link' }).click();
    await expect(page.getByRole('heading', { name: 'Check your email' })).toBeVisible();
    await shot(page, `check-email-${label}`);

    // 3. The invalid-invite error.
    stubs.redeemStatus = 400;
    await page.goto(`/#invite=${CODE}`);
    await expect(page.getByText("That invite link isn't valid", { exact: false })).toBeVisible();
    await shot(page, `invite-error-${label}`);

    // 4. AccountPanel armed, over the game's simulation screen (the busiest layout).
    stubs.access = 'ok';
    await page.addInitScript(seedSave);
    await page.goto('/');
    await page.locator('.save-card', { hasText: 'Verrin Ashgrave' }).getByRole('button', { name: 'Continue' }).click();
    const textarea = page.locator('textarea[placeholder="What do you do?"]');
    await expect(textarea).toBeVisible();
    const account = page.getByRole('button', { name: 'Account' });
    await expect(account).toBeVisible();
    await shot(page, `game-${label}`);

    // Placement: the button must not sit on top of any of the game's own controls.
    const overlaps = await page.evaluate(() => {
      const btn = [...document.querySelectorAll('button')].find((b) => b.textContent === 'Account')!;
      const a = btn.getBoundingClientRect();
      return [...document.querySelectorAll('button, textarea, input, a, [role="tab"]')]
        .filter((el) => el !== btn)
        .filter((el) => {
          const r = el.getBoundingClientRect();
          if (r.width === 0 || r.height === 0) return false;
          return r.left < a.right && r.right > a.left && r.top < a.bottom && r.bottom > a.top;
        })
        .map((el) => `${el.tagName} ${(el.textContent ?? '').trim().slice(0, 30)}`);
    });
    expect(overlaps, 'Account button overlaps a game control').toEqual([]);

    await account.click();
    await page.getByRole('button', { name: 'Delete account' }).click();
    await expect(page.getByRole('button', { name: 'Confirm' })).toBeVisible();
    await shot(page, `account-armed-${label}`);
    expect(stubs.counts['DELETE /api/account']).toBeUndefined();
  });
}

/** One save slot, seeded before the app boots (the same shape smoke.spec.ts seeds). */
function seedSave() {
  const gameState = {
    character: {
      name: 'Verrin Ashgrave',
      race: {
        id: 'mycelium',
        name: 'Mycelium',
        desc: 'A colony that learned to want.',
        intrinsic: [
          { name: 'Spore Sense', description: 'Reads the air for kin.' },
          { name: 'Rootbound', description: 'Draws on what it stands in.' },
        ],
      },
      uniqueSkill: {
        skill_name: 'The Patient Ledger',
        tier: 'Unique',
        description: 'Remembers every debt owed to it.',
        soul_resonance: 'Patience sharpened into accounting.',
        etching_text: 'The world writes a name it did not choose.',
      },
      answers: { nature: 'patient', drive: 'debt', flaw: 'slow', memory: 'a ledger', bond: 'none' },
    },
    skills: [
      { name: 'Spore Sense', tier: 'Intrinsic', mastery: 6, description: 'Reads the air for kin.' },
      {
        name: 'The Patient Ledger',
        tier: 'Unique',
        mastery: 22,
        description: 'Remembers every debt owed to it.',
        soul_resonance: 'Patience sharpened into accounting.',
        sub_abilities: [],
        usage_notes: [],
      },
    ],
    location: 'The Rotting Cloister, Vaeltharion',
    currentScene: 'Spore-light drifts between the pillars.',
    actionHistory: ['listened to the walls'],
    narrativeMemory: { entities: {}, notes: ['The cloister remembers.'] },
  };
  const log = Array.from({ length: 12 }, (_, i) => ({
    type: 'narration',
    text: `Turn ${i + 1}. The spore-light shifts along the cloister wall, and something beneath the flagstones adjusts its weight.`,
  }));
  const id = 'sbc_e2e_hosted';
  localStorage.setItem(`sbc-save:${id}`, JSON.stringify({ gameState, log, savedAt: 1_750_000_000_000, schemaVersion: 1 }));
  localStorage.setItem(
    'sbc-save-index',
    JSON.stringify([
      {
        id,
        name: 'Verrin Ashgrave',
        race: 'Mycelium',
        location: gameState.location,
        skillCount: gameState.skills.length,
        savedAt: 1_750_000_000_000,
        uniqueSkill: 'The Patient Ledger',
      },
    ]),
  );
}
