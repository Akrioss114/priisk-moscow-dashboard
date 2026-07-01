const VALID_COLUMNS = ["must", "should", "could", "wont", "done"];
const JSON_HEADERS = {
  "content-type": "application/json; charset=utf-8",
  "cache-control": "no-store",
};

function nowIso() {
  return new Date().toISOString();
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: JSON_HEADERS });
}

function fail(error) {
  const status = error.status || 500;
  return json({ error: error.message || "Internal server error" }, status);
}

function httpError(message, status) {
  return Object.assign(new Error(message), { status });
}

async function readJson(request) {
  try {
    return await request.json();
  } catch {
    throw httpError("Invalid JSON body", 400);
  }
}

function assertColumn(column) {
  if (!VALID_COLUMNS.includes(column)) throw httpError("Unknown column", 400);
}

function assertCardId(cardId) {
  if (!cardId || typeof cardId !== "string") throw httpError("cardId is required", 400);
}

function normalizeBoardState(value) {
  const state = value && typeof value === "object" ? value : {};
  const order = state.order && typeof state.order === "object" ? state.order : {};
  const normalizedOrder = {};
  for (const column of VALID_COLUMNS) {
    normalizedOrder[column] = Array.isArray(order[column]) ? order[column].filter(Boolean) : [];
  }
  return {
    version: Number.isFinite(state.version) ? state.version : 1,
    positions: state.positions && typeof state.positions === "object" ? state.positions : {},
    order: normalizedOrder,
    archived: Array.isArray(state.archived) ? state.archived.filter(Boolean) : [],
    edits: state.edits && typeof state.edits === "object" ? state.edits : {},
    updatedAt: state.updatedAt || nowIso(),
  };
}

async function kvGet(env, key) {
  const value = await env.DASHBOARD_KV.get(key, "json");
  return value;
}

async function kvPut(env, key, value) {
  await env.DASHBOARD_KV.put(key, JSON.stringify(value));
}

async function getBoardState(env) {
  return normalizeBoardState(await kvGet(env, "board/state"));
}

async function saveBoardState(env, state) {
  const next = normalizeBoardState(state);
  next.version = (next.version || 0) + 1;
  next.updatedAt = nowIso();
  await kvPut(env, "board/state", next);
  return next;
}

async function moveCard(env, cardId, column) {
  assertCardId(cardId);
  assertColumn(column);
  const state = await getBoardState(env);
  for (const key of VALID_COLUMNS) {
    state.order[key] = (state.order[key] || []).filter((id) => id !== cardId);
  }
  state.positions[cardId] = column;
  state.order[column].push(cardId);
  return saveBoardState(env, state);
}

async function archiveCard(env, cardId) {
  assertCardId(cardId);
  const state = await getBoardState(env);
  if (!state.archived.includes(cardId)) state.archived.push(cardId);
  return saveBoardState(env, state);
}

async function restoreCard(env, cardId) {
  assertCardId(cardId);
  const state = await getBoardState(env);
  state.archived = state.archived.filter((id) => id !== cardId);
  return saveBoardState(env, state);
}

function normalizeCardEdit(input) {
  const title = String(input.title || "").trim().slice(0, 240);
  const summary = String(input.summary || "").trim().slice(0, 2000);
  const sourceExcerpt = String(input.sourceExcerpt || "").trim().slice(0, 4000);
  const details = Array.isArray(input.details)
    ? input.details.map((item) => String(item || "").trim()).filter(Boolean).slice(0, 30)
    : String(input.details || "")
      .split(/\r?\n/)
      .map((item) => item.trim())
      .filter(Boolean)
      .slice(0, 30);
  if (!title) throw httpError("Title is required", 400);
  if (!summary) throw httpError("Task text is required", 400);
  return { title, summary, details, sourceExcerpt, updatedAt: nowIso() };
}

async function editCard(env, input) {
  assertCardId(input.cardId);
  const edit = normalizeCardEdit(input);
  const state = await getBoardState(env);
  state.edits = state.edits && typeof state.edits === "object" ? state.edits : {};
  state.edits[input.cardId] = edit;
  return saveBoardState(env, state);
}

function normalizeVote(value) {
  if (!value || value.status !== "active") return null;
  if (!value.id || !value.cardId) return null;
  return value;
}

async function getCurrentVote(env) {
  return normalizeVote(await kvGet(env, "vote/current"));
}

function randomId(prefix) {
  const bytes = new Uint8Array(8);
  crypto.getRandomValues(bytes);
  const suffix = [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
  return `${prefix}-${Date.now().toString(36)}-${suffix}`;
}

async function startVote(env, cardId) {
  assertCardId(cardId);
  const active = await getCurrentVote(env);
  if (active) throw httpError("Voting is already active", 409);
  const vote = { id: randomId("vote"), cardId, status: "active", startedAt: nowIso() };
  await kvPut(env, "vote/current", vote);
  return vote;
}

async function cancelVote(env) {
  const vote = await getCurrentVote(env);
  await env.DASHBOARD_KV.delete("vote/current");
  return vote;
}

async function saveParticipant(env, input) {
  const name = String(input.name || "").trim().slice(0, 80);
  if (!name) throw httpError("Participant name is required", 400);
  const participantId = input.participantId && typeof input.participantId === "string"
    ? input.participantId
    : randomId("participant");
  const participant = { id: participantId, name, updatedAt: nowIso() };
  await kvPut(env, `participants/${participantId}`, participant);
  return participant;
}

async function saveVote(env, input) {
  const active = await getCurrentVote(env);
  if (!active) throw httpError("No active voting", 409);
  const participantId = String(input.participantId || "").trim();
  if (!participantId) throw httpError("participantId is required", 400);
  if (input.voteId !== active.id || input.cardId !== active.cardId) {
    throw httpError("Voting target has changed", 409);
  }
  assertColumn(input.column);
  const vote = {
    voteId: active.id,
    cardId: active.cardId,
    participantId,
    column: input.column,
    updatedAt: nowIso(),
  };
  await kvPut(env, `votes/${active.id}/${participantId}`, vote);
  return vote;
}

async function listVotes(env, voteId) {
  if (!voteId) return [];
  const result = await env.DASHBOARD_KV.list({ prefix: `votes/${voteId}/` });
  const votes = [];
  for (const item of result.keys || []) {
    const vote = await kvGet(env, item.name);
    if (vote && vote.voteId === voteId && VALID_COLUMNS.includes(vote.column)) votes.push(vote);
  }
  return votes;
}

function aggregateVotes(votes) {
  const counts = Object.fromEntries(VALID_COLUMNS.map((column) => [column, 0]));
  for (const vote of votes) counts[vote.column] += 1;
  const max = Math.max(0, ...Object.values(counts));
  const leaders = max > 0 ? VALID_COLUMNS.filter((column) => counts[column] === max) : [];
  return { counts, total: votes.length, leaders, winner: leaders.length === 1 ? leaders[0] : null, tied: leaders.length > 1 };
}

async function statePayload(env) {
  const board = await getBoardState(env);
  const activeVote = await getCurrentVote(env);
  const votes = activeVote ? await listVotes(env, activeVote.id) : [];
  return { board, activeVote, voteSummary: aggregateVotes(votes) };
}

async function finishVote(env, input = {}) {
  const active = await getCurrentVote(env);
  if (!active) throw httpError("No active voting", 409);
  const votes = await listVotes(env, active.id);
  const summary = aggregateVotes(votes);
  let column = summary.winner;
  if (!column) {
    column = input.column;
    if (!column) throw httpError("Tie or empty vote requires an admin-selected column", 409);
    assertColumn(column);
    if (summary.leaders.length && !summary.leaders.includes(column)) {
      throw httpError("Selected column is not tied for first place", 400);
    }
  }
  const board = await moveCard(env, active.cardId, column);
  await kvPut(env, `vote/history/${active.id}`, {
    ...active,
    status: "finished",
    finishedAt: nowIso(),
    resultColumn: column,
    summary,
  });
  await env.DASHBOARD_KV.delete("vote/current");
  return { board, vote: active, resultColumn: column, summary };
}

function base64urlEncode(value) {
  const bytes = typeof value === "string" ? new TextEncoder().encode(value) : value;
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function base64urlDecode(value) {
  const base64 = value.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(value.length / 4) * 4, "=");
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return new TextDecoder().decode(bytes);
}

async function hmac(env, value) {
  if (!env.ADMIN_TOKEN_SECRET) throw httpError("ADMIN_TOKEN_SECRET is not configured", 500);
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(env.ADMIN_TOKEN_SECRET),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(value));
  return base64urlEncode(new Uint8Array(signature));
}

async function createAdminToken(env) {
  const payload = {
    role: "admin",
    exp: Math.floor(Date.now() / 1000) + 12 * 60 * 60,
    nonce: randomId("nonce"),
  };
  const body = base64urlEncode(JSON.stringify(payload));
  return `${body}.${await hmac(env, body)}`;
}

async function requireAdmin(request, env) {
  const header = request.headers.get("authorization") || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : "";
  const [body, signature] = token.split(".");
  if (!body || !signature || (await hmac(env, body)) !== signature) {
    throw httpError("Admin authorization is required", 401);
  }
  const payload = JSON.parse(base64urlDecode(body));
  if (payload.role !== "admin" || payload.exp < Math.floor(Date.now() / 1000)) {
    throw httpError("Admin token has expired", 401);
  }
}

function assertAdminPin(env, pin) {
  if (!env.ADMIN_PIN) throw httpError("ADMIN_PIN is not configured", 500);
  if (String(pin || "") !== env.ADMIN_PIN) throw httpError("Invalid admin PIN", 401);
}

async function handleApi(request, env, name) {
  if (!env.DASHBOARD_KV) throw httpError("DASHBOARD_KV is not configured", 500);

  if (name === "state") {
    if (request.method !== "GET") return json({ error: "Method not allowed" }, 405);
    return json(await statePayload(env));
  }

  if (name === "participant") {
    if (request.method !== "POST") return json({ error: "Method not allowed" }, 405);
    const participant = await saveParticipant(env, await readJson(request));
    return json({ participant });
  }

  if (name === "vote") {
    if (request.method !== "POST") return json({ error: "Method not allowed" }, 405);
    await saveVote(env, await readJson(request));
    return json(await statePayload(env));
  }

  if (name === "admin-login") {
    if (request.method !== "POST") return json({ error: "Method not allowed" }, 405);
    const input = await readJson(request);
    assertAdminPin(env, input.pin);
    return json({ token: await createAdminToken(env), expiresInSeconds: 43200 });
  }

  await requireAdmin(request, env);
  const input = request.method === "POST" ? await readJson(request) : {};

  if (name === "admin-move") {
    await moveCard(env, input.cardId, input.column);
    return json(await statePayload(env));
  }
  if (name === "admin-archive") {
    await archiveCard(env, input.cardId);
    return json(await statePayload(env));
  }
  if (name === "admin-restore") {
    await restoreCard(env, input.cardId);
    return json(await statePayload(env));
  }
  if (name === "admin-edit") {
    await editCard(env, input);
    return json(await statePayload(env));
  }
  if (name === "admin-vote-start") {
    await startVote(env, input.cardId);
    return json(await statePayload(env));
  }
  if (name === "admin-vote-finish") {
    await finishVote(env, input);
    return json(await statePayload(env));
  }
  if (name === "admin-vote-cancel") {
    await cancelVote(env);
    return json(await statePayload(env));
  }

  return json({ error: "Not found" }, 404);
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const prefix = "/.netlify/functions/";
    if (url.pathname.startsWith(prefix)) {
      try {
        return await handleApi(request, env, url.pathname.slice(prefix.length));
      } catch (error) {
        return fail(error);
      }
    }
    return env.ASSETS.fetch(request);
  },
};
