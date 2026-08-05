import { createCard, fail, json, options, readJson, requireAdmin, statePayload } from "../lib/dashboard-store.mjs";

export default async function handler(request) {
  try {
    if (request.method === "OPTIONS") return options();
    if (request.method !== "POST") return json({ error: "Method not allowed" }, 405);
    requireAdmin(request);
    const created = await createCard(await readJson(request));
    return json({ ...(await statePayload()), createdCardId: created.card.id });
  } catch (error) {
    return fail(error);
  }
}
