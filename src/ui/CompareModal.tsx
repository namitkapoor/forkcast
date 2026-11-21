import { useEffect } from "react";
import { ScreenFrame } from "../a2ui/ScreenFrame";
import type { Screen } from "../a2ui/types";
import { IconCheck, IconCrown, IconEye, IconEyeOff, IconX } from "./icons";

export interface CompareModalProps {
  title: string;
  baseScreenId: string;
  versions: Screen[];
  activeIndex: number;
  finalizedIndex?: number;
  hiddenIndices: number[];
  onSelectIndex: (index: number) => void;
  onToggleFinalize: (index: number) => void;
  onToggleHidden: (index: number) => void;
  onClose: () => void;
}

export function CompareModal({
  title,
  versions,
  activeIndex,
  finalizedIndex,
  hiddenIndices,
  onSelectIndex,
  onToggleFinalize,
  onToggleHidden,
  onClose,
}: CompareModalProps) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        onClose();
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [onClose]);

  const hiddenSet = new Set(hiddenIndices);
  const visible = versions.map((s, idx) => ({ screen: s, idx })).filter(({ idx }) => !hiddenSet.has(idx));
  const hidden = versions.map((s, idx) => ({ screen: s, idx })).filter(({ idx }) => hiddenSet.has(idx));

  return (
    <div className="scrim" onClick={onClose}>
      <div
        className="modal-card floating"
        role="dialog"
        aria-modal="true"
        aria-label={`Compare versions — ${title}`}
        onClick={(e) => e.stopPropagation()}
      >
        <header className="modal-card__head">
          <div>
            <h2>Compare Versions — {title}</h2>
            <p className="muted small">
              {visible.length} visible · {hidden.length} hidden to reduce clutter
            </p>
          </div>
          <button className="icon-btn" onClick={onClose} aria-label="Close">
            <IconX />
          </button>
        </header>

        <div className="cmp-grid">
          {visible.map(({ screen, idx }) => {
            const isFinal = finalizedIndex === idx;
            const isActive = activeIndex === idx;
            return (
              <div key={screen.id} className={`cmp-item${isFinal ? " is-final" : ""}${isActive ? " is-active" : ""}`}>
                <div className="cmp-item__head">
                  <div className="cmp-item__title">
                    <span className="vchip is-on">{idx === 0 ? "v1 original" : `v${idx + 1}`}</span>
                    <b className="mono">{screen.variant}</b>
                    {isFinal && (
                      <span className="badge badge--ok">
                        <IconCrown width={10} height={10} /> Final
                      </span>
                    )}
                  </div>
                  <div className="row-btns">
                    <button
                      className={`btn btn--sm${isFinal ? " btn--accent" : ""}`}
                      onClick={() => onToggleFinalize(idx)}
                      title={isFinal ? "Unmark finalized" : "Mark as finalized version"}
                    >
                      <IconCrown width={12} height={12} /> {isFinal ? "Finalized" : "Finalize"}
                    </button>
                    <button
                      className="btn btn--sm"
                      onClick={() => {
                        onSelectIndex(idx);
                        onClose();
                      }}
                    >
                      <IconCheck width={12} height={12} /> Use
                    </button>
                    {visible.length > 1 && (
                      <button
                        className="icon-btn icon-btn--sm"
                        onClick={() => onToggleHidden(idx)}
                        title="Hide version from strip"
                        aria-label="Hide version"
                      >
                        <IconEyeOff width={13} height={13} />
                      </button>
                    )}
                  </div>
                </div>
                {screen.rationale && <p className="muted small cmp-item__rat">{screen.rationale}</p>}
                <div className="cmp-item__frame">
                  <ScreenFrame screen={screen} mode="thumb" width={236} />
                </div>
              </div>
            );
          })}
        </div>

        {hidden.length > 0 && (
          <footer className="modal-card__foot">
            <span className="muted small">Hidden:</span>
            <div className="row-btns">
              {hidden.map(({ idx, screen }) => (
                <button key={screen.id} className="btn btn--sm btn--ghost" onClick={() => onToggleHidden(idx)}>
                  <IconEye width={12} height={12} /> Restore v{idx + 1} ({screen.variant})
                </button>
              ))}
            </div>
          </footer>
        )}
      </div>
    </div>
  );
}
