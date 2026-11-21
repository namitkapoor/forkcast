import type { BranchRequest } from "../src/lib/api.js";
import { jsonRoute } from "./_lib/http.js";
import { branch } from "./_lib/branch.js";

export const config = { maxDuration: 240 };

export default jsonRoute<BranchRequest>((body) => branch(body));
