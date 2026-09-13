import { describe, expect, it } from 'vitest';

// Dynamic import keeps the first TDD failure focused on the missing capability.
const runner = async (options) => (await import('../../bridge/node-python-runner.js')).createPythonRunner(options);

describe('isolated Python availability and input boundary', () => {
  it('reports unavailable without an installed Docker CLI instead of executing host Python', async () => {
    const api = await runner({ dockerCommand: '/mira-missing-docker' });
    expect(await api.status()).toMatchObject({ available: false });
    await expect(api.execute({ code: 'print(1)', input: { sources: [], arguments: {} }, imageId: `sha256:${'a'.repeat(64)}` })).rejects.toMatchObject({ code: 'PYTHON_UNAVAILABLE' });
  });

  it('rejects mutable tags, malformed source input and unbounded scripts before starting Docker', async () => {
    const api = await runner({ dockerCommand: '/mira-missing-docker' });
    for (const data of [
      { imageId: 'python:latest', code: 'print(1)', input: { sources: [], arguments: {} } },
      { imageId: `sha256:${'a'.repeat(64)}`, code: 'print(1)', input: { sources: [{ path: '/private' }], arguments: {} } },
      { imageId: `sha256:${'a'.repeat(64)}`, code: 'x'.repeat(65537), input: { sources: [], arguments: {} } },
    ]) await expect(api.execute(data)).rejects.toMatchObject({ code: 'TOOL_POLICY_INVALID' });
  });

  it('requires explicit pinned dependency versions and refuses image argument injection', async () => {
    const api = await runner({ dockerCommand: '/mira-missing-docker' });
    for (const input of [
      { image: '--privileged' },
      { image: 12345 },
      { image: 'python:3.13-slim', dependencies: ['numpy'] },
      { image: 'python:3.13-slim', dependencies: ['x==1; curl attacker'] },
      { image: 'python:3.13-slim', dependencies: ['https://example.org/x.whl'] },
    ]) await expect(api.prepare(input)).rejects.toMatchObject({ code: 'TOOL_POLICY_INVALID' });
  });

  it('rejects already cancelled execution without dispatch', async () => {
    const api = await runner({ dockerCommand: '/mira-missing-docker' });
    await expect(api.execute({ code: 'print(1)', imageId: `sha256:${'a'.repeat(64)}`, input: { sources: [], arguments: {} } }, { signal: AbortSignal.abort() })).rejects.toMatchObject({ name: 'AbortError' });
  });
});
