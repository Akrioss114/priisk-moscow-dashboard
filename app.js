let data = null;
    let cardById = null;
    let storageKey = '';
    let columns = [];
    let state = null;
    let activeCardId = null;
    let suppressClick = false;

    function escapeHtml(value) {
      return String(value == null ? '' : value)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
    }

    function initialState() {
      const order = {};
      for (const col of columns) order[col] = [];
      const positions = {};
      for (const card of data.cards) {
        const col = columns.indexOf(card.moscow) >= 0 ? card.moscow : card.suggestedMoscow;
        positions[card.id] = col;
        order[col].push(card.id);
      }
      return { positions, order };
    }

    function loadState() {
      try {
        const raw = localStorage.getItem(storageKey);
        if (!raw) return initialState();
        const parsed = JSON.parse(raw);
        const fallback = initialState();
        for (const card of data.cards) {
          if (!parsed.positions || columns.indexOf(parsed.positions[card.id]) < 0) {
            parsed.positions = parsed.positions || {};
            parsed.positions[card.id] = fallback.positions[card.id];
          }
        }
        parsed.order = parsed.order || fallback.order;
        for (const col of columns) {
          parsed.order[col] = (parsed.order[col] || []).filter(id => cardById.has(id));
        }
        for (const card of data.cards) {
          const col = parsed.positions[card.id];
          if (parsed.order[col].indexOf(card.id) < 0) parsed.order[col].push(card.id);
        }
        return parsed;
      } catch (error) {
        return initialState();
      }
    }

    function saveState() {
      try {
        localStorage.setItem(storageKey, JSON.stringify(state));
      } catch (error) {}
    }

    function cloneCardWithMoscow(card) {
      const cloned = {};
      for (const key in card) {
        if (Object.prototype.hasOwnProperty.call(card, key)) cloned[key] = card[key];
      }
      cloned.moscow = state.positions[card.id] || card.moscow;
      return cloned;
    }

    function currentCards() {
      return data.cards.map(cloneCardWithMoscow);
    }

    function filterCard(card) {
      const query = document.getElementById('search').value.trim().toLowerCase();
      const project = document.getElementById('projectFilter').value;
      const backlog = document.getElementById('backlogFilter').value;
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

    function renderStats(cards) {
      const visible = cards.filter(filterCard);
      const withBacklog = visible.filter(card => card.backlogMatches.length > 0).length;
      const backlogOnly = visible.filter(card => card.project === 'Беклог').length;
      const mCount = visible.filter(card => card.moscow === 'must').length;
      const items = [
        ['Карточек', visible.length],
        ['Есть в беклоге', withBacklog],
        ['Только беклог', backlogOnly],
        ['Must сейчас', mCount],
      ];
      document.getElementById('stats').innerHTML = items.map(([label, value]) => `
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
      document.getElementById('projectBars').innerHTML = rows.map(([project, count]) => `
        <div class="bar-row">
          <div>${escapeHtml(project)}</div>
          <div class="bar-track"><div class="bar-fill" style="width:${Math.max(4, Math.round(count / max * 100))}%"></div></div>
          <div>${count}</div>
        </div>
      `).join('');
    }

    function renderSources() {
      const sourceList = data.sourceFiles.map(src => `<div><strong>${escapeHtml(src.project)}:</strong> ${escapeHtml(src.file)}</div>`).join('');
      document.getElementById('sources').innerHTML = `
        ${sourceList}
        <div><strong>MoSCoW:</strong> M/S/C/W заданы как стартовая классификация; решения встречи сохраняются в этом браузере и выгружаются через CSV/JSON.</div>
        <div><strong>Беклог:</strong> пересечения отмечены на карточках, задачи без явного дубля добавлены отдельно как источник "Беклог".</div>
      `;
      document.getElementById('generatedAt').textContent = data.generatedAt;
    }

    function cardHtml(card) {
      const backlogBadge = card.backlogMatches.length ? '<span class="badge backlog">есть в беклоге</span>' : '';
      const tags = card.tags
        .filter(tag => tag && tag !== 'есть в беклоге')
        .slice(0, 3)
        .map(tag => `<span class="badge">${escapeHtml(tag)}</span>`)
        .join('');
      return `
        <article class="card" draggable="false" data-card-id="${escapeHtml(card.id)}" tabindex="0">
          <div class="card-meta">
            <span>${escapeHtml(card.requirementId)}</span>
            <span>${escapeHtml(card.project)}</span>
          </div>
          <div class="card-title">${escapeHtml(card.title)}</div>
          <div class="summary">${escapeHtml(card.summary)}</div>
          <div class="badges">${backlogBadge}${tags}</div>
        </article>
      `;
    }

    function renderBoard() {
      const cards = currentCards();
      renderStats(cards);
      renderProjectBars(cards);
      const board = document.getElementById('board');
      board.innerHTML = data.columns.map(col => {
        const laneIds = state.order[col.id] || [];
        const laneCards = laneIds.map(id => cardById.get(id)).filter(Boolean)
          .map(cloneCardWithMoscow)
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
      if (event.button !== 0) return;
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

      function onUp() {
        const targetColumn = moved && activeZone ? activeZone.dataset.column : null;
        cleanup();
        if (targetColumn) moveCard(id, targetColumn);
        window.setTimeout(() => { suppressClick = false; }, 80);
      }

      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup', onUp);
    }

    function moveCard(id, column) {
      if (columns.indexOf(column) < 0) return;
      for (const col of columns) {
        state.order[col] = (state.order[col] || []).filter(cardId => cardId !== id);
      }
      state.positions[id] = column;
      state.order[column].push(id);
      saveState();
      renderBoard();
      if (activeCardId === id && document.getElementById('detailDialog').open) {
        openDetail(id, true);
      }
    }

    function openDetail(id, keepOpen = false) {
      const card = currentCards().find(item => item.id === id);
      if (!card) return;
      activeCardId = id;
      document.getElementById('modalMeta').innerHTML = `
        <span>${escapeHtml(card.requirementId)} · ${escapeHtml(card.project)}</span>
        <span>${escapeHtml(card.sourceType)}</span>
      `;
      document.getElementById('modalTitle').textContent = card.title;
      document.getElementById('modalMoves').innerHTML = data.columns.map(col => `
        <button data-move="${escapeHtml(col.id)}" class="${card.moscow === col.id ? 'active' : ''}" title="${escapeHtml(col.title)}">${escapeHtml(col.letter)}</button>
      `).join('');
      for (const button of document.querySelectorAll('#modalMoves button')) {
        button.addEventListener('click', () => moveCard(id, button.dataset.move));
      }

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

      document.getElementById('modalBody').innerHTML = `
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
      const dialog = document.getElementById('detailDialog');
      if (!keepOpen && !dialog.open) dialog.showModal();
    }

    function exportRows() {
      return currentCards().map(card => ({
        id: card.id,
        requirementId: card.requirementId,
        title: card.title,
        project: card.project,
        moscow: card.moscow,
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
        cards: exportRows(),
      };
      download('moscow-prioritization.json', 'application/json;charset=utf-8', JSON.stringify(payload, null, 2));
    }

    function setupFilters() {
      const select = document.getElementById('projectFilter');
      const projects = [...new Set(data.cards.map(card => card.project))].sort((a, b) => a.localeCompare(b, 'ru'));
      select.innerHTML = '<option value="all">Все проекты</option>' + projects.map(project => `<option value="${escapeHtml(project)}">${escapeHtml(project)}</option>`).join('');
      for (const id of ['search', 'projectFilter', 'backlogFilter']) {
        document.getElementById(id).addEventListener('input', renderBoard);
        document.getElementById(id).addEventListener('change', renderBoard);
      }
      document.getElementById('clearFilters').addEventListener('click', () => {
        document.getElementById('search').value = '';
        document.getElementById('projectFilter').value = 'all';
        document.getElementById('backlogFilter').value = 'all';
        renderBoard();
      });
    }

    function showLoadError(message) {
      document.getElementById('board').innerHTML = `
        <div class="loading-state error">
          <strong>Не удалось загрузить данные дашборда.</strong><br>
          ${escapeHtml(message)}<br>
          Попробуйте обновить страницу с очисткой кэша: Ctrl+F5.
        </div>
      `;
    }

    function initializeDashboard(payload) {
      data = payload;
      cardById = new Map(data.cards.map(card => [card.id, card]));
      storageKey = 'moscow-dashboard-state-v2:' + data.generatedAt;
      columns = data.columns.map(col => col.id);
      state = loadState();
      setupFilters();
      renderSources();
      renderBoard();
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
      loadText('chunks.json?v=20260603-chunks1', function (manifestText) {
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

    document.getElementById('resetBtn').addEventListener('click', () => {
      if (!data) return;
      state = initialState();
      saveState();
      renderBoard();
    });
    document.getElementById('jsonBtn').addEventListener('click', exportJson);
    document.getElementById('csvBtn').addEventListener('click', exportCsv);
    document.getElementById('closeDialog').addEventListener('click', () => document.getElementById('detailDialog').close());
    document.getElementById('detailDialog').addEventListener('close', () => { activeCardId = null; });

    loadDashboardData();
