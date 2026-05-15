import { create } from 'zustand';
import type {
  AnalysisResult,
  CandidateSignal,
  ContributionStats,
  EngineSnapshot,
  ResourceProfile,
  Spectrogram,
  WorkUnit
} from '../types/domain';
import {
  workClient,
  buildLocalFileWorkUnit,
  nextCachedReplayUnit,
  cachedReplayCount
} from './workClient';
import { clearCachedAnalyses, saveCachedAnalysis } from '../data/spectrogramCache';
import {
  annotateRecurrence,
  clearDatasetMemory,
  previousChunkOffsetsFor,
  recordChunkAnalysis
} from '../data/datasetMemory';
import { requestAiTriage } from '../data/aiTriage';
import { analyzeWorkUnit, cancelCurrentAnalysis } from './engineCoordinator';

const STORAGE_KEY = 'signalscope:contribution-stats:v1';
const CANDIDATES_KEY = 'signalscope:candidates:v1';
const SETTINGS_KEY = 'signalscope:settings:v1';
const HISTORY_KEY = 'signalscope:history:v1';

interface Settings {
  resourceProfile: ResourceProfile;
}

interface HistoryEntry {
  unitId: string;
  targetName: string;
  candidates: number;
  computeMs: number;
  observedAt: string;
  finishedAt: string;
  /** Provenance of the analyzed bytes:
   *   - 'real'     : streamed from a public Berkeley SETI / BL archive
   *   - 'uploaded' : a user-supplied SIGPROC `.fil` processed locally
   *   - 'cached'   : a previously-analyzed spectrogram replayed offline
   *                  from IndexedDB
   *  Older entries may carry the legacy 'demo' tag — UI treats it as unknown. */
  source?: 'real' | 'uploaded' | 'cached' | 'demo';
}

/** Surface for the fetch-progress messages so the UI can show a download bar. */
export interface FetchProgress {
  workUnitId: string;
  phase: 'header' | 'data' | 'decode';
  bytesLoaded: number;
  bytesTotal: number;
}

interface EngineStore extends EngineSnapshot {
  stats: ContributionStats;
  candidates: CandidateSignal[];
  settings: Settings;
  history: HistoryEntry[];
  fetchProgress: FetchProgress | null;
  /** Last non-fatal error message from the engine (e.g. real-data fetch failed). */
  lastError: string | null;
  aiTriageStatus: 'idle' | 'running' | 'done' | 'error';
  aiTriageError: string | null;
  /** Count of analyses cached in IndexedDB for offline replay. Refreshed
   *  whenever an analysis finishes (or on first mount). */
  cachedCount: number;
  start(): Promise<void>;
  pause(): void;
  setProfile(p: ResourceProfile): void;
  /** Queue a user-uploaded `.fil` file for analysis. Returns the unit id
   *  so callers can navigate to / highlight it in the UI. */
  analyzeLocalFile(file: File): Promise<string>;
  /** Replay one cached analysis from IndexedDB (used as the offline fallback).
   *  Returns the unit id, or null if the cache is empty. */
  analyzeCachedReplay(): Promise<string | null>;
  /** Refresh `cachedCount` from IndexedDB. Safe to call repeatedly. */
  refreshCachedCount(): Promise<void>;
  triageLastResultWithAi(): Promise<void>;
  resetStats(): Promise<void>;
  clearError(): void;
  /** Live row buffer for the current waterfall (frames × channels), null if none. */
  liveSpectrogram: Spectrogram | null;
}

function loadJSON<T>(key: string, fallback: T): T {
  if (typeof localStorage === 'undefined') return fallback;
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return fallback;
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function saveJSON<T>(key: string, value: T): void {
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* quota — ignore */
  }
}

const initialStats: ContributionStats = loadJSON(STORAGE_KEY, {
  unitsAnalyzed: 0,
  candidatesFound: 0,
  totalComputeMs: 0,
  throughputMbinsPerSec: 0
});

const initialSettings: Settings = loadSettings();

const initialCandidates: CandidateSignal[] = loadJSON(CANDIDATES_KEY, []);
const initialHistory: HistoryEntry[] = loadJSON(HISTORY_KEY, []);

function loadSettings(): Settings {
  const raw = loadJSON<Partial<Settings> & Record<string, unknown>>(SETTINGS_KEY, {});
  const resourceProfile = isResourceProfile(raw.resourceProfile)
    ? raw.resourceProfile
    : 'balanced';
  const settings: Settings = { resourceProfile };
  saveJSON(SETTINGS_KEY, settings);
  return settings;
}

function isResourceProfile(value: unknown): value is ResourceProfile {
  return value === 'eco' || value === 'balanced' || value === 'maximum';
}

let running = false;

export const useEngine = create<EngineStore>((set) => ({
  status: 'idle',
  progress: 0,
  cpuUsageEstimate: 0,
  resourceProfile: initialSettings.resourceProfile,
  stats: initialStats,
  candidates: initialCandidates,
  settings: initialSettings,
  history: initialHistory,
  liveSpectrogram: null,
  fetchProgress: null,
  lastError: null,
  aiTriageStatus: 'idle',
  aiTriageError: null,
  cachedCount: 0,

  setProfile(p) {
    set((s) => {
      const settings = { ...s.settings, resourceProfile: p };
      saveJSON(SETTINGS_KEY, settings);
      return { settings, resourceProfile: p };
    });
  },

  async analyzeLocalFile(file) {
    // Build a one-shot work unit pointing at this Blob and push it onto
    // the work-client queue. If the engine is currently paused, also kick
    // off `start()` so the upload begins processing immediately. The file
    // never leaves the browser — the worker reads it via Blob.slice().
    const unit = buildLocalFileWorkUnit(file);
    workClient.enqueueUnit(unit);
    if (!running) {
      // Fire-and-forget; the loop will pick up the queued unit first.
      void useEngine.getState().start();
    }
    return unit.id;
  },

  async analyzeCachedReplay() {
    // Pull one cached spectrogram from IndexedDB and queue it as a one-shot
    // work unit. The worker's 'cached-decoded' branch bypasses any network
    // I/O — pure offline replay of real data the user has previously
    // analyzed.
    const unit = await nextCachedReplayUnit();
    if (!unit) return null;
    workClient.enqueueUnit(unit);
    if (!running) {
      void useEngine.getState().start();
    }
    return unit.id;
  },

  async refreshCachedCount() {
    try {
      const n = await cachedReplayCount();
      set({ cachedCount: n });
    } catch (e) {
      console.warn('[engine] cache count failed', e);
    }
  },

  clearError() {
    set({ lastError: null });
  },

  async triageLastResultWithAi() {
    const state = useEngine.getState();
    const unit = state.currentUnit;
    const result = state.lastResult;
    if (!unit || !result || result.candidates.length === 0) return;
    set({ aiTriageStatus: 'running', aiTriageError: null });
    try {
      const triaged = await requestAiTriage(unit, result);
      const triagedById = new Map(triaged.map((candidate) => [candidate.id, candidate]));
      const currentState = useEngine.getState();
      if (currentState.lastResult?.workUnitId !== result.workUnitId) {
        set({ aiTriageStatus: 'idle', aiTriageError: null });
        return;
      }
      const nextResult: AnalysisResult = { ...currentState.lastResult, candidates: triaged };
      const latestCandidates = currentState.candidates;
      const nextCandidates = latestCandidates.map(
        (candidate) => triagedById.get(candidate.id) ?? candidate
      );
      saveJSON(CANDIDATES_KEY, nextCandidates);
      set({
        lastResult: nextResult,
        candidates: nextCandidates,
        aiTriageStatus: 'done',
        aiTriageError: null
      });
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      set({ aiTriageStatus: 'error', aiTriageError: message });
    }
  },

  async resetStats() {
    const fresh: ContributionStats = {
      unitsAnalyzed: 0,
      candidatesFound: 0,
      totalComputeMs: 0,
      throughputMbinsPerSec: 0
    };
    saveJSON(STORAGE_KEY, fresh);
    saveJSON(CANDIDATES_KEY, []);
    saveJSON(HISTORY_KEY, []);
    try {
      await Promise.all([clearCachedAnalyses(), clearDatasetMemory()]);
    } catch (e) {
      console.warn('[engine] local IndexedDB reset failed', e);
    }
    set({
      stats: fresh,
      candidates: [],
      history: [],
      cachedCount: 0,
      lastResult: undefined,
      lastSpectrogram: undefined,
      liveSpectrogram: null,
      currentUnit: undefined,
      fetchProgress: null,
      aiTriageStatus: 'idle',
      aiTriageError: null,
      progress: 0
    });
  },

  pause() {
    running = false;
    cancelCurrentAnalysis();
    set({ status: 'paused' });
  },

  async start() {
    if (running) return;
    running = true;
    set({
      status: 'fetching',
      lastError: null,
      fetchProgress: null,
      aiTriageStatus: 'idle',
      aiTriageError: null
    });

    while (running) {
      const fetched = await workClient.fetchWorkUnit();
      if (!running) break;
      // Stamp `previousChunkOffsets` from the dataset memory so the worker
      // can bias chunk picks toward unexplored regions of huge files. This
      // is best-effort — if IndexedDB is unavailable or the dataset has no
      // prior coverage record, `prior` will be an empty array.
      let prior: number[] = [];
      try {
        prior = await previousChunkOffsetsFor(fetched.datasetId);
      } catch (e) {
        console.warn('[engine] previousChunkOffsetsFor failed', e);
      }
      const unit: WorkUnit =
        prior.length > 0
          ? { ...fetched, previousChunkOffsets: prior }
          : fetched;
      set({
        status: 'analyzing',
        currentUnit: unit,
        progress: 0,
        fetchProgress: null,
        liveSpectrogram: {
          workUnitId: unit.id,
          frames: unit.frames,
          channels: unit.channels,
          data: new Float32Array(unit.frames * unit.channels)
        }
      });

      const startedAt = performance.now();
      const run = await analyzeWorkUnit(unit, useEngine.getState().resourceProfile, {
        onProgress(msg) {
          useEngine.setState({
            progress: msg.progress,
            cpuUsageEstimate: msg.cpuUsage
          });
        },
        onRows(msg) {
          const live = useEngine.getState().liveSpectrogram;
          if (!live || live.workUnitId !== unit.id) return;
          if (msg.channels !== live.channels) return;
          live.data.set(msg.rows, msg.startRow * msg.channels);
          useEngine.setState({
            liveSpectrogram: {
              workUnitId: live.workUnitId,
              frames: live.frames,
              channels: live.channels,
              data: live.data
            }
          });
        },
        onFetchProgress(msg) {
          useEngine.setState({
            fetchProgress: {
              workUnitId: msg.workUnitId,
              phase: msg.phase,
              bytesLoaded: msg.bytesLoaded,
              bytesTotal: msg.bytesTotal
            }
          });
        },
        onUnitUpdated(updatedUnit) {
          useEngine.setState({
            currentUnit: updatedUnit,
            liveSpectrogram: {
              workUnitId: updatedUnit.id,
              frames: updatedUnit.frames,
              channels: updatedUnit.channels,
              data: new Float32Array(updatedUnit.frames * updatedUnit.channels)
            }
          });
        },
        onError(message) {
          console.error('[engine] worker error', message);
          useEngine.setState({ lastError: message });
        }
      });
      if (!run) break; // cancelled or failed

      let annotated = run.result.candidates;
      try {
        annotated = await annotateRecurrence(
          run.unit.datasetId,
          run.result.candidates,
          run.unit.channelBandwidthHz
        );
      } catch (e) {
        console.warn('[engine] recurrence annotation failed', e);
      }
      await finalizeAnalysis(
        run.unit,
        { ...run.result, candidates: annotated },
        run.spectrogram,
        startedAt
      );

      // Brief pause between units so the finished waterfall stays visible.
      await new Promise<void>((r) => setTimeout(r, 900));
    }

    if (!running) set((s) => ({ status: s.status === 'analyzing' ? 'paused' : s.status }));
  }
}));

async function finalizeAnalysis(
  unit: WorkUnit,
  result: AnalysisResult,
  spectrogram: Spectrogram,
  startedAt: number
) {
      const elapsed = performance.now() - startedAt;
      const stats = useEngine.getState().stats;
      const newStats: ContributionStats = {
        unitsAnalyzed: stats.unitsAnalyzed + 1,
        candidatesFound: stats.candidatesFound + result.candidates.length,
        totalComputeMs: stats.totalComputeMs + result.computeMs,
        throughputMbinsPerSec:
          (result.binsProcessed / 1e6) / Math.max(0.001, result.computeMs / 1000)
      };
      saveJSON(STORAGE_KEY, newStats);

      const cands = useEngine.getState().candidates;
      const merged = [...result.candidates, ...cands].slice(0, 200);
      saveJSON(CANDIDATES_KEY, merged);

      const history = useEngine.getState().history;
      const entry: HistoryEntry = {
        unitId: unit.id,
        targetName: unit.target.name,
        candidates: result.candidates.length,
        computeMs: result.computeMs,
        observedAt: unit.observedAt,
        finishedAt: new Date().toISOString(),
        source:
          unit.dataSource?.kind === 'filterbank'
            ? 'real'
            : unit.dataSource?.kind === 'filterbank-local'
            ? 'uploaded'
            : unit.dataSource?.kind === 'cached-decoded'
            ? 'cached'
            : 'real'
      };
      const newHistory = [entry, ...history].slice(0, 50);
      saveJSON(HISTORY_KEY, newHistory);

      // Persist the analysis to IndexedDB so we can replay it offline.
      // Skip cached-replay units (re-caching them would be pointless and would
      // also strand the original cached entry one slot lower in the LRU).
      if (unit.dataSource?.kind !== 'cached-decoded') {
        saveCachedAnalysis(unit, spectrogram, result)
          .then(() => useEngine.getState().refreshCachedCount())
          .catch((e) => console.warn('[engine] cache save failed', e));
      }

      // Record this chunk's coverage + candidates into the per-dataset
      // memory so future runs of the same dataset get accurate recurrence
      // annotations and unexplored-region biasing. The function itself
      // skips cached-replay units to avoid inflating recurrence counts.
      if (unit.datasetId) {
        try {
          await recordChunkAnalysis(unit, result);
        } catch (e) {
          console.warn('[engine] dataset memory write failed', e);
        }
      }

      useEngine.setState({
        progress: 1,
        stats: newStats,
        candidates: merged,
        history: newHistory,
        lastResult: result,
        lastSpectrogram: spectrogram,
        liveSpectrogram: spectrogram
      });

      // Pace the next unit a bit so UI can settle.
      void elapsed;
}
