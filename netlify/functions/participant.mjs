import { options, fail, json, readJson, saveParticipant } from "../lib/dashboard-store.mjs";

export default async function handler(request) {
  try {
    if (request.method === "OPTIONS") return options();
    if (request.method !== "POST") return json({ error: "Method not allowed" }, 405);
    return json({ participant: await saveParticipant(await readJson(request)) });
  } catch (error) {
    return fail(error);
  }
}

