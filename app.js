function exportRows() {
  return currentCards()
    .filter(card => !card.archived)
    .map(card => ({
      id: card.id,
      requirementId: card.requirementId,
      title: card.title,
      project: card.project,
      moscow: card.moscow,
      archived: card.archived ? 'да' : 'нет',
      sourceType: card.sourceType,
      sourceFiles: card.sourceFiles.join(', '),
      inBacklog: card.backlogMatches.length ? 'да' : 'нет',
      backlogIds: card.backlogMatches.map(match => match.id).join(', '),
      backlogTitles: card.backlogMatches.map(match => match.title).join(' | '),
      summary: card.summary,
    }));
}

function download(name, mime, content) {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function csvEscape(value) {
  return '"' + String(value == null ? '' : value).replace(/"/g, '""') + '"';
}

function exportCsv() {
  const rows = exportRows();
  const headers = Object.keys(rows[0] || { id: '' });
  const csv = [headers.map(csvEscape).join(';')]
    .concat(rows.map(row => headers.map(header => csvEscape(row[header])).join(';')))
    .join('\n');
  download('moscow-prioritization.csv', 'text/csv;charset=utf-8', '\ufeff' + csv);
}

function exportJson() {
  const payload = {
    exportedAt: new Date().toISOString(),
    sourceGeneratedAt: data.generatedAt,
    boardState: remoteState ? remoteState.board : null,
    cards: exportRows(),
  };
  download('moscow-prioritization.json', 'application/json;charset=utf-8', JSON.stringify(payload, null, 2));
}

function setupFilters() {
  const select = byId('projectFilter');
  const projects = [...new Set(data.cards.map(card => card.project))].sort((a, b) => a.localeCompare(b, 'ru'));
  select.innerHTML = '<option value="all">Все проекты</option>' + projects.map(project => `<option value="${escapeHtml(project)}">${escapeHtml(project)}</option>`).join('');
  for (const id of ['search', 'projectFilter', 'backlogFilter']) {
    byId(id).addEventListener('input', renderAll);
    byId(id).addEventListener('change', renderAll);
  }
  byId('clearFilters').addEventListener('click', () => {
    byId('search').value = '';
    byId('projectFilter').value = 'all';
    byId('backlogFilter').value = 'all';
    renderAll();
  });
  byId('archiveToggle').addEventListener('click', () => {
    archiveMode = !archiveMode;
    renderAll();
  });
}

function showLoadError(message) {
  byId('board').innerHTML = `
    <div class="loading-state error">
      <strong>Не удалось загрузить данные дашборда.</strong><br>
      ${escapeHtml(message)}<br>
      Попробуйте обновить страницу с очисткой кэша: Ctrl+F5.
    </div>
  `;
}

function loadText(url, onSuccess, onError) {
  const xhr = new XMLHttpRequest();
  xhr.open('GET', url, true);
  xhr.onreadystatechange = function () {
    if (xhr.readyState !== 4) return;
    if (xhr.status >= 200 && xhr.status < 300) {
      try {
        onSuccess(xhr.responseText);
      } catch (error) {
        onError('Файл данных получен, но не разобран браузером: ' + error.message);
      }
    } else {
      onError('HTTP ' + xhr.status + ' при загрузке ' + url + '.');
    }
  };
  xhr.onerror = function () {
    onError('Сетевая ошибка при загрузке ' + url + '.');
  };
  xhr.send();
}

function loadDashboardData() {
  loadText('chunks.json?v=20260629-functions2', function (manifestText) {
    let manifest;
    try {
      manifest = JSON.parse(manifestText);
    } catch (error) {
      showLoadError('Не удалось разобрать chunks.json: ' + error.message);
      return;
    }
    const parts = [];
    let index = 0;
    function loadNext() {
      if (index >= manifest.files.length) {
        try {
          initializeDashboard(JSON.parse(parts.join('')));
        } catch (error) {
          showLoadError('Не удалось разобрать данные дашборда: ' + error.message);
        }
        return;
      }
      const file = manifest.files[index];
      loadText(file + '?v=' + manifest.version, function (partText) {
        parts.push(partText);
        index += 1;
        loadNext();
      }, showLoadError);
    }
    loadNext();
  }, showLoadError);
}

function initializeDashboard(payload) {
  data = payload;
  ensureDoneColumn(data);
  cardById = new Map(data.cards.map(card => [card.id, card]));
  columns = data.columns;
  remoteState = { board: emptyBoardState(), activeVote: null, voteSummary: null };
  loadLocalIdentity();
  setupFilters();
  renderSources();
  renderAll();
  loadRemoteState();
  startPolling();
}

async function saveParticipant() {
  try {
    const saved = await api('participant', {
      method: 'POST',
      body: {
        participantId: participant && participant.id,
        name: byId('participantName').value,
      },
    });
    participant = saved.participant;
    localStorage.setItem(PARTICIPANT_KEY, JSON.stringify(participant));
    setStatus('Участник сохранён: ' + participant.name, 'ok');
    renderAll();
  } catch (error) {
    setStatus('Не удалось сохранить участника: ' + error.message, 'error');
  }
}

async function loginAdmin() {
  try {
    const result = await api('admin-login', {
      method: 'POST',
      body: { pin: byId('adminPin').value },
    });
    adminToken = result.token;
    localStorage.setItem(ADMIN_KEY, adminToken);
    byId('adminPin').value = '';
    setStatus('Админский режим включён.', 'ok');
    await loadRemoteState(true);
    renderAll();
  } catch (error) {
    setStatus('Не удалось войти как админ: ' + error.message, 'error');
  }
}

function logoutAdmin(render = true) {
  adminToken = '';
  archiveMode = false;
  localStorage.removeItem(ADMIN_KEY);
  if (render) {
    setStatus('Админский режим выключен.', 'ok');
    renderAll();
  }
}

byId('refreshBtn').addEventListener('click', () => loadRemoteState());
byId('jsonBtn').addEventListener('click', exportJson);
byId('csvBtn').addEventListener('click', exportCsv);
byId('saveParticipant').addEventListener('click', saveParticipant);
byId('participantName').addEventListener('keydown', event => {
  if (event.key === 'Enter') saveParticipant();
});
byId('adminLogin').addEventListener('click', loginAdmin);
byId('adminPin').addEventListener('keydown', event => {
  if (event.key === 'Enter') loginAdmin();
});
byId('adminLogout').addEventListener('click', () => logoutAdmin());
byId('closeDialog').addEventListener('click', () => byId('detailDialog').close());
byId('detailDialog').addEventListener('close', () => { activeCardId = null; });

loadDashboardData();
