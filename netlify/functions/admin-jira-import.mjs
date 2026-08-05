import { createCard, fail, json, options, readJson, requireAdmin, statePayload } from "../lib/dashboard-store.mjs";
import { getJiraIssue } from "../lib/jira-client.mjs";

export default async function handler(request) {
  try {
    if (request.method === "OPTIONS") return options();
    if (request.method !== "POST") return json({ error: "Method not allowed" }, 405);
    requireAdmin(request);
    const input = await readJson(request);
    const issue = await getJiraIssue(input.key);
    const details = [
      issue.status ? `Статус Jira: ${issue.status}` : "",
      issue.issueType ? `Тип: ${issue.issueType}` : "",
      issue.priority ? `Приоритет Jira: ${issue.priority}` : "",
      issue.components.length ? `Компоненты: ${issue.components.join(", ")}` : "",
    ].filter(Boolean);
    const created = await createCard({
      requirementId: issue.key,
      title: issue.title,
      project: issue.projectName,
      column: input.column,
      summary: issue.description || issue.title,
      details,
      sourceExcerpt: issue.url,
      sourceType: "Jira",
      sourceFiles: [issue.url],
      tags: ["Jira", issue.issueType, issue.priority, ...issue.labels].filter(Boolean),
      moscowReason: "Импортировано администратором из Jira для приоритизации.",
      externalKey: issue.key,
    });
    return json({ ...(await statePayload()), createdCardId: created.card.id });
  } catch (error) {
    return fail(error);
  }
}
