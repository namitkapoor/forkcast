// Dev page: render recorded screens from public/data/run.json.
// /gallery.html            → every screen, grouped by node
// /gallery.html?ids=a,b,c  → just those screens, side by side at full size
import { StrictMode, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { loadRun, type RunFile } from "../data/run";
import { ScreenFrame } from "./ScreenFrame";

function Gallery() {
  const [run, setRun] = useState<RunFile | null>(null);
  useEffect(() => void loadRun().then(setRun), []);
  if (!run) return <p style={{ color: "#aaa", padding: 24 }}>Loading run.json…</p>;

  const ids = new URLSearchParams(location.search).get("ids")?.split(",").filter(Boolean);
  const screens = ids ? ids.map((id) => run.screens[id]).filter(Boolean) : Object.values(run.screens);
  const width = ids ? 360 : 200;

  return (
    <div style={{ display: "flex", flexWrap: "wrap", gap: 32, padding: 32, font: "12px system-ui", color: "#a8a8a8" }}>
      {screens.map((s) => (
        <figure key={s.id} data-screen={s.id} style={{ margin: 0, display: "grid", gap: 10 }}>
          <ScreenFrame screen={s} mode="live" width={width} />
          <figcaption>{s.nodeId} · {Object.values(s.context).join(" · ")}</figcaption>
        </figure>
      ))}
    </div>
  );
}

createRoot(document.getElementById("root")!).render(<StrictMode><Gallery /></StrictMode>);
