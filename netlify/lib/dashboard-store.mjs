import { getStore } from "@netlify/blobs";
import crypto from "node:crypto";

export const VALID_COLUMNS = ["must", "should", "could", "wont", "done"];
export const DONE_COLUMN = {
  id: "done",
  letter: "D",
  title: "Done",
  subtitle: "Выполнено и не требует дальнейшей приоритизации.",
};

const JSON_HEADERS = {
  "content-type": "application/json; charset=utf-8",
  "cache-control": "no-store",
};

function boardStore() {
  return getStore({ name: "moscow-dashboard", consistency: "strong" });
}

function votesStore() {
  return getStore({ name: "moscow-votes", consistency: "strong" });
}

function nowIso() {
  return new Date().toISOString();
}

function randomId(prefix) {
  return `${prefix}-${Date.now().toString(36)}-${crypto.randomBytes(5).toString("hex")}`;
}

function base64url(value) {
  return Buffer.from(value).toString("base64url");
}

function hmac(value) {
  const secret = process.env.ADMIN_TOKEN_SECRET;
  if (!secret) throw Object.assign(new Error("ADMIN_TOKEN_SECRET is not configured"), { status: 500 });
  return crypto.createHmac("sha256", secret).update(value).digest("base64url");
}

export async function readJson(request) {
  try {
    return await request.json();
  } catch {
    throw Object.assign(new Error("Invalid JSON body"), { status: 400 });
  }
}

export function json(data, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: JSON_HEADERS });
}

export function fail(error) {
  const status = error.status || 500;
  return json({ error: error.message || "Internal server error" }, status);
}

export function assertColumn(column) {
  if (!VALID_COLUMNS.includes(column)) {
    throw Object.assign(new Error("Unknown column"), { status: 400 });
  }
}

export function assertCardId(cardId) {
  if (!cardId || typeof cardId !== "string") {
    throw Object.assign(new Error("cardId is required"), { status: 400 });
  }
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
    updatedAt: state.updatedAt || nowIso(),
  };
}

export async function getBoardState() {
  const value = await boardStore().get("board/state", { type: "json" });
  return normalizeBoardState(value);
}

export async function saveBoardState(state) {
  const next = normalizeBoardState(state);
  next.version = (next.version || 0) + 1;
  next.updatedAt = nowIso();
  await boardStore().setJSON("board/state", next);
  return next;
}

export async function moveCard(cardId, column) {
  assertCardId(cardId);
  assertColumn(column);
  const state = await getBoardState();
  for (const key of VALID_COLUMNS) {
    state.order[key] = (state.order[key] || []).filter((id) => id !== cardId);
  }
  state.positions[cardId] = column;
  state.order[column].push(cardId);
  return saveBoardState(state);
}

export async function archiveCard(cardId) {
  assertCardId(cardId);
  const state = await getBoardState();
  if (!state.archived.includes(cardId)) state.archived.push(cardId);
  return saveBoardState(state);
}

export async function restoreCard(cardId) {
  assertCardId(cardId);
  const state = await getBoardState();
  state.archived = state.archived.filter((id) => id !== cardId);
  return saveBoardState(state);
}

function normalizeVote(value) {
  if (!value || value.status !== "active") return null;
  if (!value.id || !value.cardId) return null;
  return value;
}

export async function getCurrentVote() {
  return normalizeVote(await boardStore().get("vote/current", { type: "json" }));
}

export async function startVote(cardId) {
  assertCardId(cardId);
  const active = await getCurrentVote();
  if (active) {
    throw Object.assign(new Error("Voting is already active"), { status: 409 });
  }
  const vote = {
    id: randomId("vote"),
    cardId,
    status: "active",
    startedAt: nowIso(),
  };
  await boardStore().setJSON("vote/current", vote);
  return vote;
}

export async function cancelVote() {
  const vote = await getCurrentVote();
  await boardStore().delete("vote/current");
  return vote;
}

export async function saveParticipant(input) {
  const name = String(input.name || "").trim().slice(0, 80);
  if (!name) throw Object.assign(new Error("Participant name is required"), { status: 400 });
  const participantId = input.participantId && typeof input.participantId === "string"
    ? input.participantId
    : randomId("participant");
  const participant = { id: participantId, name, updatedAt: nowIso() };
  await boardStore().setJSON(`participants/${participantId}`, participant);
  return participant;
}

export async function saveVote(input) {
  const active = await getCurrentVote();
  if (!active) throw Object.assign(new Error("No active voting"), { status: 409 });
  const participantId = String(input.participantId || "").trim();
  if (!participantId) throw Object.assign(new Error("participantId is required"), { status: 400 });
  if (input.voteId !== active.id || input.cardId !== active.cardId) {
    throw Object.assign(new Error("Voting target has changed"), { status: 409 });
  }
  assertColumn(input.column);
  const vote = {
    voteId: active.id,
    cardId: active.cardId,
    participantId,
    column: input.column,
    updatedAt: nowIso(),
  };
  await votesStore().setJSON(`votes/${active.id}/${participantId}`, vote);
  return vote;
}

export async function listVotes(voteId) {
  if (!voteId) return [];
  const store = votesStore();
  const result = await store.list({ prefix: `votes/${voteId}/` });
  const votes = [];
  for (const item of result.blobs || []) {
    const vote = await store.get(item.key, { type: "json" });
    if (vote && vote.voteId === voteId && VALID_COLUMNS.includes(vote.column)) votes.push(vote);
  }
  return votes;
}

export function aggregateVotes(votes) {
  const counts = Object.fromEntries(VALID_COLUMNS.map((column) => [column, 0]));
  for (const vote of votes) counts[vote.column] += 1;
  const max = Math.max(0, ...Object.values(counts));
  const leaders = max > 0 ? VALID_COLUMNS.filter((column) => counts[column] === max) : [];
  return { counts, total: votes.length, leaders, winner: leaders.length === 1 ? leaders[0] : null, tied: leaders.length > 1 };
}

export async function statePayload() {
  const board = await getBoardState();
  const activeVote = await getCurrentVote();
  const votes = activeVote ? await listVotes(activeVote.id) : [];
  return {
    board,
    activeVote,
    voteSummary: aggregateVotes(votes),
  };
}

export async function finishVote(input = {}) {
  const active = await getCurrentVote();
  if (!active) throw Object.assign(new Error("No active voting"), { status: 409 });
  const votes = await listVotes(active.id);
  const summary = aggregateVotes(votes);
  let column = summary.winner;
  if (!column) {
    column = input.column;
    if (!column) {
      throw Object.assign(new Error("Tie or empty vote requires an admin-selected column"), { status: 409 });
    }
    assertColumn(column);
    if (summary.leaders.length && !summary.leaders.includes(column)) {
      throw Object.assign(new Error("Selected column is not tied for first place"), { status: 400 });
    }
  }
  const board = await moveCard(active.cardId, column);
  await boardStore().setJSON(`vote/history/${active.id}`, {
    ...active,
    status: "finished",
    finishedAt: nowIso(),
    resultColumn: column,
    summary,
  });
  await boardStore().delete("vote/current");
  return { board, vote: active, resultColumn: column, summary };
}

export function createAdminToken() {
  const payload = {
    role: "admin",
    exp: Math.floor(Date.now() / 1000) + 12 * 60 * 60,
    nonce: crypto.randomBytes(8).toString("hex"),
  };
  const body = base64url(JSON.stringify(payload));
  return `${body}.${hmac(body)}`;
}

export function requireAdmin(request) {
  const header = request.headers.get("authorization") || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : "";
  const [body, signature] = token.split(".");
  if (!body || !signature || hmac(body) !== signature) {
    throw Object.assign(new Error("Admin authorization is required"), { status: 401 });
  }
  const payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
  if (payload.role !== "admin" || payload.exp < Math.floor(Date.now() / 1000)) {
    throw Object.assign(new Error("Admin token has expired"), { status: 401 });
  }
}

export function assertAdminPin(pin) {
  const expected = process.env.ADMIN_PIN;
  if (!expected) throw Object.assign(new Error("ADMIN_PIN is not configured"), { status: 500 });
  if (String(pin || "") !== expected) {
    throw Object.assign(new Error("Invalid admin PIN"), { status: 401 });
  }
}
