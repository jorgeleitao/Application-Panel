// Painel de Candidaturas: lógica da tela.
// O servidor (server.js) guarda os dados em data.json e os CVs na pasta cvs/.

(() => {
  /* ---------- Configuração ---------- */

  const STATUSES = [
    { key: 'enviada',     label: 'Enviada',      color: '--s-sent' },
    { key: 'analise',     label: 'Em análise',   color: '--s-review' },
    { key: 'entrevista',  label: 'Entrevista',   color: '--s-interview' },
    { key: 'proposta',    label: 'Proposta',     color: '--s-offer' },
    { key: 'contratado',  label: 'Contratado',   color: '--s-hired' },
    { key: 'recusada',    label: 'Recusada',     color: '--s-rejected' },
    { key: 'semresposta', label: 'Sem resposta', color: '--s-ghost' },
  ];

  const ACTIVE_STATUSES = ['enviada', 'analise', 'entrevista', 'proposta']; // ainda sem desfecho
  const INTERVIEW_STATUSES = ['entrevista', 'proposta', 'contratado'];      // contam como "chegou numa entrevista"

  const TOAST_MS = 3200;
  const CONFIRM_DELETE_MS = 4000;

  // Campo do formulário -> nome do campo na candidatura.
  const FORM_FIELDS = {
    company: '#f-company',
    role: '#f-role',
    url: '#f-url',
    sentAt: '#f-sent',
    source: '#f-source',
    cv: '#f-cv',
    status: '#f-status',
    notes: '#f-notes',
    interviewAt: '#f-idate',
    interviewStage: '#f-istage',
    interviewNotes: '#f-inotes',
  };

  const CSV_COLUMNS = [
    ['company', 'Empresa'],
    ['role', 'Cargo'],
    ['url', 'Link'],
    ['sentAt', 'Enviada em'],
    ['source', 'Origem'],
    ['cv', 'CV enviado'],
    ['status', 'Status'],
    ['notes', 'Observações'],
    ['interviewAt', 'Data da entrevista'],
    ['interviewStage', 'Etapa'],
    ['interviewNotes', 'Obs. da entrevista'],
  ];

  /* ---------- Estado ---------- */

  let apps = [];
  let settings = {};          // por enquanto só { startedAt }
  let cvFiles = [];           // CVs já guardados na pasta cvs/
  let isLoaded = false;
  let activeFilter = 'all';
  let searchText = '';
  let editingId = null;
  let deleteArmed = false;
  let deleteTimer = null;
  let toastTimer = null;
  let saveQueue = Promise.resolve();

  const $ = (selector) => document.querySelector(selector);

  /* ---------- Texto, datas e links ---------- */

  function escapeHtml(value) {
    const map = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
    return String(value ?? '').replace(/[&<>"']/g, (char) => map[char]);
  }

  function newId() {
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  }

  // As datas são guardadas como "AAAA-MM-DD", sem horário, para não sofrer com fuso.
  function todayStr() {
    const now = new Date();
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const day = String(now.getDate()).padStart(2, '0');
    return `${now.getFullYear()}-${month}-${day}`;
  }

  function parseDate(text) {
    const [year, month, day] = String(text || '').split('-').map(Number);
    return year && month && day ? new Date(year, month - 1, day) : null;
  }

  function formatDate(text) {
    const [year, month, day] = String(text || '').split('-');
    return year && month && day ? `${day}/${month}/${year}` : '—';
  }

  function daysBetween(from, to) {
    const start = parseDate(from);
    const end = parseDate(to);
    if (!start || !end) return 0;
    const msPerDay = 24 * 60 * 60 * 1000;
    return Math.max(0, Math.round((end - start) / msPerDay));
  }

  // Aceita link colado sem "https://" e descarta o que não for http(s).
  function normalizeUrl(text) {
    let value = String(text || '').trim();
    if (!value) return '';
    if (!/^https?:\/\//i.test(value)) value = 'https://' + value;
    try {
      const url = new URL(value);
      return url.protocol === 'http:' || url.protocol === 'https:' ? url.href : '';
    } catch {
      return '';
    }
  }

  function hostOf(url) {
    try {
      return new URL(url).hostname.replace(/^www\./, '');
    } catch {
      return 'link';
    }
  }

  function findStatus(key) {
    return STATUSES.find((status) => status.key === key) || STATUSES[0];
  }

  function findApp(id) {
    return apps.find((app) => app.id === id);
  }

  function showToast(message) {
    const toast = $('#toast');
    toast.textContent = message;
    toast.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => (toast.hidden = true), TOAST_MS);
  }

  /* ---------- Cálculos ---------- */

  // Início da busca: a data escolhida; senão a primeira candidatura; senão hoje.
  function searchStartDate() {
    if (settings.startedAt) return settings.startedAt;
    const sentDates = apps.map((app) => app.sentAt).filter(Boolean).sort();
    return sentDates[0] || todayStr();
  }

  function reachedInterview(app) {
    return Boolean(app.interviewAt || app.interviewNotes || INTERVIEW_STATUSES.includes(app.status));
  }

  function countByStatus(statusKey) {
    return apps.filter((app) => app.status === statusKey).length;
  }

  // Candidaturas que aparecem na lista, já filtradas, buscadas e ordenadas (mais recentes primeiro).
  function visibleApps() {
    const text = searchText.trim().toLowerCase();
    return apps
      .filter((app) => activeFilter === 'all' || app.status === activeFilter)
      .filter((app) => !text || [app.company, app.role, app.cv, app.source].join(' ').toLowerCase().includes(text))
      .sort(
        (a, b) =>
          (b.sentAt || '').localeCompare(a.sentAt || '') || (b.createdAt || 0) - (a.createdAt || 0),
      );
  }

  /* ---------- Desenho da tela ---------- */

  function render() {
    renderStats();
    renderChips();
    renderList();
    renderCvSuggestions();
  }

  function renderStats() {
    const total = apps.length;
    const start = searchStartDate();
    const active = apps.filter((app) => ACTIVE_STATUSES.includes(app.status)).length;
    const answered = apps.filter((app) => app.status !== 'enviada' && app.status !== 'semresposta').length;

    $('#total').textContent = total;
    $('#m-days').textContent = daysBetween(start, todayStr());
    $('#m-active').textContent = active;
    $('#m-int').textContent = apps.filter(reachedInterview).length;
    $('#m-rate').textContent = `${total ? Math.round((answered / total) * 100) : 0}%`;
    $('#sub').textContent = total ? `desde ${formatDate(start)}` : 'Registre a primeira para começar a contar';

    const usedStatuses = STATUSES.map((status) => ({ ...status, count: countByStatus(status.key) })).filter(
      (status) => status.count > 0,
    );
    $('#bar').hidden = !total;
    $('#bar').innerHTML = usedStatuses
      .map(
        (s) => `<i style="--c:var(${s.color});flex:${s.count}" title="${escapeHtml(s.label)}: ${s.count}"></i>`,
      )
      .join('');
    $('#legend').innerHTML = usedStatuses
      .map((s) => `<span style="--c:var(${s.color})">${escapeHtml(s.label)} <b class="mono">${s.count}</b></span>`)
      .join('');

    showStartDate(start);
    renderHiredBanner(start);
  }

  function showStartDate(start) {
    $('#start').innerHTML =
      `<span>Início da busca: <b class="mono">${formatDate(start)}</b></span>` +
      `<button type="button" id="chg">alterar</button>`;
  }

  function showStartEditor() {
    $('#start').innerHTML =
      `<label for="sd" style="display:inline">Início da busca</label>` +
      `<input id="sd" type="date" value="${escapeHtml(searchStartDate())}" style="width:auto;min-height:32px">` +
      `<button type="button" id="sdok">salvar</button>`;
    $('#sd').focus();
  }

  // Mostra quantas candidaturas foram enviadas, e em quantos dias, até a vaga conseguida mais recente.
  function renderHiredBanner(start) {
    const banner = $('#hired');
    const hired = apps
      .filter((app) => app.status === 'contratado')
      .sort((a, b) => (b.hiredAt || '').localeCompare(a.hiredAt || ''))[0];

    banner.hidden = !hired;
    if (!hired) return;

    const sentUntilThen = apps.filter((app) => app.sentAt <= hired.sentAt).length;
    const days = daysBetween(start, hired.hiredAt || todayStr());
    banner.textContent = `Vaga conseguida na ${hired.company}: ${sentUntilThen} candidaturas enviadas em ${days} dias de busca.`;
  }

  function renderChips() {
    const chip = (key, label, count) =>
      `<button class="chip" type="button" data-f="${key}" aria-pressed="${activeFilter === key}">` +
      `${escapeHtml(label)} <small>${count}</small></button>`;

    const statusChips = STATUSES.map((status) => ({ ...status, count: countByStatus(status.key) }))
      .filter((status) => status.count > 0 || status.key === activeFilter)
      .map((status) => chip(status.key, status.label, status.count));

    $('#chips').innerHTML = [chip('all', 'Todas', apps.length), ...statusChips].join('');
  }

  function renderList() {
    const list = $('#list');

    if (!isLoaded) {
      list.innerHTML = '<div class="empty"><h2>Carregando suas candidaturas…</h2></div>';
      return;
    }
    if (!apps.length) {
      list.innerHTML = emptyStateHtml();
      return;
    }

    const rows = visibleApps();
    if (!rows.length) {
      list.innerHTML = '<div class="empty"><h2>Nada encontrado com esse filtro</h2></div>';
      return;
    }

    list.innerHTML =
      '<div class="head" aria-hidden="true"><span>Empresa e cargo</span><span>Enviada</span>' +
      '<span>CV enviado</span><span>Status</span><span></span></div>' +
      rows.map(rowHtml).join('');
  }

  function emptyStateHtml() {
    return `
      <div class="empty">
        <h2>Nenhuma candidatura registrada</h2>
        <ol>
          <li>Clique em “Nova candidatura” assim que enviar o CV para uma vaga.</li>
          <li>Cole o link da vaga e informe qual arquivo de CV você mandou.</li>
          <li>Se houver entrevista, anote as perguntas e o resultado na mesma ficha.</li>
        </ol>
        <button class="btn primary" type="button" data-act="new">+ Nova candidatura</button>
      </div>`;
  }

  function rowHtml(app) {
    const status = findStatus(app.status);
    const link = normalizeUrl(app.url);
    const options = STATUSES.map(
      (s) => `<option value="${s.key}"${s.key === app.status ? ' selected' : ''}>${escapeHtml(s.label)}</option>`,
    ).join('');

    const linkHtml = link
      ? `<a href="${escapeHtml(link)}" target="_blank" rel="noopener">${escapeHtml(hostOf(link))} ↗</a>`
      : '';
    const notesTag = app.interviewNotes ? '<span class="tag">notas de entrevista</span>' : '';

    // Sem espaços entre os elementos de .co: o recuo vem do CSS, não de espaço em branco.
    return `
      <div class="row" data-id="${escapeHtml(app.id)}">
        <div class="co"><b>${escapeHtml(app.company || 'Sem nome')}</b><span>${escapeHtml(app.role || 'Cargo não informado')}</span>${linkHtml}${notesTag}</div>
        <div class="date mono">${formatDate(app.sentAt)}</div>
        <div class="cv mono">${cvCellHtml(app.cv)}</div>
        <div class="stw"><select class="pill" style="--c:var(${status.color})" data-status-for="${escapeHtml(app.id)}" aria-label="Status de ${escapeHtml(app.company)}">${options}</select></div>
        <button class="btn open" type="button" data-open="${escapeHtml(app.id)}">Abrir</button>
      </div>`;
  }

  // Se o CV foi enviado pelo painel, o nome vira um link que abre o arquivo.
  function cvCellHtml(name) {
    if (!name) return '—';
    if (!cvFiles.includes(name)) return escapeHtml(name);
    return `<a href="/cvs/${encodeURIComponent(name)}" target="_blank" rel="noopener">${escapeHtml(name)}</a>`;
  }

  // Sugestões do campo "CV enviado": os arquivos da pasta cvs/ e tudo que já foi usado.
  function renderCvSuggestions() {
    const names = new Set([...cvFiles, ...apps.map((app) => (app.cv || '').trim())]);
    names.delete('');
    $('#cvlist').innerHTML = [...names].map((name) => `<option value="${escapeHtml(name)}"></option>`).join('');
  }

  /* ---------- Salvar no servidor ---------- */

  // Gravações entram numa fila para nunca se atropelarem.
  function persist() {
    saveQueue = saveQueue
      .catch(() => {})
      .then(async () => {
        const response = await fetch('/api/data', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ apps, settings }),
        });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
      });
    return saveQueue;
  }

  async function uploadCv(file) {
    if (!file) return;
    try {
      const response = await fetch(`/api/cv?name=${encodeURIComponent(file.name)}`, { method: 'PUT', body: file });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const { name } = await response.json();

      if (!cvFiles.includes(name)) cvFiles.push(name);
      $('#f-cv').value = name;
      renderCvSuggestions();
      showToast(`CV adicionado: ${name}`);
    } catch {
      showToast('Não foi possível enviar o arquivo. Use PDF, DOC, DOCX ou ODT de até 10 MB.');
    } finally {
      $('#cv-file').value = '';
    }
  }

  /* ---------- Painel lateral (criar, editar, excluir) ---------- */

  function fillStatusOptions() {
    $('#f-status').innerHTML = STATUSES.map((s) => `<option value="${s.key}">${escapeHtml(s.label)}</option>`).join('');
  }

  function lastUsedCv() {
    const latest = [...apps].sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0))[0];
    return latest?.cv || '';
  }

  function resetDeleteButton() {
    deleteArmed = false;
    clearTimeout(deleteTimer);
    $('#del').textContent = 'Excluir';
  }

  function openPanel(id) {
    const app = id ? findApp(id) : null;
    if (id && !app) return;

    editingId = id || null;
    resetDeleteButton();

    $('#ptitle').textContent = app ? app.company || 'Candidatura' : 'Nova candidatura';
    fillForm(app);
    $('#del').hidden = !app;
    $('#overlay').hidden = false;
    setTimeout(() => $('#f-company').focus(), 30);
  }

  function closePanel() {
    $('#overlay').hidden = true;
    editingId = null;
  }

  function fillForm(app) {
    const values = app || { sentAt: todayStr(), cv: lastUsedCv(), status: 'enviada' };
    for (const [field, selector] of Object.entries(FORM_FIELDS)) {
      $(selector).value = values[field] || '';
    }
    if (app && !app.sentAt) $(FORM_FIELDS.sentAt).value = todayStr();
    if (app && !app.status) $(FORM_FIELDS.status).value = 'enviada';
  }

  function readForm() {
    const form = {};
    for (const [field, selector] of Object.entries(FORM_FIELDS)) {
      form[field] = $(selector).value;
    }
    return {
      ...form,
      company: form.company.trim(),
      role: form.role.trim(),
      cv: form.cv.trim(),
      url: normalizeUrl(form.url),
      sentAt: form.sentAt || todayStr(),
    };
  }

  /* ---------- Ações ---------- */

  async function submitForm(event) {
    event.preventDefault();
    const fields = readForm();
    if (!fields.company) return $('#f-company').focus();

    const previous = editingId ? findApp(editingId) : null;
    const application = {
      ...fields,
      createdAt: previous?.createdAt || Date.now(),
      updatedAt: Date.now(),
    };
    if (fields.status === 'contratado') application.hiredAt = previous?.hiredAt || todayStr();

    if (previous) {
      const index = apps.indexOf(previous);
      apps[index] = { ...previous, ...application, id: previous.id };
    } else {
      apps.push({ ...application, id: newId() });
    }

    $('#save').disabled = true;
    try {
      await persist();
      showToast('Candidatura salva.');
      closePanel();
    } catch {
      showToast('Não foi possível salvar. O servidor (node server.js) está rodando?');
    } finally {
      $('#save').disabled = false;
      render();
    }
  }

  function changeStatus(id, statusKey) {
    const app = findApp(id);
    if (!app || app.status === statusKey) return;

    app.status = statusKey;
    app.updatedAt = Date.now();
    if (statusKey === 'contratado' && !app.hiredAt) app.hiredAt = todayStr();

    render();
    persist().catch(() => showToast('Não foi possível salvar o status.'));
  }

  // O botão excluir pede confirmação: o primeiro clique arma, o segundo exclui.
  function deleteApplication() {
    if (!editingId) return;

    if (!deleteArmed) {
      deleteArmed = true;
      $('#del').textContent = 'Confirmar exclusão';
      clearTimeout(deleteTimer);
      deleteTimer = setTimeout(resetDeleteButton, CONFIRM_DELETE_MS);
      return;
    }

    const id = editingId;
    apps = apps.filter((app) => app.id !== id);
    render();
    closePanel();
    persist()
      .then(() => showToast('Candidatura excluída.'))
      .catch(() => showToast('Não foi possível salvar a exclusão.'));
  }

  function saveStartDate() {
    const value = $('#sd').value;
    if (!value) return renderStats();

    settings.startedAt = value;
    renderStats();
    persist().catch(() => showToast('Não foi possível salvar a data.'));
  }

  function exportCsv() {
    const quote = (value) => `"${String(value ?? '').replace(/"/g, '""')}"`;
    const header = CSV_COLUMNS.map(([, title]) => quote(title)).join(';');
    const rows = [...apps]
      .sort((a, b) => (a.sentAt || '').localeCompare(b.sentAt || ''))
      .map((app) =>
        CSV_COLUMNS.map(([field]) => quote(field === 'status' ? findStatus(app.status).label : app[field])).join(';'),
      );

    // O ﻿ no começo faz o Excel reconhecer os acentos.
    const blob = new Blob(['﻿' + [header, ...rows].join('\r\n')], { type: 'text/csv;charset=utf-8' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = 'candidaturas.csv';
    document.body.appendChild(link);
    link.click();
    link.remove();
  }

  /* ---------- Eventos ---------- */

  function bindEvents() {
    $('#csv').addEventListener('click', exportCsv);
    $('#cv-browse').addEventListener('click', () => $('#cv-file').click());
    $('#cv-file').addEventListener('change', (event) => uploadCv(event.target.files[0]));

    $('#new').addEventListener('click', () => openPanel(null));
    $('#close').addEventListener('click', closePanel);
    $('#cancel').addEventListener('click', closePanel);
    $('#scrim').addEventListener('click', closePanel);
    $('#form').addEventListener('submit', submitForm);
    $('#del').addEventListener('click', deleteApplication);
    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape' && !$('#overlay').hidden) closePanel();
    });

    $('#q').addEventListener('input', (event) => {
      searchText = event.target.value;
      renderList();
    });

    $('#chips').addEventListener('click', (event) => {
      const chip = event.target.closest('[data-f]');
      if (!chip) return;
      activeFilter = chip.dataset.f;
      renderChips();
      renderList();
    });

    $('#start').addEventListener('click', (event) => {
      if (event.target.id === 'chg') showStartEditor();
      else if (event.target.id === 'sdok') saveStartDate();
    });

    $('#list').addEventListener('change', (event) => {
      const select = event.target.closest('[data-status-for]');
      if (select) changeStatus(select.dataset.statusFor, select.value);
    });

    $('#list').addEventListener('click', (event) => {
      if (event.target.closest('select, a')) return; // não abre a ficha ao mudar o status ou clicar em link
      if (event.target.closest('[data-act="new"]')) return openPanel(null);
      const row = event.target.closest('[data-id]');
      if (row) openPanel(row.dataset.id);
    });
  }

  /* ---------- Início ---------- */

  async function loadCvFiles() {
    try {
      const response = await fetch('/api/cvs');
      cvFiles = response.ok ? await response.json() : [];
    } catch {
      cvFiles = [];
    }
    render();
  }

  async function loadData() {
    try {
      const response = await fetch('/api/data');
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const data = await response.json();
      apps = Array.isArray(data.apps) ? data.apps : [];
      settings = data.settings || {};
    } catch {
      const notice = $('#notice');
      notice.className = 'notice';
      notice.hidden = false;
      notice.textContent =
        'Não consegui ler os dados. Abra pelo endereço do servidor (http://localhost:3000) com o comando: node server.js';
      $('#new').disabled = true;
    }
    isLoaded = true;
    render();
  }

  fillStatusOptions();
  bindEvents();
  render();
  loadCvFiles();
  loadData();
})();
