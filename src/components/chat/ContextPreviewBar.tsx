import React, { useMemo } from 'react';
import { Plus, Sparkles, X } from 'lucide-react';
import type { FlowProject } from '../../types/studio';
import { buildMultimodalContext } from '../../ai/contextBuilder';
import { buildReferenceCatalog, type CatalogReferenceItem } from '../../domain/references';

interface ContextPreviewBarProps {
  draft: string;
  project: FlowProject;
  detachedKeys: string[];
  onAttachItem: (item: CatalogReferenceItem) => void;
  onDetachItem: (key: string, baseHandle: string) => void;
  onClearAll: () => void;
}

export const ContextPreviewBar: React.FC<ContextPreviewBarProps> = ({
  draft,
  project,
  detachedKeys,
  onAttachItem,
  onDetachItem,
  onClearAll,
}) => {
  const detachedSet = useMemo(() => new Set(detachedKeys), [detachedKeys]);

  const preview = useMemo(
    () => buildMultimodalContext(draft, project, project.selectedScreenId, detachedSet),
    [draft, project, detachedSet]
  );

  const attachedScreenIds = useMemo(
    () => new Set(preview.targetScreens.map((s) => s.id)),
    [preview.targetScreens]
  );
  const attachedAnnIds = useMemo(
    () => new Set(preview.includedRefs.map((r) => r.annotation.id)),
    [preview.includedRefs]
  );

  // Available items NOT currently in Active Context (pins/masks first, then screens)
  const addableItems = useMemo(() => {
    const catalog = buildReferenceCatalog(project);
    return catalog.filter((item) => {
      if (item.kind === 'pin' || item.kind === 'mask') {
        return (
          item.isLatestRevision &&
          !item.isResolved &&
          item.annotationId !== undefined &&
          !attachedAnnIds.has(item.annotationId)
        );
      }
      if (item.kind === 'screen') {
        return item.screenId !== undefined && !attachedScreenIds.has(item.screenId);
      }
      return false;
    });
  }, [project, attachedAnnIds, attachedScreenIds]);

  const hasActiveAttachments =
    preview.targetScreens.length > 0 || preview.includedRefs.length > 0;

  return (
    <div className="space-y-1.5 min-w-0">
      {/* 1. Active Context Sent to Gemini 4 (Every chip has a clickable × Remove button!) */}
      <div className="rounded-lg bg-zinc-900/90 border border-zinc-800 px-2.5 py-1.5 space-y-1 min-w-0">
        <div className="flex items-center justify-between gap-2 text-[9px] uppercase tracking-wider text-zinc-400 font-semibold">
          <span className="flex items-center gap-1 truncate">
            <Sparkles className="w-2.5 h-2.5 text-emerald-400 shrink-0" />
            <span>
              Context Sent to Gemini 4 (
              {preview.targetScreens.length + preview.includedRefs.length})
            </span>
          </span>
          {hasActiveAttachments && (
            <button
              type="button"
              onClick={onClearAll}
              className="text-zinc-400 hover:text-rose-300 font-mono normal-case shrink-0 transition"
              title="Detach all screens and pins from this prompt"
            >
              Clear all ×
            </button>
          )}
        </div>

        {hasActiveAttachments ? (
          <div className="flex items-center gap-1 overflow-x-auto pb-0.5">
            {preview.targetScreens.map((sc) => (
              <span
                key={sc.id}
                title={`Attached screen: ${sc.title} (click × to remove)`}
                className="inline-flex items-center gap-1 pl-1.5 pr-1 py-0.5 rounded bg-emerald-500/15 border border-emerald-500/35 text-emerald-200 text-[10px] font-mono shrink-0"
              >
                <span>@{sc.slug}</span>
                <button
                  type="button"
                  onClick={() => onDetachItem(`screen:${sc.id}`, sc.slug)}
                  title={`Remove @${sc.slug} from AI context`}
                  className="p-0.5 rounded hover:bg-emerald-500/30 text-emerald-300 hover:text-white transition"
                >
                  <X className="w-2.5 h-2.5" />
                </button>
              </span>
            ))}

            {preview.includedRefs.map((ref) => {
              const isMask = ref.annotation.kind === 'paint-region';
              return (
                <span
                  key={ref.token}
                  title={`${ref.token} on @${ref.screen.slug}: "${ref.revision.comment}" (click × to remove)`}
                  className={`inline-flex items-center gap-1 pl-1.5 pr-1 py-0.5 rounded border text-[10px] font-mono shrink-0 max-w-[215px] ${
                    isMask
                      ? 'bg-pink-500/15 border-pink-500/40 text-pink-200'
                      : 'bg-blue-500/15 border-blue-500/40 text-blue-200'
                  }`}
                >
                  <span className="truncate">
                    {ref.token}: &ldquo;{ref.revision.comment.slice(0, 18)}
                    {ref.revision.comment.length > 18 ? '…' : ''}&rdquo;
                  </span>
                  <button
                    type="button"
                    onClick={() =>
                      onDetachItem(`ann:${ref.annotation.id}`, ref.annotation.mentionTag)
                    }
                    title={`Remove ${ref.token} from AI context`}
                    className="p-0.5 rounded hover:bg-white/15 text-current hover:text-white shrink-0 transition"
                  >
                    <X className="w-2.5 h-2.5" />
                  </button>
                </span>
              );
            })}
          </div>
        ) : (
          <div className="text-[10px] text-zinc-500 py-0.5">
            No context attached — click <code className="text-zinc-300">+</code> below or type{' '}
            <code className="text-zinc-300">@</code> to add pins or screens.
          </div>
        )}
      </div>

      {/* 2. Addable Unattached Pins & Screens (+ chips) */}
      {addableItems.length > 0 && (
        <div className="flex items-center gap-1 overflow-x-auto pb-0.5">
          <span className="text-[9px] uppercase tracking-wider text-zinc-500 font-semibold shrink-0 pr-0.5">
            Attach:
          </span>
          {addableItems.map((item) => (
            <button
              key={`${item.kind}-${item.token}`}
              type="button"
              onClick={() => onAttachItem(item)}
              title={`Add ${item.token} (${item.secondaryText}): ${item.primaryText}`}
              className={`inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-md border text-[10px] font-mono shrink-0 transition ${
                item.kind === 'mask'
                  ? 'bg-pink-500/10 hover:bg-pink-500/25 border-pink-500/35 text-pink-300'
                  : item.kind === 'pin'
                  ? 'bg-blue-500/10 hover:bg-blue-500/25 border-blue-500/35 text-blue-300'
                  : 'bg-zinc-900 hover:bg-zinc-800 border-zinc-700 text-zinc-300 hover:text-emerald-300'
              }`}
            >
              <Plus className="w-2.5 h-2.5" />
              <span>{item.token}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
};
