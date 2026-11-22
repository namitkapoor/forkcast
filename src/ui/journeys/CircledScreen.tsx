import { useEffect, useRef, useState } from "react";
import { ScreenFrame } from "../../a2ui/ScreenFrame";
import { componentRects, type Rect } from "../../a2ui/componentRects";
import type { Screen } from "../../a2ui/types";
import type { CheckResult } from "../../journeys/types";

/** A numbered "why" tag on a component (Explain mode), colored by the ingredient that drove it. */
export interface Mark {
  componentId: string;
  n: number;
  source: string;
  title?: string;
}

interface Props {
  screen: Screen;
  width: number;
  mode?: "thumb" | "live";
  /** Failing checks; each one with a componentId gets circled (red; amber for persona contracts). */
  failing: CheckResult[];
  /** Show the label tag next to each circle: true = all, "persona" = persona contracts only, false = none. */
  tags?: boolean | "persona" | "values" | "numbered";
  /** Embed without device chrome (chat bubble). */
  bare?: boolean;
  /** Numbered decision tags (Explain mode). */
  marks?: Mark[];
  /** Component to outline (hovering a legend row). */
  highlight?: string | null;
}

type Circle = Rect & { key: string; label: string; persona: boolean; num: number };
type Placed = Rect & { key: string; mark?: Mark; hl?: boolean };

/** "[judge] Seat-together status is shown: reason" → "Seat-together status is shown". */
export const contractLabel = (c: CheckResult) => c.message.replace(/^\[judge\]\s*/, "").split(": ")[0];

/** A ScreenFrame with an outline on every component a failing check points at, plus optional Explain tags. */
export function CircledScreen({ screen, width, mode = "thumb", failing, tags = true, bare = false, marks = [], highlight = null }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const [circles, setCircles] = useState<Circle[]>([]);
  const [placed, setPlaced] = useState<Placed[]>([]);
  const targets = failing.filter((c) => c.componentId);
  const key = [
    targets.map((c) => `${c.kind}:${c.componentId}:${c.value ?? ""}`).join("|"),
    marks.map((m) => `${m.n}:${m.componentId}`).join("|"),
    highlight ?? "",
  ].join("#");

  useEffect(() => {
    if (!targets.length && !marks.length && !highlight) {
      setCircles([]);
      setPlaced([]);
      return;
    }
    const frame = ref.current?.querySelector(".fc-phone");
    if (!frame) return;
    // The renderer mounts components asynchronously (custom elements, shadow roots), so measure a few times.
    const measure = () => {
      const rects = componentRects(frame);
      const at = (id: string) => rects.find((x) => x.id === id);
      const next: Circle[] = [];
      const nums = new Map<string, number>();
      for (const c of targets) if (!nums.has(c.componentId!)) nums.set(c.componentId!, nums.size + 1);
      targets.forEach((c, i) => {
        const r = at(c.componentId!);
        const persona = c.kind === "persona";
        const label = persona ? contractLabel(c) : tags === "values" && c.value ? c.value : c.message || `${c.value} not grounded`;
        // Several persona contracts on one component share one amber circle and one tag.
        const same = persona ? next.find((x) => x.persona && x.key.startsWith(`${c.componentId}-`)) : undefined;
        if (same) same.label = `${same.label} · ${label}`;
        else if (r) next.push({ x: r.x, y: r.y, w: r.w, h: r.h, key: `${c.componentId}-${i}`, label, persona, num: nums.get(c.componentId!)! });
      });
      const nextPlaced: Placed[] = [];
      for (const m of marks) {
        const r = at(m.componentId);
        if (r) nextPlaced.push({ x: r.x, y: r.y, w: r.w, h: r.h, key: `m-${m.n}-${m.componentId}`, mark: m });
      }
      if (highlight) {
        const r = at(highlight);
        if (r) nextPlaced.push({ x: r.x, y: r.y, w: r.w, h: r.h, key: `hl-${highlight}`, hl: true });
      }
      setCircles((prev) => (JSON.stringify(prev) === JSON.stringify(next) ? prev : next));
      setPlaced((prev) => (JSON.stringify(prev) === JSON.stringify(nextPlaced) ? prev : nextPlaced));
    };
    const timers = [0, 60, 200, 500, 1200].map((ms) => window.setTimeout(measure, ms));
    const ro = new ResizeObserver(measure);
    ro.observe(frame);
    return () => {
      timers.forEach(clearTimeout);
      ro.disconnect();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [screen.id, key, width, bare]);

  const box = (r: Rect, padX = 4, padY = 3) => ({
    left: `calc(${r.x * 100}% - ${padX}px)`,
    top: `calc(${r.y * 100}% - ${padY}px)`,
    width: `calc(${r.w * 100}% + ${padX * 2}px)`,
    height: `calc(${r.h * 100}% + ${padY * 2}px)`,
  });

  return (
    <div className="jr-circled" ref={ref} style={{ width }}>
      <ScreenFrame screen={screen} width={width} mode={mode} bare={bare} />
      {circles.map((c) => (
        <div key={c.key} className={`jr-circle${c.persona ? " jr-circle--persona" : ""}`} style={box(c)} data-circle={c.key} data-circle-kind={c.persona ? "persona" : "check"}>
          {tags === "numbered" && <span className="jr-circle__num" title={c.label}>{c.num}</span>}
          {(tags === true || tags === "values" || (tags === "persona" && c.persona)) && <span className={`jr-circle__tag${c.y > 0.8 ? " is-above" : ""}`}>{c.label}</span>}
        </div>
      ))}
      {placed.map((p) =>
        p.hl ? (
          <div key={p.key} className="jr-hl" style={box(p, 3, 2)} />
        ) : (
          <span
            key={p.key}
            className={`jr-mark jr-mark--${p.mark!.source}`}
            style={{ left: `calc(${p.x * 100}% - 7px)`, top: `calc(${p.y * 100}% - 7px)` }}
            title={p.mark!.title}
            data-mark={p.mark!.n}
          >
            {p.mark!.n}
          </span>
        ),
      )}
    </div>
  );
}
