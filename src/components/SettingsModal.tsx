import React from 'react';
import { Cpu, KeyRound, RefreshCw, RotateCcw, ShieldCheck, X } from 'lucide-react';
import type { ThinkingLevelSetting } from '../types/studio';
import { useStudioStore } from '../store/useStudioStore';
import { getEnvApiKey, LLM_TASK_ORDER } from '../ai/llmConfig';

const LEVELS: ThinkingLevelSetting[] = ['LOW', 'MEDIUM', 'HIGH', 'XHIGH'];

export const SettingsModal: React.FC = () => {
  const isOpen = useStudioStore((s) => s.isSettingsOpen);
  const settings = useStudioStore((s) => s.settings);
  const project = useStudioStore((s) => s.project);

  const setSettingsOpen = useStudioStore((s) => s.setSettingsOpen);
  const updateSettings = useStudioStore((s) => s.updateSettings);
  const updateLlmTaskConfig = useStudioStore((s) => s.updateLlmTaskConfig);
  const reloadSettingsFromEnv = useStudioStore((s) => s.reloadSettingsFromEnv);
  const updateTotalBudget = useStudioStore((s) => s.updateTotalBudget);
  const resetProject = useStudioStore((s) => s.resetProject);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 bg-black/75 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="bg-[#18181d] border border-zinc-700 rounded-2xl shadow-2xl max-w-3xl w-full max-h-[90vh] flex flex-col overflow-hidden">
        <div className="px-5 py-3.5 border-b border-zinc-800 flex items-center justify-between shrink-0">
          <div className="flex items-center gap-2">
            <KeyRound className="w-4 h-4 text-violet-400" />
            <h3 className="text-sm font-bold text-zinc-100">
              Gemini 4 Series Models, Reasoning Levels &amp; .env Config
            </h3>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={reloadSettingsFromEnv}
              className="px-2.5 py-1 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-zinc-200 text-[11px] font-medium flex items-center gap-1"
              title="Re-read all Gemini 4 model names & thinking levels from .env"
            >
              <RefreshCw className="w-3 h-3 text-emerald-400" /> Sync from .env
            </button>
            <button
              type="button"
              onClick={() => setSettingsOpen(false)}
              className="p-1 rounded-lg text-zinc-400 hover:text-white hover:bg-zinc-800"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-5 space-y-5">
          {/* API Key + Runtime Controls */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <label className="text-xs font-semibold text-zinc-200">Gemini API Key</label>
                {getEnvApiKey() && settings.apiKey === getEnvApiKey() && (
                  <span className="px-2 py-0.5 rounded-full bg-emerald-500/15 border border-emerald-500/40 text-emerald-300 text-[10px] font-mono">
                    Loaded from .env
                  </span>
                )}
              </div>
              <input
                type="password"
                value={settings.apiKey}
                onChange={(e) => {
                  const val = e.target.value;
                  updateSettings({
                    apiKey: val,
                    useMockFallback: val.trim() ? false : settings.useMockFallback,
                  });
                }}
                placeholder="Set GEMINI_API_KEY in .env or paste AIza..."
                className="w-full bg-zinc-900 border border-zinc-700 rounded-xl px-3 py-2 text-xs font-mono text-zinc-100 focus:outline-none focus:border-violet-400"
              />
              <p className="text-[10px] text-zinc-500 flex items-center gap-1">
                <ShieldCheck className="w-3 h-3 text-emerald-400 shrink-0" />
                Sourced from gitignored <code className="text-zinc-300">.env</code>
              </p>
            </div>

            <div className="space-y-2">
              <label className="flex items-center justify-between p-2.5 rounded-xl bg-zinc-900 border border-zinc-800 cursor-pointer">
                <div>
                  <div className="text-xs font-semibold text-zinc-100">Demo / Mock Fallback</div>
                  <div className="text-[10px] text-zinc-400">
                    Use instant local simulator when offline or without key
                  </div>
                </div>
                <input
                  type="checkbox"
                  checked={settings.useMockFallback}
                  onChange={(e) => updateSettings({ useMockFallback: e.target.checked })}
                  className="accent-violet-500 w-4 h-4"
                />
              </label>

              <label className="flex items-center justify-between p-2.5 rounded-xl bg-zinc-900 border border-zinc-800 cursor-pointer">
                <div>
                  <div className="text-xs font-semibold text-zinc-200">
                    Include Thoughts (<code className="text-zinc-400">GEMINI_INCLUDE_THOUGHTS</code>)
                  </div>
                  <div className="text-[10px] text-zinc-500">
                    Request Gemini 4 thought summaries alongside JSON responses
                  </div>
                </div>
                <input
                  type="checkbox"
                  checked={settings.includeThoughts}
                  onChange={(e) => updateSettings({ includeThoughts: e.target.checked })}
                  className="accent-violet-500 w-4 h-4"
                />
              </label>
            </div>
          </div>

          {/* Per-Task Gemini 4 Model & Explicit Reasoning Matrix */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <div className="text-xs font-semibold text-zinc-100 flex items-center gap-1.5">
                <Cpu className="w-3.5 h-3.5 text-violet-400" />
                Gemini 4 Per-Call Models &amp; Explicit Thinking Levels (Sourced from .env)
              </div>
              <span className="text-[10px] font-mono text-zinc-500">
                11 routes · carbon · neon · hydrogen · transcribe
              </span>
            </div>

            <div className="rounded-xl border border-zinc-800 overflow-hidden bg-zinc-950/60">
              <div className="grid grid-cols-12 gap-2 px-3 py-2 bg-zinc-900/90 border-b border-zinc-800 text-[10px] font-semibold uppercase tracking-wider text-zinc-400">
                <div className="col-span-5">LLM Call / .env Prefix</div>
                <div className="col-span-4">Gemini 4 Model ID</div>
                <div className="col-span-3">Thinking Level</div>
              </div>

              <div className="divide-y divide-zinc-800/80">
                {LLM_TASK_ORDER.map((taskKey) => {
                  const cfg = settings.llmTasks[taskKey];
                  const supportsXHigh = /hydrogen|neon/i.test(cfg.model);
                  const stakeColor =
                    cfg.stakes === 'high'
                      ? 'bg-violet-500/20 text-violet-300 border-violet-500/40'
                      : cfg.stakes === 'medium'
                      ? 'bg-sky-500/15 text-sky-300 border-sky-500/35'
                      : 'bg-zinc-800 text-zinc-400 border-zinc-700';

                  return (
                    <div
                      key={taskKey}
                      className="grid grid-cols-12 gap-2 px-3 py-2 items-center text-xs hover:bg-zinc-900/40"
                    >
                      <div className="col-span-5 min-w-0">
                        <div className="flex items-center gap-1.5">
                          <span className="font-medium text-zinc-100 truncate text-[11px]">
                            {cfg.label}
                          </span>
                          <span
                            className={`px-1 py-0.2 rounded border text-[9px] uppercase font-semibold shrink-0 ${stakeColor}`}
                          >
                            {cfg.stakes}
                          </span>
                        </div>
                        <div className="text-[9px] font-mono text-zinc-500 truncate">
                          {cfg.envPrefix}_MODEL / _THINKING_LEVEL
                        </div>
                      </div>

                      <div className="col-span-4">
                        <input
                          value={cfg.model}
                          onChange={(e) =>
                            updateLlmTaskConfig(taskKey, { model: e.target.value })
                          }
                          className="w-full bg-zinc-900 border border-zinc-700 rounded-md px-2 py-1 text-[11px] font-mono text-zinc-100 focus:outline-none focus:border-violet-400"
                        />
                      </div>

                      <div className="col-span-3">
                        <select
                          value={cfg.thinkingLevel}
                          onChange={(e) =>
                            updateLlmTaskConfig(taskKey, {
                              thinkingLevel: e.target.value as ThinkingLevelSetting,
                            })
                          }
                          className="w-full bg-zinc-900 border border-zinc-700 rounded-md px-2 py-1 text-[10px] font-mono text-zinc-100"
                        >
                          {LEVELS.filter((lv) => lv !== 'XHIGH' || supportsXHigh).map((lv) => (
                            <option key={lv} value={lv}>
                              {lv}
                            </option>
                          ))}
                        </select>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
            <p className="text-[10px] text-zinc-500">
              <code>LOW</code> / <code>MEDIUM</code> / <code>HIGH</code> supported on all Gemini 4
              models; <code>XHIGH</code> available on <code>gemini-4-neon</code> and{' '}
              <code>gemini-4-hydrogen</code>.
            </p>
          </div>

          {/* Session Token Cap */}
          <div className="flex items-center justify-between gap-3 pt-2 border-t border-zinc-800">
            <div>
              <div className="text-xs font-semibold text-zinc-200">Session Token Spend Cap</div>
              <div className="text-[11px] text-zinc-500">
                Tracks actual Gemini 4 usageMetadata (prompt + output + thoughts tokens)
              </div>
            </div>
            <input
              type="number"
              step={25000}
              min={25000}
              value={project.budgetConfig.totalTokenBudget}
              onChange={(e) => updateTotalBudget(Number(e.target.value))}
              className="w-32 bg-zinc-900 border border-zinc-700 rounded-lg px-2.5 py-1.5 text-xs font-mono text-zinc-100 text-right"
            />
          </div>
        </div>

        <div className="px-5 py-3 border-t border-zinc-800 bg-[#141418] flex items-center justify-between shrink-0">
          <button
            type="button"
            onClick={() => {
              resetProject();
              setSettingsOpen(false);
            }}
            className="px-3 py-1.5 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-zinc-300 text-xs flex items-center gap-1.5"
          >
            <RotateCcw className="w-3.5 h-3.5" /> Reset Starter Preset
          </button>
          <button
            type="button"
            onClick={() => setSettingsOpen(false)}
            className="px-4 py-1.5 rounded-lg bg-violet-600 hover:bg-violet-500 text-white text-xs font-semibold"
          >
            Done
          </button>
        </div>
      </div>
    </div>
  );
};
