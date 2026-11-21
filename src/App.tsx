import React, { useEffect } from 'react';
import { TopToolbar } from './components/TopToolbar';
import { LeftSidebar } from './components/LeftSidebar';
import { RightInspector } from './components/RightInspector';
import { PromptComposer } from './components/PromptComposer';
import { StudioCanvas } from './canvas/StudioCanvas';
import { PlayModeModal } from './components/PlayModeModal';
import { CompareVariantsModal } from './components/CompareVariantsModal';
import { SettingsModal } from './components/SettingsModal';
import { useStudioStore } from './store/useStudioStore';

export const App: React.FC = () => {
  const toast = useStudioStore((s) => s.toast);
  const clearToast = useStudioStore((s) => s.clearToast);

  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => clearToast(), 4200);
    return () => clearTimeout(timer);
  }, [toast, clearToast]);

  return (
    <div className="w-screen h-screen flex flex-col bg-[#141416] text-zinc-100 overflow-hidden">
      <TopToolbar />

      <div className="flex-1 flex min-h-0 overflow-hidden">
        <LeftSidebar />

        <main className="flex-1 relative min-w-0 h-full overflow-hidden">
          <StudioCanvas />
          <PromptComposer />

          {toast && (
            <div
              onClick={clearToast}
              className={`absolute top-3 right-3 z-40 px-3.5 py-2 rounded-xl border text-xs font-medium shadow-2xl cursor-pointer backdrop-blur-md transition ${
                toast.tone === 'success'
                  ? 'bg-emerald-950/95 border-emerald-500/50 text-emerald-200'
                  : toast.tone === 'warning'
                  ? 'bg-amber-950/95 border-amber-500/50 text-amber-200'
                  : 'bg-zinc-900/95 border-zinc-700 text-zinc-200'
              }`}
            >
              {toast.text}
            </div>
          )}
        </main>

        <RightInspector />
      </div>

      <PlayModeModal />
      <CompareVariantsModal />
      <SettingsModal />
    </div>
  );
};

export default App;
