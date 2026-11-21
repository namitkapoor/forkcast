// Validates the hand-written fixtures and checks that broken streams are rejected.
// Run: npx tsx scripts/validate-fixtures.ts
import { fixtureScreens } from "../src/data/fixtures";
import { validateMessages, catalogPromptSummary } from "../src/a2ui/validate";
import { BASIC_CATALOG_ID } from "../src/a2ui/types";

let failed = 0;
const check = (label: string, messages: unknown[], expectOk: boolean) => {
  const r = validateMessages(messages);
  const pass = r.ok === expectOk;
  if (!pass) failed++;
  console.log(`${pass ? "PASS" : "FAIL"}  ${label}  (expected ${expectOk ? "valid" : "invalid"}, got ${r.ok ? "valid" : "invalid"})`);
  for (const e of r.errors) console.log(`        - ${e}`);
};

for (const s of fixtureScreens) check(`fixture ${s.id}`, s.messages, true);

// Broken 1: misspelled component, Text with a numeric text, and a dangling child reference.
check("broken: unknown component + bad prop + dangling ref", [
  { version: "v0.9", createSurface: { surfaceId: "b1", catalogId: BASIC_CATALOG_ID } },
  {
    version: "v0.9",
    updateComponents: {
      surfaceId: "b1",
      components: [
        { id: "root", component: "Column", children: ["t", "ghost"] },
        { id: "t", component: "Txt", text: 42 },
      ],
    },
  },
], false);

// Broken 2: v0.8-style action shape, no createSurface, no root.
check("broken: no createSurface, no root, v0.8 action", [
  {
    version: "v0.9",
    updateComponents: {
      surfaceId: "b2",
      components: [
        { id: "btn", component: "Button", child: "lbl", action: { name: "pay" } },
        { id: "lbl", component: "Text", text: "Pay" },
      ],
    },
  },
], false);

const summary = catalogPromptSummary();
console.log(`\ncatalogPromptSummary(): ${summary.length} chars, ${summary.split("\n").length} lines`);
if (!summary.includes("Button") || summary.length < 500) {
  failed++;
  console.log("FAIL  summary looks wrong");
}
if (process.argv.includes("--print")) console.log(summary);

console.log(failed ? `\n${failed} check(s) failed` : "\nall checks passed");
process.exit(failed ? 1 : 0);
