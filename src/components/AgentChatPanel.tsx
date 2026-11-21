import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowUp, Loader2, Mic, MicOff, Square, Trash2 } from 'lucide-react';
import { useStudioStore } from '../store/useStudioStore';
import { resolveExecutionPolicy } from '../ai/budgetPolicy';
import {
  buildReferenceCatalog,
  detectCaretMention,
  filterReferenceCatalog,
  type CatalogReferenceItem,
} from '../domain/references';
import { useVoiceInput } from '../hooks/useVoiceInput';
import { ChatMessageCard } from './chat/ChatMessageCard';
import { DisambiguationCard } from './chat/DisambiguationCard';
import { MentionMenu } from './chat/MentionMenu';
import { ContextPreviewBar } from './chat/ContextPreviewBar';

export const AgentChatPanel: React.FC = () => {
  const project = useStudioStore((s) => s.project);
  const settings = useStudioStore((s) => s.settings);
  const chatDraft = useStudioStore((s) => s.chatDraft);
  const detachedContextKeys = useStudioStore((s) => s.detachedContextKeys);
  const chatMessages = useStudioStore((s) => s.chatMessages);
  const isBusy = useStudioStore((s) => s.isBusy);
  const busyLabel = useStudioStore((s) => s.busyLabel);

  const setChatDraft = useStudioStore((s) => s.setChatDraft);
  const appendToChatDraft = useStudioStore((s) => s.appendToChatDraft);
  const detachContextItem = useStudioStore((s) => s.detachContextItem);
  const clearAllChatContext = useStudioStore((s) => s.clearAllChatContext);
  const clearChatMessages = useStudioStore((s) => s.clearChatMessages);
  const cancelActiveAiJob = useStudioStore((s) => s.cancelActiveAiJob);
  const submitPrompt = useStudioStore((s) => s.submitPrompt);
  const updateDisambiguationControl = useStudioStore((s) => s.updateDisambiguationControl);
  const confirmDisambiguation = useStudioStore((s) => s.confirmDisambiguation);
  const dismissDisambiguation = useStudioStore((s) => s.dismissDisambiguation);
  const selectScreen = useStudioStore((s) => s.selectScreen);
  const setActiveVariant = useStudioStore((s) => s.setActiveVariant);
  const setFinalizedVariant = useStudioStore((s) => s.setFinalizedVariant);
  const setCompareScreenId = useStudioStore((s) => s.setCompareScreenId);

  const [mentionRange, setMentionRange] = useState<{
    start: number;
    end: number;
    query: string;
  } | null>(null);
  const [activeMentionIdx, setActiveMentionIdx] = useState(0);

  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const bottomRef = useRef<HTMLDivElement | null>(null);

  const { isListening, isTranscribing, isSupported, toggleListening } = useVoiceInput({
    getCurrentText: () => useStudioStore.getState().chatDraft,
    onTextUpdate: (nextText) => setChatDraft(nextText),
  });

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [chatMessages.length, isBusy, project.pendingDisambiguation]);

  const catalog = useMemo(() => buildReferenceCatalog(project), [project]);

  const filteredMentions = useMemo(() => {
    if (!mentionRange) return [];
    return filterReferenceCatalog(catalog, mentionRange.query);
  }, [mentionRange, catalog]);

  const selectedScreen = project.selectedScreenId
    ? project.screens[project.selectedScreenId]
    : null;
  const policyPreview = resolveExecutionPolicy(project, settings, selectedScreen);

  const syncCaret = (value: string, caretPos: number) => {
    const detected = detectCaretMention(value, caretPos);
    setMentionRange(detected);
    if (detected) setActiveMentionIdx(0);
  };

  const getUnmuteKeysForItem = (item: CatalogReferenceItem): string[] => {
    const keys: string[] = [];
    if (item.annotationId) keys.push(`ann:${item.annotationId}`);
    if (item.screenId) keys.push(`screen:${item.screenId}`);
    return keys;
  };

  const handleSelectCatalogItem = (item: CatalogReferenceItem) => {
    const unmuteKeys = getUnmuteKeysForItem(item);
    if (!mentionRange) {
      appendToChatDraft(item.token, unmuteKeys);
      requestAnimationFrame(() => textareaRef.current?.focus());
      return;
    }

    // Replace @query at caret AND clear any prior detachment for this item
    const next =
      chatDraft.slice(0, mentionRange.start) + `${item.token} ` + chatDraft.slice(mentionRange.end);
    if (unmuteKeys.length > 0) {
      appendToChatDraft('', unmuteKeys);
    }
    setChatDraft(next);
    setMentionRange(null);
    const nextCaret = mentionRange.start + item.token.length + 1;
    requestAnimationFrame(() => {
      if (textareaRef.current) {
        textareaRef.current.focus();
        textareaRef.current.setSelectionRange(nextCaret, nextCaret);
      }
    });
  };

  const handleSend = async (e?: React.FormEvent) => {
    e?.preventDefault();
    if (!chatDraft.trim() || isBusy) return;
    const text = chatDraft.trim();
    setChatDraft('');
    setMentionRange(null);
    await submitPrompt(text);
  };

  return (
    <div className="flex-1 min-h-0 min-w-0 flex flex-col overflow-hidden bg-[#16161b]">
      {/* Subheader */}
      <div className="px-3 py-1.5 border-b border-[#26262f] flex items-center justify-between text-[10px] text-zinc-400 shrink-0">
        <span className="truncate">
          Add with <code className="text-blue-300">@Pin</code> / <code className="text-blue-300">+</code>{' '}
          · Remove with <code className="text-rose-300">×</code> on any chip
        </span>
        <button
          type="button"
          onClick={clearChatMessages}
          title="Clear conversation thread"
          className="p-1 rounded hover:bg-zinc-800 text-zinc-500 hover:text-zinc-200 shrink-0"
        >
          <Trash2 className="w-3 h-3" />
        </button>
      </div>

      {/* Scrollable Persistent Message Thread */}
      <div className="flex-1 min-h-0 overflow-y-auto p-3 space-y-3">
        {chatMessages.map((msg) => (
          <ChatMessageCard
            key={msg.id}
            message={msg}
            isBusy={isBusy}
            onRetry={(p) => submitPrompt(p, true)}
            onFocusVariant={(sid, vid) => {
              selectScreen(sid);
              setActiveVariant(sid, vid);
            }}
            onCompare={(sid) => setCompareScreenId(sid)}
            onFinalize={(sid, vid) => setFinalizedVariant(sid, vid)}
          />
        ))}

        {project.pendingDisambiguation && (
          <DisambiguationCard
            request={project.pendingDisambiguation}
            onUpdateControl={updateDisambiguationControl}
            onConfirm={confirmDisambiguation}
            onDismiss={dismissDisambiguation}
          />
        )}

        {isBusy && (
          <div className="rounded-xl bg-violet-950/40 border border-violet-500/40 p-2.5 flex items-center justify-between gap-2 text-xs text-violet-200">
            <div className="flex items-center gap-2 min-w-0">
              <Loader2 className="w-3.5 h-3.5 animate-spin text-violet-400 shrink-0" />
              <span className="text-[11px] leading-snug truncate">
                {busyLabel || 'Running Gemini 4...'}
              </span>
            </div>
            <button
              type="button"
              onClick={cancelActiveAiJob}
              className="px-2 py-0.5 rounded bg-zinc-900 hover:bg-zinc-800 border border-zinc-700 text-[10px] text-zinc-300 flex items-center gap-1 shrink-0"
            >
              <Square className="w-2.5 h-2.5 fill-current" /> Stop
            </button>
          </div>
        )}

        <div ref={bottomRef} />
      </div>

      {/* Bottom Composer + Interactive Add/Remove Context Bar + Versioned @Autocomplete */}
      <div className="relative p-2.5 border-t border-[#2b2b33] bg-[#141418] space-y-2 shrink-0 min-w-0">
        {mentionRange !== null && (
          <MentionMenu
            items={filteredMentions}
            activeIndex={activeMentionIdx}
            onSelectItem={handleSelectCatalogItem}
          />
        )}

        <ContextPreviewBar
          draft={chatDraft}
          project={project}
          detachedKeys={detachedContextKeys}
          onAttachItem={handleSelectCatalogItem}
          onDetachItem={detachContextItem}
          onClearAll={clearAllChatContext}
        />

        <form
          onSubmit={handleSend}
          className="rounded-xl bg-[#1b1b22] border border-zinc-700 focus-within:border-violet-400 p-2 space-y-1.5 transition min-w-0"
        >
          <textarea
            ref={textareaRef}
            rows={2}
            value={chatDraft}
            disabled={isBusy}
            onChange={(e) => {
              setChatDraft(e.target.value);
              syncCaret(e.target.value, e.target.selectionStart ?? e.target.value.length);
            }}
            onClick={(e) => {
              const t = e.currentTarget;
              syncCaret(t.value, t.selectionStart ?? t.value.length);
            }}
            onKeyUp={(e) => {
              if (['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(e.key)) {
                const t = e.currentTarget;
                syncCaret(t.value, t.selectionStart ?? t.value.length);
              }
            }}
            onKeyDown={(e) => {
              if (mentionRange !== null && filteredMentions.length > 0) {
                if (e.key === 'ArrowDown') {
                  e.preventDefault();
                  setActiveMentionIdx((i) => (i + 1) % filteredMentions.length);
                  return;
                }
                if (e.key === 'ArrowUp') {
                  e.preventDefault();
                  setActiveMentionIdx(
                    (i) => (i - 1 + filteredMentions.length) % filteredMentions.length
                  );
                  return;
                }
                if (e.key === 'Enter' || e.key === 'Tab') {
                  e.preventDefault();
                  handleSelectCatalogItem(filteredMentions[activeMentionIdx]);
                  return;
                }
                if (e.key === 'Escape') {
                  e.preventDefault();
                  setMentionRange(null);
                  return;
                }
              }
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                handleSend();
              }
            }}
            placeholder="Type @Pin to attach @Pin-2:v1, or describe changes..."
            className="w-full bg-transparent text-xs text-zinc-100 placeholder:text-zinc-500 focus:outline-none resize-none leading-relaxed"
          />

          <div className="flex items-center justify-between gap-2 min-w-0">
            <span
              title={policyPreview.allocationReason}
              className="text-[10px] font-mono text-zinc-400 truncate min-w-0"
            >
              {policyPreview.model} · {policyPreview.thinkingLevel}
            </span>

            <div className="flex items-center gap-1.5 shrink-0">
              {isSupported && (
                <button
                  type="button"
                  onClick={toggleListening}
                  title={
                    isListening
                      ? 'Click to stop recording & finalize streaming transcript'
                      : isTranscribing
                      ? 'Streaming transcript from Gemini...'
                      : `Speak prompt (${settings.llmTasks.VOICE_TRANSCRIBE.model})`
                  }
                  className={`px-2 py-1.5 rounded-lg border text-[10px] font-medium flex items-center gap-1 transition ${
                    isListening
                      ? 'bg-rose-600 border-rose-400 text-white animate-pulse'
                      : isTranscribing
                      ? 'bg-violet-600/30 border-violet-400/60 text-violet-200'
                      : 'bg-zinc-900 border-zinc-800 text-zinc-400 hover:text-zinc-100'
                  }`}
                >
                  {isTranscribing ? (
                    <>
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      <span>Streaming…</span>
                    </>
                  ) : isListening ? (
                    <>
                      <MicOff className="w-3.5 h-3.5" />
                      <span>Listening</span>
                    </>
                  ) : (
                    <Mic className="w-3.5 h-3.5" />
                  )}
                </button>
              )}
              <button
                type="submit"
                disabled={!chatDraft.trim() || isBusy}
                className="px-2.5 py-1.5 rounded-lg bg-violet-600 hover:bg-violet-500 disabled:opacity-40 text-white text-[11px] font-semibold flex items-center gap-1 transition"
              >
                {isBusy ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                ) : (
                  <>
                    <ArrowUp className="w-3.5 h-3.5" /> Send
                  </>
                )}
              </button>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
};
