import { ACCESS_STORAGE_KEY } from '@soulbound/shared';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import AccessGate from '../AccessGate';
import App from '../../App';

/**
 * `<AccessGate>` (Phase 5, R19). `fetch` is stubbed throughout — nothing here
 * reaches a real network. See `lib/__tests__/api.test.ts` for `checkAccess`
 * itself; this file only covers what the component does with each result.
 */

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  localStorage.clear();
});

beforeEach(() => {
  localStorage.clear();
});

function jsonResponse(status: number, body: unknown, headers: Record<string, string> = {}): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: '',
    headers: {
      get: (name: string) =>
        name.toLowerCase() === 'content-type'
          ? (headers['content-type'] ?? 'application/json')
          : (headers[name.toLowerCase()] ?? null),
    },
    json: async () => body,
    text: async () => JSON.stringify(body),
  } as unknown as Response;
}

function stubFetchOnce(response: Response) {
  const fetchMock = vi.fn().mockResolvedValueOnce(response);
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

describe('AccessGate', () => {
  it('shows an inline form on a 401 PASSPHRASE_REQUIRED', async () => {
    stubFetchOnce(
      jsonResponse(401, { error: { message: 'Passphrase required', code: 'PASSPHRASE_REQUIRED' } }),
    );
    render(
      <AccessGate>
        <div>secret game</div>
      </AccessGate>,
    );

    expect(await screen.findByLabelText('Passphrase')).toBeInTheDocument();
    expect(screen.queryByText('secret game')).not.toBeInTheDocument();
  });

  it('renders children on a 204 (ok)', async () => {
    stubFetchOnce(jsonResponse(204, undefined));
    render(
      <AccessGate>
        <div>secret game</div>
      </AccessGate>,
    );

    expect(await screen.findByText('secret game')).toBeInTheDocument();
    expect(screen.queryByLabelText('Passphrase')).not.toBeInTheDocument();
  });

  it('renders children on a 502 (unknown) — fails open in the UI', async () => {
    stubFetchOnce(
      { ok: false, status: 502, headers: { get: () => 'text/plain' }, json: async () => {
        throw new Error('not json');
      }, text: async () => 'Bad Gateway' } as unknown as Response,
    );
    render(
      <AccessGate>
        <div>secret game</div>
      </AccessGate>,
    );

    expect(await screen.findByText('secret game')).toBeInTheDocument();
  });

  it('submitting the form stores the passphrase and renders children', async () => {
    const fetchMock = vi.fn();
    fetchMock.mockResolvedValueOnce(
      jsonResponse(401, { error: { message: 'Passphrase required', code: 'PASSPHRASE_REQUIRED' } }),
    );
    fetchMock.mockResolvedValueOnce(jsonResponse(204, undefined));
    vi.stubGlobal('fetch', fetchMock);

    render(
      <AccessGate>
        <div>secret game</div>
      </AccessGate>,
    );

    const input = await screen.findByLabelText('Passphrase');
    fireEvent.change(input, { target: { value: 'correct-horse-battery' } });
    fireEvent.click(screen.getByRole('button', { name: 'Enter' }));

    expect(await screen.findByText('secret game')).toBeInTheDocument();
    expect(localStorage.getItem(ACCESS_STORAGE_KEY)).toBe('correct-horse-battery');
  });

  it('trims a pasted value with surrounding whitespace before storing', async () => {
    const fetchMock = vi.fn();
    fetchMock.mockResolvedValueOnce(
      jsonResponse(401, { error: { message: 'Passphrase required', code: 'PASSPHRASE_REQUIRED' } }),
    );
    fetchMock.mockResolvedValueOnce(jsonResponse(204, undefined));
    vi.stubGlobal('fetch', fetchMock);

    render(
      <AccessGate>
        <div>secret game</div>
      </AccessGate>,
    );

    const input = await screen.findByLabelText('Passphrase');
    fireEvent.change(input, { target: { value: '  hunter2hunter2  ' } });
    fireEvent.click(screen.getByRole('button', { name: 'Enter' }));

    await screen.findByText('secret game');
    expect(localStorage.getItem(ACCESS_STORAGE_KEY)).toBe('hunter2hunter2');
  });

  it('pressing Enter in the input submits the form', async () => {
    const fetchMock = vi.fn();
    fetchMock.mockResolvedValueOnce(
      jsonResponse(401, { error: { message: 'Passphrase required', code: 'PASSPHRASE_REQUIRED' } }),
    );
    fetchMock.mockResolvedValueOnce(jsonResponse(204, undefined));
    vi.stubGlobal('fetch', fetchMock);

    render(
      <AccessGate>
        <div>secret game</div>
      </AccessGate>,
    );

    const input = await screen.findByLabelText('Passphrase');
    fireEvent.change(input, { target: { value: 'correct-horse-battery' } });
    fireEvent.submit(input.closest('form')!);

    expect(await screen.findByText('secret game')).toBeInTheDocument();
  });

  it('the show/hide toggle switches the input type between password and text', async () => {
    stubFetchOnce(
      jsonResponse(401, { error: { message: 'Passphrase required', code: 'PASSPHRASE_REQUIRED' } }),
    );
    render(
      <AccessGate>
        <div>secret game</div>
      </AccessGate>,
    );

    const input = (await screen.findByLabelText('Passphrase')) as HTMLInputElement;
    expect(input.type).toBe('password');
    fireEvent.click(screen.getByRole('button', { name: 'Show' }));
    expect(input.type).toBe('text');
    fireEvent.click(screen.getByRole('button', { name: 'Hide' }));
    expect(input.type).toBe('password');
  });

  it('a later PASSPHRASE_REQUIRED event overlays the form while children stay mounted', async () => {
    stubFetchOnce(jsonResponse(204, undefined));
    render(
      <AccessGate>
        <div>secret game</div>
      </AccessGate>,
    );

    expect(await screen.findByText('secret game')).toBeInTheDocument();

    // A mid-session 401 goes through lib/api.ts's postJson, which calls
    // emitPassphraseRequired(). Import it directly to simulate that here,
    // rather than driving a whole postJson call through this test.
    const { emitPassphraseRequired } = await import('../../lib/passphrase');
    emitPassphraseRequired();

    expect(await screen.findByLabelText('Passphrase')).toBeInTheDocument();
    // Children are still in the DOM underneath the overlay.
    expect(screen.getByText('secret game')).toBeInTheDocument();
  });

  it('renders the title screen after a 204, wrapping <App/> for real', async () => {
    stubFetchOnce(jsonResponse(204, undefined));
    render(
      <AccessGate>
        <App />
      </AccessGate>,
    );

    expect(await screen.findByText('The Soulbound Chronicles')).toBeInTheDocument();
  });

  it('rejects a non-ASCII passphrase (accented letter) in the form and stores nothing', async () => {
    stubFetchOnce(
      jsonResponse(401, { error: { message: 'Passphrase required', code: 'PASSPHRASE_REQUIRED' } }),
    );
    render(
      <AccessGate>
        <div>secret game</div>
      </AccessGate>,
    );

    const input = await screen.findByLabelText('Passphrase');
    fireEvent.change(input, { target: { value: 'café123' } });
    fireEvent.click(screen.getByRole('button', { name: 'Enter' }));

    expect(
      await screen.findByText(/Use only standard keyboard characters/),
    ).toBeInTheDocument();
    // No second fetch — the value never reached checkAccess().
    expect(screen.getByLabelText('Passphrase')).toBeInTheDocument();
    const { getPassphrase } = await import('../../lib/passphrase');
    expect(getPassphrase()).toBeNull();
  });

  it('rejects a non-ASCII passphrase (emoji) in the form and stores nothing', async () => {
    stubFetchOnce(
      jsonResponse(401, { error: { message: 'Passphrase required', code: 'PASSPHRASE_REQUIRED' } }),
    );
    render(
      <AccessGate>
        <div>secret game</div>
      </AccessGate>,
    );

    const input = await screen.findByLabelText('Passphrase');
    fireEvent.change(input, { target: { value: 'hunter2🔒' } });
    fireEvent.click(screen.getByRole('button', { name: 'Enter' }));

    expect(
      await screen.findByText(/Use only standard keyboard characters/),
    ).toBeInTheDocument();
    const { getPassphrase } = await import('../../lib/passphrase');
    expect(getPassphrase()).toBeNull();
  });

  it("clears the stored value and shows a recoverable message when the re-check comes back 'unknown'", async () => {
    const fetchMock = vi.fn();
    fetchMock.mockResolvedValueOnce(
      jsonResponse(401, { error: { message: 'Passphrase required', code: 'PASSPHRASE_REQUIRED' } }),
    );
    // The re-check after submit fails to reach the server.
    fetchMock.mockRejectedValueOnce(new TypeError('Failed to fetch'));
    vi.stubGlobal('fetch', fetchMock);

    render(
      <AccessGate>
        <div>secret game</div>
      </AccessGate>,
    );

    const input = await screen.findByLabelText('Passphrase');
    fireEvent.change(input, { target: { value: 'correct-horse-battery' } });
    fireEvent.click(screen.getByRole('button', { name: 'Enter' }));

    expect(
      await screen.findByText(/Couldn't reach the server/),
    ).toBeInTheDocument();
    expect(screen.getByLabelText('Passphrase')).toBeInTheDocument();
    expect(screen.queryByText('secret game')).not.toBeInTheDocument();
    const { getPassphrase } = await import('../../lib/passphrase');
    expect(getPassphrase()).toBeNull();
  });

  it('shows the "didn\'t work" message when a resubmitted passphrase re-checks as 401 PASSPHRASE_REQUIRED', async () => {
    const fetchMock = vi.fn();
    fetchMock.mockResolvedValueOnce(
      jsonResponse(401, { error: { message: 'Passphrase required', code: 'PASSPHRASE_REQUIRED' } }),
    );
    fetchMock.mockResolvedValueOnce(
      jsonResponse(401, { error: { message: 'Passphrase required', code: 'PASSPHRASE_REQUIRED' } }),
    );
    vi.stubGlobal('fetch', fetchMock);

    render(
      <AccessGate>
        <div>secret game</div>
      </AccessGate>,
    );

    const input = await screen.findByLabelText('Passphrase');
    fireEvent.change(input, { target: { value: 'wrong-passphrase' } });
    fireEvent.click(screen.getByRole('button', { name: 'Enter' }));

    expect(await screen.findByText("That passphrase didn't work.")).toBeInTheDocument();
    expect(screen.getByLabelText('Passphrase')).toBeInTheDocument();
    expect(screen.queryByText('secret game')).not.toBeInTheDocument();
  });

  it('never touches localStorage or fetch directly — only through lib/', async () => {
    // Static guard, mirrored from constraints.test.ts's approach: read the
    // source and assert absence, rather than trying to prove a negative
    // behaviourally.
    const { readFileSync } = await import('node:fs');
    const { resolve } = await import('node:path');
    const source = readFileSync(resolve(process.cwd(), 'src/components/AccessGate.tsx'), 'utf8');
    expect(source).not.toMatch(/localStorage/);
    expect(source).not.toMatch(/fetch\(/);
  });

  it('waits for the pending check before showing either the form or children', async () => {
    let resolveFetch!: (r: Response) => void;
    const fetchMock = vi.fn().mockReturnValueOnce(
      new Promise<Response>((resolve) => {
        resolveFetch = resolve;
      }),
    );
    vi.stubGlobal('fetch', fetchMock);

    render(
      <AccessGate>
        <div>secret game</div>
      </AccessGate>,
    );

    expect(screen.queryByText('secret game')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Passphrase')).not.toBeInTheDocument();

    resolveFetch(jsonResponse(204, undefined));
    await waitFor(() => expect(screen.getByText('secret game')).toBeInTheDocument());
  });
});
