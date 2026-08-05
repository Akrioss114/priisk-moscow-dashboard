import { fail, json, options, requireAdmin } from "../lib/dashboard-store.mjs";
import { searchJiraIssues } from "../lib/jira-client.mjs";

export default async function handler(request) {
  try {
    if (request.method === "OPTIONS") return options();
    if (request.method !== "GET") return json({ error: "Method not allowed" }, 405);
    requireAdmin(request);
    const query = new URL(request.url).searchParams.get("q") || "";
    return json({ query, issues: await searchJiraIssues(query) });
  } catch (error) {
    return fail(error);
  }
}
