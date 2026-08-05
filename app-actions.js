async function submitVote(column) {
  const activeVote = remoteState && remoteState.activeVote;
  if (!activeVote) return setStatus('Сейчас нет активного голосования.', 'error');
  if (!participant || !participant.id) {
    showParticipantForm('Введите имя участника перед первым голосованием.');
    return;
  }
  try {
    remoteState = await api('vote', {
      method: 'POST',
      body: {
        participantId: participant.id,
        voteId: activeVote.id,
        cardId: activeVote.cardId,
        column,
      },
    });
    rememberLocalVote(activeVote.id, column);
    setStatus('Голос учтён.', 'ok');
    renderAll();
  } catch (error) {
    setStatus('Не удалось проголосовать: ' + error.message, 'error');
  }
}

async function adminMove(cardId, column) {
  try {
    remoteState = await api('admin-move', { method: 'POST', body: { cardId, column } });
    setStatus('Карточка перенесена.', 'ok');
    renderAll();
  } catch (error) {
    setStatus('Не удалось перенести карточку: ' + error.message, 'error');
  }
}

async function adminArchive(cardId) {
  try {
    remoteState = await api('admin-archive', { method: 'POST', body: { cardId } });
    setStatus('Карточка отправлена в архив.', 'ok');
    byId('detailDialog').close();
    renderAll();
  } catch (error) {
    setStatus('Не удалось архивировать карточку: ' + error.message, 'error');
  }
}

async function adminRestore(cardId) {
  try {
    remoteState = await api('admin-restore', { method: 'POST', body: { cardId } });
    setStatus('Карточка восстановлена.', 'ok');
    renderAll();
  } catch (error) {
    setStatus('Не удалось восстановить карточку: ' + error.message, 'error');
  }
}

async function adminSaveEdit(cardId) {
  const form = byId('adminEditForm');
  if (!form) return;
  try {
    remoteState = await api('admin-edit', {
      method: 'POST',
      body: {
        cardId,
        title: byId('editTitle').value,
        summary: byId('editSummary').value,
        details: byId('editDetails').value,
        sourceExcerpt: byId('editSourceExcerpt').value,
      },
      timeoutMs: 9000,
    });
    form.dataset.dirty = 'false';
    editModeCardId = null;
    setStatus('Правки задачи сохранены.', 'ok');
    renderAll();
  } catch (error) {
    setStatus('Не удалось сохранить правки: ' + error.message, 'error');
  }
}

async function adminCreateCard(event) {
  event.preventDefault();
  const submit = byId('submitCreateCard');
  submit.disabled = true;
  submit.textContent = 'Создание...';
  try {
    remoteState = await api('admin-create', {
      method: 'POST',
      body: {
        project: byId('createProject').value,
        column: byId('createColumn').value,
        title: byId('createTitle').value,
        summary: byId('createSummary').value,
        details: byId('createDetails').value,
        sourceExcerpt: byId('createSourceExcerpt').value,
      },
      timeoutMs: 12000,
    });
    syncCardCatalog();
    byId('createCardDialog').close();
    byId('createCardForm').reset();
    setStatus('Новая задача создана и добавлена на доску.', 'ok');
    renderAll();
  } catch (error) {
    setStatus('Не удалось создать задачу: ' + error.message, 'error');
  } finally {
    submit.disabled = false;
    submit.textContent = 'Создать задачу';
  }
}

function findJiraDuplicate(issue) {
  const key = String(issue.key || '').trim().toUpperCase();
  const title = String(issue.title || '').trim().toLowerCase();
  return currentCards().find(card => {
    const requirementId = String(card.requirementId || '').trim().toUpperCase();
    const cardTitle = String(card.title || '').trim().toLowerCase();
    const sourceText = [card.sourceExcerpt, ...(card.sourceFiles || [])].join(' ').toUpperCase();
    return (key && (requirementId === key || sourceText.indexOf('/BROWSE/' + key) >= 0)) || (title && cardTitle === title);
  }) || null;
}

function renderJiraResults() {
  const container = byId('jiraResults');
  if (!container) return;
  if (!jiraSearchResults.length) {
    container.innerHTML = '';
    return;
  }
  container.innerHTML = jiraSearchResults.map(issue => {
    const duplicate = findJiraDuplicate(issue);
    const action = duplicate
      ? `<button type="button" disabled title="Карточка ${escapeHtml(duplicate.requirementId)} уже есть на доске">Уже на доске</button>`
      : `<button class="primary" type="button" data-jira-import="${escapeHtml(issue.key)}">Добавить</button>`;
    const link = issue.url
      ? `<a class="jira-link" href="${escapeHtml(issue.url)}" target="_blank" rel="noopener">${escapeHtml(issue.key)}</a>`
      : `<strong>${escapeHtml(issue.key)}</strong>`;
    return `
      <article class="jira-result">
        <div class="jira-result-main">
          <div class="jira-result-meta">
            <span>${link}</span>
            <span>${escapeHtml(issue.projectName || 'Без проекта')}</span>
            <span>${escapeHtml(issue.status || 'Статус не указан')}</span>
            <span>${escapeHtml(issue.issueType || '')}</span>
          </div>
          <div class="jira-result-title">${escapeHtml(issue.title)}</div>
          ${issue.summary ? `<div class="jira-result-summary">${escapeHtml(issue.summary)}</div>` : ''}
        </div>
        <div class="jira-result-actions">${action}</div>
      </article>
    `;
  }).join('');
  for (const button of container.querySelectorAll('[data-jira-import]')) {
    button.addEventListener('click', () => adminJiraImport(button.dataset.jiraImport, button));
  }
}

async function adminJiraSearch() {
  const query = byId('jiraQuery').value.trim();
  const status = byId('jiraSearchStatus');
  if (query.length < 2) {
    status.className = 'inline-status error';
    status.textContent = 'Введите не менее двух символов.';
    return;
  }
  const button = byId('jiraSearchBtn');
  button.disabled = true;
  button.textContent = 'Поиск...';
  status.className = 'inline-status';
  status.textContent = 'Запрашиваем Jira...';
  jiraSearchResults = [];
  renderJiraResults();
  try {
    const result = await api('admin-jira-search?q=' + encodeURIComponent(query), { timeoutMs: 25000 });
    jiraSearchResults = Array.isArray(result.issues) ? result.issues : [];
    status.className = 'inline-status' + (jiraSearchResults.length ? ' ok' : '');
    status.textContent = jiraSearchResults.length
      ? 'Найдено: ' + jiraSearchResults.length + '. Выберите задачу для импорта.'
      : 'Совпадений не найдено.';
    renderJiraResults();
  } catch (error) {
    status.className = 'inline-status error';
    status.textContent = 'Поиск недоступен: ' + error.message + '.';
  } finally {
    button.disabled = false;
    button.textContent = 'Найти';
  }
}

async function adminJiraImport(key, button) {
  button.disabled = true;
  button.textContent = 'Добавление...';
  const status = byId('jiraSearchStatus');
  try {
    remoteState = await api('admin-jira-import', {
      method: 'POST',
      body: { key, column: byId('jiraColumn').value },
      timeoutMs: 25000,
    });
    syncCardCatalog();
    status.className = 'inline-status ok';
    status.textContent = key + ' добавлена на доску.';
    renderAll();
    renderJiraResults();
  } catch (error) {
    status.className = 'inline-status error';
    status.textContent = 'Не удалось добавить ' + key + ': ' + error.message + '.';
    button.disabled = false;
    button.textContent = 'Добавить';
  }
}

async function adminStartVote(cardId) {
  try {
    remoteState = await api('admin-vote-start', { method: 'POST', body: { cardId } });
    setStatus('Голосование запущено.', 'ok');
    renderAll();
  } catch (error) {
    setStatus('Не удалось запустить голосование: ' + error.message, 'error');
  }
}

async function adminFinishVote() {
  const summary = remoteState && remoteState.voteSummary ? remoteState.voteSummary : null;
  let column = null;
  if (!summary || !summary.winner) {
    column = window.prompt('Ничья или нет голосов. Введите итоговую колонку: must, should, could, wont или done');
    if (!column) return;
    column = column.trim().toLowerCase();
  }
  try {
    remoteState = await api('admin-vote-finish', { method: 'POST', body: column ? { column } : {} });
    setStatus('Голосование завершено, карточка перенесена.', 'ok');
    renderAll();
  } catch (error) {
    setStatus('Не удалось завершить голосование: ' + error.message, 'error');
  }
}

async function adminCancelVote() {
  try {
    remoteState = await api('admin-vote-cancel', { method: 'POST', body: {} });
    setStatus('Голосование отменено.', 'ok');
    renderAll();
  } catch (error) {
    setStatus('Не удалось отменить голосование: ' + error.message, 'error');
  }
}

function detailActions(card) {
  const activeVote = remoteState && remoteState.activeVote;
  if (isAdmin()) {
    const moveButtons = data.columns.map(col => `
      <button data-move="${escapeHtml(col.id)}" class="${card.moscow === col.id ? 'active' : ''}" title="${escapeHtml(col.title)}">${escapeHtml(col.letter)}</button>
    `).join('');
    const voteButtons = activeVote
      ? '<button id="modalFinishVote">Завершить голосование</button><button id="modalCancelVote">Отменить голосование</button>'
      : '<button id="modalStartVote">Запустить голосование</button>';
    const archiveButton = card.archived
      ? '<button id="modalRestore">Вернуть из архива</button>'
      : '<button id="modalArchive" class="danger">В архив</button>';
    const editButton = editModeCardId === card.id
      ? '<button id="modalCancelEdit">Отменить правку</button>'
      : '<button id="modalEdit">Редактировать</button>';
    return `<div class="move-buttons">${moveButtons}</div><div class="modal-admin-actions">${editButton}${voteButtons}${archiveButton}</div>`;
  }
  if (activeVote && activeVote.cardId === card.id) {
    return `<div class="move-buttons vote-buttons">${voteButtonsHtml(activeVote)}</div>`;
  }
  return '<div class="subtle">Админ может запустить голосование по этой карточке.</div>';
}

function bindDetailActions(card) {
  for (const button of document.querySelectorAll('[data-move]')) {
    button.addEventListener('click', () => adminMove(card.id, button.dataset.move));
  }
  for (const button of document.querySelectorAll('[data-vote-column]')) {
    button.addEventListener('click', () => submitVote(button.dataset.voteColumn));
  }
  const start = byId('modalStartVote');
  if (start) start.addEventListener('click', () => adminStartVote(card.id));
  const finish = byId('modalFinishVote');
  if (finish) finish.addEventListener('click', () => adminFinishVote());
  const cancel = byId('modalCancelVote');
  if (cancel) cancel.addEventListener('click', () => adminCancelVote());
  const archive = byId('modalArchive');
  if (archive) archive.addEventListener('click', () => adminArchive(card.id));
  const restore = byId('modalRestore');
  if (restore) restore.addEventListener('click', () => adminRestore(card.id));
  const edit = byId('modalEdit');
  if (edit) edit.addEventListener('click', () => {
    editModeCardId = card.id;
    openDetail(card.id, true);
  });
  const cancelEdit = byId('modalCancelEdit');
  if (cancelEdit) cancelEdit.addEventListener('click', () => {
    editModeCardId = null;
    openDetail(card.id, true);
  });
  const saveEdit = byId('saveCardEdit');
  if (saveEdit) saveEdit.addEventListener('click', () => adminSaveEdit(card.id));
  const editForm = byId('adminEditForm');
  if (editForm) {
    for (const field of editForm.querySelectorAll('input, textarea')) {
      field.addEventListener('input', () => { editForm.dataset.dirty = 'true'; });
    }
  }
}

function adminEditHtml(card) {
  if (!isAdmin() || editModeCardId !== card.id) return '';
  return `
    <section class="admin-edit-form" id="adminEditForm" data-dirty="false">
      <div class="section-title">Редактирование задачи</div>
      <label>
        <span>Название</span>
        <input id="editTitle" class="field" type="text" maxlength="240" value="${escapeHtml(card.title)}">
      </label>
      <label>
        <span>Краткий текст</span>
        <textarea id="editSummary" rows="4">${escapeHtml(card.summary)}</textarea>
      </label>
      <label>
        <span>Основные моменты</span>
        <textarea id="editDetails" rows="7">${escapeHtml((card.details || []).join('\n'))}</textarea>
      </label>
      <label>
        <span>Фрагмент источника</span>
        <textarea id="editSourceExcerpt" rows="5">${escapeHtml(card.sourceExcerpt || '')}</textarea>
      </label>
      <div class="modal-admin-actions">
        <button id="saveCardEdit" class="primary">Сохранить правки</button>
      </div>
    </section>
  `;
}

function openDetail(id, keepOpen = false) {
  const card = currentCards().find(item => item.id === id);
  if (!card) return;
  activeCardId = id;
  byId('modalMeta').innerHTML = `
    <span>${escapeHtml(card.requirementId)} · ${escapeHtml(card.project)}</span>
    <span>${escapeHtml(card.sourceType)}</span>
  `;
  byId('modalTitle').textContent = card.title;
  byId('modalMoves').innerHTML = detailActions(card);

  const backlogHtml = card.backlogMatches.length
    ? `<table class="backlog-table">
        <thead><tr><th>ID</th><th>Задача</th><th>Статус</th><th>Сложн.</th><th>Важн.</th></tr></thead>
        <tbody>
          ${card.backlogMatches.map(match => `
            <tr>
              <td>${escapeHtml(match.id)}</td>
              <td><strong>${escapeHtml(match.title)}</strong><br>${escapeHtml(match.effect || match.rationale)}</td>
              <td>${escapeHtml(match.status)}</td>
              <td>${escapeHtml(match.complexity)}</td>
              <td>${escapeHtml(match.importance)}</td>
            </tr>
          `).join('')}
        </tbody>
      </table>`
    : '<div class="subtle">Связь с задачами беклога не зафиксирована.</div>';

  byId('modalBody').innerHTML = `
    ${adminEditHtml(card)}
    <div class="detail-grid">
      <section>
        <div class="section-title">Основные моменты</div>
        <p>${escapeHtml(card.summary)}</p>
        <ul class="detail-list">
          ${card.details.map(item => `<li>${escapeHtml(item)}</li>`).join('')}
        </ul>
      </section>
      <section>
        <div class="section-title">Атрибуты</div>
        <div class="kv"><span>MoSCoW</span><strong>${escapeHtml(card.moscow.toUpperCase())}</strong></div>
        <div class="kv"><span>Статус</span><div>${card.archived ? 'Архив' : 'Активна'}</div></div>
        <div class="kv"><span>Правки</span><div>${card.editedAt ? 'Сохранены админом' : 'Нет'}</div></div>
        <div class="kv"><span>Причина</span><div>${escapeHtml(card.moscowReason)}</div></div>
        <div class="kv"><span>Источник</span><div>${escapeHtml(card.sourceFiles.join(', '))}</div></div>
        <div class="kv"><span>Теги</span><div>${escapeHtml(card.tags.join(', '))}</div></div>
      </section>
    </div>
    <section>
      <div class="section-title">Связь с беклогом</div>
      ${backlogHtml}
    </section>
    <section>
      <div class="section-title">Фрагмент источника</div>
      <p>${escapeHtml(card.sourceExcerpt)}</p>
    </section>
  `;
  bindDetailActions(card);
  const dialog = byId('detailDialog');
  if (!keepOpen && !dialog.open) dialog.showModal();
}
