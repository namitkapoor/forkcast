import type { AskRequest } from "../src/lib/api.js";
import { jsonRoute } from "./_lib/http.js";
import { ask } from "./_lib/ask.js";

export const config = { maxDuration: 30 };

export default jsonRoute<AskRequest>((body) => ask(body));
