interface AiEnv {
  AI?: {
    run(model: string, input: unknown): Promise<unknown>;
  };
  CLOUDFLARE_AI_MODEL?: string;
}

interface TriageCandidateInput {
  id?: string;
  frequencyMHz?: number;
  driftHzPerSec?: number;
  snr?: number;
  durationSec?: number;
  confidence?: number;
  label?: string;
  recurrenceCount?: number;
  explanation?: string;
}

interface TriageRequest {
  promptVersion?: string;
  workUnit?: Record<string, unknown>;
  analysis?: Record<string, unknown>;
  candidates?: TriageCandidateInput[];
}

interface TriageAssessment {
  candidateId: string;
  label: 'likely_rfi' | 'likely_noise' | 'interesting' | 'needs_follow_up';
  confidence: number;
  rationale: string;
  recommendedAction?: string;
  createdAt: string;
}

const DEFAULT_MODEL = '@cf/meta/llama-3.1-8b-instruct';
const MAX_CANDIDATES = 25;
const MAX_BODY_BYTES = 32 * 1024;
const RATE_LIMIT_WINDOW_MS = 60_000;
const RATE_LIMIT_MAX_REQUESTS = 20;
const PROMPT_VERSION = 'signalscope-ai-triage-v1';
const LABELS = new Set(['likely_rfi', 'likely_noise', 'interesting', 'needs_follow_up']);
const rateBuckets = new Map<string, { startedAt: number; count: number }>();

export const onRequestPost: PagesFunction<AiEnv> = async ({ request, env }) => {
  const contentLength = Number(request.headers.get('Content-Length') ?? '0');
  if (contentLength > MAX_BODY_BYTES) {
    return json({ error: 'AI triage request is too large.' }, 413);
  }
  const rateKey = clientRateKey(request);
  if (isRateLimited(rateKey)) {
    return json({ error: 'AI triage is temporarily rate-limited. Please try again later.' }, 429);
  }

  if (!env.AI) {
    return json(
      {
        code: 'AI_NOT_CONFIGURED',
        error:
          'Cloudflare Workers AI binding is not configured. Add an AI binding named AI, or deploy this endpoint to a Worker with Workers AI enabled.'
      },
      503
    );
  }

  let body: TriageRequest;
  try {
    body = (await request.json()) as TriageRequest;
  } catch {
    return json({ error: 'Malformed JSON body.' }, 400);
  }

  const candidates = Array.isArray(body.candidates)
    ? body.candidates.slice(0, MAX_CANDIDATES).map(normalizeCandidate)
    : [];
  if (candidates.length === 0) return json({ assessments: [] });
  if (candidates.some((candidate) => typeof candidate.id !== 'string' || candidate.id.length === 0)) {
    return json({ error: 'Every candidate must include an id.' }, 400);
  }

  const model = env.CLOUDFLARE_AI_MODEL || DEFAULT_MODEL;
  const promptVersion = body.promptVersion || PROMPT_VERSION;
  const aiInput = {
    messages: [
      {
        role: 'system',
        content:
          'You are assisting with educational SETI candidate triage. Be conservative. ' +
          'Never claim evidence of extraterrestrial intelligence. Classify likely mundane causes first. ' +
          'Return only strict JSON with an "assessments" array. Labels must be one of: ' +
          'likely_rfi, likely_noise, interesting, needs_follow_up.'
      },
      {
        role: 'user',
        content:
          'Triage these candidate summaries from an in-browser radio-spectrogram analyzer. ' +
          'Use recurrence count, SNR, drift, duration, source kind, and existing rule label. ' +
          'For each candidate return candidateId, label, confidence from 0 to 1, rationale, and recommendedAction. ' +
          JSON.stringify({
            promptVersion,
            workUnit: normalizeRecord(body.workUnit ?? {}, 240),
            analysis: normalizeRecord(body.analysis ?? {}, 160),
            candidates
          })
      }
    ]
  };

  let raw: unknown;
  try {
    raw = await env.AI.run(model, aiInput);
  } catch (e) {
    return json(
      { error: `Workers AI request failed: ${e instanceof Error ? e.message : String(e)}` },
      502
    );
  }

  const text = extractText(raw);
  const parsed = parseAiJson(text);
  if (!parsed || !Array.isArray(parsed.assessments)) {
    return json({ error: 'Workers AI returned an unparseable triage response.', raw: text }, 502);
  }

  const now = new Date().toISOString();
  const allowedIds = new Set(candidates.map((candidate) => candidate.id as string));
  const assessments: TriageAssessment[] = [];
  for (const item of parsed.assessments) {
    const candidateId = typeof item?.candidateId === 'string' ? item.candidateId : '';
    const label = typeof item?.label === 'string' ? item.label : '';
    if (!allowedIds.has(candidateId) || !LABELS.has(label)) continue;
    assessments.push({
      candidateId,
      label: label as TriageAssessment['label'],
      confidence: clamp01(Number(item.confidence ?? 0)),
      rationale: normalizeText(item.rationale, 'No rationale returned.'),
      recommendedAction: normalizeText(item.recommendedAction, ''),
      createdAt: now
    });
  }

  return json({ provider: 'cloudflare-workers-ai', model, promptVersion, assessments });
};

export const onRequestOptions: PagesFunction<AiEnv> = async () => {
  return new Response(null, {
    status: 204,
    headers: corsHeaders('POST, OPTIONS')
  });
};

function extractText(raw: unknown): string {
  if (typeof raw === 'string') return raw;
  if (raw && typeof raw === 'object') {
    const record = raw as Record<string, unknown>;
    for (const key of ['response', 'result', 'text', 'content']) {
      if (typeof record[key] === 'string') return record[key] as string;
    }
    const choices = record.choices;
    if (Array.isArray(choices) && choices.length > 0) {
      const message = choices[0]?.message;
      if (message && typeof message === 'object') {
        const content = (message as Record<string, unknown>).content;
        if (typeof content === 'string') return content;
      }
    }
  }
  return JSON.stringify(raw);
}

function parseAiJson(text: string): { assessments?: unknown[] } | null {
  const trimmed = text.trim();
  try {
    return JSON.parse(trimmed) as { assessments?: unknown[] };
  } catch {
    const start = trimmed.indexOf('{');
    const end = trimmed.lastIndexOf('}');
    if (start >= 0 && end > start) {
      try {
        return JSON.parse(trimmed.slice(start, end + 1)) as { assessments?: unknown[] };
      } catch {
        return null;
      }
    }
    return null;
  }
}

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      ...corsHeaders('POST, OPTIONS'),
      'Content-Type': 'application/json'
    }
  });
}

function corsHeaders(methods: string): Record<string, string> {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': methods,
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Max-Age': '86400'
  };
}

function clientRateKey(request: Request): string {
  return (
    request.headers.get('CF-Connecting-IP') ||
    request.headers.get('X-Forwarded-For')?.split(',')[0]?.trim() ||
    'anonymous'
  );
}

function isRateLimited(key: string): boolean {
  const now = Date.now();
  const bucket = rateBuckets.get(key);
  if (!bucket || now - bucket.startedAt > RATE_LIMIT_WINDOW_MS) {
    rateBuckets.set(key, { startedAt: now, count: 1 });
    return false;
  }
  bucket.count += 1;
  if (rateBuckets.size > 2_000) {
    for (const [bucketKey, value] of rateBuckets) {
      if (now - value.startedAt > RATE_LIMIT_WINDOW_MS) rateBuckets.delete(bucketKey);
    }
  }
  return bucket.count > RATE_LIMIT_MAX_REQUESTS;
}

function normalizeCandidate(candidate: TriageCandidateInput): TriageCandidateInput {
  return {
    id: scrub(candidate.id, 80),
    frequencyMHz: finiteNumber(candidate.frequencyMHz),
    driftHzPerSec: finiteNumber(candidate.driftHzPerSec),
    snr: finiteNumber(candidate.snr),
    durationSec: finiteNumber(candidate.durationSec),
    confidence: finiteNumber(candidate.confidence),
    label: scrub(candidate.label, 32),
    recurrenceCount: finiteNumber(candidate.recurrenceCount),
    explanation: scrub(candidate.explanation, 280)
  };
}

function normalizeRecord(record: Record<string, unknown>, maxStringLength: number): Record<string, unknown> {
  const normalized: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(record).slice(0, 24)) {
    if (typeof value === 'string') normalized[key] = scrub(value, maxStringLength);
    else if (typeof value === 'number') normalized[key] = finiteNumber(value);
    else if (typeof value === 'boolean' || value === null) normalized[key] = value;
    else if (Array.isArray(value)) normalized[key] = value.slice(0, 16).map((item) =>
      typeof item === 'string' ? scrub(item, maxStringLength) : typeof item === 'number' ? finiteNumber(item) : item
    );
  }
  return normalized;
}

function scrub(value: unknown, maxLength: number): string | undefined {
  if (typeof value !== 'string') return undefined;
  return value
    .replace(/[<>`]/g, '')
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, maxLength);
}

function finiteNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(1, value));
}

function normalizeText(value: unknown, fallback: string): string {
  const text = typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : '';
  return text || fallback;
}
