import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { requestAiTriage } from './aiTriage';
import type { AnalysisResult, CandidateSignal, WorkUnit } from '../types/domain';

function unit(): WorkUnit {
  return {
    id: 'u1',
    target: { name: 'TRAPPIST-1', raHours: 23.1, decDeg: -5 },
    telescope: 'Green Bank Telescope',
    observedAt: '2026-05-15T00:00:00.000Z',
    freqStartMHz: 1420,
    freqEndMHz: 1421,
    channelBandwidthHz: 10,
    channels: 1024,
    frames: 32,
    framePeriodSec: 1,
    sourceRef: 'BL/test',
    license: 'BSD'
  };
}

function candidate(id: string, overrides: Partial<CandidateSignal> = {}): CandidateSignal {
  return {
    id,
    workUnitId: 'u1',
    frequencyMHz: 1420.405,
    driftHzPerSec: 0.1,
    snr: 12.4,
    durationSec: 32,
    confidence: 0.7,
    label: 'interesting',
    explanation: 'Narrowband peak.',
    pixel: { channel: 100, row: 0, width: 1, height: 32 },
    ...overrides
  };
}

function result(candidates: CandidateSignal[]): AnalysisResult {
  return {
    workUnitId: 'u1',
    computeMs: 123,
    candidates,
    noiseFloor: 0.5,
    binsProcessed: 32_000
  };
}

describe('requestAiTriage', () => {
  const originalFetch = globalThis.fetch;
  beforeEach(() => {
    vi.restoreAllMocks();
  });
  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('returns the original candidates unchanged when there are none to triage', async () => {
    const fetchMock = vi.fn();
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    const r = result([]);
    const out = await requestAiTriage(unit(), r);
    expect(out).toBe(r.candidates);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('attaches assessments to matching candidates on a 200 response', async () => {
    const c = candidate('c1');
    const fetchMock = vi.fn(async () =>
      new Response(
        JSON.stringify({
          provider: 'cloudflare-workers-ai',
          model: '@cf/meta/llama-3.1-8b-instruct',
          promptVersion: 'signalscope-ai-triage-v1',
          assessments: [
            {
              candidateId: 'c1',
              label: 'interesting',
              confidence: 0.81,
              rationale: 'Narrowband, no known carrier in band.',
              recommendedAction: 'Re-observe.',
              createdAt: '2026-05-16T00:00:00.000Z'
            }
          ]
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      )
    );
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    const out = await requestAiTriage(unit(), result([c]));
    expect(out).toHaveLength(1);
    expect(out[0].aiAssessment).toBeDefined();
    expect(out[0].aiAssessment?.label).toBe('interesting');
    expect(out[0].aiAssessment?.provider).toBe('cloudflare-workers-ai');
    expect(out[0].aiAssessment?.confidence).toBeCloseTo(0.81);
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it('preserves the rule-based fallback provider when the worker returns one', async () => {
    const c = candidate('c1');
    const fetchMock = vi.fn(async () =>
      new Response(
        JSON.stringify({
          provider: 'signalscope-rule-fallback',
          model: '@cf/meta/llama-3.1-8b-instruct',
          assessments: [
            {
              candidateId: 'c1',
              label: 'likely_rfi',
              confidence: 0.8,
              rationale: 'Conservative fallback.'
            }
          ]
        }),
        { status: 200 }
      )
    );
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    const out = await requestAiTriage(unit(), result([c]));
    expect(out[0].aiAssessment?.provider).toBe('signalscope-rule-fallback');
  });

  it('drops assessments referencing unknown candidate ids', async () => {
    const c = candidate('c1');
    const fetchMock = vi.fn(async () =>
      new Response(
        JSON.stringify({
          assessments: [
            { candidateId: 'unknown', label: 'interesting', confidence: 0.5, rationale: 'x' },
            { candidateId: 'c1', label: 'likely_noise', confidence: 0.4, rationale: 'y' }
          ]
        }),
        { status: 200 }
      )
    );
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    const out = await requestAiTriage(unit(), result([c]));
    expect(out[0].aiAssessment?.label).toBe('likely_noise');
  });

  it('drops assessments with invalid label strings', async () => {
    const c = candidate('c1');
    const fetchMock = vi.fn(async () =>
      new Response(
        JSON.stringify({
          assessments: [{ candidateId: 'c1', label: 'maybe_alien', confidence: 0.9, rationale: 'no' }]
        }),
        { status: 200 }
      )
    );
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    const out = await requestAiTriage(unit(), result([c]));
    expect(out[0].aiAssessment).toBeUndefined();
  });

  it('throws a friendly error on 503 (AI binding missing)', async () => {
    globalThis.fetch = vi.fn(async () =>
      new Response(JSON.stringify({ code: 'AI_NOT_CONFIGURED', error: 'no AI' }), { status: 503 })
    ) as unknown as typeof fetch;
    await expect(requestAiTriage(unit(), result([candidate('c1')]))).rejects.toThrow(/not enabled/i);
  });

  it('throws a friendly error on 429', async () => {
    globalThis.fetch = vi.fn(async () =>
      new Response(JSON.stringify({ error: 'rate limited' }), { status: 429 })
    ) as unknown as typeof fetch;
    await expect(requestAiTriage(unit(), result([candidate('c1')]))).rejects.toThrow(/wait a minute/i);
  });

  it('throws a friendly error on 413 (payload too large)', async () => {
    globalThis.fetch = vi.fn(async () =>
      new Response(JSON.stringify({ error: 'too big' }), { status: 413 })
    ) as unknown as typeof fetch;
    await expect(requestAiTriage(unit(), result([candidate('c1')]))).rejects.toThrow(/too large/i);
  });

  it('throws a friendly error on 502 (model could not produce JSON)', async () => {
    globalThis.fetch = vi.fn(async () =>
      new Response(JSON.stringify({ error: 'bad upstream' }), { status: 502 })
    ) as unknown as typeof fetch;
    await expect(requestAiTriage(unit(), result([candidate('c1')]))).rejects.toThrow(/clean response/i);
  });

  it('limits the request body to at most 10 candidates', async () => {
    const cands = Array.from({ length: 15 }, (_, i) => candidate(`c${i}`));
    let receivedCount = -1;
    globalThis.fetch = vi.fn(async (_url, init) => {
      const body = JSON.parse(String(init?.body ?? '{}')) as { candidates: unknown[] };
      receivedCount = body.candidates.length;
      return new Response(JSON.stringify({ assessments: [] }), { status: 200 });
    }) as unknown as typeof fetch;
    await requestAiTriage(unit(), result(cands));
    expect(receivedCount).toBe(10);
  });
});
