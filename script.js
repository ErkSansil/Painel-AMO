/* ===== STATE ===== */
const state = {
  periodo: '30d',
  canal: 'todos',
  dataEspecifica: null,
  intervalo: { de: null, ate: null },
  data: null,      // dados brutos do sheets
  refreshTimer: null,
  countdown: 60,
  autoRefreshMin: 1,
  sheetsUrl: '',
};

/* ===== MOCK DATA (substituir pelo fetch do Sheets) ===== */
function getMockData() {
  return {
    sede: {
      investimento: 130674,
      leads: 0,
      qualificados: 2922,
      custoQualificado: 44.72,
    },
    filial: {
      investimento: 140426,
      leads: 0,
      qualificados: 4302,
      custoQualificado: 32.64,
    },
  };
}

function calcTotal(d) {
  return {
    investimento: d.sede.investimento + d.filial.investimento,
    leads: d.sede.leads + d.filial.leads,
    qualificados: d.sede.qualificados + d.filial.qualificados,
    custoQualificado: (d.sede.investimento + d.filial.investimento) /
      (d.sede.qualificados + d.filial.qualificados || 1),
  };
}

/* ===== FETCH ===== */
async function fetchData() {
  if (!state.sheetsUrl) {
    state.data = getMockData();
    return;
  }
  try {
    const res = await fetch(state.sheetsUrl);
    const json = await res.json();
    state.data = parseSheets(json);
  } catch (e) {
    console.warn('Erro ao buscar Sheets, usando mock:', e);
    state.data = getMockData();
  }
}

// Adapte parseSheets() quando tiver a estrutura real do Sheets
function parseSheets(json) {
  return getMockData();
}

/* ===== FORMAT ===== */
function fmtBRL(v) {
  return 'R$ ' + Math.round(v).toLocaleString('pt-BR');
}
function fmtNum(v) {
  return Math.round(v).toLocaleString('pt-BR');
}

/* ===== RENDER CARDS ===== */
function renderCards() {
  const container = document.getElementById('cardsContainer');
  if (!state.data) {
    container.innerHTML = '<p style="color:var(--text-muted);font-size:14px">Carregando...</p>';
    return;
  }

  const d = state.data;
  const total = calcTotal(d);
  const canal = state.canal;

  const showTotal  = canal === 'todos';
  const showSede   = canal === 'todos' || canal === 'sede';
  const showFilial = canal === 'todos' || canal === 'filial';

  let html = '';

  if (showTotal) {
    html += cardHTML({
      type: 'total',
      icon: '∑',
      title: 'Total Geral',
      subtitle: 'AMO Sede + AMO Filial',
      metrics: [
        { label: 'Investimento', value: fmtBRL(total.investimento) },
        { label: 'Leads', value: fmtNum(total.leads) },
        { label: 'Qualificados', value: fmtNum(total.qualificados) },
        { label: 'Custo por Qualificado Total', value: fmtBRL(total.custoQualificado) },
      ],
      wide: true,
    });
  }

  if (showSede || showFilial) {
    html += '<div class="cards-row">';
    if (showSede) {
      html += cardHTML({
        type: 'sede',
        icon: 'S',
        title: 'AMO Sede',
        subtitle: '',
        metrics: [
          { label: 'Investimento', value: fmtBRL(d.sede.investimento) },
          { label: 'Leads', value: fmtNum(d.sede.leads) },
          { label: 'Qualificados', value: fmtNum(d.sede.qualificados) },
          { label: 'Custo / Qualificado', value: fmtBRL(d.sede.custoQualificado) },
        ],
      });
    }
    if (showFilial) {
      html += cardHTML({
        type: 'filial',
        icon: 'F',
        title: 'AMO Filial',
        subtitle: '',
        metrics: [
          { label: 'Investimento', value: fmtBRL(d.filial.investimento) },
          { label: 'Leads', value: fmtNum(d.filial.leads) },
          { label: 'Qualificados', value: fmtNum(d.filial.qualificados) },
          { label: 'Custo / Qualificado', value: fmtBRL(d.filial.custoQualificado) },
        ],
      });
    }
    html += '</div>';
  }

  container.innerHTML = html;
}

function cardHTML({ type, icon, title, subtitle, metrics, wide }) {
  const metricItems = metrics.map(m => `
    <div class="metric-item">
      <div class="metric-label">${m.label}</div>
      <div class="metric-value">${m.value}</div>
    </div>
  `).join('');

  return `
    <div class="metric-card${wide ? ' card-total' : ''}" style="margin-bottom:16px">
      <div class="card-header">
        <div class="card-icon ${type}">${icon}</div>
        <div>
          <div class="card-title">${title}</div>
          ${subtitle ? `<div class="card-subtitle">${subtitle}</div>` : ''}
        </div>
      </div>
      <div class="card-metrics">${metricItems}</div>
    </div>
  `;
}

/* ===== REFRESH ===== */
function updateTimestamps() {
  const now = new Date();
  const hms = now.toTimeString().slice(0, 8);
  document.getElementById('ultimaAtt').textContent = hms;
}

function startCountdown() {
  clearInterval(state.refreshTimer);
  state.countdown = state.autoRefreshMin * 60;

  state.refreshTimer = setInterval(() => {
    state.countdown--;
    const min = String(Math.floor(state.countdown / 60)).padStart(2, '0');
    const sec = String(state.countdown % 60).padStart(2, '0');
    document.getElementById('proximaAtt').textContent = `${min}:${sec}`;

    if (state.countdown <= 0) {
      doRefresh();
    }
  }, 1000);
}

async function doRefresh() {
  await fetchData();
  renderCards();
  updateTimestamps();
  startCountdown();
}

/* ===== NAVIGATION ===== */
document.querySelectorAll('.nav-item').forEach(item => {
  item.addEventListener('click', e => {
    e.preventDefault();
    const page = item.dataset.page;
    document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
    document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
    item.classList.add('active');
    document.getElementById('page-' + page).classList.add('active');
  });
});

/* ===== PERIOD ===== */
document.getElementById('periodGroup').addEventListener('click', e => {
  const btn = e.target.closest('.btn-seg');
  if (!btn) return;
  document.querySelectorAll('#periodGroup .btn-seg').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  state.periodo = btn.dataset.val;
  doRefresh();
});

/* ===== CANAL ===== */
document.getElementById('canalGroup').addEventListener('click', e => {
  const btn = e.target.closest('.btn-seg');
  if (!btn) return;
  document.querySelectorAll('#canalGroup .btn-seg').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  state.canal = btn.dataset.val;
  renderCards();
});

/* ===== DATA ESPECÍFICA ===== */
const btnDataEsp = document.getElementById('btnDataEspecifica');
const inputDataEsp = document.getElementById('inputDataEspecifica');
btnDataEsp.addEventListener('click', () => inputDataEsp.click());
inputDataEsp.addEventListener('change', () => {
  state.dataEspecifica = inputDataEsp.value;
  document.getElementById('labelDataEspecifica').textContent =
    inputDataEsp.value
      ? new Date(inputDataEsp.value + 'T12:00:00').toLocaleDateString('pt-BR')
      : 'Selecionar data específica';
  doRefresh();
});

/* ===== INTERVALO ===== */
const btnInt = document.getElementById('btnIntervalo');
const intervaloDiv = document.getElementById('intervaloInputs');
btnInt.addEventListener('click', () => {
  intervaloDiv.classList.toggle('hidden');
  if (!intervaloDiv.classList.contains('hidden')) {
    intervaloDiv.style.display = 'flex';
  } else {
    intervaloDiv.style.display = '';
  }
});
document.getElementById('btnAplicarIntervalo').addEventListener('click', () => {
  const de = document.getElementById('inputDe').value;
  const ate = document.getElementById('inputAte').value;
  if (de && ate) {
    state.intervalo = { de, ate };
    document.getElementById('labelIntervalo').textContent =
      `${new Date(de + 'T12:00:00').toLocaleDateString('pt-BR')} – ${new Date(ate + 'T12:00:00').toLocaleDateString('pt-BR')}`;
    intervaloDiv.classList.add('hidden');
    intervaloDiv.style.display = '';
    doRefresh();
  }
});

/* ===== DARK MODE ===== */
document.getElementById('darkToggle').addEventListener('click', () => {
  const isDark = document.body.classList.toggle('dark');
  document.getElementById('darkLabel').textContent = isDark ? 'Modo claro' : 'Modo escuro';
  localStorage.setItem('theme', isDark ? 'dark' : 'light');
});
if (localStorage.getItem('theme') === 'dark') {
  document.body.classList.add('dark');
  document.getElementById('darkLabel').textContent = 'Modo claro';
}

/* ===== REFRESH BUTTONS ===== */
document.getElementById('refreshBtn').addEventListener('click', doRefresh);
document.getElementById('topRefreshBtn').addEventListener('click', doRefresh);

/* ===== CONFIG ===== */
document.getElementById('salvarConfig').addEventListener('click', () => {
  state.sheetsUrl = document.getElementById('sheetsUrl').value.trim();
  state.autoRefreshMin = parseInt(document.getElementById('autoRefreshMin').value) || 1;
  localStorage.setItem('sheetsUrl', state.sheetsUrl);
  localStorage.setItem('autoRefreshMin', state.autoRefreshMin);
  document.getElementById('configSaved').classList.remove('hidden');
  setTimeout(() => document.getElementById('configSaved').classList.add('hidden'), 2500);
  doRefresh();
});

// Restaurar configurações salvas
const savedUrl = localStorage.getItem('sheetsUrl');
const savedMin = localStorage.getItem('autoRefreshMin');
if (savedUrl) {
  state.sheetsUrl = savedUrl;
  document.getElementById('sheetsUrl').value = savedUrl;
}
if (savedMin) {
  state.autoRefreshMin = parseInt(savedMin);
  document.getElementById('autoRefreshMin').value = savedMin;
}

/* ===== INIT ===== */
doRefresh();
