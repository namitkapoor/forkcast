import { useEffect, useMemo, useState, type ReactNode } from "react";
import type { Journey, JourneysFile } from "../../journeys/types";
import { CircledScreen } from "./CircledScreen";
import { extractFacts } from "./agg";
import { cap, day, goalVerdict, money, shortPersona, turnOk } from "./data";
import { IconCheck, IconX } from "../icons";
import { IconLock } from "./icons";

interface Props {
  file: JourneysFile;
  journey: Journey;
  turn: number;
  onTurn: (i: number) => void;
}

function Section({ title, count, children }: { title: string; count?: number; children: ReactNode }) {
  return (
    <details className="jr-sec" open>
      <summary>
        {title}
        {count !== undefined && <span className="jr-sec__n">{count}</span>}
      </summary>
      <div className="jr-sec__body">{children}</div>
    </details>
  );
}

function useScreenWidth() {
  const calc = () => Math.max(260, Math.min(340, window.innerWidth - 50));
  const [w, setW] = useState(calc);
  useEffect(() => {
    const on = () => setW(calc());
    window.addEventListener("resize", on);
    return () => window.removeEventListener("resize", on);
  }, []);
  return w;
}

export function JourneyView({ file, journey: j, turn, onTurn }: Props) {
  const screenW = useScreenWidth();
  const q = file.queries.find((x) => x.id === j.queryId);
  const p = file.personas.find((x) => x.id === j.personaId);
  const t = j.turns[Math.min(turn, j.turns.length - 1)];
  const verdict = goalVerdict(j, q, p);
  const failing = t ? t.checks.filter((c) => !c.ok) : [];
  const onScreen = useMemo(() => {
    if (!t) return new Set<string>();
    const fs = extractFacts(t.screen).map((f) => f.value);
    const raw = JSON.stringify(t.screen.messages);
    return new Set([...fs, ...t.ingredients.toolResults.flatMap((r) => r.fares.map((f) => f.flightId)).filter((id) => raw.includes(id))]);
  }, [t]);

  if (!t) return <div className="page-stub">This journey has no turns.</div>;
  const ing = t.ingredients;

  return (
    <div className="jr-journey">
      <div className={`jr-verdict ${verdict.ok ? "is-ok" : "is-bad"}`} data-verdict={verdict.ok ? "ok" : "bad"}>
        {verdict.ok ? <IconCheck width={14} height={14} /> : <IconX width={14} height={14} />}
        <b>{verdict.ok ? "Goal met:" : "Goal not met:"}</b>
        <span>{verdict.text.replace(/^Goal (not )?met:?\s*/i, "")}</span>
        <span className="jr-verdict__tail muted">
          {shortPersona(p)} · run {j.run + 1} · {j.outcome}
        </span>
      </div>

      <div className="jr-l3">
        <nav className="jr-rail" aria-label="Turns">
          {j.turns.map((x, i) => {
            const ok = turnOk(x);
            return (
              <button key={i} className={`jr-rail__item${i === t.index ? " is-on" : ""}`} onClick={() => onTurn(i)} aria-current={i === t.index ? "step" : undefined} data-rail={i}>
                <span className={`dot dot--${ok ? "pass" : "fail"}`} />
                <span className="jr-rail__n">{i + 1}</span>
                <span className="jr-rail__intent">{cap(x.intent)}</span>
                {x.ingredients.pinned && <IconLock width={10} height={10} />}
              </button>
            );
          })}
        </nav>

        <section className="jr-col jr-chat" aria-label="Chat">
          <h3 className="jr-col__h">Chat</h3>
          <div className="jr-chatlog">
            {ing.history.map((h, i) => {
              const user = h.startsWith("user:");
              return (
                <div key={i} className={`jr-msg ${user ? "jr-msg--user" : "jr-msg--bot"} is-past`}>
                  {h.replace(/^(user|assistant showed):\s*/, user ? "" : "showed ")}
                </div>
              );
            })}
            <div className="jr-msg jr-msg--user">{t.userMessage}</div>
            <div className="jr-msg jr-msg--bot">
              <span className="muted">generated</span> {t.screen.variant}
              {t.ms ? <span className="muted"> · {(t.ms / 1000).toFixed(1)}s</span> : null}
            </div>
            <div className="jr-next">
              <span className="muted small">Next action</span>
              <div>{t.userAction}</div>
            </div>
          </div>
        </section>

        <section className="jr-col jr-ingredients" aria-label="Ingredients">
          <h3 className="jr-col__h">Ingredients</h3>
          {ing.pinned && (
            <div className="jr-pinned">
              <IconLock width={12} height={12} /> Pinned layout <code>{ing.pinned.key}</code>
              <span className="muted"> from {ing.pinned.fromScreenId}</span>
            </div>
          )}
          <Section title="Context">
            <div className="chips" style={{ marginTop: 0 }}>
              {Object.entries(ing.context).map(([k, v]) => (
                <span className="chip chip--ctx" key={k}>
                  <span>{k}</span> {v}
                </span>
              ))}
            </div>
          </Section>
          <Section title="History" count={ing.history.length}>
            {ing.history.length ? (
              <ol className="jr-hist">
                {ing.history.map((h, i) => (
                  <li key={i}>{h}</li>
                ))}
              </ol>
            ) : (
              <span className="muted small">First turn</span>
            )}
          </Section>
          <Section title="Tool results" count={ing.toolResults.reduce((n, r) => n + r.fares.length, 0)}>
            {ing.toolResults.map((r, ri) => (
              <div key={ri} className="jr-tool">
                <div className="jr-tool__call mono">
                  {r.tool}({Object.entries(r.args).map(([k, v]) => `${k}: ${String(v)}`).join(", ")})
                </div>
                <div className="jr-fares-scroll">
                  <table className="jr-fares">
                    <thead>
                      <tr>
                        <th>Flight</th>
                        <th>Date</th>
                        <th>Depart → arrive</th>
                        <th>Stops</th>
                        <th className="num">Total</th>
                      </tr>
                    </thead>
                    <tbody>
                      {r.fares.map((f) => (
                        <tr key={`${f.flightId}-${f.date}`} className={onScreen.has(f.flightId) ? "is-shown" : ""} title={onScreen.has(f.flightId) ? "Shown on screen" : undefined}>
                          <td className="mono">{f.flightId}</td>
                          <td>{day(f.date)}</td>
                          <td className="mono">
                            {f.depart}→{f.arrive}
                          </td>
                          <td>{f.stops}</td>
                          <td className="num">{money(f.total, f.currency)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            ))}
          </Section>
          <Section title="Carry" count={Object.keys(ing.carry).length}>
            <dl className="jr-kv">
              {Object.entries(ing.carry).map(([k, v]) => (
                <div key={k}>
                  <dt>{k}</dt>
                  <dd className="mono">{typeof v === "object" ? JSON.stringify(v) : String(v)}</dd>
                </div>
              ))}
            </dl>
          </Section>
          <Section title="Prompt version">
            <code>{ing.promptVersion}</code>
          </Section>
        </section>

        <section className="jr-col jr-screen" aria-label="Screen">
          <h3 className="jr-col__h">
            Screen <span className="muted">· {t.screen.variant}</span>
          </h3>
          <CircledScreen screen={t.screen} width={screenW} mode="live" failing={failing} />
          {t.screen.rationale && <p className="muted small jr-rationale">{t.screen.rationale}</p>}
          <ul className="jr-checks">
            {t.checks.map((c, i) => (
              <li key={i} className={c.ok ? "is-ok" : "is-bad"} data-check={c.kind}>
                {c.ok ? <IconCheck width={13} height={13} /> : <IconX width={13} height={13} />}
                <span className="jr-checks__kind">{c.kind}</span>
                <span>{c.message}</span>
              </li>
            ))}
          </ul>
        </section>
      </div>
    </div>
  );
}
