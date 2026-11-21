import { useEffect, useRef, useState } from "react";
import { ScreenFrame } from "../../a2ui/ScreenFrame";
import { componentRects, type Rect } from "../../a2ui/componentRects";
import type { Screen } from "../../a2ui/types";
import type { CheckResult } from "../../journeys/types";

interface Props {
  screen: Screen;
  width: number;
  mode?: "thumb" | "live";
  /** Failing checks; each one with a componentId gets circled. */
  failing: CheckResult[];
  /** Show the value tag next to each circle (off for small thumbs). */
  tags?: boolean;
}

type Circle = Rect & { key: string; label: string };

/** A ScreenFrame with a red outline on every component a failing check points at. */
export function CircledScreen({ screen, width, mode = "thumb", failing, tags = true }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const [circles, setCircles] = useState<Circle[]>([]);
  const targets = failing.filter((c) => c.componentId);
  const key = targets.map((c) => `${c.componentId}:${c.value ?? ""}`).join("|");

  useEffect(() => {
    if (!targets.length) {
      setCircles([]);
      return;
    }
    const frame = ref.current?.querySelector(".fc-phone");
    if (!frame) return;
    // The renderer mounts components asynchronously (custom elements, shadow roots), so measure a few times.
    const measure = () => {
      const rects = componentRects(frame);
      const next: Circle[] = [];
      targets.forEach((c, i) => {
        const r = rects.find((x) => x.id === c.componentId);
        if (r) next.push({ x: r.x, y: r.y, w: r.w, h: r.h, key: `${c.componentId}-${i}`, label: c.message || `${c.value} not grounded` });
      });
      setCircles((prev) => (JSON.stringify(prev) === JSON.stringify(next) ? prev : next));
    };
    const timers = [0, 60, 200, 500, 1200].map((ms) => window.setTimeout(measure, ms));
    const ro = new ResizeObserver(measure);
    ro.observe(frame);
    return () => {
      timers.forEach(clearTimeout);
      ro.disconnect();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [screen.id, key, width]);

  return (
    <div className="jr-circled" ref={ref} style={{ width }}>
      <ScreenFrame screen={screen} width={width} mode={mode} />
      {circles.map((c) => (
        <div
          key={c.key}
          className="jr-circle"
          style={{ left: `calc(${c.x * 100}% - 4px)`, top: `calc(${c.y * 100}% - 3px)`, width: `calc(${c.w * 100}% + 8px)`, height: `calc(${c.h * 100}% + 6px)` }}
          data-circle={c.key}
        >
          {tags && <span className={`jr-circle__tag${c.y > 0.8 ? " is-above" : ""}`}>{c.label}</span>}
        </div>
      ))}
    </div>
  );
}
