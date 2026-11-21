import type { TranscribeRequest } from "../src/lib/api.js";
import { jsonRoute } from "./_lib/http.js";
import { transcribe } from "./_lib/transcribe.js";

export const config = { maxDuration: 30 };

export default jsonRoute<TranscribeRequest>((body) => transcribe(body));
