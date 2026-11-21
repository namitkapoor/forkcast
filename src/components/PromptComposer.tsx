import React, { useMemo, useRef, useState } from 'react';
import {
  ArrowUp,
  Check,
  Loader2,
  Mic,
  MicOff,
  SlidersHorizontal,
  Sparkles,
  X,
} from 'lucide-react';
import { useStudioStore } from '../store/useStudioStore';
import { formatTokens, resolveExecutionPolicy } from '../ai/budgetPolicy';
import { useVoiceInput } from '../hooks/useVoiceInput';

export const PromptComposer: React.FC = () => {
  const project = useStudioStore((s) => s.project);
  const settings = useStudioStore((s) => s.settings);
  const isBusy = useStudioStore((s) => s.isBusy);
  const busyLabel = useStudioStore((s) => s.busyLabel);

  const submitPrompt = useStudioStore((s) => s.submitPrompt);
  const updateDisambiguationControl = useStudioStore((s) => s.updateDisambiguationControl);
  const confirmDisambiguation = useStudioStore((s) => s.confirmDisambiguation);
  const dismissDisambiguation = useStudioStore((s) => s.dismissDisambiguation);

  const [input, setInput] = useState('');
  const [showMentions, setShowMentions] = useState(false);
  const [mentionQuery, setMentionQuery] = useState('');
  const inputRef = useRef<HTMLInputElement | null>(null);

  const { isListening, isSupported, toggleListening } = useVoiceInput((text) => {
    setInput((prev) => (prev ? `${prev} ${text}` : text));
  });

  const mentionItems = useMemo(() => {
    const items: Array<{ tag: string; label: string; kind: 'screen' | 'pin' | 'mask' }> = [];
    for (const sc of Object.values(project.screens)) {
      items.push({ tag: `@${sc.slug}`, label: sc.title, kind: 'screen' });
      for (const ann of sc.annotations) {
        if (ann.status === 'open') {
          items.push({
            tag: `@${ann.mentionTag}`,
            label: `${sc.slug}: ${ann.comment.slice(0, 34)}${
              ann.includeInAiFeedback ? '' : ' (AI off)'
            }`,
            kind: ann.kind === 'paint-region' ? 'mask' : 'pin',
          });
        }
      }
    }
    if (!mentionQuery) return items.slice(0, 8);
    const q = mentionQuery.toLowerCase();
    return items
      .filter((i) => i.tag.toLowerCase().includes(q) || i.label.toLowerCase().includes(q))
      .slice(0, 8);
  }, [project.screens, mentionQuery]);

  const selectedScreen = project.selectedScreenId
    ? project.screens[project.selectedScreenId]
    : null;
  const policyPreview = resolveExecutionPolicy(project, settings, selectedScreen);

  const handleChange = (val: string) => {
    setInput(val);
    const match = val.match(/@([A-Za-z0-9_-]*)$/);
    if (match) {
      setShowMentions(true);
      setMentionQuery(match[1]);
    } else {
      setShowMentions(false);
    }
  };

  const insertMention = (tag: string) => {
    const next = input.replace(/@([A-Za-z0-9_-]*)$/, `${tag} `);
    setInput(next);
    setShowMentions(false);
    inputRef.current?.focus();
  };

  const handleSubmit = async (e?: React.FormEvent) => {
    e?.preventDefault();
    if (!input.trim() || isBusy) return;
    const text = input.trim();
    setInput('');
    setShowMentions(false);
    await submitPrompt(text);
  };

  const disambig = project.pendingDisambiguation;

  return (
    <div className="pointer-events-none absolute inset-x-0 bottom-4 z-30 flex flex-col items-center px-4">
      <div className="pointer-events-auto w-full max-w-2xl space-y-2">
        {/* Inline Multimodal Disambiguation Micro-UI (Zero Wall-of-Text!) */}
        {disambig && (
          <div className="rounded-2xl bg-[#18181e]/98 border border-violet-500/50 p-4 shadow-2xl backdrop-blur-xl space-y-3.5">
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="flex items-center gap-2">
                  <span className="px-2 py-0.5 rounded-full bg-violet-500/20 text-violet-300 text-[10px] font-semibold flex items-center gap-1">
                    <SlidersHorizontal className="w-3 h-3" /> Disambiguate Before Generating
                  </span>
                  <span className="text-[10px] font-mono text-emerald-300">
                    Saves ~{formatTokens(disambig.estimatedTokenSavings)} tok
                  </span>
                </div>
                <p className="text-xs text-zinc-300 mt-1">{disambig.rationale}</p>
              </div>
              <button
                type="button"
                onClick={dismissDisambiguation}
                className="text-zinc-500 hover:text-zinc-200 p-1"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="space-y-3 max-h-72 overflow-y-auto pr-1">
              {disambig.controls.map((ctrl) => {
                if (ctrl.kind === 'choice-cards') {
                  return (
                    <div key={ctrl.id} className="space-y-1.5">
                      <div className="text-[11px] font-semibold text-zinc-300">{ctrl.label}</div>
                      <div className="grid grid-cols-3 gap-2">
                        {ctrl.options.map((opt) => {
                          const selected = ctrl.selectedIds.includes(opt.id);
                          return (
                            <button
                              key={opt.id}
                              type="button"
                              onClick={() =>
                                updateDisambiguationControl(ctrl.id, (c) => {
                                  if (c.kind !== 'choice-cards') return c;
                                  return { ...c, selectedIds: [opt.id] };
                                })
                              }
                              className={`text-left p-2.5 rounded-xl border transition space-y-1 ${
                                selected
                                  ? 'bg-violet-500/20 border-violet-400 text-zinc-100'
                                  : 'bg-zinc-900 border-zinc-800 text-zinc-400 hover:border-zinc-600'
                              }`}
                            >
                              <div className="flex items-center justify-between gap-1">
                                <span className="text-[11px] font-semibold">{opt.title}</span>
                                {selected && <Check className="w-3 h-3 text-violet-300" />}
                              </div>
                              <div className="text-[10px] text-zinc-400 leading-snug">
                                {opt.subtitle}
                              </div>
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  );
                }

                if (ctrl.kind === 'visual-preview') {
                  return (
                    <div key={ctrl.id} className="space-y-1.5">
                      <div className="text-[11px] font-semibold text-zinc-300">{ctrl.label}</div>
                      <div className="grid grid-cols-3 gap-2">
                        {ctrl.options.map((opt) => {
                          const selected = ctrl.selectedId === opt.id;
                          return (
                            <button
                              key={opt.id}
                              type="button"
                              onClick={() =>
                                updateDisambiguationControl(ctrl.id, (c) =>
                                  c.kind === 'visual-preview' ? { ...c, selectedId: opt.id } : c
                                )
                              }
                              className={`text-left p-2.5 rounded-xl border transition space-y-1.5 ${
                                selected
                                  ? 'bg-emerald-500/15 border-emerald-400 text-zinc-100'
                                  : 'bg-zinc-900 border-zinc-800 text-zinc-400 hover:border-zinc-600'
                              }`}
                            >
                              <div className="flex items-center gap-1">
                                {opt.palette.map((hex, i) => (
                                  <span
                                    key={i}
                                    style={{ backgroundColor: hex }}
                                    className="w-4 h-4 rounded-full border border-white/20"
                                  />
                                ))}
                              </div>
                              <div className="text-[11px] font-semibold">{opt.title}</div>
                              <div className="text-[10px] text-zinc-400">{opt.layoutHint}</div>
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  );
                }

                if (ctrl.kind === 'slider') {
                  return (
                    <div key={ctrl.id} className="space-y-1">
                      <div className="flex items-center justify-between text-[11px]">
                        <span className="font-semibold text-zinc-300">{ctrl.label}</span>
                        <span className="font-mono text-violet-300">
                          {ctrl.value}
                          {ctrl.unit}
                        </span>
                      </div>
                      <div className="flex items-center gap-2 text-[10px] text-zinc-500">
                        <span>{ctrl.minLabel}</span>
                        <input
                          type="range"
                          min={ctrl.min}
                          max={ctrl.max}
                          step={ctrl.step}
                          value={ctrl.value}
                          onChange={(e) =>
                            updateDisambiguationControl(ctrl.id, (c) =>
                              c.kind === 'slider' ? { ...c, value: Number(e.target.value) } : c
                            )
                          }
                          className="flex-1 accent-violet-500"
                        />
                        <span>{ctrl.maxLabel}</span>
                      </div>
                    </div>
                  );
                }

                if (ctrl.kind === 'chips') {
                  return (
                    <div key={ctrl.id} className="space-y-1.5">
                      <div className="text-[11px] font-semibold text-zinc-300">{ctrl.label}</div>
                      <div className="flex items-center gap-1.5 flex-wrap">
                        {ctrl.options.map((opt) => {
                          const active = ctrl.selected.includes(opt);
                          return (
                            <button
                              key={opt}
                              type="button"
                              onClick={() =>
                                updateDisambiguationControl(ctrl.id, (c) => {
                                  if (c.kind !== 'chips') return c;
                                  const next = active
                                    ? c.selected.filter((x) => x !== opt)
                                    : [...c.selected, opt];
                                  return { ...c, selected: next };
                                })
                              }
                              className={`px-2.5 py-1 rounded-full text-[11px] border transition ${
                                active
                                  ? 'bg-violet-500/20 border-violet-400 text-violet-200 font-medium'
                                  : 'bg-zinc-900 border-zinc-800 text-zinc-400 hover:text-zinc-200'
                              }`}
                            >
                              {opt}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  );
                }
                return null;
              })}
            </div>

            <div className="flex items-center justify-between pt-2 border-t border-zinc-800">
              <button
                type="button"
                onClick={dismissDisambiguation}
                className="text-xs text-zinc-400 hover:text-zinc-200"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={confirmDisambiguation}
                className="px-4 py-1.5 rounded-xl bg-gradient-to-r from-violet-600 to-emerald-600 hover:from-violet-500 hover:to-emerald-500 text-white text-xs font-semibold flex items-center gap-1.5 shadow-lg"
              >
                <Sparkles className="w-3.5 h-3.5" /> Generate Progressive Flow
              </button>
            </div>
          </div>
        )}

        {/* @Mention Autocomplete Popup */}
        {showMentions && mentionItems.length > 0 && (
          <div className="rounded-xl bg-[#18181e]/98 border border-zinc-700 p-1.5 shadow-2xl max-h-48 overflow-y-auto backdrop-blur">
            <div className="px-2 py-1 text-[10px] uppercase tracking-wider text-zinc-500 font-semibold">
              Reference Screen, Pin, or Painted Mask
            </div>
            {mentionItems.map((item) => (
              <button
                key={item.tag}
                type="button"
                onClick={() => insertMention(item.tag)}
                className="w-full text-left px-2.5 py-1.5 rounded-lg hover:bg-zinc-800 flex items-center justify-between gap-2 text-xs"
              >
                <span
                  className={`font-mono font-semibold ${
                    item.kind === 'mask'
                      ? 'text-pink-300'
                      : item.kind === 'pin'
                      ? 'text-blue-300'
                      : 'text-emerald-300'
                  }`}
                >
                  {item.tag}
                </span>
                <span className="text-zinc-400 truncate text-[11px]">{item.label}</span>
              </button>
            ))}
          </div>
        )}

        {/* Quick Demo Action Chips */}
        {!disambig && !isBusy && (
          <div className="flex items-center justify-center gap-1.5 flex-wrap">
            <button
              type="button"
              onClick={() => setInput('Design a B2B fintech team onboarding and card issue flow')}
              className="px-2.5 py-1 rounded-full bg-[#1b1b21]/90 hover:bg-zinc-800 border border-zinc-800 text-[10px] text-zinc-400 hover:text-zinc-200 transition"
            >
              ✦ Try Act 1: Disambiguate a new flow
            </button>
            <button
              type="button"
              onClick={() =>
                setInput('Refine @Checkout using @Pin-1 to make the Subscribe CTA emerald with 1-click cancel reassurance')
              }
              className="px-2.5 py-1 rounded-full bg-[#1b1b21]/90 hover:bg-zinc-800 border border-zinc-800 text-[10px] text-zinc-400 hover:text-zinc-200 transition"
            >
              ✦ Try Act 2: Refine @Checkout with @Pin-1
            </button>
          </div>
        )}

        {/* Floating Prompt Bar */}
        <form
          onSubmit={handleSubmit}
          className="rounded-2xl bg-[#1b1b21]/96 border border-zinc-700/90 shadow-[0_12px_40px_rgba(0,0,0,0.65)] backdrop-blur-xl px-3 py-2 flex items-center gap-2 focus-within:border-violet-400/70 transition"
        >
          <Sparkles className="w-4 h-4 text-violet-400 shrink-0" />
          <input
            ref={inputRef}
            value={input}
            onChange={(e) => handleChange(e.target.value)}
            disabled={isBusy}
            placeholder={
              isBusy
                ? busyLabel ?? 'Working...'
                : 'Describe a user flow or type @Checkout @Pin-1 to steer the AI...'
            }
            className="flex-1 bg-transparent text-xs text-zinc-100 placeholder:text-zinc-500 focus:outline-none"
          />

          <span
            title={policyPreview.allocationReason}
            className="hidden sm:inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-zinc-900 border border-zinc-800 text-[10px] font-mono text-zinc-400 shrink-0"
          >
            {policyPreview.tier === 'core' ? '★ Pro' : policyPreview.tier === 'standard' ? 'Flash' : 'Lite'} · ~
            {formatTokens(policyPreview.estimatedTokens)}
          </span>

          {isSupported && (
            <button
              type="button"
              onClick={toggleListening}
              title="Voice Dictation"
              className={`p-1.5 rounded-xl border transition ${
                isListening
                  ? 'bg-pink-600 border-pink-400 text-white animate-pulse'
                  : 'bg-zinc-900 border-zinc-800 text-zinc-400 hover:text-zinc-100'
              }`}
            >
              {isListening ? <MicOff className="w-3.5 h-3.5" /> : <Mic className="w-3.5 h-3.5" />}
            </button>
          )}

          <button
            type="submit"
            disabled={!input.trim() || isBusy}
            className="p-1.5 rounded-xl bg-violet-600 hover:bg-violet-500 disabled:opacity-40 text-white transition shrink-0"
          >
            {isBusy ? <Loader2 className="w-4 h-4 animate-spin" /> : <ArrowUp className="w-4 h-4" />}
          </button>
        </form>
      </div>
    </div>
  );
};
