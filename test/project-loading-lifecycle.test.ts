import vm from 'node:vm';

import { describe, expect, it, vi } from 'vitest';

import { PROJECT_SHELL_CLIENT_SCRIPT } from '../src/web/project-shell.js';

class FakeNode {
  className = 'status';
  type = '';
  onclick: (() => void) | null = null;
  children: FakeNode[] = [];
  attributes = new Map<string, string>();
  private text = '';

  get textContent(): string {
    return this.text;
  }

  set textContent(value: string) {
    this.text = value;
    this.children = [];
  }

  setAttribute(name: string, value: string): void {
    this.attributes.set(name, value);
  }

  append(...nodes: FakeNode[]): void {
    this.children.push(...nodes);
  }
}

function mockResponse(ok: boolean, status = ok ? 200 : 500, message = '') {
  const response = {
    ok,
    status,
    clone: () => response,
    json: async () => (message ? { error: { message } } : {}),
  };
  return response;
}

function createHarness(
  nativeFetch: (...args: unknown[]) => Promise<unknown>,
  options: { immediateTimeout?: boolean } = {},
) {
  const status = new FakeNode();
  const context: Record<string, unknown> = {
    fetch: nativeFetch,
    AbortController,
    document: {
      querySelector: (selector: string) => (selector === '#status' ? status : null),
      createElement: () => new FakeNode(),
    },
    setTimeout: options.immediateTimeout
      ? (callback: () => void) => {
          queueMicrotask(callback);
          return 1;
        }
      : setTimeout,
    clearTimeout: options.immediateTimeout ? () => undefined : clearTimeout,
  };

  vm.createContext(context);
  vm.runInContext(PROJECT_SHELL_CLIENT_SCRIPT, context);
  return { context: context as { fetch: (input: string) => Promise<ReturnType<typeof mockResponse>> }, status };
}

async function flush(): Promise<void> {
  for (let index = 0; index < 3; index += 1) {
    await new Promise<void>((resolve) => setImmediate(resolve));
  }
}

function retryButton(status: FakeNode): FakeNode {
  const button = status.children.find((child) => child.textContent === 'Retry');
  if (!button) throw new Error('Retry button was not rendered.');
  return button;
}

describe('bounded project read lifecycle', () => {
  it('resolves successful project reads without rendering recovery UI', async () => {
    const nativeFetch = vi.fn(async () => mockResponse(true));
    const { context, status } = createHarness(nativeFetch);

    const response = await context.fetch('/api/projects');

    expect(response.ok).toBe(true);
    expect(nativeFetch).toHaveBeenCalledTimes(1);
    expect(status.className).toBe('status');
    expect(status.children).toHaveLength(0);
  });

  it('turns a repository timeout into a bounded error state with Retry', async () => {
    const nativeFetch = vi.fn(() => new Promise(() => undefined));
    const { context, status } = createHarness(nativeFetch, { immediateTimeout: true });

    void context.fetch('/api/projects/demo/overview');
    await flush();

    expect(status.className).toBe('status error');
    expect(status.textContent).toContain('Repository data request timed out');
    expect(status.attributes.get('aria-live')).toBe('polite');
    expect(retryButton(status).type).toBe('button');
  });

  it('distinguishes catalog API failure from repository failure', async () => {
    const nativeFetch = vi.fn(async () => mockResponse(false, 503, 'catalog unavailable'));
    const { context, status } = createHarness(nativeFetch);

    void context.fetch('/api/projects');
    await flush();

    expect(status.className).toBe('status error');
    expect(status.textContent).toBe('Project catalog request failed: catalog unavailable');
    expect(retryButton(status).textContent).toBe('Retry');
  });

  it('retries the same pending read and resolves it once without duplicating recovery handlers', async () => {
    let attempts = 0;
    const nativeFetch = vi.fn(async () => {
      attempts += 1;
      return attempts === 1 ? mockResponse(false, 502, 'temporary repository failure') : mockResponse(true);
    });
    const { context, status } = createHarness(nativeFetch);

    const pending = context.fetch('/api/projects/demo/overview');
    await flush();
    const firstRetry = retryButton(status);

    firstRetry.onclick?.();
    const response = await pending;

    expect(response.ok).toBe(true);
    expect(nativeFetch).toHaveBeenCalledTimes(2);
    expect(status.children).toHaveLength(0);
    expect(status.textContent).toBe('Retrying repository data…');
  });
});
