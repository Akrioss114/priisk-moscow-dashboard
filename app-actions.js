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
    return `<div class="move-buttons">${moveButtons}</div><div class="modal-admin-actions">${voteButtons}${archiveButton}</div>`;
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
  bindDetailActions(card);

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
  const dialog = byId('detailDialog');
  if (!keepOpen && !dialog.open) dialog.showModal();
}
