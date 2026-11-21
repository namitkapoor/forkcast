import { useCallback, useEffect, useState } from "react";
import { loadJourneys, shortPersona, truncate, type LoadedJourneys } from "./data";
import { Suite } from "./Suite";
import { QueryLanes } from "./QueryLanes";
import { JourneyView } from "./JourneyView";
import { IconBack } from "./icons";
import "./journeys.css";

type Nav = { level: 1 } | { level: 2; queryId: string; focus?: string } | { level: 3; queryId: string; personaId: string; run: number; turn: number };

export function JourneysPage() {
  const [data, setData] = useState<LoadedJourneys | null | "loading">("loading");
  const [nav, setNav] = useState<Nav>({ level: 1 });
  // Run picked per (query, persona) in L2; survives going down to L3 and back.
  const [runs, setRuns] = useState<Record<string, Record<string, number>>>({});

  useEffect(() => {
    let live = true;
    loadJourneys().then((d) => live && setData(d));
    return () => {
      live = false;
    };
  }, []);

  const up = useCallback(() => {
    setNav((n) => (n.level === 3 ? { level: 2, queryId: n.queryId, focus: n.personaId } : { level: 1 }));
  }, []);

  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || e.defaultPrevented) return;
      const t = e.target;
      if (t instanceof HTMLElement && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))) return;
      if (document.querySelector(".scrim")) return;
      up();
    };
    window.addEventListener("keydown", down);
    return () => window.removeEventListener("keydown", down);
  }, [up]);

  // Each level starts at the top.
  useEffect(() => {
    document.querySelector(".page")?.scrollTo({ top: 0 });
  }, [nav.level, nav.level !== 1 ? nav.queryId : ""]);

  if (data === "loading") {
    return (
      <div className="loading">
        <span className="spinner" /> Loading journeys…
      </div>
    );
  }
  if (!data) return <div className="page-stub">No journeys found. Expected /data/journeys.json or /data/journeys.sample.json.</div>;

  const { file, sample } = data;
  const q = nav.level !== 1 ? file.queries.find((x) => x.id === nav.queryId) : undefined;
  const p = nav.level === 3 ? file.personas.find((x) => x.id === nav.personaId) : undefined;
  const journey = nav.level === 3 ? file.journeys.find((j) => j.queryId === nav.queryId && j.personaId === nav.personaId && j.run === nav.run) : undefined;

  const crumbs: { label: string; go?: () => void }[] = [{ label: "Suite", go: nav.level > 1 ? () => setNav({ level: 1 }) : undefined }];
  if (nav.level >= 2 && q) crumbs.push({ label: truncate(q.text, 30), go: nav.level === 3 ? up : undefined });
  if (nav.level === 3) crumbs.push({ label: `${shortPersona(p)} · run ${nav.run + 1}` });

  return (
    <div className={`jr jr--l${nav.level}`}>
      <div className="jr-bar">
        {nav.level > 1 && (
          <button className="icon-btn icon-btn--sm" onClick={up} aria-label="Up one level (Esc)" title="Up one level (Esc)">
            <IconBack width={15} height={15} />
          </button>
        )}
        <nav className="jr-crumbs" aria-label="Breadcrumbs">
          {crumbs.map((c, i) => (
            <span key={i} className="jr-crumb">
              {i > 0 && <span className="jr-crumbs__sep">›</span>}
              {c.go ? (
                <button onClick={c.go}>{c.label}</button>
              ) : (
                <span aria-current="page" title={i === 1 ? q?.text : undefined}>
                  {c.label}
                </span>
              )}
            </span>
          ))}
        </nav>
        <span className="jr-bar__right">
          {sample && (
            <span className="badge badge--accent" title="public/data/journeys.json not found; showing the hand-built sample" data-sample>
              sample data
            </span>
          )}
          <span className="muted small jr-bar__meta">
            {file.journeys.length} journeys · {new Date(file.createdAt).toLocaleDateString("en-GB", { day: "numeric", month: "short" })}
          </span>
        </span>
      </div>

      {nav.level === 1 && <Suite file={file} onOpen={(queryId, personaId) => setNav({ level: 2, queryId, focus: personaId })} />}
      {nav.level === 2 && (
        <QueryLanes
          file={file}
          queryId={nav.queryId}
          runs={runs[nav.queryId] ?? {}}
          focusPersona={nav.focus}
          onRun={(personaId, run) => setRuns((r) => ({ ...r, [nav.queryId]: { ...r[nav.queryId], [personaId]: run } }))}
          onOpenTurn={(personaId, run, turn) => setNav({ level: 3, queryId: nav.queryId, personaId, run, turn })}
        />
      )}
      {nav.level === 3 &&
        (journey ? (
          <JourneyView file={file} journey={journey} turn={nav.turn} onTurn={(turn) => setNav({ ...nav, turn })} />
        ) : (
          <div className="page-stub">Journey not found.</div>
        ))}
    </div>
  );
}
