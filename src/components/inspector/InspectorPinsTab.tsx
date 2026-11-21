import React, { useState } from 'react';
import {
  Check,
  Edit3,
  History,
  MessageSquare,
  Paintbrush,
  Pin,
  RotateCcw,
  Send,
  Trash2,
} from 'lucide-react';
import type { FlowProject, ScreenAnnotation, ScreenNode } from '../../types/studio';
import { formatVersionedRef } from '../../domain/annotations';

interface InspectorPinsTabProps {
  screen: ScreenNode;
  project: FlowProject;
  isBusy: boolean;
  onSelectScreen: (screenId: string) => void;
  onMentionInChat: (versionedToken: string) => void;
  onToggleIncludeInAi: (screenId: string, annotationId: string) => void;
  onSetAllIncludeInAi: (screenId: string, include: boolean) => void;
  onEditAnnotation: (screenId: string, annotationId: string, comment: string) => void;
  onToggleStatus: (screenId: string, annotationId: string) => void;
  onRestoreRevision: (screenId: string, annotationId: string, revisionId: string) => void;
  onDeleteAnnotation: (screenId: string, annotationId: string) => void;
  onSendIncludedToAI: () => void;
}

export const InspectorPinsTab: React.FC<InspectorPinsTabProps> = ({
  screen,
  project,
  isBusy,
  onSelectScreen,
  onMentionInChat,
  onToggleIncludeInAi,
  onSetAllIncludeInAi,
  onEditAnnotation,
  onToggleStatus,
  onRestoreRevision,
  onDeleteAnnotation,
  onSendIncludedToAI,
}) => {
  const [scope, setScope] = useState<'screen' | 'all'>('screen');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState('');
  const [expandedRevId, setExpandedRevId] = useState<string | null>(null);

  const allProjectAnnotations: ScreenAnnotation[] = Object.values(project.screens).flatMap(
    (sc) => sc.annotations
  );
  const displayed = scope === 'screen' ? screen.annotations : allProjectAnnotations;

  const includedOpenOnScreen = screen.annotations.filter(
    (a) => a.status === 'open' && a.includeInAiFeedback
  ).length;

  return (
    <div className="flex-1 min-h-0 flex flex-col overflow-hidden">
      <div className="p-2.5 border-b border-zinc-800 flex items-center justify-between gap-2 bg-[#151519] shrink-0">
        <div className="flex items-center bg-zinc-900 border border-zinc-800 rounded-lg p-0.5 text-[10px]">
          <button
            type="button"
            onClick={() => setScope('screen')}
            className={`px-2 py-0.5 rounded ${
              scope === 'screen' ? 'bg-zinc-700 text-white font-medium' : 'text-zinc-400'
            }`}
          >
            This Screen ({screen.annotations.length})
          </button>
          <button
            type="button"
            onClick={() => setScope('all')}
            className={`px-2 py-0.5 rounded ${
              scope === 'all' ? 'bg-zinc-700 text-white font-medium' : 'text-zinc-400'
            }`}
          >
            All ({allProjectAnnotations.length})
          </button>
        </div>

        {scope === 'screen' && screen.annotations.length > 0 && (
          <div className="flex items-center gap-1 text-[10px] shrink-0">
            <button
              type="button"
              onClick={() => onSetAllIncludeInAi(screen.id, true)}
              className="text-emerald-400 hover:underline"
            >
              All AI
            </button>
            <span className="text-zinc-600">/</span>
            <button
              type="button"
              onClick={() => onSetAllIncludeInAi(screen.id, false)}
              className="text-zinc-400 hover:underline"
            >
              None
            </button>
          </div>
        )}
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto p-3 space-y-2.5">
        {displayed.length === 0 ? (
          <div className="p-4 rounded-xl border border-dashed border-zinc-800 text-center space-y-1.5">
            <MessageSquare className="w-5 h-5 text-zinc-500 mx-auto" />
            <div className="text-xs font-medium text-zinc-300">No pins or masks yet</div>
            <p className="text-[11px] text-zinc-500">
              Press <kbd className="px-1 rounded bg-zinc-800 text-zinc-300">C</kbd> to pin an
              element or <kbd className="px-1 rounded bg-zinc-800 text-zinc-300">B</kbd> to paint a
              region.
            </p>
          </div>
        ) : (
          displayed.map((ann) => {
            const ownerScreen = project.screens[ann.screenId];
            const isEditing = editingId === ann.id;
            const showRevs = expandedRevId === ann.id;
            const latestToken = formatVersionedRef(ann);

            return (
              <div
                key={ann.id}
                className={`p-2.5 rounded-xl border space-y-2 transition min-w-0 ${
                  ann.status === 'resolved'
                    ? 'bg-zinc-900/40 border-zinc-800 opacity-80'
                    : ann.includeInAiFeedback
                    ? 'bg-zinc-900 border-zinc-700'
                    : 'bg-zinc-900/50 border-dashed border-zinc-800'
                }`}
              >
                <div className="flex items-center justify-between gap-1.5 min-w-0">
                  <div className="flex items-center gap-1.5 min-w-0 flex-wrap">
                    {ann.kind === 'paint-region' ? (
                      <Paintbrush className="w-3 h-3 text-pink-400 shrink-0" />
                    ) : (
                      <Pin className="w-3 h-3 text-blue-400 shrink-0" />
                    )}
                    <button
                      type="button"
                      onClick={() => onMentionInChat(latestToken)}
                      title={`Insert ${latestToken} into AI Chat`}
                      className="text-[11px] font-mono font-semibold text-blue-300 hover:text-blue-200 transition"
                    >
                      {latestToken}
                    </button>
                    {scope === 'all' && ownerScreen && (
                      <button
                        type="button"
                        onClick={() => onSelectScreen(ownerScreen.id)}
                        className="text-[10px] font-mono text-emerald-300 hover:underline"
                      >
                        @{ownerScreen.slug}
                      </button>
                    )}
                  </div>

                  <div className="flex items-center gap-1 shrink-0">
                    <button
                      type="button"
                      onClick={() => onMentionInChat(latestToken)}
                      className="px-1.5 py-0.5 rounded bg-blue-500/15 hover:bg-blue-500/25 text-blue-300 text-[9px] font-mono"
                    >
                      +Chat
                    </button>
                    <button
                      type="button"
                      onClick={() => onToggleStatus(ann.screenId, ann.id)}
                      title={ann.status === 'open' ? 'Mark resolved' : 'Reopen'}
                      className={`p-1 rounded ${
                        ann.status === 'resolved'
                          ? 'text-emerald-400 bg-emerald-500/15'
                          : 'text-zinc-500 hover:text-emerald-300'
                      }`}
                    >
                      <Check className="w-3 h-3" />
                    </button>
                    <button
                      type="button"
                      onClick={() => onDeleteAnnotation(ann.screenId, ann.id)}
                      className="p-1 rounded text-zinc-500 hover:text-rose-400"
                    >
                      <Trash2 className="w-3 h-3" />
                    </button>
                  </div>
                </div>

                {ann.elementTarget && (
                  <div className="text-[10px] font-mono text-blue-300/80 bg-blue-500/10 border border-blue-500/20 rounded px-1.5 py-0.5 truncate">
                    &lt;{ann.elementTarget.tagName}&gt;{' '}
                    {ann.elementTarget.textSnippet || ann.elementTarget.selector}
                  </div>
                )}

                {isEditing ? (
                  <div className="space-y-1.5">
                    <textarea
                      rows={2}
                      value={editDraft}
                      onChange={(e) => setEditDraft(e.target.value)}
                      className="w-full bg-zinc-950 border border-blue-500/60 rounded-lg p-2 text-xs text-zinc-100 focus:outline-none"
                    />
                    <div className="flex justify-end gap-1.5">
                      <button
                        type="button"
                        onClick={() => setEditingId(null)}
                        className="px-2 py-0.5 text-[10px] text-zinc-400"
                      >
                        Cancel
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          if (editDraft.trim()) {
                            onEditAnnotation(ann.screenId, ann.id, editDraft.trim());
                          }
                          setEditingId(null);
                        }}
                        className="px-2 py-0.5 rounded bg-blue-600 text-white text-[10px] font-semibold"
                      >
                        Save v{ann.revisions.length + 1}
                      </button>
                    </div>
                  </div>
                ) : (
                  <p className="text-xs text-zinc-200 leading-snug break-words">{ann.comment}</p>
                )}

                <div className="flex items-center justify-between pt-1.5 border-t border-zinc-800/80 gap-1">
                  <label className="flex items-center gap-1.5 cursor-pointer select-none">
                    <input
                      type="checkbox"
                      checked={ann.includeInAiFeedback}
                      onChange={() => onToggleIncludeInAi(ann.screenId, ann.id)}
                      className="accent-emerald-500 rounded"
                    />
                    <span
                      className={`text-[10px] font-medium ${
                        ann.includeInAiFeedback ? 'text-emerald-300' : 'text-zinc-500'
                      }`}
                    >
                      {ann.includeInAiFeedback ? 'Include in AI' : 'Excluded from AI'}
                    </span>
                  </label>

                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => {
                        setEditingId(ann.id);
                        setEditDraft(ann.comment);
                      }}
                      className="text-[10px] text-zinc-400 hover:text-zinc-100 flex items-center gap-0.5"
                    >
                      <Edit3 className="w-2.5 h-2.5" /> Edit
                    </button>
                    <button
                      type="button"
                      onClick={() => setExpandedRevId(showRevs ? null : ann.id)}
                      className="text-[10px] text-zinc-400 hover:text-zinc-100 flex items-center gap-0.5"
                    >
                      <History className="w-2.5 h-2.5" /> Revs ({ann.revisions.length})
                    </button>
                  </div>
                </div>

                {showRevs && (
                  <div className="pt-2 border-t border-zinc-800 space-y-1.5">
                    <div className="text-[9px] uppercase tracking-wider text-zinc-500 font-semibold">
                      Version History (Click +Chat to reference exact revision)
                    </div>
                    {[...ann.revisions].reverse().map((rev) => {
                      const verTok = formatVersionedRef(ann, rev.revisionNumber);
                      return (
                        <div
                          key={rev.id}
                          className="p-2 rounded-lg bg-zinc-950/90 border border-zinc-800/90 space-y-1"
                        >
                          <div className="flex items-center justify-between gap-1 text-[9px] text-zinc-500">
                            <span className="font-mono text-zinc-300 font-semibold">
                              {verTok} · {rev.author} ({rev.status})
                            </span>
                            <div className="flex items-center gap-2 shrink-0">
                              <button
                                type="button"
                                onClick={() => onMentionInChat(verTok)}
                                className="text-blue-400 hover:underline font-mono"
                              >
                                +{verTok}
                              </button>
                              {rev.revisionNumber < ann.revisions.length && (
                                <button
                                  type="button"
                                  onClick={() => onRestoreRevision(ann.screenId, ann.id, rev.id)}
                                  className="text-emerald-400 hover:underline flex items-center gap-0.5"
                                >
                                  <RotateCcw className="w-2.5 h-2.5" /> Restore
                                </button>
                              )}
                            </div>
                          </div>
                          <div className="text-[10px] text-zinc-300 leading-snug break-words">
                            {rev.comment}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>

      <div className="p-3 border-t border-[#2b2b33] bg-[#151519] shrink-0">
        <button
          type="button"
          disabled={isBusy || includedOpenOnScreen === 0}
          onClick={onSendIncludedToAI}
          className="w-full py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 disabled:opacity-40 text-white text-xs font-semibold flex items-center justify-center gap-1.5 shadow transition"
        >
          <Send className="w-3.5 h-3.5" />
          Send Included to AI ({includedOpenOnScreen} opted-in)
        </button>
      </div>
    </div>
  );
};
