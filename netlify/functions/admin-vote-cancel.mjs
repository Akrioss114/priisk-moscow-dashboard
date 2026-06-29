import { cancelVote, fail, json, requireAdmin, statePayload } from "../lib/dashboard-store.mjs";

export default async function handler(request) {
  try {
    if (request.method !== "POST") return json({ error: "Method not allowed" }, 405);
    requireAdmin(request);
    await cancelVote();
    return json(await statePayload());
  } catch (error) {
    return fail(error);
  }
}
