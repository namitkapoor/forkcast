import type { GenerateScreenRequest } from "../src/lib/api.js";
import { jsonRoute } from "./_lib/http.js";
import { HttpError } from "./_lib/gemini.js";
import { generateScreen } from "./_lib/screen.js";

export const config = { maxDuration: 60 };

export default jsonRoute<GenerateScreenRequest>(async (body) => {
  if (!body.node || typeof body.node !== "object") throw new HttpError(400, "node is required");
  const node = { ...body.node, id: body.nodeId ?? body.node.id };
  const { screen, warnings, repaired, attempts } = await generateScreen({ node, context: body.context ?? {}, utterance: body.utterance, carry: body.carry });
  return { screen, warnings, repaired, attempts };
});
