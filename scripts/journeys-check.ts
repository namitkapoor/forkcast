// Unit-style checks for src/journeys/{checks,aggregate,converge}, plus extraction coverage over real screens.
// Usage: npm run check:journeys
import { existsSync, readFileSync } from "node:fs";
import { A2UI_VERSION, BASIC_CATALOG_ID, type Screen } from "../src/a2ui/types.js";
import { bestFare, searchFares } from "../src/domains/flights/fares.js";
import { buildIntentGraph, matrix, summarize } from "../src/journeys/aggregate.js";
import { checkJourneyGoal, checkTurn, extractFacts } from "../src/journeys/checks.js";
import { choosePins } from "../src/journeys/converge.js";
import { PERSONAS, QUERIES } from "../src/journeys/fixtures.js";
import type { Intent, Journey, JourneysFile, Persona, Query, Turn } from "../src/journeys/types.js";

let failed = 0;
let passed = 0;
function assert(cond: unknown, name: string, detail?: unknown) {
  if (cond) passed++;
  else {
    failed++;
    console.error(`FAIL ${name}`, detail !== undefined ? JSON.stringify(detail, null, 1).slice(0, 800) : "");
  }
}

const family = PERSONAS.find((p) => p.id === "family")!;
const solo = PERSONAS.find((p) => p.id === "solo")!;
const hero = QUERIES.find((q) => q.id === "cheapest-morning")!;
const budget = QUERIES.find((q) => q.id === "under-budget")!;
const ctxOf = (p: Persona) => ({ origin: p.context.origin, pax: Number(p.context.pax), currency: p.context.currency });

const fares = searchFares(hero.constraints, ctxOf(family));
const best = bestFare(hero.constraints, ctxOf(family))!;
const [f0, f1] = fares;
const eur = (n: number) => `€${n.toLocaleString("en-GB")}`;
const dmy = (iso: string) => `${Number(iso.slice(8))} Mar`;

let screenSeq = 0;
function screen(components: Record<string, unknown>[], data?: Record<string, unknown>, variant = "fixture"): Screen {
  const id = `t-${++screenSeq}`;
  const v = A2UI_VERSION;
  return {
    id,
    nodeId: "results",
    context: family.context,
    variant,
    rationale: "test",
    model: "fixture",
    createdAt: "2026-11-21T00:00:00Z",
    annotations: [],
    messages: [
      { version: v, createSurface: { surfaceId: id, catalogId: BASIC_CATALOG_ID } },
      { version: v, updateComponents: { surfaceId: id, components } },
      ...(data ? [{ version: v, updateDataModel: { surfaceId: id, path: "/", value: data } }] : []),
    ],
  };
}

function turn(index: number, intent: Intent, s: Screen, opts: { fares?: typeof fares; carry?: Record<string, unknown>; persona?: Persona } = {}): Omit<Turn, "checks"> {
  return {
    index,
    userMessage: index === 0 ? hero.text : "ok",
    intent,
    ingredients: {
      context: (opts.persona ?? family).context,
      history: [],
      toolResults: opts.fares ? [{ tool: "searchFares", args: {}, fares: opts.fares }] : [],
      carry: opts.carry ?? {},
      promptVersion: "test",
    },
    screen: s,
    userAction: "",
  };
}
const withChecks = (t: Omit<Turn, "checks">, prev: Turn[] = [], query: Query = hero, persona: Persona = family): Turn => ({
  ...t,
  checks: checkTurn(t, { query, persona, prevTurns: prev }),
});

// A results screen bound through a list template (relative paths), a nested path, and literal text.
const resultsScreen = (extraText?: string) =>
  screen(
    [
      { id: "root", component: "Column", children: ["title", "list", ...(extraText ? ["extra"] : [])] },
      { id: "title", component: "Text", text: { path: "/header/title" } },
      { id: "list", component: "List", children: { componentId: "card", path: "/fares" } },
      { id: "card", component: "Card", child: "row" },
      { id: "row", component: "Row", children: ["info", "price", "pp"] },
      { id: "info", component: "Text", text: { path: "info" } },
      { id: "price", component: "Text", text: { path: "totalLabel" } },
      { id: "pp", component: "Text", text: { path: "ppLabel" } },
      ...(extraText ? [{ id: "extra", component: "Text", text: extraText }] : []),
    ],
    {
      header: { title: `Lisbon · ${dmy(f0.date)} · 4 travelers` },
      fares: [f0, f1].map((f) => ({
        info: `**${f.flightId.slice(0, 2)} ${f.flightId.slice(2)}** · ${f.depart} → ${f.arrive}`,
        totalLabel: `**${eur(f.total)}**`,
        ppLabel: `${f.pricePerPax} EUR / person`,
      })),
    },
  );

// --- extractFacts
{
  const s = resultsScreen();
  const facts = extractFacts(s);
  const kinds = (k: string) => facts.filter((f) => f.kind === k);
  assert(kinds("flight").some((f) => f.value === f0.flightId && f.componentId === "info"), "extract: flight from list template", facts);
  assert(kinds("price").some((f) => f.value === `${f0.total} EUR` && f.componentId === "price"), "extract: € total normalized", facts);
  assert(kinds("price").some((f) => f.value === `${f0.pricePerPax} EUR`), "extract: trailing EUR code", facts);
  assert(kinds("time").some((f) => f.value === f0.depart), "extract: time", facts);
  assert(kinds("date").some((f) => f.value === f0.date.slice(5) && f.componentId === "title"), "extract: date from nested path", facts);
  const misc = extractFacts(
    screen([{ id: "root", component: "Text", text: "USD 293 · £96 · €1,284 · 1,284 EUR · 23:40 +1 · Sat 14 Mar · Mar 7 · 2027-03-21 · U2 8123" }]),
  );
  const vals = misc.map((f) => `${f.kind}:${f.value}`);
  for (const want of ["price:293 USD", "price:96 GBP", "price:1284 EUR", "time:23:40", "date:03-14", "date:03-07", "date:03-21", "flight:U28123"])
    assert(vals.includes(want), `extract: ${want}`, vals);
  assert(!vals.some((v) => v.startsWith("flight:SD") || v.startsWith("flight:UR")), "extract: currency code is not a flight", vals);
}

// --- grounding
const t0 = withChecks(turn(0, "search", resultsScreen(), { fares }));
assert(t0.checks.every((c) => c.ok), "grounding: grounded screen passes", t0.checks);
assert(["grounding", "carry", "schema"].every((k) => t0.checks.some((c) => c.kind === k && c.ok)), "grounding: ok ticks per kind", t0.checks);

const invented = withChecks(turn(0, "search", resultsScreen("Also a 09:15 departure"), { fares }));
const bad = invented.checks.filter((c) => !c.ok);
assert(bad.length === 1 && bad[0].kind === "grounding" && bad[0].componentId === "extra" && bad[0].value === "09:15", "grounding: invented 09:15 caught on the right component", bad);
assert(/09:15 is not in the tool results or carried fare/.test(bad[0]?.message ?? ""), "grounding: message wording", bad[0]);

const fakePrice = withChecks(turn(0, "search", resultsScreen("From €999 total"), { fares }));
assert(fakePrice.checks.some((c) => !c.ok && c.kind === "grounding" && c.value === "€999"), "grounding: invented price caught", fakePrice.checks);

const echo = withChecks(turn(0, "search", resultsScreen("Departing before 12:00"), { fares }));
assert(echo.checks.every((c) => c.ok), "grounding: echoing the query window is fine", echo.checks);

// --- schema
const empty = withChecks(turn(0, "search", screen([]), { fares }));
assert(empty.checks.some((c) => c.kind === "schema" && !c.ok), "schema: no components fails");
const errScreen = withChecks(turn(0, "search", screen([{ id: "root", component: "Text", text: "Oops" }], undefined, "error"), { fares }));
assert(errScreen.checks.some((c) => c.kind === "schema" && !c.ok), "schema: error state fails");

// --- carry
const carry = { flightId: f0.flightId, total: f0.total, currency: "EUR", pax: 4 };
const pay = (text: string) => screen([{ id: "root", component: "Column", children: ["summary"] }, { id: "summary", component: "Text", text }]);
const t1 = withChecks(turn(1, "select", pay(`${f0.flightId} · ${f0.depart} · ${eur(f0.total)}`), { carry }), [t0]);
assert(t1.checks.every((c) => c.ok), "carry: consistent pay screen passes", t1.checks);
const wrongTotal = withChecks(turn(2, "pay", pay(`${f0.flightId} · ${f0.depart} · ${eur(f1.total)}`), { carry }), [t0, t1]);
assert(wrongTotal.checks.some((c) => c.kind === "carry" && !c.ok && c.componentId === "summary"), "carry: different total fails", wrongTotal.checks);
const wrongFlight = withChecks(turn(2, "pay", pay(`${f1.flightId} · ${eur(f0.total)}`), { carry }), [t0, t1]);
assert(wrongFlight.checks.some((c) => c.kind === "carry" && !c.ok && c.value?.replace(" ", "") === f1.flightId), "carry: different flight fails", wrongFlight.checks);
const wrongTime = withChecks(turn(2, "pay", pay(`${f0.flightId} departs ${f1.depart === f0.depart ? "05:55" : f1.depart}`), { carry }), [t0, t1]);
assert(wrongTime.checks.some((c) => c.kind === "carry" && !c.ok), "carry: different depart time fails", wrongTime.checks);

// --- goal oracle
const journey = (turns: Turn[], outcome: Journey["outcome"], personaId = "family", queryId = hero.id): Journey => ({
  id: `${queryId}:${personaId}:0`,
  queryId,
  personaId,
  run: 0,
  turns,
  outcome,
  goalMet: false,
});
{
  assert(f0.flightId === best.flightId, "fixture: first fare is the oracle");
  const hit = checkJourneyGoal(journey([t0, t1, withChecks(turn(2, "confirm", pay(`Booked ${f0.flightId}`), { carry }), [t0, t1])], "booked"), hero, family);
  assert(hit.goalMet && hit.result.ok, "goal: hit", hit);
  // Miss: only the second fare was ever shown.
  const onlySecond = screen(
    [{ id: "root", component: "Column", children: ["a"] }, { id: "a", component: "Text", text: `${f1.flightId} ${f1.depart} ${eur(f1.total)}` }],
  );
  const miss = checkJourneyGoal(journey([withChecks(turn(0, "search", onlySecond, { fares: [f1] }))], "abandoned"), hero, family);
  assert(!miss.goalMet && !miss.result.ok && miss.result.value === best.flightId, "goal: miss", miss);
  // Booked a different total than the tool says.
  const badBook = { ...carry, total: f0.total + 40 };
  const drift = checkJourneyGoal(journey([t0, withChecks(turn(1, "select", pay(f0.flightId), { carry }), [t0]), withChecks(turn(2, "pay", pay(f0.flightId), { carry: badBook }), [t0])], "booked"), hero, family);
  assert(!drift.goalMet, "goal: booked total drift fails", drift);
  // Empty: solo + under-budget has no fares.
  assert(searchFares(budget.constraints, ctxOf(solo)).length === 0, "fixture: solo under-budget has no fares");
  const none = screen([{ id: "root", component: "Text", text: "Sorry — no flights to Lisbon under $100 in March." }]);
  const emptyOk = checkJourneyGoal(journey([withChecks(turn(0, "search", none, { persona: solo }), [], budget, solo)], "abandoned", "solo", budget.id), budget, solo);
  assert(emptyOk.goalMet, "goal: empty case, said none", emptyOk);
  const fabricated = screen([{ id: "root", component: "Text", text: "UA 1234 · 07:10 · $95" }]);
  const emptyBad = checkJourneyGoal(journey([withChecks(turn(0, "search", fabricated, { persona: solo }), [], budget, solo)], "abandoned", "solo", budget.id), budget, solo);
  assert(!emptyBad.goalMet && emptyBad.result.componentId === "root", "goal: empty case, fabricated fare", emptyBad);
  const groundedNone = withChecks(turn(0, "search", none, { persona: solo }), [], budget, solo);
  assert(groundedNone.checks.every((c) => c.ok), "grounding: '$100' echoed from the query is fine", groundedNone.checks);
}

// --- converge + aggregate
{
  const good = journey([t0, t1], "booked");
  good.goalMet = true;
  const pins1 = choosePins([good]);
  assert(pins1.length === 0, "pins: one turn per key is not enough evidence", pins1);
  const good2 = { ...good, id: "x:family:1", run: 1, turns: [withChecks(turn(0, "search", resultsScreen("4 travelers"), { fares })), t1] };
  const pins2 = choosePins([good, good2]);
  assert(pins2.some((p) => p.key === "search|family" && p.evidence === 2 && p.score === 1), "pins: minEvidence met", pins2);
  assert(choosePins([good, good2], { minEvidence: 3 }).length === 0, "pins: custom minEvidence respected");
  const searchPin = pins2.find((p) => p.key === "search|family");
  assert(searchPin?.screenId === t0.screen.id, "pins: tie-break by fewer components", searchPin);
  const q = { ...good, turns: [{ ...t0, intent: "question" as Intent }, { ...t0, intent: "question" as Intent }] };
  assert(choosePins([q]).length === 0, "pins: never pin question");
  const badJ = journey([invented as Turn, invented as Turn], "abandoned");
  assert(choosePins([badJ]).length === 0, "pins: low score not pinned");

  const s = summarize([good, badJ]);
  assert(s.journeys === 2 && s.passRate === 0.5 && s.failingChecks.grounding === 2, "summarize", s);
  const g = buildIntentGraph([good, badJ], PERSONAS);
  const startSearch = g.edges.find((e) => e.from === "start" && e.to === "search");
  assert(startSearch?.count === 2 && startSearch.failing === 1, "graph: start edge counts", g.edges);
  assert(g.edges.some((e) => e.from === "search" && e.to === "select") && g.edges.some((e) => e.to === "end"), "graph: transitions + end", g.edges);
  const m = matrix([good, badJ], QUERIES, PERSONAS);
  const cell = m.find((r) => r.queryId === hero.id && r.personaId === "family");
  assert(m.length === 9 && cell?.runs === 2 && cell.booked === 1, "matrix", cell);
}

console.log(`\nasserts: ${passed} passed, ${failed} failed`);

// --- extraction coverage over real generated screens
{
  const run = JSON.parse(readFileSync("public/data/run.json", "utf8")) as { screens: Record<string, Screen> };
  const screens = Object.values(run.screens);
  const counts: Record<string, number> = { price: 0, time: 0, flight: 0, date: 0 };
  let withFacts = 0;
  for (const s of screens) {
    const facts = extractFacts(s);
    if (facts.length) withFacts++;
    for (const f of facts) counts[f.kind]++;
  }
  console.log(`run.json: ${screens.length} screens, ${withFacts} with facts; ` + Object.entries(counts).map(([k, v]) => `${k} ${v}`).join(", "));
  if (counts.price < 50 || counts.time < 50) {
    console.error("FAIL extraction coverage looks too low");
    failed++;
  }
}

// --- journeys.json, if the simulator has produced one (override with JOURNEYS=path)
const JOURNEYS = process.env.JOURNEYS ?? "public/data/journeys.json";
if (existsSync(JOURNEYS)) {
  const file = JSON.parse(readFileSync(JOURNEYS, "utf8")) as JourneysFile;
  const qById = new Map(file.queries.map((q) => [q.id, q]));
  const pById = new Map(file.personas.map((p) => [p.id, p]));
  const rechecked = file.journeys.map((j) => {
    const q = qById.get(j.queryId)!;
    const p = pById.get(j.personaId)!;
    const turns: Turn[] = [];
    for (const t of j.turns) turns.push({ ...t, checks: checkTurn(t, { query: q, persona: p, prevTurns: [...turns] }) });
    const next = { ...j, turns };
    return { ...next, goalMet: checkJourneyGoal(next, q, p).goalMet };
  });
  const s = summarize(rechecked);
  console.log(`journeys.json: ${s.journeys} journeys, pass ${(s.passRate * 100).toFixed(0)}%, goal ${(s.goalRate * 100).toFixed(0)}%, booked ${(s.bookedRate * 100).toFixed(0)}%, failing`, s.failingChecks);
  const fails = rechecked.flatMap((j) => j.turns.flatMap((t) => t.checks.filter((c) => !c.ok).map((c) => `${j.id}#${t.index} ${c.kind}: ${c.message}`)));
  for (const f of fails.slice(0, 12)) console.log(`  ${f}`);
  console.log(`pins: ${choosePins(rechecked).length}`);
} else {
  console.log("journeys.json: not present yet");
}

if (failed) process.exit(1);
