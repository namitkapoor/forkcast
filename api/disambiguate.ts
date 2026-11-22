import type { DisambiguationRequestPayload } from "../src/lib/api.js";
import { jsonRoute } from "./_lib/http.js";
import { disambiguate } from "./_lib/disambiguate.js";

export const config = { maxDuration: 25 };

export default jsonRoute<DisambiguationRequestPayload>((body) => disambiguate(body));
