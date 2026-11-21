// Generates the persona portraits (fictional people) with Gemini image generation.
// Writes public/personas/{id}.png, square ~512px.
//
// Usage: npx tsx scripts/gen-personas.ts [--only family,solo] [--model gemini-3.1-flash-image]
import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { GoogleGenAI } from "@google/genai";
import { loadDotEnv } from "../api/_lib/env";

loadDotEnv(path.resolve(".env"));

const argv = process.argv.slice(2);
const flag = (f: string) => {
  const i = argv.indexOf(f);
  return i >= 0 ? argv[i + 1] : undefined;
};
const only = flag("--only")?.split(",");
const MODELS = flag("--model") ? [flag("--model")!] : ["gemini-3.1-flash-image", "gemini-2.5-flash-image"];

const STYLE =
  "Natural-light candid headshot photo, head and shoulders, plain soft neutral light-grey background, square framing, " +
  "photorealistic, looks like an ordinary everyday person (not a model, not a celebrity), relaxed genuine expression, " +
  "casual clothes, shallow depth of field. No text, no watermark, no logos, no frame.";

const PEOPLE: { id: string; who: string }[] = [
  { id: "family", who: "A Nigerian-British father in his late 30s, short hair, warm tired smile of a busy parent, wearing a simple knit sweater." },
  { id: "solo", who: "A Chinese-American woman in her early 30s, a management consultant, shoulder-length dark hair, wearing a plain navy blazer over a t-shirt, confident and friendly." },
  { id: "budget-couple", who: "A young couple in their mid-20s, cheek to cheek, both smiling: a white British man with a short beard and a British-Indian woman with long dark hair, hoodies and casual jackets." },
];

const key = process.env.GEMINI_API_KEY?.trim();
if (!key) {
  console.error("GEMINI_API_KEY missing (expected in .env)");
  process.exit(1);
}
const ai = new GoogleGenAI({ apiKey: key });
const outDir = path.resolve("public/personas");
mkdirSync(outDir, { recursive: true });

async function generate(prompt: string): Promise<{ data: Buffer; model: string }> {
  let lastErr: unknown;
  for (const model of MODELS) {
    try {
      const res = await ai.models.generateContent({
        model,
        contents: prompt,
        config: { responseModalities: ["IMAGE", "TEXT"], imageConfig: { aspectRatio: "1:1" } } as never,
      });
      const part = res.candidates?.[0]?.content?.parts?.find((p) => p.inlineData?.data);
      if (part?.inlineData?.data) return { data: Buffer.from(part.inlineData.data, "base64"), model };
      lastErr = new Error(`${model}: no image in response`);
    } catch (e) {
      lastErr = e;
      console.warn(`  ${model} failed: ${e instanceof Error ? e.message.slice(0, 200) : String(e)}`);
    }
  }
  throw lastErr;
}

let failures = 0;
for (const p of PEOPLE) {
  if (only && !only.includes(p.id)) continue;
  try {
    const { data, model } = await generate(`${p.who} ${STYLE}`);
    const file = path.join(outDir, `${p.id}.png`);
    writeFileSync(file, data);
    try {
      // macOS: normalise to a 512px PNG.
      execFileSync("sips", ["-s", "format", "png", "-Z", "512", file, "--out", file], { stdio: "ignore" });
    } catch {
      /* sips unavailable: keep the original */
    }
    console.log(`${p.id}: ${model} -> ${path.relative(process.cwd(), file)}`);
  } catch (e) {
    failures++;
    console.error(`${p.id}: failed (${e instanceof Error ? e.message.slice(0, 200) : String(e)})`);
  }
}
process.exit(failures ? 1 : 0);
