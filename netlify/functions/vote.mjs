import { fail, json, readJson, saveVote, statePayload } from "../lib/dashboard-store.mjs";

export default async function handler(request) {
  try {
    if (request.method !== "POST") return json({ error: "Method not allowed" }, 405);
    await saveVote(await readJson(request));
    return json(await statePayload());
  } catch (error) {
    return fail(error);
  }
}
