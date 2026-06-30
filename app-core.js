let data = null;
let cardById = null;
let columns = [];
let remoteState = null;
let participant = null;
let adminToken = '';
let activeCardId = null;
let suppressClick = false;
let archiveMode = false;
let pollTimer = null;

const API = '/.netlify/functions';
const PARTICIPANT_KEY = 'moscow-dashboard-participant-v1';
const ADMIN_KEY = 'moscow-dashboard-admin-token-v1';
const LOCAL_VOTES_KEY = 'moscow-dashboard-local-votes-v1';
const DONE_COLUMN = {
  id: 'done',
  letter: 'D',
  title: 'Done',
  subtitle: 'Выполнено и не требует дальнейшей приоритизации.'
};

function escapeHtml(value) {
  return String(value == null ? '' : value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function byId(id) {
  return document.getElementById(id);
}

function isAdmin() {
  return !!adminToken;
}

function columnIds() {
  return columns.map(col => col.id);
}

function ensureDoneColumn(payload) {
  const exists = payload.columns.some(col => col.id === DONE_COLUMN.id);
  if (!exists) payload.columns.push(DONE_COLUMN);
  payload.stats = payload.stats || {};
  payload.stats.byMoscow = payload.stats.byMoscow || {};
  if (payload.stats.byMoscow.done == null) payload.stats.byMoscow.done = 0;
}

function baseColumn(card) {
  const ids = columnIds();
  if (ids.indexOf(card.moscow) >= 0) return card.moscow;
  if (ids.indexOf(card.suggestedMoscow) >= 0) return card.suggestedMoscow;
  return 'should';
}

function emptyBoardState() {
  const order = {};
  for (const col of columnIds()) order[col] = [];
  return { version: 0, positions: {}, order, archived: [], updatedAt: '' };
}

function normalizedBoardState() {
  const serverBoard = remoteState && remoteState.board ? remoteState.board : {};
  const state = emptyBoardState();
  state.version = Number(serverBoard.version || 0);
  state.updatedAt = serverBoard.updatedAt || '';
  state.positions = serverBoard.positions && typeof serverBoard.positions === 'object' ? serverBoard.positions : {};
  state.archived = Array.isArray(serverBoard.archived) ? serverBoard.archived : [];

  for (const col of columnIds()) {
    const serverOrder = serverBoard.order && Array.isArray(serverBoard.order[col]) ? serverBoard.order[col] : [];
    state.order[col] = serverOrder.filter(id => cardById.has(id));
  }

  for (const card of data.cards) {
    const col = state.positions[card.id] || baseColumn(card);
    state.positions[card.id] = col;
    if (state.order[col] && state.order[col].indexOf(card.id) < 0) state.order[col].push(card.id);
  }
  return state;
}

function cloneCard(card, state) {
  const cloned = {};
  for (const key in card) {
    if (Object.prototype.hasOwnProperty.call(card, key)) cloned[key] = card[key];
  }
  cloned.moscow = state.positions[card.id] || baseColumn(card);
  cloned.archived = state.archived.indexOf(card.id) >= 0;
  return cloned;
}

function currentCards() {
  const state = normalizedBoardState();
  return data.cards.map(card => cloneCard(card, state));
}

function visibleCards() {
  return currentCards().filter(filterCard);
}

function localVotes() {
  try {
    return JSON.parse(localStorage.getItem(LOCAL_VOTES_KEY) || '{}');
  } catch {
    return {};
  }
}

function rememberLocalVote(voteId, column) {
  const votes = localVotes();
  votes[voteId] = column;
  localStorage.setItem(LOCAL_VOTES_KEY, JSON.stringify(votes));
}

function loadLocalIdentity() {
  try {
    participant = JSON.parse(localStorage.getItem(PARTICIPANT_KEY) || 'null');
  } catch {
    participant = null;
  }
  adminToken = localStorage.getItem(ADMIN_KEY) || '';
  if (participant && participant.name) byId('participantName').value = participant.name;
  renderAuthState();
}

function showParticipantForm(message) {
  const block = byId('participantBlock');
  if (block) block.hidden = false;
  if (message) setStatus(message, 'error');
  const input = byId('participantName');
  if (input) input.focus();
}

function setStatus(message, type) {
  const node = byId('statusLine');
  node.textContent = message;
  node.className = 'status-line' + (type ? ' ' + type : '');
}

async function api(path, options = {}) {
  const headers = options.headers || {};
  if (options.body && !headers['content-type']) headers['content-type'] = 'application/json';
  if (adminToken) headers.authorization = 'Bearer ' + adminToken;
  const response = await fetch(API + '/' + path, {
    method: options.method || 'GET',
    headers,
    body: options.body ? JSON.stringify(options.body) : undefined,
  });
  const text = await response.text();
  let payload = null;
  try {
    payload = text ? JSON.parse(text) : null;
  } catch {
    payload = { error: text };
  }
  if (!response.ok) {
    if (response.status === 401 && path !== 'admin-login') logoutAdmin(false);
    throw new Error(payload && payload.error ? payload.error : 'HTTP ' + response.status);
  }
  return payload;
}

async function loadRemoteState(silent = false) {
  try {
    remoteState = await api('state');
    if (!silent) setStatus('Общая доска синхронизирована.', 'ok');
    renderAll();
  } catch (error) {
    if (!remoteState) remoteState = { board: emptyBoardState(), activeVote: null, voteSummary: null };
    setStatus('Общая доска недоступна: ' + error.message, 'error');
    renderAll();
  }
}

function startPolling() {
  if (pollTimer) window.clearInterval(pollTimer);
  pollTimer = window.setInterval(() => loadRemoteState(true), 3500);
}

function renderStats(cards) {
  const visible = cards.filter(filterCard);
  const withBacklog = visible.filter(card => card.backlogMatches.length > 0).length;
  const archived = currentCards().filter(card => card.archived).length;
  const done = visible.filter(card => card.moscow === 'done').length;
  const must = visible.filter(card => card.moscow === 'must').length;
  const items = [
    ['Карточек', visible.length],
    ['Есть в беклоге', withBacklog],
    ['Must сейчас', must],
    ['Done', done],
    ['Архив', archived],
  ];
  byId('stats').innerHTML = items.map(([label, value]) => `
    <div class="metric"><div class="value">${value}</div><div class="label">${escapeHtml(label)}</div></div>
  `).join('');
}

function renderProjectBars(cards) {
  const counts = new Map();
  for (const card of cards.filter(filterCard)) {
    counts.set(card.project, (counts.get(card.project) || 0) + 1);
  }
  const max = Math.max(1, ...counts.values());
  const rows = [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'ru'));
  byId('projectBars').innerHTML = rows.map(([project, count]) => `
    <div class="bar-row">
      <div>${escapeHtml(project)}</div>
      <div class="bar-track"><div class="bar-fill" style="width:${Math.max(4, Math.round(count / max * 100))}%"></div></div>
      <div>${count}</div>
    </div>
  `).join('');
}

function renderSources() {
  const sourceList = data.sourceFiles.map(src => `<div><strong>${escapeHtml(src.project)}:</strong> ${escapeHtml(src.file)}</div>`).join('');
  byId('sources').innerHTML = `
    ${sourceList}
    <div><strong>MoSCoW:</strong> M/S/C/W/D используются как общая доска. Переносы, архив и голосования синхронизируются через Netlify Functions.</div>
    <div><strong>Беклог:</strong> пересечения отмечены на карточках, задачи без явного дубля добавлены как отдельные карточки.</div>
    <div><strong>Доступ без VPN:</strong> адрес остаётся на Netlify. Если сеть блокирует сам Netlify или домен netlify.app, потребуется отдельный домен или зеркало.</div>
  `;
  byId('generatedAt').textContent = data.generatedAt;
}

function filterCard(card) {
  const query = byId('search').value.trim().toLowerCase();
  const project = byId('projectFilter').value;
  const backlog = byId('backlogFilter').value;
  if (archiveMode) {
    if (!card.archived) return false;
  } else if (card.archived) {
    return false;
  }
  if (project !== 'all' && card.project !== project) return false;
  if (backlog === 'with' && card.backlogMatches.length === 0) return false;
  if (backlog === 'without' && card.backlogMatches.length > 0) return false;
  if (backlog === 'backlogOnly' && card.project !== 'Беклог') return false;
  if (!query) return true;
  const haystack = [
    card.requirementId,
    card.title,
    card.project,
    card.sourceType,
    card.summary,
    card.details.join(' '),
    card.tags.join(' '),
    card.backlogMatches.map(match => match.title + ' ' + match.effect).join(' ')
  ].join(' ').toLowerCase();
  return haystack.indexOf(query) >= 0;
}

function cardHtml(card) {
  const backlogBadge = card.backlogMatches.length ? '<span class="badge backlog">есть в беклоге</span>' : '';
  const archivedBadge = card.archived ? '<span class="badge archive">архив</span>' : '';
  const activeVote = remoteState && remoteState.activeVote;
  const voteBadge = activeVote && activeVote.cardId === card.id ? '<span class="badge vote">голосование</span>' : '';
  const tags = card.tags
    .filter(tag => tag && tag !== 'есть в беклоге')
    .slice(0, 3)
    .map(tag => `<span class="badge">${escapeHtml(tag)}</span>`)
    .join('');
  return `
    <article class="card${card.archived ? ' archived' : ''}${activeVote && activeVote.cardId === card.id ? ' voting' : ''}" draggable="false" data-card-id="${escapeHtml(card.id)}" tabindex="0">
      <div class="card-meta">
        <span>${escapeHtml(card.requirementId)}</span>
        <span>${escapeHtml(card.project)}</span>
      </div>
      <div class="card-title">${escapeHtml(card.title)}</div>
      <div class="summary">${escapeHtml(card.summary)}</div>
      <div class="badges">${voteBadge}${archivedBadge}${backlogBadge}${tags}</div>
    </article>
  `;
}

function renderBoard() {
  const state = normalizedBoardState();
  const cards = currentCards();
  renderStats(cards);
  renderProjectBars(cards);
  const board = byId('board');
  board.innerHTML = data.columns.map(col => {
    const laneCards = (state.order[col.id] || [])
      .map(id => cardById.get(id))
      .filter(Boolean)
      .map(card => cloneCard(card, state))
      .filter(card => card.moscow === col.id && filterCard(card));
    return `
      <section class="lane" data-lane="${escapeHtml(col.id)}">
        <div class="lane-head">
          <div class="lane-title">
            <div><span class="lane-letter">${escapeHtml(col.letter)}</span><span class="lane-name">${escapeHtml(col.title)}</span></div>
            <span class="lane-count">${laneCards.length}</span>
          </div>
          <div class="lane-subtitle">${escapeHtml(col.subtitle)}</div>
        </div>
        <div class="dropzone" data-column="${escapeHtml(col.id)}">${laneCards.map(cardHtml).join('')}<div class="empty">Нет карточек</div></div>
      </section>
    `;
  }).join('');
  bindCards();
}

function bindCards() {
  for (const node of document.querySelectorAll('.card')) {
    node.addEventListener('mousedown', event => startMouseDrag(event, node));
    node.addEventListener('click', event => {
      if (suppressClick) {
        event.preventDefault();
        return;
      }
      openDetail(node.dataset.cardId);
    });
    node.addEventListener('keydown', event => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        openDetail(node.dataset.cardId);
      }
    });
  }
}

function startMouseDrag(event, node) {
  if (!isAdmin() || event.button !== 0) return;
  const id = node.dataset.cardId;
  const startX = event.clientX;
  const startY = event.clientY;
  const rect = node.getBoundingClientRect();
  let moved = false;
  let ghost = null;
  let activeZone = null;

  function setActiveZone(zone) {
    if (activeZone === zone) return;
    if (activeZone) activeZone.classList.remove('over');
    activeZone = zone;
    if (activeZone) activeZone.classList.add('over');
  }

  function cleanup() {
    if (ghost) ghost.remove();
    node.classList.remove('drag-source');
    document.body.classList.remove('dragging');
    if (activeZone) activeZone.classList.remove('over');
    document.removeEventListener('mousemove', onMove);
    document.removeEventListener('mouseup', onUp);
  }

  function onMove(moveEvent) {
    const dx = moveEvent.clientX - startX;
    const dy = moveEvent.clientY - startY;
    if (!moved && Math.hypot(dx, dy) > 8) {
      moved = true;
      suppressClick = true;
      node.classList.add('drag-source');
      document.body.classList.add('dragging');
      ghost = node.cloneNode(true);
      ghost.classList.add('drag-ghost');
      ghost.style.width = rect.width + 'px';
      document.body.appendChild(ghost);
    }
    if (!moved) return;
    moveEvent.preventDefault();
    ghost.style.left = moveEvent.clientX + 'px';
    ghost.style.top = moveEvent.clientY + 'px';
    const target = document.elementFromPoint(moveEvent.clientX, moveEvent.clientY);
    setActiveZone(target ? target.closest('.dropzone') : null);
  }

  async function onUp() {
    const targetColumn = moved && activeZone ? activeZone.dataset.column : null;
    cleanup();
    if (targetColumn) await adminMove(id, targetColumn);
    window.setTimeout(() => { suppressClick = false; }, 80);
  }

  document.addEventListener('mousemove', onMove);
  document.addEventListener('mouseup', onUp);
}

function voteButtonsHtml(activeVote, compact = false) {
  if (!activeVote) return '';
  const selected = localVotes()[activeVote.id];
  return data.columns.map(col => `
    <button data-vote-column="${escapeHtml(col.id)}" class="${selected === col.id ? 'active' : ''}" title="${escapeHtml(col.title)}">
      ${compact ? escapeHtml(col.letter) : escapeHtml(col.letter + ' ' + col.title)}
    </button>
  `).join('');
}

function tallyHtml() {
  const summary = remoteState && remoteState.voteSummary ? remoteState.voteSummary : null;
  if (!summary) return '';
  return data.columns.map(col => {
    const count = summary.counts && summary.counts[col.id] ? summary.counts[col.id] : 0;
    const leader = summary.leaders && summary.leaders.indexOf(col.id) >= 0;
    return `<span class="vote-count${leader ? ' leader' : ''}">${escapeHtml(col.letter)} ${count}</span>`;
  }).join('');
}

function renderVotePanel() {
  const activeVote = remoteState && remoteState.activeVote;
  const panel = byId('votePanel');
  if (!activeVote) {
    panel.className = 'vote-panel muted-panel';
    panel.innerHTML = 'Нет активного голосования';
    return;
  }
  const card = cardById.get(activeVote.cardId);
  panel.className = 'vote-panel';
  panel.innerHTML = `
    <div class="vote-title">${card ? escapeHtml(card.requirementId + ' · ' + card.title) : escapeHtml(activeVote.cardId)}</div>
    <div class="vote-counts">${tallyHtml()}</div>
    <div class="vote-actions">${voteButtonsHtml(activeVote, true)}</div>
    ${isAdmin() ? '<div class="vote-actions admin-vote-actions"><button id="finishVote">Завершить</button><button id="cancelVote">Отменить</button></div>' : ''}
  `;
  for (const button of panel.querySelectorAll('[data-vote-column]')) {
    button.addEventListener('click', () => submitVote(button.dataset.voteColumn));
  }
  const finish = byId('finishVote');
  if (finish) finish.addEventListener('click', () => adminFinishVote());
  const cancel = byId('cancelVote');
  if (cancel) cancel.addEventListener('click', () => adminCancelVote());
}

function renderAuthState() {
  const hasParticipant = !!(participant && participant.id);
  const participantBlock = byId('participantBlock');
  if (participantBlock) participantBlock.hidden = hasParticipant;
  const participantStatus = byId('participantStatus');
  if (participantStatus) {
    participantStatus.textContent = hasParticipant
      ? 'Голосует как: ' + participant.name + '. Имя сохранено в этом браузере.'
      : 'Имя участника будет запрошено перед первым голосованием.';
  }
  const adminStatus = byId('adminStatus');
  if (adminStatus) {
    adminStatus.textContent = isAdmin()
      ? 'Админский режим включён. Можно двигать, архивировать задачи и управлять голосованием.'
      : 'Админ может двигать, архивировать задачи и управлять голосованием.';
  }
  byId('adminLogin').hidden = isAdmin();
  byId('adminPin').hidden = isAdmin();
  byId('adminLogout').hidden = !isAdmin();
  byId('archiveToggle').hidden = !isAdmin();
  byId('archiveToggle').classList.toggle('active', archiveMode);
  for (const node of document.querySelectorAll('.admin-only')) node.hidden = !isAdmin();
  document.body.classList.toggle('admin-mode', isAdmin());
}

function renderAll() {
  if (!data) return;
  renderAuthState();
  renderVotePanel();
  renderBoard();
  if (activeCardId && byId('detailDialog').open) openDetail(activeCardId, true);
}
