import type { EditScreenRequest } from "../src/lib/api.js";
import { jsonRoute } from "./_lib/http.js";
import { editScreen } from "./_lib/edit.js";

export const config = { maxDuration: 60 };

export default jsonRoute<EditScreenRequest>((body) => editScreen(body));
