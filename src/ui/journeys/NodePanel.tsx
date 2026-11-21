import { useEffect, useMemo, useRef } from "react";
import type { Screen } from "../../a2ui/types";
import type { CheckResult, Intent, JourneysFile } from "../../journeys/types";
import { IconX } from "../icons";
import { CircledScreen } from "./CircledScreen";
import { cap, personaColor, shortPersona, truncate } from "./data";

interface Props {
  file: JourneysFile;
  intent: Intent;
  onClose: () => void;
  /** Open the journey a thumbnail came from. */
  onOpen?: (queryId: string, personaId: string, run: number, turn: number) => void;
}

type Shot = { screen: Screen; failing: CheckResult[]; queryId: string; personaId: string; run: number; turn: number };

/** "One node, many screens": every screen people saw while in one intent, grouped by persona. */
export function NodePanel({ file, intent, onClose, onOpen }: Props) {
  const closeRef = useRef<HTMLButtonElement>(null);

  const { groups, total, layouts } = useMemo(() => {
    const seen = new Set<string>();
    const byPersona = new Map<string, Shot[]>();
    for (const j of file.journeys) {
      j.turns.forEach((t, i) => {
        if (t.intent !== intent || !t.screen) return;
        const key = t.screen.id || `${j.id}:${i}`;
        if (seen.has(key)) return;
        seen.add(key);
        const list = byPersona.get(j.personaId) ?? [];
        list.push({ screen: t.screen, failing: (t.checks ?? []).filter((c) => !c.ok && c.kind !== "persona"), queryId: j.queryId, personaId: j.personaId, run: j.run, turn: i });
        byPersona.set(j.personaId, list);
      });
    }
    const groups = file.personas
      .map((p, i) => ({ persona: p, color: personaColor(p.id, i), shots: byPersona.get(p.id) ?? [] }))
      .filter((g) => g.shots.length);
    const all = groups.flatMap((g) => g.shots);
    return { groups, total: all.length, layouts: new Set(all.map((s) => s.screen.variant || s.screen.id)).size };
  }, [file, intent]);

  useEffect(() => {
    closeRef.current?.focus();
    const down = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.preventDefault();
      onClose();
    };
    window.addEventListener("keydown", down);
    return () => window.removeEventListener("keydown", down);
  }, [onClose]);

  const qText = (id: string) => file.queries.find((q) => q.id === id)?.text ?? id;

  return (
    <div className="scrim np-scrim" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="np" role="dialog" aria-modal="true" aria-labelledby="np-title">
        <header className="np__head">
          <div className="np__titles">
            <span className="np__eyebrow">One node, many screens</span>
            <h2 id="np-title">
              {cap(intent)} <span className="np__sub">· {total} screen{total === 1 ? "" : "s"}, {groups.length} traveler{groups.length === 1 ? "" : "s"}, {layouts} distinct layout{layouts === 1 ? "" : "s"}</span>
            </h2>
            <p className="np__note">Different screens, one intent. The tree groups them by what the person was trying to do, not by how the screen looked.</p>
          </div>
          <button ref={closeRef} className="icon-btn icon-btn--sm" onClick={onClose} aria-label="Close (Esc)" title="Close (Esc)">
            <IconX width={15} height={15} />
          </button>
        </header>
        <div className="np__body">
          {groups.map((g) => (
            <section className="np-group" key={g.persona.id}>
              <h3 className="np-group__h">
                <span className="np-group__dot" style={{ background: g.color }} />
                {shortPersona(g.persona)}
                <span className="np-group__n">
                  · {g.shots.length} screen{g.shots.length === 1 ? "" : "s"}
                </span>
              </h3>
              <div className="np-row">
                {g.shots.map((s) => {
                  const body = (
                    <>
                      <CircledScreen screen={s.screen} width={180} failing={s.failing} tags={false} />
                      <span className="np-shot__cap">
                        <span className={s.failing.length ? "tone-bad" : "tone-good"}>{s.failing.length ? `${s.failing.length} failing` : "passes"}</span>
                        <span className="np-shot__meta" title={`${qText(s.queryId)} · run ${s.run + 1} · turn ${s.turn + 1}`}>
                          {truncate(qText(s.queryId), 26)} · T{s.turn + 1}
                        </span>
                      </span>
                    </>
                  );
                  const key = `${s.screen.id}-${s.queryId}-${s.run}-${s.turn}`;
                  return onOpen ? (
                    <button key={key} className="np-shot is-link" onClick={() => onOpen(s.queryId, s.personaId, s.run, s.turn)} title="Open this journey">
                      {body}
                    </button>
                  ) : (
                    <div key={key} className="np-shot">
                      {body}
                    </div>
                  );
                })}
              </div>
            </section>
          ))}
          {!groups.length && <p className="muted">No screens recorded for this intent.</p>}
        </div>
      </div>
    </div>
  );
}
