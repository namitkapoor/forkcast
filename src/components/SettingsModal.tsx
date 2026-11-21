import React from 'react';
import { KeyRound, RotateCcw, ShieldCheck, X } from 'lucide-react';
import { useStudioStore } from '../store/useStudioStore';

export const SettingsModal: React.FC = () => {
  const isOpen = useStudioStore((s) => s.isSettingsOpen);
  const settings = useStudioStore((s) => s.settings);
  const project = useStudioStore((s) => s.project);

  const setSettingsOpen = useStudioStore((s) => s.setSettingsOpen);
  const updateSettings = useStudioStore((s) => s.updateSettings);
  const updateTotalBudget = useStudioStore((s) => s.updateTotalBudget);
  const resetProject = useStudioStore((s) => s.resetProject);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 bg-black/75 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="bg-[#18181d] border border-zinc-700 rounded-2xl shadow-2xl max-w-lg w-full overflow-hidden">
        <div className="px-5 py-3.5 border-b border-zinc-800 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <KeyRound className="w-4 h-4 text-violet-400" />
            <h3 className="text-sm font-bold text-zinc-100">Studio AI &amp; Budget Settings</h3>
          </div>
          <button
            type="button"
            onClick={() => setSettingsOpen(false)}
            className="p-1 rounded-lg text-zinc-400 hover:text-white hover:bg-zinc-800"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-5 space-y-4">
          {/* Gemini API Key */}
          <div className="space-y-1.5">
            <label className="text-xs font-semibold text-zinc-200">
              Gemini API Key (Client-Side)
            </label>
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
              placeholder="AIza..."
              className="w-full bg-zinc-900 border border-zinc-700 rounded-xl px-3 py-2 text-xs font-mono text-zinc-100 focus:outline-none focus:border-violet-400"
            />
            <p className="text-[11px] text-zinc-500 flex items-center gap-1">
              <ShieldCheck className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
              Stored locally in your browser via localStorage. Never sent to any third-party proxy.
            </p>
          </div>

          {/* Demo / Mock Fallback Toggle */}
          <label className="flex items-center justify-between p-3 rounded-xl bg-zinc-900 border border-zinc-800 cursor-pointer">
            <div>
              <div className="text-xs font-semibold text-zinc-100">Demo / Mock Fallback Mode</div>
              <div className="text-[11px] text-zinc-400">
                Simulate instant Gemini responses when offline, rate-limited, or without an API key
              </div>
            </div>
            <input
              type="checkbox"
              checked={settings.useMockFallback}
              onChange={(e) => updateSettings({ useMockFallback: e.target.checked })}
              className="accent-violet-500 w-4 h-4"
            />
          </label>

          {/* Configurable Model IDs per UX Priority Tier */}
          <div className="space-y-2">
            <div className="text-xs font-semibold text-zinc-200">
              Gemini Model Routing by UX Priority Tier
            </div>
            <div className="grid grid-cols-1 gap-2">
              {(
                [
                  ['core', '★ Core UX Focus (Explore / Pro + Thinking)'],
                  ['standard', 'Standard Flows (Balanced Flash)'],
                  ['supporting', 'Supporting / Exploit-Locked (Fast Flash-Lite)'],
                ] as const
              ).map(([tier, label]) => (
                <div key={tier} className="flex items-center justify-between gap-3">
                  <span className="text-[11px] text-zinc-400">{label}</span>
                  <input
                    value={settings.models[tier]}
                    onChange={(e) =>
                      updateSettings({
                        models: { ...settings.models, [tier]: e.target.value },
                      })
                    }
                    className="w-48 bg-zinc-900 border border-zinc-700 rounded-lg px-2.5 py-1 text-[11px] font-mono text-zinc-100"
                  />
                </div>
              ))}
            </div>
          </div>

          {/* Session Token Cap */}
          <div className="flex items-center justify-between gap-3 pt-2 border-t border-zinc-800">
            <div>
              <div className="text-xs font-semibold text-zinc-200">Session Token Spend Cap</div>
              <div className="text-[11px] text-zinc-500">
                Tracks actual Gemini usageMetadata tokens
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

        <div className="px-5 py-3 border-t border-zinc-800 bg-[#141418] flex items-center justify-between">
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
