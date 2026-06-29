import { assertAdminPin, createAdminToken, fail, json, readJson } from "../lib/dashboard-store.mjs";

export default async function handler(request) {
  try {
    if (request.method !== "POST") return json({ error: "Method not allowed" }, 405);
    const input = await readJson(request);
    assertAdminPin(input.pin);
    return json({ token: createAdminToken(), expiresInSeconds: 43200 });
  } catch (error) {
    return fail(error);
  }
}
