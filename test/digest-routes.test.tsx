import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';

// Nights are written to a temp dir; runs/ is a read-only fixture and is never touched.
let runsDir: string;
const config = { adapter: 'shim', installed: '2026-10-29T14:06:00+01:00', beatEverySeconds: 60, runsDir: '' };

const jobs = [
  '{"at":"2026-11-01T23:00:05+01:00","job":"lane/sync","status":"ok","owner":"rook"}',
  '{"at":"2026-11-01T23:00:02+01:00","job":"rig/rotate-logs","status":"ok","owner":"lane-07"}',
  '{"at":"2026-11-01T23:30:00+01:00","job":"digest/render","status":"fail","owner":null,"error":"timeout"}',
];

beforeAll(() => {
  runsDir = mkdtempSync(join(tmpdir(), 'runs-routes-'));
  config.runsDir = runsDir;
  writeFileSync(join(runsDir, '2026-11-01.jsonl'), jobs.join('\n') + '\n');
  writeFileSync(join(runsDir, '2026-11-02.jsonl'), '');
  writeFileSync(join(runsDir, '2026-11-03.jsonl'), [jobs[0], 'not json', jobs[1]].join('\n') + '\n');
});

afterAll(() => {
  rmSync(runsDir, { recursive: true, force: true });
});

// Job names in the order the page lists them, one per table row.
function pageJobs(html: string): string[] {
  return [...html.matchAll(/<tr[^>]*><td>([^<]+)<\/td>/g)].map((m) => m[1]);
}

describe('GET /digest/:night (page)', () => {
  it('answers 200 with the jobs for a night that has a file', async () => {
    const res = await createApp(config).request('/digest/2026-11-01');
    const html = await res.text();
    expect(res.status).toBe(200);
    expect(html).toContain('digest 2026-11-01');
    expect(pageJobs(html)).toEqual(['digest/render', 'lane/sync', 'rig/rotate-logs']);
  });

  it('answers 404 for a night with no file', async () => {
    const res = await createApp(config).request('/digest/2026-01-01');
    expect(res.status).toBe(404);
    expect(await res.text()).toContain('no run log for 2026-01-01');
  });

  it('says nothing ran for an empty night', async () => {
    const res = await createApp(config).request('/digest/2026-11-02');
    expect(res.status).toBe(200);
    expect(await res.text()).toContain('nothing ran');
  });

  it('says how many lines could not be read and still lists the valid rows', async () => {
    const res = await createApp(config).request('/digest/2026-11-03');
    const html = await res.text();
    expect(res.status).toBe(200);
    expect(html).toContain('1 line could not be read');
    expect(pageJobs(html)).toEqual(['lane/sync', 'rig/rotate-logs']);
  });
});

describe('GET /api/digest/:night (JSON)', () => {
  it('answers 200 with the rows for a night that has a file', async () => {
    const res = await createApp(config).request('/api/digest/2026-11-01');
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.night).toBe('2026-11-01');
    expect(body.rows.map((r: { job: string }) => r.job)).toEqual(['digest/render', 'lane/sync', 'rig/rotate-logs']);
  });

  it('answers 404 for a night with no file', async () => {
    const res = await createApp(config).request('/api/digest/2026-01-01');
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: 'no run log for 2026-01-01' });
  });

  it('returns no rows for an empty night', async () => {
    const res = await createApp(config).request('/api/digest/2026-11-02');
    expect(res.status).toBe(200);
    expect((await res.json()).rows).toEqual([]);
  });

  it('counts the bad line and keeps the valid rows', async () => {
    const res = await createApp(config).request('/api/digest/2026-11-03');
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.badLines).toBe(1);
    expect(body.rows.map((r: { job: string }) => r.job)).toEqual(['lane/sync', 'rig/rotate-logs']);
  });
});

describe('page and JSON agree', () => {
  it('list the same jobs in the same order for one night', async () => {
    const app = createApp(config);
    const html = await (await app.request('/digest/2026-11-01')).text();
    const body = await (await app.request('/api/digest/2026-11-01')).json();
    expect(pageJobs(html)).toEqual(body.rows.map((r: { job: string }) => r.job));
  });
});
