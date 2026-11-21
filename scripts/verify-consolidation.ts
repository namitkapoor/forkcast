import assert from "node:assert/strict";
import {
  appendAnnotationRevision,
  createVersionedAnnotation,
  formatVersionedRef,
  getRevisionByNumber,
  normalizeAnnotationMap,
} from "../src/ui/annotations";
import {
  buildReferenceCatalog,
  detectCaretMention,
  filterReferenceCatalog,
  normalizeSpokenMentions,
  resolvePromptReferences,
  stripReferenceTokenFromText,
} from "../src/ui/references";
import { flightGraph } from "../src/domains/flights/graph";
import { fixtureScreens } from "../src/data/fixtures";
import { buildThinkingConfig, models, taskConfigs } from "../api/_lib/models.js";

let passed = 0;
function check(name: string, fn: () => void) {
  fn();
  passed++;
  console.log(`PASS  ${name}`);
}

check("legacy annotations normalize with collision-free Pin/Mask handles", () => {
  const map = normalizeAnnotationMap({
    "s-1": [
      { id: "a1", x: 0.2, y: 0.3, text: "Price looks small", kind: "note", createdAt: "2026-01-01T00:00:00Z" },
      { id: "a2", x: 0.5, y: 0.6, text: "Wrong currency", kind: "bug", mentionTag: "Pin-5", createdAt: "2026-01-01T00:01:00Z" },
    ],
  });
  assert.equal(map["s-1"][0].mentionTag, "Pin-6");
  assert.equal(map["s-1"][1].mentionTag, "Pin-5");
  assert.equal(map["s-1"][0].includeInAiFeedback, true);
  assert.equal(map["s-1"][0].revisions?.length, 1);
});

check("monotonic @Pin-N:vK & @Mask-N:vK revisions and lookup", () => {
  const map: Record<string, ReturnType<typeof createVersionedAnnotation>[]> = {};
  const p1 = createVersionedAnnotation(map, { x: 0.4, y: 0.4, text: "Make CTA primary", kind: "rule", componentId: "pay_btn" });
  map["fx-payment-1"] = [p1];
  assert.equal(formatVersionedRef(p1), "@Pin-1:v1");

  const p1v2 = appendAnnotationRevision(p1, { text: "Move CTA above total and keep primary" });
  map["fx-payment-1"] = [p1v2];
  assert.equal(formatVersionedRef(p1v2), "@Pin-1:v2");
  assert.equal(getRevisionByNumber(p1v2, 1).text, "Make CTA primary");
  assert.equal(getRevisionByNumber(p1v2, 2).text, "Move CTA above total and keep primary");

  const m1 = createVersionedAnnotation(map, {
    x: 0.5,
    y: 0.5,
    text: "Group fare breakdown",
    kind: "mask",
    intersectingIds: ["total_row"],
  });
  assert.equal(formatVersionedRef(m1), "@Mask-1:v1");
});

check("@mention catalog, fuzzy filter, caret detection, and detach resolution", () => {
  const screensById = new Map(fixtureScreens.map((s) => [s.id, s]));
  const firstScreen = fixtureScreens[0];
  const p1 = createVersionedAnnotation({}, { x: 0.2, y: 0.2, text: "Highlight baggage fee", kind: "bug", componentId: "bag" });
  const p1v2 = appendAnnotationRevision(p1, { text: "Bold baggage fee in header" });
  const p2 = createVersionedAnnotation({ [firstScreen.id]: [p1v2] }, {
    x: 0.6,
    y: 0.7,
    text: "Private QA note",
    kind: "note",
    includeInAiFeedback: false,
  });

  const annotations = { [firstScreen.id]: [p1v2, p2] };
  const catalog = buildReferenceCatalog(flightGraph, screensById, annotations);
  assert.ok(catalog.some((c) => c.token === "@Pin-1:v2"));
  assert.ok(catalog.some((c) => c.token === "@Pin-1:v1"));
  assert.ok(catalog.some((c) => c.token === "@payment"));

  const fuzzy = filterReferenceCatalog(catalog, "pin1v1");
  assert.equal(fuzzy[0]?.token, "@Pin-1:v1");

  const caret = detectCaretMention("Please apply @Pin-1:v", 21);
  assert.deepEqual(caret, { start: 13, end: 21, query: "Pin-1:v" });

  // Auto-includes Pin-1:v2 (AI on), excludes Pin-2 (AI off)
  const autoRes = resolvePromptReferences({
    prompt: "Refine this screen",
    graph: flightGraph,
    screensById,
    annotationsByScreen: annotations,
    activeScreenId: firstScreen.id,
    shownScreenId: firstScreen.id,
  });
  assert.equal(autoRes.includedAnnotations.length, 1);
  assert.equal(autoRes.includedAnnotations[0].token, "@Pin-1:v2");

  // Explicit @Pin-1:v1 overrides latest and @Pin-2 explicit mention overrides includeInAiFeedback=false
  const explicitRes = resolvePromptReferences({
    prompt: "Use @Pin-1:v1 and @Pin-2:v1 on @payment",
    graph: flightGraph,
    screensById,
    annotationsByScreen: annotations,
    activeScreenId: firstScreen.id,
    shownScreenId: firstScreen.id,
  });
  assert.equal(explicitRes.includedAnnotations.length, 2);
  assert.equal(explicitRes.includedAnnotations[0].revision.text, "Highlight baggage fee");
  assert.ok(explicitRes.explicitNodes.some((n) => n.id === "payment"));

  // Detaching Pin-1 removes it from auto-included context and strips token from draft
  const stripped = stripReferenceTokenFromText("Fix @Pin-1:v2 quickly", "Pin-1");
  assert.equal(stripped, "Fix quickly");
  const detachedRes = resolvePromptReferences({
    prompt: stripped,
    graph: flightGraph,
    screensById,
    annotationsByScreen: annotations,
    activeScreenId: firstScreen.id,
    shownScreenId: firstScreen.id,
    detachedKeys: new Set([`ann:${p1v2.id}`]),
  });
  assert.equal(detachedRes.includedAnnotations.length, 0);
});

check("spoken mention normalization for Gemini Voice AI", () => {
  const norm = normalizeSpokenMentions("Please resolve at pin two version one and at mask one at payment", flightGraph);
  assert.equal(norm, "Please resolve @Pin-2:v1 and @Mask-1 @payment");
});

check("Gemini 4 model & thinkingLevel clamping across carbon/argon vs hydrogen/neon", () => {
  const clamped = buildThinkingConfig("gemini-4-carbon", "XHIGH", false);
  assert.equal(String(clamped?.thinkingLevel), "high");
  const unclamped = buildThinkingConfig("gemini-4-neon", "XHIGH", false);
  assert.equal(String(unclamped?.thinkingLevel), "xhigh");
  const nonG4 = buildThinkingConfig("gemini-3.5-transcribe", "LOW", false);
  assert.equal(nonG4, undefined);
  assert.ok(models.generator.length > 0);
  assert.ok(taskConfigs.editCore.model.length > 0);
});

console.log(`\nall ${passed} consolidation checks passed`);
