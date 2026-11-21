import { useCallback, useEffect, useState } from "react";
import { loadHeroJourneys, loadJourneys, loadNaiveJourneys, type HeroMode, shortPersona, sortQueries, truncate, type LoadedJourneys } from "./data";
import { Suite } from "./Suite";
import { JourneyView } from "./JourneyView";
import { IconBack } from "./icons";
import "./journeys.css";

import type { JourneysFile } from "../../journeys/types";

/** `fromHero`: the journey comes from the hero's (unpinned) file, not journeys.json. */
type Nav = { level: 1 } | { level: 3; queryId: string; personaId: string; run: number; turn: number; fromHero: boolean };

export function JourneysPage() {
  const [data, setData] = useState<LoadedJourneys | null | "loading">("loading");
  const [unpinned, setUnpinned] = useState<JourneysFile | null>(null);
  const [naive, setNaive] = useState<JourneysFile | null>(null);
  // The problem first: the hero opens on the naive-prompt run.
  const [mode, setMode] = useState<HeroMode>("naive");
  const [nav, setNav] = useState<Nav>({ level: 1 });
  // Hero state lives here so coming back from a journey lands where you left.
  const [heroQuery, setHeroQuery] = useState<string | null>(null);
  const [heroTurn, setHeroTurn] = useState(0);

  useEffect(() => {
    let live = true;
    // The hero waits for both so it never flips from pinned to unpinned screens mid-view.
    Promise.all([loadJourneys(), loadHeroJourneys(), loadNaiveJourneys()]).then(([d, u, n]) => {
      if (!live) return;
      setUnpinned(u);
      setNaive(n);
      setData(d);
    });
    return () => {
      live = false;
    };
  }, []);

  const up = useCallback(() => setNav({ level: 1 }), []);

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
  }, [nav.level]);

  if (data === "loading") {
    return (
      <div className="loading">
        <span className="spinner" /> Loading journeys…
      </div>
    );
  }
  if (!data) return <div className="page-stub">No journeys found. Expected /data/journeys.json or /data/journeys.sample.json.</div>;

  const { file } = data;
  const checkedFile = unpinned ?? file;
  const heroFile = mode === "naive" && naive ? naive : checkedFile;
  const queryId = heroQuery ?? sortQueries(heroFile.queries)[0]?.id ?? "";

  if (nav.level === 1) {
    return (
      <div className="jr jr--l1">
        <Suite
          file={file}
          heroFile={heroFile}
          mode={naive ? mode : undefined}
          onMode={setMode}
          queryId={queryId}
          turn={heroTurn}
          onQuery={setHeroQuery}
          onTurn={setHeroTurn}
          onOpen={(q, personaId, run, turn) => setNav({ level: 3, queryId: q, personaId, run, turn, fromHero: true })}
        />
      </div>
    );
  }

  const src = nav.fromHero ? heroFile : file;
  const q = src.queries.find((x) => x.id === nav.queryId);
  const p = src.personas.find((x) => x.id === nav.personaId);
  const journey = src.journeys.find((j) => j.queryId === nav.queryId && j.personaId === nav.personaId && j.run === nav.run);

  return (
    <div className="jr jr--l3">
      <div className="jr-bar">
        <button className="icon-btn icon-btn--sm" onClick={up} aria-label="Back (Esc)" title="Back (Esc)">
          <IconBack width={15} height={15} />
        </button>
        <nav className="jr-crumbs" aria-label="Breadcrumbs">
          <span className="jr-crumb">
            <button onClick={up}>Three travelers</button>
          </span>
          <span className="jr-crumb jr-crumb--q">
            <span className="jr-crumbs__sep">›</span>
            <button onClick={up} title={q?.text}>
              “{truncate(q?.text ?? nav.queryId, 44)}”
            </button>
          </span>
          <span className="jr-crumb">
            <span className="jr-crumbs__sep">›</span>
            {p?.photo && <img className="avatar avatar--crumb" src={p.photo} alt="" width={18} height={18} />}
            <span aria-current="page">{shortPersona(p)}</span>
          </span>
        </nav>
      </div>
      {journey ? (
        <JourneyView file={src} journey={journey} turn={nav.turn} onTurn={(turn) => setNav({ ...nav, turn })} />
      ) : (
        <div className="page-stub">Journey not found.</div>
      )}
    </div>
  );
}
