import { fail, json, statePayload } from "../lib/dashboard-store.mjs";

export default async function handler(request) {
  try {
    if (request.method !== "GET") return json({ error: "Method not allowed" }, 405);
    return json(await statePayload());
  } catch (error) {
    return fail(error);
  }
}
