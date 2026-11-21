import React, { useEffect, useRef, useState } from 'react';
import { Loader2, MessageSquarePlus, Mic, MicOff, Pin, Send, X } from 'lucide-react';
import type { AnnotationCategory } from '../types/studio';
import { useStudioStore } from '../store/useStudioStore';
import { formatVersionedRef } from '../domain/annotations';
import { useVoiceInput } from '../hooks/useVoiceInput';

export const PendingPinModal: React.FC = () => {
  const draft = useStudioStore((s) => s.pendingPinDraft);
  const project = useStudioStore((s) => s.project);
  const setPendingPinDraft = useStudioStore((s) => s.setPendingPinDraft);
  const addAnnotation = useStudioStore((s) => s.addAnnotation);
  const appendToChatDraft = useStudioStore((s) => s.appendToChatDraft);
  const sendIncludedFeedbackToAI = useStudioStore((s) => s.sendIncludedFeedbackToAI);
  const setActiveTool = useStudioStore((s) => s.setActiveTool);

  const [comment, setComment] = useState('');
  const commentRef = useRef(comment);
  commentRef.current = comment;
  const [category, setCategory] = useState<AnnotationCategory>('usability');
  const [includeInAi, setIncludeInAi] = useState(true);

  const { isListening, isTranscribing, isSupported, toggleListening } = useVoiceInput({
    getCurrentText: () => commentRef.current,
    onTextUpdate: (nextText) => setComment(nextText),
  });

  useEffect(() => {
    if (draft) {
      setComment('');
      setCategory('usability');
      setIncludeInAi(true);
    }
  }, [draft]);

  if (!draft) return null;
  const screen = project.screens[draft.screenId];
  if (!screen) return null;

  const commitPin = async (mode: 'save' | 'mention' | 'apply') => {
    if (!comment.trim()) return;
    const saved = addAnnotation(draft.screenId, {
      screenId: draft.screenId,
      variantId: draft.variantId,
      author: 'designer',
      kind: 'point-element',
      includeInAiFeedback: mode === 'apply' ? true : includeInAi,
      xPercent: draft.xPercent,
      yPercent: draft.yPercent,
      elementTarget: {
        selector: draft.selector,
        tagName: draft.tagName,
        textSnippet: draft.textSnippet,
        boundingBox: draft.boundingBox,
      },
      category,
      severity: 'warning',
      comment: comment.trim(),
    });
    const text = comment.trim();
    setPendingPinDraft(null);
    setActiveTool('select');

    if (!saved) return;
    const versionedToken = formatVersionedRef(saved, 1);

    if (mode === 'mention') {
      appendToChatDraft(versionedToken);
    } else if (mode === 'apply') {
      await sendIncludedFeedbackToAI(
        draft.screenId,
        `Iterate on @${screen.slug} implementing ${versionedToken}: ${text}`
      );
    }
  };

  return (
    <div className="pointer-events-none absolute inset-x-0 bottom-4 z-40 flex justify-center px-4">
      <div className="pointer-events-auto w-full max-w-md rounded-2xl bg-[#18181f]/98 border border-blue-500/60 p-3.5 shadow-[0_16px_48px_rgba(0,0,0,0.75)] backdrop-blur-xl space-y-2.5">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0 space-y-1">
            <div className="flex items-center gap-1.5 text-xs font-semibold text-blue-300">
              <Pin className="w-3.5 h-3.5 shrink-0" />
              <span className="truncate">New Versioned Pin on @{screen.slug}</span>
              <span className="text-[10px] font-mono text-zinc-400 shrink-0">
                ({draft.xPercent}%, {draft.yPercent}%)
              </span>
            </div>
            <div className="text-[11px] font-mono text-zinc-300 bg-blue-500/10 border border-blue-500/25 rounded-md px-2 py-0.5 truncate">
              &lt;{draft.tagName}&gt;{' '}
              {draft.textSnippet ? `"${draft.textSnippet}"` : draft.selector}
            </div>
          </div>
          <button
            type="button"
            onClick={() => setPendingPinDraft(null)}
            className="p-1 rounded-lg text-zinc-400 hover:text-white hover:bg-zinc-800 shrink-0"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="flex gap-2">
          <textarea
            autoFocus
            rows={2}
            value={comment}
            onChange={(e) => setComment(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                commitPin('mention');
              } else if (e.key === 'Escape') {
                setPendingPinDraft(null);
              }
            }}
            placeholder='Describe what to improve (Enter inserts @Pin-N:v1 into AI Chat)...'
            className="flex-1 min-w-0 bg-zinc-900 border border-zinc-700 rounded-xl px-3 py-2 text-xs text-zinc-100 placeholder:text-zinc-500 focus:outline-none focus:border-blue-400 resize-none"
          />
          {isSupported && (
            <button
              type="button"
              onClick={toggleListening}
              title={
                isListening
                  ? 'Stop recording & stream transcript'
                  : isTranscribing
                  ? 'Streaming transcript...'
                  : 'Dictate pin feedback via Gemini Voice AI'
              }
              className={`px-2.5 rounded-xl border transition self-stretch flex items-center justify-center shrink-0 ${
                isListening
                  ? 'bg-rose-600 border-rose-400 text-white animate-pulse'
                  : isTranscribing
                  ? 'bg-violet-600/30 border-violet-400/60 text-violet-200'
                  : 'bg-zinc-900 border-zinc-700 text-zinc-300 hover:text-white'
              }`}
            >
              {isTranscribing ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : isListening ? (
                <MicOff className="w-4 h-4" />
              ) : (
                <Mic className="w-4 h-4" />
              )}
            </button>
          )}
        </div>

        <div className="flex items-center justify-between gap-2 flex-wrap">
          <div className="flex items-center gap-2.5">
            <select
              value={category}
              onChange={(e) => setCategory(e.target.value as AnnotationCategory)}
              className="bg-zinc-900 border border-zinc-700 rounded-lg px-2 py-1 text-[11px] text-zinc-200"
            >
              <option value="usability">Usability</option>
              <option value="hierarchy">Hierarchy</option>
              <option value="copy">Copy</option>
              <option value="layout">Layout</option>
              <option value="accessibility">Accessibility</option>
              <option value="flow">Flow</option>
            </select>

            <label className="flex items-center gap-1.5 text-[11px] text-zinc-200 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={includeInAi}
                onChange={(e) => setIncludeInAi(e.target.checked)}
                className="accent-emerald-500 rounded"
              />
              AI On
            </label>
          </div>

          <div className="flex items-center gap-1.5">
            <button
              type="button"
              disabled={!comment.trim()}
              onClick={() => commitPin('save')}
              className="px-2 py-1.5 rounded-lg bg-zinc-800 hover:bg-zinc-700 disabled:opacity-40 text-zinc-200 text-[11px] font-medium"
            >
              Save
            </button>
            <button
              type="button"
              disabled={!comment.trim()}
              onClick={() => commitPin('mention')}
              className="px-2.5 py-1.5 rounded-lg bg-blue-600/25 hover:bg-blue-600/40 border border-blue-500/50 disabled:opacity-40 text-blue-200 text-[11px] font-semibold flex items-center gap-1"
            >
              <MessageSquarePlus className="w-3 h-3" /> @Chat
            </button>
            <button
              type="button"
              disabled={!comment.trim()}
              onClick={() => commitPin('apply')}
              className="px-2.5 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 disabled:opacity-40 text-white text-[11px] font-semibold flex items-center gap-1 shadow"
            >
              <Send className="w-3 h-3" /> Iterate
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
