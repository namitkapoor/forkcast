import type { Intent } from "../../journeys/types";
import type { HeroMode } from "../journeys/data";

export interface Drill {
  mode: HeroMode;
  personaId: string;
  intent: Intent;
}

/** `#flow/generic/family/search` ⇄ Drill. */
export const drillHash = (d: Drill) =>
  `#flow/${d.mode === "naive" ? "generic" : "persona"}/${encodeURIComponent(d.personaId)}/${encodeURIComponent(d.intent)}`;

export function drillFromHash(h: string): Drill | null {
  const m = /^#flow\/(generic|persona)\/([^/]+)\/([^/]+)/.exec(h);
  return m ? { mode: m[1] === "generic" ? "naive" : "checked", personaId: decodeURIComponent(m[2]), intent: decodeURIComponent(m[3]) as Intent } : null;
}
