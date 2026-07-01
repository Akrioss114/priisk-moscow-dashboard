import { options, fail, finishVote, json, readJson, requireAdmin, statePayload } from "../lib/dashboard-store.mjs";

export default async function handler(request) {
  try {
    if (request.method === "OPTIONS") return options();
    if (request.method !== "POST") return json({ error: "Method not allowed" }, 405);
    requireAdmin(request);
    await finishVote(await readJson(request));
    return json(await statePayload());
  } catch (error) {
    return fail(error);
  }
}

