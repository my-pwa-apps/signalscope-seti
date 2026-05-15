import { useMemo, useState, useEffect } from 'react';
import { Card, CardHeader } from '../components/ui/Card';
import { Pill } from '../components/ui/Pill';
import { useEngine } from '../engine/store';
import type { AiAssessment, CandidateLabel, CandidateSignal } from '../types/domain';
import { formatHz, formatMHz } from '../utils/format';
import { MeterBar } from '../components/ui/MeterBar';
import { Button } from '../components/ui/Button';
import {
  buildFindingsBundle,
  canExportFindings,
  suggestedBundleFileName
} from '../data/findingsExport';
import {
  getDatasetMemory,
  summarizeCoverage,
  type DatasetMemoryRecord
} from '../data/datasetMemory';

const FILTERS: { value: 'all' | CandidateLabel; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'interesting', label: 'Interesting' },
  { value: 'needs-followup', label: 'Needs follow-up' },
  { value: 'likely-rfi', label: 'Likely RFI' },
  { value: 'noise', label: 'Noise' }
];

export function Findings() {
  const all = useEngine((s) => s.candidates);
  const lastResult = useEngine((s) => s.lastResult);
  const currentUnit = useEngine((s) => s.currentUnit);
  const aiTriageStatus = useEngine((s) => s.aiTriageStatus);
  const aiTriageError = useEngine((s) => s.aiTriageError);
  const triageWithAi = useEngine((s) => s.triageLastResultWithAi);
  const [filter, setFilter] = useState<'all' | CandidateLabel>('all');
  const [active, setActive] = useState<CandidateSignal | null>(null);

  const filtered = useMemo(
    () => (filter === 'all' ? all : all.filter((c) => c.label === filter)),
    [all, filter]
  );

  const counts = useMemo(() => {
    const c: Record<string, number> = { all: all.length };
    for (const x of all) c[x.label] = (c[x.label] ?? 0) + 1;
    return c;
  }, [all]);

  const current = active ? filtered.find((candidate) => candidate.id === active.id) ?? active : filtered[0] ?? null;
  const exportable =
    currentUnit !== undefined &&
    currentUnit !== null &&
    lastResult !== undefined &&
    canExportFindings(currentUnit, lastResult);
  const canTriageWithAi =
    currentUnit !== undefined &&
    currentUnit !== null &&
    lastResult !== undefined &&
    lastResult.candidates.length > 0 &&
    aiTriageStatus !== 'running';

  function handleExport() {
    if (!currentUnit || !lastResult) return;
    const blob = buildFindingsBundle(currentUnit, lastResult);
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = suggestedBundleFileName(currentUnit);
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 5_000);
  }

  function handleAiTriage() {
    void triageWithAi();
  }

  return (
    <div className="space-y-5">
      <Card>
        <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
          <div>
            <h2 className="text-xl font-semibold text-slate-100">Candidate signals</h2>
            <p className="mt-1 max-w-2xl text-sm text-slate-400">
              These are pixels in the waterfall that stood out from the local noise. Most
              are interference. None of them are evidence of intelligent life.
            </p>
          </div>
          <div className="flex flex-wrap gap-1">
            {FILTERS.map((f) => (
              <button
                key={f.value}
                onClick={() => setFilter(f.value)}
                className={`rounded-full border px-3 py-1 text-xs font-semibold uppercase tracking-widest transition ${
                  filter === f.value
                    ? 'border-signal-cyan/50 bg-signal-cyan/10 text-signal-cyan'
                    : 'border-white/10 bg-white/5 text-slate-400 hover:text-slate-200'
                }`}
              >
                {f.label} <span className="ml-1 text-[10px] text-slate-500">{counts[f.value] ?? 0}</span>
              </button>
            ))}
          </div>
        </div>

        <div className="mt-4 rounded-xl border border-signal-amber/30 bg-signal-amber/5 p-4 text-sm leading-relaxed text-amber-100/90">
          <strong className="font-semibold text-signal-amber">Important:</strong>{' '}
          A candidate signal is not evidence of extraterrestrial intelligence. Most
          candidates are caused by terrestrial radio interference, instrumental effects,
          or random fluctuations of the noise. Real SETI candidates require independent
          verification by professional observatories before any further claim is made.
        </div>

        <div className="mt-4 flex flex-col gap-3 rounded-xl border border-white/5 bg-white/[0.02] p-4 text-sm leading-relaxed text-slate-300 md:flex-row md:items-center md:justify-between">
          <div className="flex-1">
            <strong className="font-semibold text-slate-100">Share with researchers.</strong>{' '}
            Download the last analyzed unit as a bundle containing a{' '}
            <code className="rounded bg-black/30 px-1 py-0.5 font-mono text-[10px]">.dat</code>{' '}
            file in turbo_seti format, a JSON manifest with full provenance, and a
            README. Berkeley SETI doesn&rsquo;t currently accept automated uploads of
            third-party hits, but the bundle is in a shape any radio astronomer can
            ingest. See the README inside the zip for details.
          </div>
          <Button size="sm" variant="ghost" onClick={handleExport} disabled={!exportable}>
            {exportable ? 'Export findings bundle' : 'No analyzed unit yet'}
          </Button>
        </div>

        <div className="mt-4 flex flex-col gap-3 rounded-xl border border-signal-violet/25 bg-signal-violet/5 p-4 text-sm leading-relaxed text-violet-100/90 md:flex-row md:items-center md:justify-between">
          <div className="flex-1">
            <strong className="font-semibold text-signal-violet">AI triage.</strong>{' '}
            Optionally send compact candidate metadata to your Cloudflare Workers AI
            endpoint for an advisory label and short rationale. Raw filterbank bytes
            and spectrogram tensors are not sent.
            {aiTriageError && (
              <div className="mt-2 text-[11px] text-signal-rose">{aiTriageError}</div>
            )}
          </div>
          <Button size="sm" variant="ghost" onClick={handleAiTriage} disabled={!canTriageWithAi}>
            {aiTriageStatus === 'running'
              ? 'AI triage running'
              : canTriageWithAi
              ? 'Analyze candidates with AI'
              : 'No candidates to triage'}
          </Button>
        </div>

        <DatasetCoverage datasetId={currentUnit?.datasetId} />
      </Card>

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader title="Detections" subtitle={`${filtered.length} candidate(s)`} />
          <div className="overflow-hidden rounded-xl border border-white/5">
            <table className="w-full text-left text-sm">
              <thead className="bg-white/[0.03] text-[10px] uppercase tracking-widest text-slate-500">
                <tr>
                  <th className="px-3 py-2.5">Label</th>
                  <th className="px-3 py-2.5">Frequency</th>
                  <th className="px-3 py-2.5">Drift</th>
                  <th className="px-3 py-2.5">SNR</th>
                  <th className="px-3 py-2.5">Duration</th>
                  <th className="px-3 py-2.5">Confidence</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/5">
                {filtered.length === 0 && (
                  <tr>
                    <td colSpan={6} className="px-3 py-6 text-center text-sm text-slate-500">
                      No candidates yet. Run a few work units from the Dashboard.
                    </td>
                  </tr>
                )}
                {filtered.map((c) => (
                  <tr
                    key={c.id}
                    onClick={() => setActive(c)}
                    className={`cursor-pointer transition hover:bg-white/[0.04] ${
                      current?.id === c.id ? 'bg-white/[0.05]' : ''
                    }`}
                  >
                    <td className="px-3 py-2.5">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <LabelPill label={c.label} />
                        {c.recurrenceCount !== undefined && c.recurrenceCount > 0 && (
                          <RecurrencePill count={c.recurrenceCount} />
                        )}
                        {c.aiAssessment && <AiAssessmentPill assessment={c.aiAssessment} />}
                      </div>
                    </td>
                    <td className="px-3 py-2.5 font-mono text-xs text-slate-200">
                      {formatMHz(c.frequencyMHz)}
                    </td>
                    <td className="px-3 py-2.5 font-mono text-xs text-slate-300">
                      {formatHz(c.driftHzPerSec)}/s
                    </td>
                    <td className="px-3 py-2.5 font-mono text-xs text-signal-cyan">
                      {c.snr.toFixed(1)}σ
                    </td>
                    <td className="px-3 py-2.5 font-mono text-xs text-slate-300">
                      {c.durationSec.toFixed(1)} s
                    </td>
                    <td className="px-3 py-2.5">
                      <div className="flex items-center gap-2">
                        <MeterBar value={c.confidence} tone="violet" className="max-w-[120px]" />
                        <span className="font-mono text-[10px] text-slate-400">
                          {(c.confidence * 100).toFixed(0)}%
                        </span>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>

        <Card>
          <CardHeader title="Inspector" subtitle={current ? current.id : 'Select a candidate'} />
          {current ? (
            <div className="space-y-4 text-sm">
              <div className="flex flex-wrap items-center gap-2">
                <LabelPill label={current.label} large />
                {current.recurrenceCount !== undefined && current.recurrenceCount > 0 && (
                  <RecurrencePill count={current.recurrenceCount} />
                )}
                {current.aiAssessment && <AiAssessmentPill assessment={current.aiAssessment} />}
              </div>
              <p className="leading-relaxed text-slate-300">{current.explanation}</p>

              {current.aiAssessment && <AiAssessmentCard assessment={current.aiAssessment} />}

              <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-xs">
                <Field label="Frequency" value={formatMHz(current.frequencyMHz, 6)} />
                <Field label="Drift rate" value={`${formatHz(current.driftHzPerSec)}/s`} />
                <Field label="SNR" value={`${current.snr.toFixed(2)}σ`} />
                <Field label="Duration" value={`${current.durationSec.toFixed(2)} s`} />
                <Field label="Channel" value={`${current.pixel.channel}`} />
                <Field
                  label="Footprint"
                  value={`${current.pixel.width} × ${current.pixel.height} px`}
                />
                <Field label="Work unit" value={current.workUnitId} />
                <Field label="Confidence" value={`${(current.confidence * 100).toFixed(0)}%`} />
              </dl>

              <div className="rounded-lg border border-white/5 bg-white/[0.03] p-3 text-[11px] leading-relaxed text-slate-400">
                Even an "Interesting" or "Needs follow-up" candidate is unlikely to be
                anything new. Real SETI workflows require repeat observations from
                multiple antennas before any further analysis.
              </div>
            </div>
          ) : (
            <p className="text-sm text-slate-500">No candidate selected.</p>
          )}
        </Card>
      </div>
    </div>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <>
      <dt className="text-[10px] uppercase tracking-widest text-slate-500">{label}</dt>
      <dd className="font-mono text-slate-200">{value}</dd>
    </>
  );
}

function LabelPill({ label, large = false }: { label: CandidateLabel; large?: boolean }) {
  const map: Record<CandidateLabel, { tone: 'slate' | 'rose' | 'cyan' | 'amber'; text: string }> = {
    noise: { tone: 'slate', text: 'Noise' },
    'likely-rfi': { tone: 'rose', text: 'Likely terrestrial RFI' },
    interesting: { tone: 'cyan', text: 'Interesting candidate' },
    'needs-followup': { tone: 'amber', text: 'Needs follow-up' }
  };
  const { tone, text } = map[label];
  return (
    <Pill tone={tone} className={large ? 'text-xs px-3 py-1' : ''}>
      {text}
    </Pill>
  );
}

function RecurrencePill({ count }: { count: number }) {
  // Cross-chunk recurrence indicator: shown when a candidate's frequency was
  // also flagged by one or more *prior* analyses of the same dataset. A
  // count of 1 means one earlier hit at this frequency in the same file,
  // 2 means two, and so on — anything above zero is interesting because
  // persistent narrowband emitters are the most useful kind of SETI hit.
  return (
    <Pill tone="amber" dot className="text-[10px]">
      {count === 1 ? 'Seen 1x in this dataset' : 'Seen ' + count + 'x in this dataset'}
    </Pill>
  );
}

function AiAssessmentPill({ assessment }: { assessment: AiAssessment }) {
  const map: Record<AiAssessment['label'], { tone: 'slate' | 'rose' | 'cyan' | 'amber'; text: string }> = {
    likely_noise: { tone: 'slate', text: 'AI: likely noise' },
    likely_rfi: { tone: 'rose', text: 'AI: likely RFI' },
    interesting: { tone: 'cyan', text: 'AI: interesting' },
    needs_follow_up: { tone: 'amber', text: 'AI: follow-up' }
  };
  const { tone, text } = map[assessment.label];
  const isFallback = assessment.provider === 'signalscope-rule-fallback';
  const display = isFallback ? text.replace('AI:', 'Rule:') : text;
  return (
    <Pill tone={tone} className="text-[10px]">
      {display} {(assessment.confidence * 100).toFixed(0)}%
    </Pill>
  );
}

function AiAssessmentCard({ assessment }: { assessment: AiAssessment }) {
  const isFallback = assessment.provider === 'signalscope-rule-fallback';
  const title = isFallback
    ? 'Conservative rule-based fallback (AI did not return parseable JSON)'
    : 'Cloudflare AI advisory triage';
  return (
    <div className="rounded-lg border border-signal-violet/25 bg-signal-violet/5 p-3 text-[11px] leading-relaxed text-violet-100/80">
      <div className="mb-1 flex flex-wrap items-center justify-between gap-2">
        <strong className="font-semibold text-signal-violet">{title}</strong>
        <span className="font-mono text-[10px] text-violet-100/60">
          {assessment.model} · {(assessment.confidence * 100).toFixed(0)}%
        </span>
      </div>
      <p>{assessment.rationale}</p>
      {assessment.recommendedAction && (
        <p className="mt-2 text-violet-100/70">Recommended action: {assessment.recommendedAction}</p>
      )}
    </div>
  );
}

function DatasetCoverage({ datasetId }: { datasetId?: string }) {
  // Loads the per-dataset memory record (if any) and shows a compact summary
  // of how much of the underlying file has been analyzed across all past
  // runs, plus how many prior candidates exist. Renders nothing when there
  // is no datasetId, no memory record, or no prior coverage worth showing.
  const [memory, setMemory] = useState<DatasetMemoryRecord | null>(null);
  const lastResult = useEngine((s) => s.lastResult);
  useEffect(() => {
    let cancelled = false;
    if (!datasetId) {
      setMemory(null);
      return;
    }
    getDatasetMemory(datasetId)
      .then((m) => {
        if (!cancelled) setMemory(m);
      })
      .catch(() => {
        if (!cancelled) setMemory(null);
      });
    return () => {
      cancelled = true;
    };
    // Re-fetch when the latest analysis completes, since recordChunkAnalysis
    // writes a new record after every finalize().
  }, [datasetId, lastResult]);

  if (!datasetId || !memory) return null;
  const summary = summarizeCoverage(memory);
  // Suppress the card on truly empty memory — it only adds noise.
  if (summary.uniqueOffsetCount === 0 && memory.candidates.length === 0) return null;
  const fractionPct = summary.fractionCovered * 100;
  const knownSize = memory.totalFileBytes && memory.totalFileBytes > 0;
  return (
    <div className="mt-4 flex flex-col gap-3 rounded-xl border border-signal-cyan/30 bg-signal-cyan/5 p-4 text-sm leading-relaxed text-cyan-100/90">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <strong className="font-semibold text-signal-cyan">Dataset memory.</strong>
        <span className="font-mono text-[10px] text-cyan-100/70">{datasetId}</span>
      </div>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat label="Analyzed chunks" value={String(summary.uniqueOffsetCount)} />
        <Stat label="Bytes covered" value={formatBytes(summary.bytesCovered)} />
        <Stat
          label="Of file"
          value={knownSize ? fractionPct.toFixed(1) + '%' : 'unknown size'}
        />
        <Stat label="Prior candidates" value={String(memory.candidates.length)} />
      </div>
      <p className="text-[11px] text-cyan-100/70">
        Future analyses of this dataset will be biased toward unexplored regions,
        and candidates flagged at the same frequency across multiple chunks will be
        highlighted with a recurrence pill.
      </p>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-white/5 bg-white/[0.04] px-3 py-2">
      <div className="text-[9px] uppercase tracking-widest text-cyan-100/60">{label}</div>
      <div className="mt-1 font-mono text-sm text-slate-100">{value}</div>
    </div>
  );
}

function formatBytes(b: number): string {
  if (b < 1024) return b + ' B';
  if (b < 1024 * 1024) return (b / 1024).toFixed(1) + ' KiB';
  if (b < 1024 * 1024 * 1024) return (b / (1024 * 1024)).toFixed(1) + ' MiB';
  return (b / (1024 * 1024 * 1024)).toFixed(2) + ' GiB';
}