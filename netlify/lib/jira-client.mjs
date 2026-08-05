const DEFAULT_BASE_URL = "https://jira.pmpractice.ru";
const REQUEST_TIMEOUT_MS = 20000;

function httpError(message, status = 502) {
  return Object.assign(new Error(message), { status });
}

function jiraConfig() {
  const baseUrl = String(process.env.JIRA_BASE_URL || DEFAULT_BASE_URL).replace(/\/+$/, "");
  const token = process.env.JIRA_API_TOKEN || process.env.JIRA_TOKEN || "";
  const username = process.env.JIRA_USERNAME || "";
  const explicitHeader = process.env.JIRA_AUTH_HEADER || "";
  const authMode = String(process.env.JIRA_AUTH_MODE || (username ? "basic" : "bearer")).toLowerCase();

  if (!explicitHeader && !token) {
    throw httpError("Интеграция с Jira не настроена на сервере", 503);
  }
  if (!explicitHeader && authMode === "basic" && !username) {
    throw httpError("Для Basic Auth не задан JIRA_USERNAME", 503);
  }

  let authorization = explicitHeader;
  if (!authorization && authMode === "basic") {
    authorization = `Basic ${Buffer.from(`${username}:${token}`).toString("base64")}`;
  } else if (!authorization) {
    authorization = `Bearer ${token}`;
  }
  return { baseUrl, authorization };
}

function jiraErrorMessage(payload, status) {
  const messages = [];
  if (payload && Array.isArray(payload.errorMessages)) messages.push(...payload.errorMessages);
  if (payload && payload.errors && typeof payload.errors === "object") messages.push(...Object.values(payload.errors));
  if (status === 401 || status === 403) return "Jira отклонила серверную авторизацию";
  return messages.filter(Boolean).join("; ") || `Jira вернула HTTP ${status}`;
}

async function jiraRequest(path) {
  const config = jiraConfig();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  let response;
  try {
    response = await fetch(config.baseUrl + path, {
      headers: {
        authorization: config.authorization,
        accept: "application/json",
      },
      signal: controller.signal,
    });
  } catch (error) {
    if (error.name === "AbortError") throw httpError("Jira не ответила за 20 секунд", 504);
    throw httpError("Сервер не может подключиться к Jira", 502);
  } finally {
    clearTimeout(timeout);
  }

  let payload = null;
  try {
    payload = await response.json();
  } catch {
    payload = null;
  }
  if (!response.ok) throw httpError(jiraErrorMessage(payload, response.status), response.status === 404 ? 404 : 502);
  return { payload, baseUrl: config.baseUrl };
}

function textFromJira(value) {
  if (!value) return "";
  if (typeof value === "string") return value.replace(/\r/g, "").trim();
  if (Array.isArray(value)) return value.map(textFromJira).filter(Boolean).join("\n");
  if (typeof value === "object") {
    if (typeof value.text === "string") return value.text;
    return textFromJira(value.content);
  }
  return String(value);
}

function issueView(issue, baseUrl) {
  const fields = issue && issue.fields ? issue.fields : {};
  const key = String(issue && issue.key || "").toUpperCase();
  const description = textFromJira(fields.description).slice(0, 4000);
  return {
    key,
    title: String(fields.summary || key).trim().slice(0, 240),
    summary: description.slice(0, 600),
    description,
    projectName: String(fields.project && fields.project.name || fields.project && fields.project.key || "Jira").trim().slice(0, 120),
    projectKey: String(fields.project && fields.project.key || "").trim().slice(0, 40),
    status: String(fields.status && fields.status.name || "").trim().slice(0, 100),
    issueType: String(fields.issuetype && fields.issuetype.name || "").trim().slice(0, 100),
    priority: String(fields.priority && fields.priority.name || "").trim().slice(0, 100),
    labels: Array.isArray(fields.labels) ? fields.labels.map(String).slice(0, 20) : [],
    components: Array.isArray(fields.components) ? fields.components.map(item => String(item && item.name || "")).filter(Boolean).slice(0, 20) : [],
    url: key ? `${baseUrl}/browse/${encodeURIComponent(key)}` : "",
  };
}

const FIELDS = "summary,description,status,project,issuetype,priority,labels,components";

export async function getJiraIssue(key) {
  const normalized = String(key || "").trim().toUpperCase();
  if (!/^[A-Z][A-Z0-9_]*-\d+$/.test(normalized)) throw httpError("Некорректный ключ Jira", 400);
  const result = await jiraRequest(`/rest/api/2/issue/${encodeURIComponent(normalized)}?fields=${encodeURIComponent(FIELDS)}`);
  return issueView(result.payload, result.baseUrl);
}

export async function searchJiraIssues(query) {
  const normalized = String(query || "").trim().slice(0, 180);
  if (normalized.length < 2) throw httpError("Введите не менее двух символов", 400);
  if (/^[A-Za-z][A-Za-z0-9_]*-\d+$/.test(normalized)) {
    try {
      return [await getJiraIssue(normalized)];
    } catch (error) {
      if (error.status === 404) return [];
      throw error;
    }
  }

  const escaped = normalized.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
  const params = new URLSearchParams({
    jql: `summary ~ "${escaped}" ORDER BY updated DESC`,
    maxResults: "10",
    fields: FIELDS,
  });
  const result = await jiraRequest(`/rest/api/2/search?${params.toString()}`);
  const issues = Array.isArray(result.payload && result.payload.issues) ? result.payload.issues : [];
  return issues.slice(0, 10).map(issue => issueView(issue, result.baseUrl));
}
