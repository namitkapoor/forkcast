import type { SimulateStepRequest } from "../src/lib/api.js";
import { jsonRoute } from "./_lib/http.js";
import { simulateStep } from "./_lib/simulate.js";

export const config = { maxDuration: 60 };

export default jsonRoute<SimulateStepRequest>((body) => simulateStep(body));
