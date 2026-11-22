import type { CritiqueScreenRequest } from "../src/lib/api.js";
import { jsonRoute } from "./_lib/http.js";
import { critiqueScreen } from "./_lib/critique.js";

export const config = { maxDuration: 240 };

export default jsonRoute<CritiqueScreenRequest>((body) => critiqueScreen(body));
