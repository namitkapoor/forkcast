// Convergence: score variants per (intent, persona) and pin the best where there is enough evidence.
import { componentCount } from "./checks.js";
import { pinKey, type Intent, type Journey, type Pin, type Turn } from "./types.js";

const NEVER_PIN: Intent[] = ["question", "other"];

const personaFails = (t: Turn) => (t.checks ?? []).filter((c) => !c.ok && c.kind === "persona").length;

/**
 * 0.6 if every correctness check passes, +0.4 if the journey booked or met its goal, −0.1 per failing check. Clamped to [0, 1].
 * Persona contracts don't change the score; they break ties between equally correct variants in choosePins.
 */
export function scoreTurn(turn: Turn, journey: Journey): number {
  const failures = (turn.checks ?? []).filter((c) => !c.ok && c.kind !== "persona").length;
  const score = (failures === 0 ? 0.6 : 0) + (journey.outcome === "booked" || journey.goalMet ? 0.4 : 0) - 0.1 * failures;
  return Math.max(0, Math.min(1, Math.round(score * 1000) / 1000));
}

export function choosePins(journeys: Journey[], opts: { minEvidence?: number } = {}): Pin[] {
  const minEvidence = opts.minEvidence ?? 2;
  const groups = new Map<string, { intent: Intent; personaId: string; turns: { turn: Turn; score: number; size: number; persona: number }[] }>();
  for (const j of journeys) {
    for (const t of j.turns) {
      if (NEVER_PIN.includes(t.intent) || !t.screen?.id) continue;
      const key = pinKey(t.intent, j.personaId);
      const g = groups.get(key) ?? { intent: t.intent, personaId: j.personaId, turns: [] };
      g.turns.push({ turn: t, score: scoreTurn(t, j), size: componentCount(t.screen), persona: personaFails(t) });
      groups.set(key, g);
    }
  }
  const pins: Pin[] = [];
  for (const [key, g] of groups) {
    if (g.turns.length < minEvidence) continue;
    const best = [...g.turns].sort((a, b) => b.score - a.score || a.persona - b.persona || a.size - b.size || a.turn.screen.id.localeCompare(b.turn.screen.id))[0];
    if (best.score < 0.6) continue;
    pins.push({ key, intent: g.intent, personaId: g.personaId, screenId: best.turn.screen.id, score: best.score, evidence: g.turns.length });
  }
  return pins.sort((a, b) => a.key.localeCompare(b.key));
}
