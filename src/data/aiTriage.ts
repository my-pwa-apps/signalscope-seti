import type { AnalysisResult, AiAssessment, CandidateSignal, WorkUnit } from '../types/domain';

export const AI_TRIAGE_PROMPT_VERSION = 'signalscope-ai-triage-v1';

const AI_TRIAGE_PATH = import.meta.env.VITE_AI_TRIAGE_PATH ?? '/api/triage';

interface AiTriageResponse {
  provider?: string;
  model?: string;
  promptVersion?: string;
  assessments?: Array<{
    candidateId?: string;
    label?: AiAssessment['label'];
    confidence?: number;
    rationale?: string;
    recommendedAction?: string;
    createdAt?: string;
  }>;
}

export async function requestAiTriage(
  unit: WorkUnit,
  result: AnalysisResult,
  candidates: CandidateSignal[] = result.candidates
): Promise<CandidateSignal[]> {
  if (candidates.length === 0) return result.candidates;

  const response = await fetch(AI_TRIAGE_PATH, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      promptVersion: AI_TRIAGE_PROMPT_VERSION,
      workUnit: summarizeWorkUnit(unit),
      analysis: {
        computeMs: result.computeMs,
        noiseFloor: result.noiseFloor,
        binsProcessed: result.binsProcessed,
        summary: result.summary ?? null
      },
      candidates: candidates.slice(0, 10).map(summarizeCandidate)
    })
  });

  if (!response.ok) {
    throw new Error(await aiTriageErrorMessage(response));
  }

  const payload = (await response.json()) as AiTriageResponse;
  const assessments = new Map<string, AiAssessment>();
  const now = new Date().toISOString();
  for (const item of payload.assessments ?? []) {
    if (!item.candidateId || !isAiLabel(item.label)) continue;
    assessments.set(item.candidateId, {
      provider: isAiProvider(payload.provider) ? payload.provider : 'cloudflare-workers-ai',
      model: payload.model || 'unknown',
      promptVersion: payload.promptVersion || AI_TRIAGE_PROMPT_VERSION,
      label: item.label,
      confidence: clamp01(item.confidence ?? 0),
      rationale: normalizeText(item.rationale, 'No rationale returned.'),
      recommendedAction: item.recommendedAction
        ? normalizeText(item.recommendedAction, undefined)
        : undefined,
      createdAt: item.createdAt || now
    });
  }

  return result.candidates.map((candidate) => {
    const assessment = assessments.get(candidate.id);
    return assessment ? { ...candidate, aiAssessment: assessment } : candidate;
  });
}

function summarizeWorkUnit(unit: WorkUnit) {
  return {
    id: unit.id,
    targetName: unit.target.name,
    telescope: unit.telescope,
    observedAt: unit.observedAt,
    datasetId: unit.datasetId ?? null,
    sourceRef: unit.sourceRef,
    frequencyRangeMHz: [unit.freqStartMHz, unit.freqEndMHz],
    channelBandwidthHz: unit.channelBandwidthHz,
    frames: unit.frames,
    framePeriodSec: unit.framePeriodSec,
    chunkCount: unit.chunkCount ?? 1,
    chunkOffsets: unit.chunkOffsets ?? null,
    chunkSpanBytes: unit.chunkSpanBytes ?? null,
    sourceKind: unit.dataSource?.kind ?? 'unknown'
  };
}

function summarizeCandidate(candidate: CandidateSignal) {
  return {
    id: candidate.id,
    frequencyMHz: round(candidate.frequencyMHz, 6),
    driftHzPerSec: round(candidate.driftHzPerSec, 6),
    snr: round(candidate.snr, 3),
    durationSec: round(candidate.durationSec, 3),
    confidence: round(candidate.confidence, 3),
    label: candidate.label,
    recurrenceCount: candidate.recurrenceCount ?? 0,
    datasetId: candidate.datasetId ?? null,
    explanation: candidate.explanation,
    pixel: candidate.pixel
  };
}

function isAiLabel(value: unknown): value is AiAssessment['label'] {
  return (
    value === 'likely_rfi' ||
    value === 'likely_noise' ||
    value === 'interesting' ||
    value === 'needs_follow_up'
  );
}

function isAiProvider(value: unknown): value is AiAssessment['provider'] {
  return value === 'cloudflare-workers-ai' || value === 'signalscope-rule-fallback';
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(1, value));
}

function normalizeText(value: string | undefined, fallback: string | undefined): string {
  const text = (value ?? '').replace(/\s+/g, ' ').trim();
  return text || fallback || '';
}

function round(value: number, digits: number): number {
  const scale = 10 ** digits;
  return Math.round(value * scale) / scale;
}

async function aiTriageErrorMessage(response: Response): Promise<string> {
  const fallback = `AI triage failed with HTTP ${response.status}`;
  let payload: { code?: string; error?: string } | null = null;
  try {
    payload = (await response.json()) as { code?: string; error?: string };
  } catch {
    return fallback;
  }
  if (payload?.code === 'AI_NOT_CONFIGURED' || response.status === 503) {
    return 'AI triage is not enabled on this deployment. Configure the Cloudflare Workers AI binding named AI.';
  }
  if (response.status === 429) return 'AI triage is busy. Please wait a minute and try again.';
  if (response.status === 413) return 'AI triage request is too large for this deployment.';
  if (response.status === 502) {
    return 'AI triage could not produce a clean response. Please try again; the detector results are still saved.';
  }
  return payload?.error || fallback;
}
