// Dev-only harness for ScreenFrame: open /harness.html under `vite`.
import { StrictMode, useState } from "react";
import { createRoot } from "react-dom/client";
import { fixtureScreens } from "../data/fixtures";
import { ScreenFrame } from "./ScreenFrame";
import { A2UI_VERSION, BASIC_CATALOG_ID, type Annotation, type Screen } from "./types";

const broken: Screen = {
  ...fixtureScreens[0],
  id: "fx-broken",
  variant: "broken-on-purpose",
  messages: [
    { version: A2UI_VERSION, createSurface: { surfaceId: "fx-broken", catalogId: BASIC_CATALOG_ID } },
    { version: A2UI_VERSION, updateComponents: { surfaceId: "fx-broken", components: [{ id: "root", component: "Carousel", children: [] }] } },
  ],
};

function Harness() {
  const [annotate, setAnnotate] = useState(false);
  const [log, setLog] = useState<string[]>([]);
  const [screens, setScreens] = useState<Screen[]>(fixtureScreens);
  const push = (line: string) => setLog((l) => [`${new Date().toLocaleTimeString()}  ${line}`, ...l].slice(0, 30));

  const addPin = (screenId: string, componentId: string, rel: { x: number; y: number }) => {
    push(`component ${screenId} → ${componentId} @ (${rel.x.toFixed(2)}, ${rel.y.toFixed(2)})`);
    setScreens((all) =>
      all.map((s) => {
        if (s.id !== screenId) return s;
        const a: Annotation = { id: `a${Date.now()}`, componentId, x: rel.x, y: rel.y, text: componentId, kind: "note", createdAt: new Date().toISOString() };
        return { ...s, annotations: [...s.annotations, a] };
      }),
    );
  };

  return (
    <div style={{ minHeight: "100vh", background: "#0f1013", color: "#d8dae0", font: "13px/1.4 system-ui, sans-serif", padding: 24, boxSizing: "border-box" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 16, marginBottom: 20 }}>
        <strong style={{ fontSize: 15 }}>ScreenFrame harness</strong>
        <label style={{ display: "flex", gap: 6, alignItems: "center", cursor: "pointer" }}>
          <input data-testid="annotate" type="checkbox" checked={annotate} onChange={(e) => setAnnotate(e.target.checked)} />
          annotate
        </label>
      </div>

      <h3 style={h3}>thumb · 160px</h3>
      <div style={{ display: "flex", gap: 24, marginBottom: 32, flexWrap: "wrap" }}>
        {[...screens, broken].map((s) => (
          <div key={s.id} style={{ display: "grid", gap: 8 }}>
            <ScreenFrame screen={s} mode="thumb" width={160} />
            <span style={{ color: "#8b8f98", fontSize: 11 }}>{s.variant}</span>
          </div>
        ))}
      </div>

      <h3 style={h3}>live · 360px</h3>
      <div style={{ display: "flex", gap: 32, alignItems: "flex-start", flexWrap: "wrap" }}>
        {screens.map((s) => (
          <div key={s.id} data-testid={`live-${s.id}`}>
            <ScreenFrame
              screen={s}
              mode="live"
              width={360}
              annotate={annotate}
              onAction={(a) => push(`action ${s.id} → ${a.name} from ${a.sourceComponentId ?? "?"} ${JSON.stringify(a.context ?? {})}`)}
              onComponentClick={(id, rel) => addPin(s.id, id, rel)}
            />
          </div>
        ))}
        <div style={{ flex: "1 1 260px", minWidth: 260 }}>
          <h3 style={h3}>log</h3>
          <pre data-testid="log" style={{ margin: 0, whiteSpace: "pre-wrap", font: "12px/1.5 ui-monospace, Menlo, monospace", color: "#b9f0c8" }}>
            {log.length ? log.join("\n") : "—"}
          </pre>
        </div>
      </div>
    </div>
  );
}

const h3 = { margin: "0 0 12px", fontSize: 11, fontWeight: 600, letterSpacing: "0.06em", textTransform: "uppercase" as const, color: "#8b8f98" };

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <Harness />
  </StrictMode>,
);
