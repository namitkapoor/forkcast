import React from 'react';
import {
  AlertTriangle,
  Columns2,
  Crown,
  Eye,
  RotateCcw,
  Sparkles,
} from 'lucide-react';
import type { ChatMessage } from '../../types/studio';
import { formatTokens } from '../../ai/budgetPolicy';

interface ChatMessageCardProps {
  message: ChatMessage;
  isBusy: boolean;
  onRetry: (prompt: string) => void;
  onFocusVariant: (screenId: string, variantId: string) => void;
  onCompare: (screenId: string) => void;
  onFinalize: (screenId: string, variantId: string) => void;
}

export const ChatMessageCard: React.FC<ChatMessageCardProps> = ({
  message,
  isBusy,
  onRetry,
  onFocusVariant,
  onCompare,
  onFinalize,
}) => {
  if (message.role === 'user') {
    return (
      <div className="flex flex-col items-end space-y-1 min-w-0">
        <div className="max-w-[92%] rounded-2xl rounded-tr-sm bg-violet-600/25 border border-violet-500/40 px-3 py-2 text-xs text-zinc-100 leading-relaxed whitespace-pre-wrap break-words">
          {message.text}
        </div>
        {message.attachedMentions && message.attachedMentions.length > 0 && (
          <div className="flex items-center gap-1 flex-wrap justify-end">
            {message.attachedMentions.map((tag) => (
              <span
                key={tag}
                className="px-1.5 py-0.5 rounded bg-zinc-900 border border-zinc-800 text-[9px] font-mono text-blue-200"
              >
                {tag}
              </span>
            ))}
            {(message.excludedAnnotationCount ?? 0) > 0 && (
              <span className="text-[9px] text-zinc-500">
                ({message.excludedAnnotationCount} AI-off skipped)
              </span>
            )}
          </div>
        )}
      </div>
    );
  }

  if (message.role === 'error') {
    return (
      <div className="rounded-xl bg-rose-950/50 border border-rose-500/40 p-3 space-y-2 text-xs min-w-0">
        <div className="flex items-center gap-1.5 text-rose-300 font-semibold">
          <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
          <span>Gemini 4 Request Error</span>
        </div>
        <p className="text-[11px] text-rose-200/90 leading-snug break-words">{message.text}</p>
        {message.retryPrompt && (
          <button
            type="button"
            disabled={isBusy}
            onClick={() => onRetry(message.retryPrompt!)}
            className="px-2.5 py-1 rounded-lg bg-rose-500/20 hover:bg-rose-500/30 border border-rose-400/40 text-rose-100 text-[10px] font-semibold inline-flex items-center gap-1"
          >
            <RotateCcw className="w-3 h-3" /> Retry Request
          </button>
        )}
      </div>
    );
  }

  return (
    <div className="rounded-2xl rounded-tl-sm bg-[#1c1c23] border border-zinc-800 p-3 space-y-2 text-xs min-w-0">
      {message.modelUsed && (
        <div className="flex items-center justify-between gap-2 text-[10px] min-w-0">
          <span className="font-mono text-zinc-300 flex items-center gap-1 min-w-0 truncate">
            <Sparkles className="w-3 h-3 text-violet-400 shrink-0" />
            <span className="truncate">{message.modelUsed}</span>
            {message.thinkingLevel && (
              <span className="px-1 rounded bg-zinc-800 text-violet-300 shrink-0">
                {message.thinkingLevel}
              </span>
            )}
          </span>
          <span
            className={`px-1.5 py-0.5 rounded text-[9px] font-semibold shrink-0 ${
              message.usedMock
                ? 'bg-amber-500/15 text-amber-300'
                : 'bg-emerald-500/15 text-emerald-300'
            }`}
          >
            {message.usedMock ? 'Demo' : 'Live API'}
          </span>
        </div>
      )}

      {message.createdVariantLabel && (
        <div className="text-[11px] font-semibold text-emerald-300 break-words">
          ✦ Created &ldquo;{message.createdVariantLabel}&rdquo; on @{message.targetScreenSlug}
        </div>
      )}

      <p className="text-[11px] text-zinc-300 leading-relaxed break-words">{message.text}</p>

      {message.resolvedMentionTags && message.resolvedMentionTags.length > 0 && (
        <div className="flex items-center gap-1 flex-wrap">
          <span className="text-[10px] text-zinc-500">Addressed:</span>
          {message.resolvedMentionTags.map((tag) => (
            <span
              key={tag}
              className="px-1.5 py-0.5 rounded bg-emerald-500/15 border border-emerald-500/35 text-emerald-300 text-[9px] font-mono"
            >
              ✓ {tag}
            </span>
          ))}
        </div>
      )}

      {message.tokens && (
        <div className="text-[9px] font-mono text-zinc-500 flex items-center gap-2 flex-wrap">
          <span>{formatTokens(message.tokens.total)} tok</span>
          <span>·</span>
          <span>in {formatTokens(message.tokens.prompt)}</span>
          <span>out {formatTokens(message.tokens.output)}</span>
          {message.tokens.thought > 0 && (
            <span className="text-violet-400">think {formatTokens(message.tokens.thought)}</span>
          )}
        </div>
      )}

      {message.targetScreenId && message.createdVariantId && (
        <div className="flex items-center gap-1.5 pt-1.5 border-t border-zinc-800 flex-wrap">
          <button
            type="button"
            onClick={() => onFocusVariant(message.targetScreenId!, message.createdVariantId!)}
            className="px-2 py-1 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-zinc-200 text-[10px] font-medium flex items-center gap-1"
          >
            <Eye className="w-3 h-3" /> View
          </button>
          <button
            type="button"
            onClick={() => onCompare(message.targetScreenId!)}
            className="px-2 py-1 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-zinc-200 text-[10px] font-medium flex items-center gap-1"
          >
            <Columns2 className="w-3 h-3" /> Compare
          </button>
          <button
            type="button"
            onClick={() => onFinalize(message.targetScreenId!, message.createdVariantId!)}
            className="px-2 py-1 rounded-lg bg-emerald-500/15 hover:bg-emerald-500/25 border border-emerald-500/40 text-emerald-300 text-[10px] font-semibold flex items-center gap-1"
          >
            <Crown className="w-3 h-3" /> Finalize
          </button>
        </div>
      )}
    </div>
  );
};
