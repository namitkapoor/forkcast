// Unit-style checks for src/journeys/{checks,aggregate,converge}, plus extraction coverage over real screens.
// Usage: npm run check:journeys
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { A2UI_VERSION, BASIC_CATALOG_ID, type Screen } from "../src/a2ui/types.js";
import { bestFare, searchFares } from "../src/domains/flights/fares.js";
import { buildIntentGraph, matrix, summarize } from "../src/journeys/aggregate.js";
import { checkJourneyGoal, checkTurn, extractFacts } from "../src/journeys/checks.js";
import { choosePins } from "../src/journeys/converge.js";
import { checkPersonaRules, fareUnits } from "../src/journeys/personaContracts.js";
import { judgeOne, newStats, rejudgeJourneys, type JudgeCall } from "./judge-core.js";
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
  assert(startSearch?.count === 2 && startSearch.failing === 0, "graph: start edge counts (tree counts persona misfits only; this fixture fails grounding)", g.edges);
  assert(g.edges.some((e) => e.from === "search" && e.to === "select") && g.edges.some((e) => e.to === "end"), "graph: transitions + end", g.edges);
  const m = matrix([good, badJ], QUERIES, PERSONAS);
  const cell = m.find((r) => r.queryId === hero.id && r.personaId === "family");
  assert(m.length === 9 && cell?.runs === 2 && cell.booked === 1, "matrix", cell);
}

// --- persona contracts: rule pass/fail per persona
{
  const budgetCouple = PERSONAS.find((p) => p.id === "budget-couple")!;
  type Row = { flight?: string; times?: string; stops?: string; price: string };
  // One Card per fare with literal Texts; ids: f{i}_id, f{i}_times, f{i}_price.
  const fareList = (rows: Row[], header = "Lisbon · March") =>
    screen([
      { id: "root", component: "Column", children: ["hdr", ...rows.map((_, i) => `f${i}`)] },
      { id: "hdr", component: "Text", text: header },
      ...rows.flatMap((r, i) => [
        { id: `f${i}`, component: "Card", child: `f${i}_col` },
        { id: `f${i}_col`, component: "Column", children: [`f${i}_id`, `f${i}_times`, `f${i}_price`] },
        { id: `f${i}_id`, component: "Text", text: r.flight ?? "" },
        { id: `f${i}_times`, component: "Text", text: [r.times, r.stops].filter(Boolean).join(" · ") },
        { id: `f${i}_price`, component: "Text", text: r.price },
      ]),
    ]);
  const rules = (p: Persona, intent: Intent, s: Screen, fs: typeof fares, carry: Record<string, unknown> = {}) =>
    checkPersonaRules({ ...turn(0, intent, s, { fares: fs, persona: p, carry }), userMessage: "Cheapest morning flight to Lisbon" }, p);
  const one = (rs: ReturnType<typeof rules>, id: string) => rs.find((r) => r.contractId === id);

  // Family: totals for 4, no very-early first.
  const famF = searchFares(hero.constraints, ctxOf(family));
  const ib = famF.find((f) => f.flightId === "IB4610")!;
  const u2 = famF.find((f) => f.flightId === "U25369")!;
  const famOk = rules(family, "search", fareList([
    { flight: ib.flightId, times: `${ib.depart} – ${ib.arrive}`, price: `€${ib.total} total` },
    { flight: u2.flightId, times: `${u2.depart} – ${u2.arrive}`, price: `€${u2.total} total` },
  ]), famF);
  assert(one(famOk, "family-total-for-4")?.ok && one(famOk, "family-no-early-first")?.ok, "persona/family: totals + 07:10 first pass", famOk);
  assert(!famOk.some((r) => r.contractId === "family-seats-together"), "persona: judge contracts are not run offline", famOk);
  const famBad = rules(family, "search", fareList([
    { flight: u2.flightId, times: `${u2.depart} – ${u2.arrive}`, price: `€${u2.pricePerPax}` },
    { flight: ib.flightId, times: `${ib.depart} – ${ib.arrive}`, price: `€${ib.pricePerPax} / person` },
  ]), famF);
  const tot = one(famBad, "family-total-for-4");
  assert(tot && !tot.ok && tot.componentId === "f0_price" && tot.kind === "persona", "persona/family: per-person price fails on its component", tot);
  const early = one(famBad, "family-no-early-first");
  assert(early && !early.ok && early.componentId === "f0_id" && early.value === "06:05", "persona/family: 06:05 ranked first fails", early);
  const famMention = rules(family, "select", fareList([{ flight: ib.flightId, times: `${ib.depart} – ${ib.arrive}`, price: `€${ib.pricePerPax} pp · 4 travelers` }]), famF);
  assert(one(famMention, "family-total-for-4")?.ok, "persona/family: '4 travelers' next to the price passes", famMention);
  assert(rules(family, "confirm", fareList([{ flight: ib.flightId, price: `€${ib.pricePerPax}` }]), famF).length === 0, "persona: contracts only run on their intents");

  // Solo (Maya): stops labeled, arrival shown, nonstop above similar 1-stop.
  const soloF = searchFares(hero.constraints, ctxOf(solo));
  const [ua, , ib7] = soloF; // UA2681 1 stop $293, IB7362 1 stop $366
  const ba = soloF.find((f) => f.stops === 0 && f.pricePerPax <= ib7.pricePerPax * 1.15)!; // BA8578 nonstop $374
  const soloOk = rules(solo, "search", fareList([
    { flight: ba.flightId, times: `${ba.depart} – ${ba.arrive}`, stops: "Nonstop", price: `$${ba.total}` },
    { flight: ua.flightId, times: `${ua.depart} – ${ua.arrive}`, stops: "1 stop", price: `$${ua.total}` },
  ]), soloF);
  assert(["solo-stops-labeled", "solo-arrival-shown", "solo-nonstop-first"].every((id) => one(soloOk, id)?.ok), "persona/solo: labeled, arrivals, nonstop first pass", soloOk);
  const soloBad = rules(solo, "search", fareList([
    { flight: ib7.flightId, times: `${ib7.depart} – ${ib7.arrive}`, stops: "1 stop", price: `$${ib7.total}` },
    { flight: ba.flightId, times: `departs ${ba.depart}`, price: `$${ba.total}` },
  ]), soloF);
  const lab = one(soloBad, "solo-stops-labeled");
  assert(lab && !lab.ok && lab.componentId === "f1_id", "persona/solo: unlabeled stops fail on that fare", lab);
  const arr = one(soloBad, "solo-arrival-shown");
  assert(arr && !arr.ok && arr.componentId === "f1_id", "persona/solo: missing arrival fails", arr);
  const ns = one(soloBad, "solo-nonstop-first");
  assert(ns && !ns.ok && ns.componentId === "f0_id" && /ranks above nonstop/.test(ns.message), "persona/solo: 1-stop above nonstop within 15% fails", ns);
  const soloSummary = rules(solo, "search", screen([
    { id: "root", component: "Column", children: ["card", "sum"] },
    { id: "card", component: "Card", child: "c" },
    { id: "c", component: "Text", text: `${ua.flightId} · ${ua.depart} – ${ua.arrive} · 1 stop · $${ua.total}` },
    { id: "sum", component: "Text", text: `Best match: ${ua.flightId} ($${ua.total})` },
  ]), soloF);
  assert(one(soloSummary, "solo-stops-labeled")?.ok, "persona/solo: a summary line re-mentioning a full card is fine", soloSummary);
  const units = fareUnits(resultsScreen(), "EUR");
  assert(units.length === 2 && units[0].key.startsWith("card@/fares/0"), "persona: fare units follow list templates", units.map((u) => u.key));

  // Budget couple: true total, budget echo is not a fare price.
  const bF = searchFares(hero.constraints, ctxOf(budgetCouple));
  const fr = bF.find((f) => f.flightId === "FR9164")!;
  const bOk = rules(budgetCouple, "select", fareList([{ flight: fr.flightId, times: `${fr.depart} – ${fr.arrive}`, price: `£${fr.pricePerPax} each · £${fr.total} total` }], "Under £100 per person"), bF);
  assert(one(bOk, "budget-true-total")?.ok, "persona/budget: total shown passes", bOk);
  const bBad = rules(budgetCouple, "search", fareList([{ flight: fr.flightId, times: `${fr.depart} – ${fr.arrive}`, price: `£${fr.pricePerPax} pp · 2 travelers` }]), bF);
  const bt = one(bBad, "budget-true-total");
  assert(bt && !bt.ok && bt.componentId === "f0_price", "persona/budget: per-person only fails (pax mention isn't a total)", bt);

  // checkTurn wires rule contracts in for the persona's intents.
  const wired = withChecks(turn(0, "search", resultsScreen(), { fares }));
  assert(wired.checks.some((c) => c.kind === "persona" && c.contractId === "family-total-for-4" && c.ok), "persona: checkTurn includes rule contracts", wired.checks);
  const s = summarize([journey([{ ...wired, checks: [...wired.checks, { kind: "persona", ok: false, message: "x", contractId: "family-seats-together" }] }], "booked")]);
  assert(s.passRate === 1 && s.failingChecks.persona === 1 && s.servesRate !== undefined && s.servesRate < 1, "persona: summary tracks serves separately from pass", s);
}

// --- persona contracts: judge path with a mocked model and the hash cache (no network)
{
  const dir = mkdtempSync(path.join(tmpdir(), "judge-"));
  try {
    let calls = 0;
    const mock: JudgeCall = async (system, prompt) => {
      calls++;
      assert(/Seat-together status is shown/.test(prompt) && / \(Text\): /.test(prompt) && /componentId/.test(system), "judge: prompt carries contract + digest", prompt.slice(0, 400));
      return { data: { pass: false, reason: "No seat-together status anywhere.", componentId: "title" }, info: { model: "mock", ms: 5, inputTokens: 100, outputTokens: 20 } };
    };
    const seats = family.contracts!.find((c) => c.id === "family-seats-together")!;
    const t = turn(0, "search", resultsScreen(), { fares });
    const stats = newStats();
    const r1 = await judgeOne(t, family, seats, { call: mock, cacheDir: dir, stats });
    assert(r1 && !r1.ok && r1.kind === "persona" && r1.source === "judge" && r1.componentId === "title" && r1.message === "[judge] Seat-together status is shown: No seat-together status anywhere.", "judge: verdict becomes a persona check", r1);
    assert(calls === 1 && readdirSync(dir).length === 1 && stats.calls === 1, "judge: one call, one cache file", { calls, stats });
    const never: JudgeCall = async () => {
      throw new Error("network used despite cache");
    };
    const r2 = await judgeOne(t, family, seats, { call: never, cacheDir: dir, stats });
    assert(JSON.stringify(r2) === JSON.stringify(r1) && stats.cached === 1, "judge: second run served from cache", { r2, stats });
    const r3 = await judgeOne({ ...t, userMessage: "different" }, family, seats, { call: never, cacheDir: dir, stats, network: false });
    assert(r3 === null, "judge: cache miss with network off is skipped", r3);
    const bogus: JudgeCall = async () => ({ data: { pass: false, reason: "x", componentId: "nope" }, info: { model: "mock", ms: 1 } });
    const r4 = await judgeOne({ ...t, userMessage: "other" }, family, seats, { call: bogus, cacheDir: dir });
    assert(r4 && r4.componentId === undefined, "judge: unknown componentId dropped", r4);

    // rejudgeJourneys is idempotent: persona checks are replaced, not appended.
    const j = journey([withChecks(turn(0, "search", resultsScreen(), { fares })), t1], "booked");
    const once = await rejudgeJourneys([j], QUERIES, PERSONAS, { call: mock, cacheDir: dir });
    const twice = await rejudgeJourneys(once, QUERIES, PERSONAS, { call: never, cacheDir: dir });
    const count = (js: Journey[]) => js[0].turns.flatMap((x) => x.checks.filter((c) => c.kind === "persona")).length;
    assert(count(once) > 0 && count(once) === count(twice), "judge: rejudge is idempotent", { a: count(once), b: count(twice) });
    assert(twice[0].turns[0].checks.some((c) => c.source === "judge") && twice[0].turns[1].checks.filter((c) => c.kind === "goal").length === 1, "judge: judge checks + one goal check", twice[0].turns.map((x) => x.checks.map((c) => c.kind)));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
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
