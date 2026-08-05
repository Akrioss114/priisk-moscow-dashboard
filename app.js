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

function refreshProjectOptions() {
  const select = byId('projectFilter');
  const current = select.value || 'all';
  const projects = [...new Set(sourceCards().map(card => card.project).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'ru'));
  select.innerHTML = '<option value="all">Все проекты</option>' + projects.map(project => `<option value="${escapeHtml(project)}">${escapeHtml(project)}</option>`).join('');
  select.value = projects.indexOf(current) >= 0 ? current : 'all';
  const suggestions = byId('projectSuggestions');
  if (suggestions) suggestions.innerHTML = projects.map(project => `<option value="${escapeHtml(project)}"></option>`).join('');
}

function setupFilters() {
  refreshProjectOptions();
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
      Попробуйте обновить страницу с очисткой кэша: Ctrl+F5. Если вы без VPN, проблема может быть в частичной блокировке файлов данных.
    </div>
  `;
}

function openCreateCard() {
  refreshProjectOptions();
  const column = byId('createColumn');
  column.innerHTML = data.columns.map(col => `<option value="${escapeHtml(col.id)}">${escapeHtml(col.letter + ' · ' + col.title)}</option>`).join('');
  column.value = 'must';
  const dialog = byId('createCardDialog');
  dialog.showModal();
  byId('createTitle').focus();
}

function requestAdminAccess(actionName) {
  if (isAdmin()) return true;
  const dialog = byId('settingsDialog');
  if (!dialog.open) dialog.showModal();
  const status = byId('adminStatus');
  if (status) status.textContent = actionName + ' доступен после входа администратора.';
  byId('adminPin').focus();
  return false;
}

function openJiraDialog() {
  if (!requestAdminAccess('Импорт из Jira')) return;
  const column = byId('jiraColumn');
  column.innerHTML = data.columns.map(col => `<option value="${escapeHtml(col.id)}">${escapeHtml(col.letter + ' · ' + col.title)}</option>`).join('');
  column.value = 'must';
  jiraSearchResults = [];
  renderJiraResults();
  byId('jiraSearchStatus').className = 'inline-status';
  byId('jiraSearchStatus').textContent = 'Введите номер или название тикета.';
  const dialog = byId('jiraDialog');
  dialog.showModal();
  byId('jiraQuery').focus();
}

function showLoadProgress(message) {
  byId('board').innerHTML = `
    <div class="loading-state">
      ${escapeHtml(message)}
    </div>
  `;
}

function addCacheBuster(url, attempt) {
  const separator = url.indexOf('?') >= 0 ? '&' : '?';
  return url + separator + 'try=' + attempt + '&t=' + Date.now();
}

function loadText(url, onSuccess, onError, options = {}) {
  const maxAttempts = options.maxAttempts || 4;
  const timeoutMs = options.timeoutMs || 12000;
  let attempt = 0;

  function runAttempt() {
    attempt += 1;
    let finished = false;
    const requestUrl = attempt > 1 ? addCacheBuster(url, attempt) : url;
    const xhr = new XMLHttpRequest();
    const timer = window.setTimeout(function () {
      if (finished) return;
      finished = true;
      xhr.abort();
      retryOrFail('Таймаут ' + timeoutMs + ' мс при загрузке ' + url + '.');
    }, timeoutMs);

    function retryOrFail(message) {
      if (attempt < maxAttempts) {
        window.setTimeout(runAttempt, 350 * attempt);
        return;
      }
      onError(message + ' Попыток: ' + attempt + '.');
    }

    xhr.open('GET', requestUrl, true);
    xhr.onreadystatechange = function () {
      if (xhr.readyState !== 4 || finished) return;
      finished = true;
      window.clearTimeout(timer);
      if (xhr.status >= 200 && xhr.status < 300) {
        try {
          onSuccess(xhr.responseText);
        } catch (error) {
          onError('Файл ' + url + ' получен, но не разобран браузером: ' + error.message);
        }
      } else {
        retryOrFail('HTTP ' + xhr.status + ' при загрузке ' + url + '.');
      }
    };
    xhr.onerror = function () {
      if (finished) return;
      finished = true;
      window.clearTimeout(timer);
      retryOrFail('Сетевая ошибка при загрузке ' + url + '.');
    };
    xhr.send();
  }

  runAttempt();
}

function loadDashboardData() {
  loadDashboardDataFromChunks(function () {
    showLoadProgress('Загрузка карточек резервным способом...');
    loadText('dashboard-data.json?v=20260630-single-data1', function (payloadText) {
      try {
        initializeDashboard(JSON.parse(payloadText));
      } catch (error) {
        showLoadError('Не удалось разобрать dashboard-data.json: ' + error.message);
      }
    }, function (message) {
      showLoadError('Не удалось загрузить данные карточек. ' + message);
    }, { maxAttempts: 2, timeoutMs: 8000 });
  });
}

function finishDashboardData(parts) {
  try {
    initializeDashboard(JSON.parse(parts.join('')));
  } catch (error) {
    showLoadError('Не удалось разобрать данные дашборда: ' + error.message);
  }
}

function loadDashboardDataFromChunks(onFallback) {
  showLoadProgress('Загрузка манифеста данных...');
  loadText('chunks.json?v=20260630-utf8-chunks1', function (manifestText) {
    let manifest;
    try {
      manifest = JSON.parse(manifestText);
    } catch (error) {
      if (onFallback) onFallback();
      else showLoadError('Не удалось разобрать chunks.json: ' + error.message);
      return;
    }

    const parts = [];
    let index = 0;
    let active = 0;
    let loaded = 0;
    let failed = false;
    const concurrency = Math.min(8, manifest.files.length);

    function fail(message) {
      if (failed) return;
      failed = true;
      if (onFallback) onFallback();
      else showLoadError(message);
    }

    function pump() {
      if (failed) return;
      if (loaded >= manifest.files.length) {
        finishDashboardData(parts);
        return;
      }
      while (active < concurrency && index < manifest.files.length) {
        const partIndex = index;
        const file = manifest.files[partIndex];
        index += 1;
        active += 1;
        showLoadProgress('Загрузка карточек: ' + loaded + ' из ' + manifest.files.length + '...');
        loadText(file + '?v=' + manifest.version, function (partText) {
          parts[partIndex] = partText;
          active -= 1;
          loaded += 1;
          showLoadProgress('Загрузка карточек: ' + loaded + ' из ' + manifest.files.length + '...');
          pump();
        }, function (message) {
          fail('Не удалось загрузить ' + file + '. ' + message);
        }, { maxAttempts: 5, timeoutMs: 15000 });
      }
    }

    pump();
  }, function () {
    if (onFallback) onFallback();
    else showLoadError('Не удалось загрузить chunks.json.');
  }, { maxAttempts: 5, timeoutMs: 15000 });
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
    byId('participantBlock').hidden = true;
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
    const settings = byId('settingsDialog');
    if (settings && settings.open) settings.close();
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
byId('newCardBtn').addEventListener('click', () => {
  if (requestAdminAccess('Создание задач')) openCreateCard();
});
byId('jiraImportBtn').addEventListener('click', openJiraDialog);
byId('settingsBtn').addEventListener('click', () => byId('settingsDialog').showModal());
byId('closeSettings').addEventListener('click', () => byId('settingsDialog').close());
byId('jsonBtn').addEventListener('click', exportJson);
byId('csvBtn').addEventListener('click', exportCsv);
byId('saveParticipant').addEventListener('click', saveParticipant);
byId('participantName').addEventListener('keydown', event => {
  if (event.key === 'Enter') saveParticipant();
});
byId('changeParticipant').addEventListener('click', () => {
  participant = null;
  localStorage.removeItem(PARTICIPANT_KEY);
  byId('settingsDialog').close();
  showParticipantForm('Введите новое имя участника.');
  renderAll();
});
byId('adminLogin').addEventListener('click', loginAdmin);
byId('adminPin').addEventListener('keydown', event => {
  if (event.key === 'Enter') loginAdmin();
});
byId('adminLogout').addEventListener('click', () => logoutAdmin());
byId('closeDialog').addEventListener('click', () => byId('detailDialog').close());
byId('detailDialog').addEventListener('close', () => { activeCardId = null; });
byId('createCardForm').addEventListener('submit', adminCreateCard);
byId('closeCreateCard').addEventListener('click', () => byId('createCardDialog').close());
byId('cancelCreateCard').addEventListener('click', () => byId('createCardDialog').close());
byId('closeJira').addEventListener('click', () => byId('jiraDialog').close());
byId('jiraSearchBtn').addEventListener('click', adminJiraSearch);
byId('jiraQuery').addEventListener('keydown', event => {
  if (event.key === 'Enter') {
    event.preventDefault();
    adminJiraSearch();
  }
});

loadDashboardData();
