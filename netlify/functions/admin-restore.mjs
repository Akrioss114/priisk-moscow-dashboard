import { options, fail, json, readJson, requireAdmin, restoreCard, statePayload } from "../lib/dashboard-store.mjs";

export default async function handler(request) {
  try {
    if (request.method === "OPTIONS") return options();
    if (request.method !== "POST") return json({ error: "Method not allowed" }, 405);
    requireAdmin(request);
    const input = await readJson(request);
    await restoreCard(input.cardId);
    return json(await statePayload());
  } catch (error) {
    return fail(error);
  }
}

