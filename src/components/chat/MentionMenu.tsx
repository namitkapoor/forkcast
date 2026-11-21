import React from 'react';
import { Paintbrush, Pin } from 'lucide-react';
import type { CatalogReferenceItem } from '../../domain/references';

interface MentionMenuProps {
  items: CatalogReferenceItem[];
  activeIndex: number;
  onSelectItem: (item: CatalogReferenceItem) => void;
}

export const MentionMenu: React.FC<MentionMenuProps> = ({
  items,
  activeIndex,
  onSelectItem,
}) => {
  if (items.length === 0) {
    return (
      <div className="absolute left-3 right-3 bottom-full mb-1.5 z-50 rounded-xl bg-[#18181f] border border-zinc-700 px-3 py-2 shadow-2xl text-[11px] text-zinc-400">
        No matching @Pin:vK, @Mask:vK, or @Screen found.
      </div>
    );
  }

  return (
    <div className="absolute left-3 right-3 bottom-full mb-1.5 z-50 rounded-xl bg-[#18181f] border border-zinc-700 p-1.5 shadow-2xl max-h-56 overflow-y-auto">
      <div className="px-2 py-1 text-[9px] uppercase tracking-wider text-zinc-500 font-semibold flex items-center justify-between">
        <span>Versioned Pins, Masks &amp; Screens ({items.length})</span>
        <span>↑↓ Enter</span>
      </div>
      {items.map((item, idx) => {
        const isActive = idx === activeIndex;
        return (
          <button
            key={`${item.kind}-${item.token}-${item.annotationId ?? item.screenId ?? idx}`}
            type="button"
            onMouseDown={(e) => {
              e.preventDefault();
              onSelectItem(item);
            }}
            className={`w-full text-left px-2 py-1.5 rounded-lg flex flex-col gap-0.5 transition ${
              isActive ? 'bg-zinc-800' : 'hover:bg-zinc-800/70'
            }`}
          >
            <div className="flex items-center justify-between gap-2 min-w-0">
              <div className="flex items-center gap-1.5 min-w-0">
                {item.kind === 'mask' ? (
                  <Paintbrush className="w-3 h-3 text-pink-400 shrink-0" />
                ) : item.kind === 'pin' ? (
                  <Pin className="w-3 h-3 text-blue-400 shrink-0" />
                ) : (
                  <span className="w-2 h-2 rounded-full bg-emerald-400 shrink-0" />
                )}
                <span
                  className={`font-mono text-xs font-semibold shrink-0 ${
                    item.kind === 'mask'
                      ? 'text-pink-300'
                      : item.kind === 'pin'
                      ? 'text-blue-300'
                      : 'text-emerald-300'
                  }`}
                >
                  {item.token}
                </span>
              </div>
              <span
                className={`text-[9px] font-mono truncate ${
                  item.isResolved
                    ? 'text-zinc-500'
                    : item.includeInAiFeedback === false
                    ? 'text-amber-400'
                    : 'text-zinc-400'
                }`}
              >
                {item.secondaryText}
              </span>
            </div>
            <div className="text-[11px] text-zinc-300 truncate pl-4">{item.primaryText}</div>
          </button>
        );
      })}
    </div>
  );
};
