/* ============================================================
   PAINEL AMO — script.js
   ------------------------------------------------------------
   Toda a lógica do painel vive aqui: sessão/login, busca de
   dados na planilha (via Apps Script), filtros, renderização
   dos cards e da tabela diária, relatórios Excel/PDF, histórico
   de atualizações e gerenciamento de usuários.

   Organização do arquivo (na ordem):
   1. Config da API e estado global
   2. Busca e tratamento de dados (fetch, filtros, agregação)
   3. Renderização (cards e tabela por dia)
   4. Navegação, filtros e modos de data
   5. Relatórios (Excel e PDF)
   6. Sessão, login, perfil e avatar
   7. Gerenciamento de usuários (só Chefe/Adm)
   8. Histórico, heartbeat e inicialização
   ============================================================ */

/* ===== CONFIG DA API (Google Apps Script) =====
   Depois de implantar o Apps Script (ver apps-script-Code.gs),
   cole aqui a URL que termina em /exec                          */
const SHEETS_API_URL = 'https://script.google.com/macros/s/AKfycbzCbNRSL9vyBpYI3rjNxz8a5cybZfh5t9e-vzc2dq9ZplbEw2bQT6L1i8gqykFLv5f_UA/exec';

/* ===== VERSÃO ===== */
const VERSAO = 'Beta 2.0';

/* ===== STATE ===== */
const state = {
  filtroModo: 'periodo', // 'periodo' | 'data' | 'intervalo'
  periodo: 'hoje',
  canal: 'todos',
  dataEspecifica: null,
  intervalo: { de: null, ate: null },
  data: null,      // dados brutos do sheets
  carregando: false,
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
      leadsAptas: 850,
      potenciais: 2922,
      potenciaisReais: 1450,
    },
    filial: {
      investimento: 140426,
      leads: 0,
      leadsAptas: 1230,
      potenciais: 4302,
      potenciaisReais: 2100,
    },
  };
}

function calcTotal(d) {
  return {
    investimento: d.sede.investimento + d.filial.investimento,
    leads: d.sede.leads + d.filial.leads,
    leadsAptas: d.sede.leadsAptas + d.filial.leadsAptas,
    potenciais: d.sede.potenciais + d.filial.potenciais,
    potenciaisReais: d.sede.potenciaisReais + d.filial.potenciaisReais,
    vendasCLT: d.sede.vendasCLT + d.filial.vendasCLT,
  };
}

/* ===== FETCH ===== */
// Linhas diárias cruas vindas da planilha (uma por dia, por canal)
let rawRows = { sede: [], filial: [] };
let rawRowsBreno = { sede: [], filial: [] };
let rawRowsVendas = [];

const stateBreno = {
  filtroModo: 'periodo',
  periodo: 'hoje',
  canal: 'todos',
  dataEspecifica: null,
  intervalo: { de: null, ate: null },
  data: null,
  carregando: false,
};

const stateVendas = {
  filtroModo: 'periodo',
  periodo: '30d',
  dataEspecifica: null,
  intervalo: { de: null, ate: null },
  data: null,
  carregando: false,
};

// Estado separado para os filtros da tabela "por dia" de Vendas
const stateVendasTab = {
  filtroModo: 'periodo',
  periodo: '30d',
  dataEspecifica: null,
  intervalo: { de: null, ate: null },
  canal: 'todos',   // todos | sede | filial
  aptas: 'todas',   // todas | sem | so
};

async function fetchData() {
  if (!SHEETS_API_URL) {
    state.data = getMockData();
    return;
  }
  // Sem sessão, não busca (a tela de login está na frente mesmo)
  if (!sessao.usuario) return;
  try {
    const params = new URLSearchParams({
      action: 'dados',
      usuario: sessao.usuario,
      senha: sessao.senha,
    });
    const res = await fetch(`${SHEETS_API_URL}?${params}`);
    const json = await res.json();
    if (!json.ok) {
      // Credencial inválida ou suspensa no meio da sessão? Volta pro login.
      if (json.erro === 'Não autorizado') {
        ['sessaoUsuario', 'sessaoSenha', 'sessaoNivel'].forEach(k => {
          localStorage.removeItem(k);
          sessionStorage.removeItem(k);
        });
        location.reload();
        return;
      }
      throw new Error(json.erro);
    }
    rawRows = { sede: json.sede, filial: json.filial };
    state.data = {
      sede: agregarRows(filtrarPorData(rawRows.sede)),
      filial: agregarRows(filtrarPorData(rawRows.filial)),
    };
    atualizarTabelaDiaria();
    rawRowsBreno = { sede: json.brenoSede || [], filial: json.brenoFilial || [] };
    stateBreno.data = {
      sede: agregarRows(filtrarPorDataBreno(rawRowsBreno.sede)),
      filial: agregarRows(filtrarPorDataBreno(rawRowsBreno.filial)),
    };
    atualizarTabelaDiariaBreno();

    rawRowsVendas = json.vendas || [];
    stateVendas.data = agregarVendas(filtrarPorDataVendas(rawRowsVendas));
    atualizarTabelaDiariaVendas();
    renderCardsVendas();

    // Horários de última alteração detectados pela API
    if (json.ultimaAttLeads) {
      const el = document.getElementById('attLeads');
      if (el.textContent !== '--' && el.textContent !== json.ultimaAttLeads) {
        addLog('leads', 'Dados de leads atualizados na planilha', json.ultimaAttLeads);
      }
      el.textContent = json.ultimaAttLeads;
    }
    if (json.ultimaAttInvestimento) {
      const el = document.getElementById('attInvestimento');
      if (el.textContent !== '--' && el.textContent !== json.ultimaAttInvestimento) {
        addLog('invest', 'Investimento atualizado na planilha', json.ultimaAttInvestimento);
      }
      el.textContent = json.ultimaAttInvestimento;
    }
    if (json.brenoAttLeads) {
      const el = document.getElementById('bAttLeads');
      if (el) el.textContent = json.brenoAttLeads;
    }
    if (json.brenoAttInvestimento) {
      const el = document.getElementById('bAttInvestimento');
      if (el) el.textContent = json.brenoAttInvestimento;
    }
  } catch (e) {
    console.warn('Erro ao buscar Sheets, usando mock:', e);
    state.data = getMockData();
  }
}

/** Aplica o filtro de data ativo (período / data específica / intervalo) */
function filtrarPorData(rows) {
  const hoje = new Date(); hoje.setHours(0, 0, 0, 0);
  const dia = d => { const x = new Date(d + 'T00:00:00'); x.setHours(0, 0, 0, 0); return x; };

  if (state.filtroModo === 'data' && state.dataEspecifica) {
    return rows.filter(r => r.data === state.dataEspecifica);
  }
  if (state.filtroModo === 'intervalo' && state.intervalo.de && state.intervalo.ate) {
    const de = dia(state.intervalo.de), ate = dia(state.intervalo.ate);
    return rows.filter(r => { const d = dia(r.data); return d >= de && d <= ate; });
  }
  // período
  const p = state.periodo || '30d';
  if (p === 'hoje') return rows.filter(r => +dia(r.data) === +hoje);
  if (p === 'ontem') {
    const ontem = new Date(hoje); ontem.setDate(ontem.getDate() - 1);
    return rows.filter(r => +dia(r.data) === +ontem);
  }
  const dias = parseInt(p) || 30;
  const inicio = new Date(hoje); inicio.setDate(inicio.getDate() - (dias - 1));
  return rows.filter(r => { const d = dia(r.data); return d >= inicio && d <= hoje; });
}

function filtrarPorDataBreno(rows) {
  const hoje = new Date(); hoje.setHours(0, 0, 0, 0);
  const dia = d => { const x = new Date(d + 'T00:00:00'); x.setHours(0, 0, 0, 0); return x; };

  if (stateBreno.filtroModo === 'data' && stateBreno.dataEspecifica) {
    return rows.filter(r => r.data === stateBreno.dataEspecifica);
  }
  if (stateBreno.filtroModo === 'intervalo' && stateBreno.intervalo.de && stateBreno.intervalo.ate) {
    const de = dia(stateBreno.intervalo.de), ate = dia(stateBreno.intervalo.ate);
    return rows.filter(r => { const d = dia(r.data); return d >= de && d <= ate; });
  }
  const p = stateBreno.periodo || '30d';
  if (p === 'hoje') return rows.filter(r => +dia(r.data) === +hoje);
  if (p === 'ontem') {
    const ontem = new Date(hoje); ontem.setDate(ontem.getDate() - 1);
    return rows.filter(r => +dia(r.data) === +ontem);
  }
  const dias = parseInt(p) || 30;
  const inicio = new Date(hoje); inicio.setDate(inicio.getDate() - (dias - 1));
  return rows.filter(r => { const d = dia(r.data); return d >= inicio && d <= hoje; });
}

function filtrarPorDataVendas(rows) {
  const hoje = new Date(); hoje.setHours(0, 0, 0, 0);
  const dia = d => { const x = new Date(d + 'T00:00:00'); x.setHours(0, 0, 0, 0); return x; };

  if (stateVendas.filtroModo === 'data' && stateVendas.dataEspecifica) {
    return rows.filter(r => r.data === stateVendas.dataEspecifica);
  }
  if (stateVendas.filtroModo === 'intervalo' && stateVendas.intervalo.de && stateVendas.intervalo.ate) {
    const de = dia(stateVendas.intervalo.de), ate = dia(stateVendas.intervalo.ate);
    return rows.filter(r => { const d = dia(r.data); return d >= de && d <= ate; });
  }
  const p = stateVendas.periodo || 'hoje';
  if (p === 'hoje') return rows.filter(r => +dia(r.data) === +hoje);
  if (p === 'ontem') {
    const ontem = new Date(hoje); ontem.setDate(ontem.getDate() - 1);
    return rows.filter(r => +dia(r.data) === +ontem);
  }
  const dias = parseInt(p) || 30;
  const inicio = new Date(hoje); inicio.setDate(inicio.getDate() - (dias - 1));
  return rows.filter(r => { const d = dia(r.data); return d >= inicio && d <= hoje; });
}

function agregarVendas(rows) {
  function contar(arr) {
    return {
      contratos: arr.length,
      validadas: arr.filter(r => r.status === 'VALIDADA').length,
      canceladas: arr.filter(r => r.status === 'CANCELADA').length,
      naoValidadas: arr.filter(r => r.status === 'NAO_VALIDADA').length,
    };
  }
  const semAptas = rows.filter(r => !r.isApta);
  const aptas    = rows.filter(r => r.isApta);
  return {
    geral:       contar(semAptas),
    aptas:       contar(aptas),
    sede:        contar(semAptas.filter(r => r.canal === 'sede')),
    filial:      contar(semAptas.filter(r => r.canal === 'filial')),
    sedeAptas:   contar(aptas.filter(r => r.canal === 'sede')),
    filialAptas: contar(aptas.filter(r => r.canal === 'filial')),
  };
}

function atualizarTabelaDiariaVendas() {
  // tabela por dia de vendas — será implementada junto com os cards
  renderTableVendas();
}

/** Soma as linhas diárias nos totais dos cards */
function agregarRows(rows) {
  return rows.reduce((acc, r) => ({
    investimento: acc.investimento + (r.investimento || 0),
    leads: acc.leads + (r.leads || 0),
    potenciais: acc.potenciais + (r.potenciaisCLT || 0),
    potenciaisReais: acc.potenciaisReais + (r.potenciaisReais || 0),
    leadsAptas: acc.leadsAptas + (r.leadsAptas || 0),
    vendasCLT: acc.vendasCLT + (r.vendasCLT || 0),
  }), { investimento: 0, leads: 0, potenciais: 0, potenciaisReais: 0, leadsAptas: 0, vendasCLT: 0 });
}

/** Alimenta a tabela "Visualização por Dia" com os dados reais */
function atualizarTabelaDiaria() {
  const rows = [
    ...rawRows.sede.map(r => ({ ...r, canal: 'sede' })),
    ...rawRows.filial.map(r => ({ ...r, canal: 'filial' })),
  ];
  rows.sort((a, b) => b.data.localeCompare(a.data));
  tableState.rows = rows.map(r => ({
    data: r.data,
    canal: r.canal,
    investimento: r.investimento || 0,
    leads: r.leads || 0,
    potenciais: r.potenciaisCLT || 0,
    potenciaisReais: r.potenciaisReais || 0,
    vendasCLT: r.vendasCLT || 0,
    leadsAptas: r.leadsAptas || 0,
  }));
  tableState.page = 1;
  renderTable();
}

function atualizarTabelaDiariaBreno() {
  const rows = [
    ...rawRowsBreno.sede.map(r => ({ ...r, canal: 'sede' })),
    ...rawRowsBreno.filial.map(r => ({ ...r, canal: 'filial' })),
  ];
  rows.sort((a, b) => b.data.localeCompare(a.data));
  tableStateBreno.rows = rows.map(r => ({
    data: r.data,
    canal: r.canal,
    investimento: r.investimento || 0,
    leads: r.leads || 0,
    potenciais: r.potenciaisCLT || 0,
    potenciaisReais: r.potenciaisReais || 0,
    vendasCLT: r.vendasCLT || 0,
    leadsAptas: r.leadsAptas || 0,
  }));
  tableStateBreno.page = 1;
  renderTableBreno();
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
  if (!state.data || state.carregando) {
    // Monta os cards com o esqueleto animado enquanto carrega
    const skVal = '<span class="metric-value loading">––––</span>';
    const skCard = (title, subtitle, wide) => `
      <div class="metric-card${wide ? ' card-total' : ''}" style="margin-bottom:16px">
        <div class="card-header">
          <div class="card-icon ${wide ? 'total' : ''}"></div>
          <div>
            <div class="card-title">${title}</div>
            ${subtitle ? `<div class="card-subtitle">${subtitle}</div>` : ''}
          </div>
        </div>
        <div class="card-metrics">
          ${['Investimento','N° Leads','N° Potenciais','N° Potenciais Reais','N° Vendas Potenciais','N° Leads Aptas']
            .map(l => `<div class="metric-item"><div class="metric-label">${l}</div>${skVal}</div>`)
            .join('')}
        </div>
      </div>`;

    const showTotal  = state.canal === 'todos';
    const showSede   = state.canal === 'todos' || state.canal === 'sede';
    const showFilial = state.canal === 'todos' || state.canal === 'filial';

    let html = '';
    if (showTotal)  html += skCard('Total Geral', 'Éder Sede + Éder Filial', true);
    if (showSede || showFilial) {
      html += '<div class="cards-row">';
      if (showSede)   html += skCard('Éder Sede', '', false);
      if (showFilial) html += skCard('Éder Filial', '', false);
      html += '</div>';
    }
    container.innerHTML = html;
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
      icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:18px;height:18px"><ellipse cx="12" cy="5" rx="9" ry="3"/><path d="M21 12c0 1.66-4 3-9 3s-9-1.34-9-3"/><path d="M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5"/></svg>',
      title: 'Total Geral',
      subtitle: 'Éder Sede + Éder Filial',
      metrics: [
        { label: 'Investimento', value: fmtBRL(total.investimento) },
        { label: 'N° Leads', value: fmtNum(total.leads) },
        { label: 'N° Potenciais', value: fmtNum(total.potenciais) },
        { label: 'N° Potenciais Reais', value: fmtNum(total.potenciaisReais) },
        { label: 'N° Vendas Potenciais', value: fmtNum(total.vendasCLT) },
        { label: 'N° Leads Aptas', value: fmtNum(total.leadsAptas) },
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
        title: 'Éder Sede',
        subtitle: '',
        metrics: [
          { label: 'Investimento', value: fmtBRL(d.sede.investimento) },
          { label: 'N° Leads', value: fmtNum(d.sede.leads) },
          { label: 'N° Potenciais', value: fmtNum(d.sede.potenciais) },
          { label: 'N° Potenciais Reais', value: fmtNum(d.sede.potenciaisReais) },
          { label: 'N° Vendas Potenciais', value: fmtNum(d.sede.vendasCLT) },
          { label: 'N° Leads Aptas', value: fmtNum(d.sede.leadsAptas) },
        ],
      });
    }
    if (showFilial) {
      html += cardHTML({
        type: 'filial',
        icon: 'F',
        title: 'Éder Filial',
        subtitle: '',
        metrics: [
          { label: 'Investimento', value: fmtBRL(d.filial.investimento) },
          { label: 'N° Leads', value: fmtNum(d.filial.leads) },
          { label: 'N° Potenciais', value: fmtNum(d.filial.potenciais) },
          { label: 'N° Potenciais Reais', value: fmtNum(d.filial.potenciaisReais) },
          { label: 'N° Vendas Potenciais', value: fmtNum(d.filial.vendasCLT) },
          { label: 'N° Leads Aptas', value: fmtNum(d.filial.leadsAptas) },
        ],
      });
    }
    html += '</div>';
  }

  container.innerHTML = html;
}

function cardHTML({ type, icon, title, subtitle, metrics, wide, extraStyle, extraClass }) {
  const metricItems = metrics.map(m => `
    <div class="metric-item">
      <div class="metric-label">${m.label}</div>
      <div class="metric-value">${m.value}</div>
    </div>
  `).join('');

  const style = ['margin-bottom:16px', extraStyle].filter(Boolean).join(';');
  const cls = ['metric-card', wide ? 'card-total' : '', extraClass || ''].filter(Boolean).join(' ');
  return `
    <div class="${cls}" style="${style}">
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

function renderCardsBreno() {
  const container = document.getElementById('bCardsContainer');
  if (!container) return;
  if (!stateBreno.data || stateBreno.carregando) {
    const skVal = '<span class="metric-value loading">––––</span>';
    const skCard = (title, subtitle, wide) => `
      <div class="metric-card${wide ? ' card-total' : ''}" style="margin-bottom:16px">
        <div class="card-header">
          <div class="card-icon ${wide ? 'total' : ''}"></div>
          <div>
            <div class="card-title">${title}</div>
            ${subtitle ? `<div class="card-subtitle">${subtitle}</div>` : ''}
          </div>
        </div>
        <div class="card-metrics">
          ${['Investimento','N° Leads','N° Potenciais','N° Potenciais Reais','N° Vendas Potenciais','N° Leads Aptas']
            .map(l => `<div class="metric-item"><div class="metric-label">${l}</div>${skVal}</div>`)
            .join('')}
        </div>
      </div>`;
    const showTotal  = stateBreno.canal === 'todos';
    const showSede   = stateBreno.canal === 'todos' || stateBreno.canal === 'sede';
    const showFilial = stateBreno.canal === 'todos' || stateBreno.canal === 'filial';
    let html = '';
    if (showTotal)  html += skCard('Total Geral', 'Breno Sede + Breno Filial', true);
    if (showSede || showFilial) {
      html += '<div class="cards-row">';
      if (showSede)   html += skCard('Breno Sede', '', false);
      if (showFilial) html += skCard('Breno Filial', '', false);
      html += '</div>';
    }
    container.innerHTML = html;
    return;
  }

  const d = stateBreno.data;
  const total = calcTotal(d);
  const canal = stateBreno.canal;
  const showTotal  = canal === 'todos';
  const showSede   = canal === 'todos' || canal === 'sede';
  const showFilial = canal === 'todos' || canal === 'filial';

  let html = '';
  if (showTotal) {
    html += cardHTML({
      type: 'total',
      icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:18px;height:18px"><ellipse cx="12" cy="5" rx="9" ry="3"/><path d="M21 12c0 1.66-4 3-9 3s-9-1.34-9-3"/><path d="M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5"/></svg>',
      title: 'Total Geral',
      subtitle: 'Breno Sede + Breno Filial',
      metrics: [
        { label: 'Investimento', value: fmtBRL(total.investimento) },
        { label: 'N° Leads', value: fmtNum(total.leads) },
        { label: 'N° Potenciais', value: fmtNum(total.potenciais) },
        { label: 'N° Potenciais Reais', value: fmtNum(total.potenciaisReais) },
        { label: 'N° Vendas Potenciais', value: fmtNum(total.vendasCLT) },
        { label: 'N° Leads Aptas', value: fmtNum(total.leadsAptas) },
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
        title: 'Breno Sede',
        subtitle: '',
        metrics: [
          { label: 'Investimento', value: fmtBRL(d.sede.investimento) },
          { label: 'N° Leads', value: fmtNum(d.sede.leads) },
          { label: 'N° Potenciais', value: fmtNum(d.sede.potenciais) },
          { label: 'N° Potenciais Reais', value: fmtNum(d.sede.potenciaisReais) },
          { label: 'N° Vendas Potenciais', value: fmtNum(d.sede.vendasCLT) },
          { label: 'N° Leads Aptas', value: fmtNum(d.sede.leadsAptas) },
        ],
      });
    }
    if (showFilial) {
      html += cardHTML({
        type: 'filial',
        icon: 'F',
        title: 'Breno Filial',
        subtitle: '',
        metrics: [
          { label: 'Investimento', value: fmtBRL(d.filial.investimento) },
          { label: 'N° Leads', value: fmtNum(d.filial.leads) },
          { label: 'N° Potenciais', value: fmtNum(d.filial.potenciais) },
          { label: 'N° Potenciais Reais', value: fmtNum(d.filial.potenciaisReais) },
          { label: 'N° Vendas Potenciais', value: fmtNum(d.filial.vendasCLT) },
          { label: 'N° Leads Aptas', value: fmtNum(d.filial.leadsAptas) },
        ],
      });
    }
    html += '</div>';
  }
  container.innerHTML = html;
}

/* ===== REFRESH ===== */
function updateTimestamps() {
  const now = new Date();
  const hms = now.toTimeString().slice(0, 8);
  document.getElementById('ultimaAtt').textContent = hms;
  const bEl = document.getElementById('bUltimaAtt');
  if (bEl) bEl.textContent = hms;
}

function startCountdown() {
  clearInterval(state.refreshTimer);
  state.countdown = state.autoRefreshMin * 60;

  state.refreshTimer = setInterval(() => {
    state.countdown--;
    const min = String(Math.floor(state.countdown / 60)).padStart(2, '0');
    const sec = String(state.countdown % 60).padStart(2, '0');
    const txt = `${min}:${sec}`;
    document.getElementById('proximaAtt').textContent = txt;
    const bEl = document.getElementById('bProximaAtt');
    if (bEl) bEl.textContent = txt;

    if (state.countdown <= 0) {
      clearInterval(state.refreshTimer);
      state.refreshTimer = null;
      doRefresh(true); // auto-refresh: silencioso, sem skeleton
    }
  }, 1000);
}

async function doRefresh(silencioso = false) {
  if (!silencioso) {
    state.carregando = true;
    stateBreno.carregando = true;
    renderCards();
    renderCardsBreno();
  }
  await fetchData();
  state.carregando = false;
  stateBreno.carregando = false;
  renderCards();
  renderCardsBreno();
  updateTimestamps();
  startCountdown();
}

/* ===== NAVIGATION ===== */
function navegarPara(page) {
  document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));

  const item = document.querySelector(`.nav-item[data-page="${page}"]`);
  if (item) item.classList.add('active');
  const pageEl = document.getElementById('page-' + page);
  if (pageEl) pageEl.classList.add('active');

  // Marca (e mantém aberto) o grupo que contém a página ativa
  document.querySelectorAll('.nav-group').forEach(g => {
    const contem = g.querySelector(`[data-page="${page}"]`);
    g.classList.toggle('tem-ativo', !!contem);
    if (contem) g.classList.add('aberto');
  });
}

// Sub-itens (Visão Geral, Por Dia, Relatório, Perfil...)
document.querySelectorAll('.nav-item').forEach(item => {
  item.addEventListener('click', e => {
    e.preventDefault();
    navegarPara(item.dataset.page);
  });
});

// Cabeçalho do grupo: o texto navega pra Visão Geral do painel e abre a lista;
// o chevron (seta) só abre/fecha, sem navegar.
document.querySelectorAll('.nav-group-header').forEach(header => {
  const grupo = header.closest('.nav-group');
  header.addEventListener('click', e => {
    if (e.target.closest('.nav-chevron')) {
      grupo.classList.toggle('aberto');
      return;
    }
    grupo.classList.add('aberto');
    navegarPara(header.dataset.page);
  });
});

// Avatar/nome no topo abrem o Perfil
document.getElementById('abrirPerfil').addEventListener('click', () => navegarPara('perfil'));

/* ===== MODO DE FILTRO (período / data / intervalo são exclusivos) ===== */
function setFiltroModo(modo) {
  state.filtroModo = modo;

  const rowPeriodo   = document.getElementById('periodGroup').closest('.filter-row');
  const rowData      = document.getElementById('btnDataEspecifica').closest('.filter-row');
  const rowIntervalo = document.getElementById('btnIntervalo').closest('.filter-row');

  rowPeriodo.classList.toggle('filter-disabled', modo !== 'periodo');
  rowData.classList.toggle('filter-disabled', modo !== 'data');
  rowIntervalo.classList.toggle('filter-disabled', modo !== 'intervalo');

  // Limpa o estado visual dos modos não ativos
  if (modo !== 'periodo') {
    document.querySelectorAll('#periodGroup .btn-seg').forEach(b => b.classList.remove('active'));
    state.periodo = null;
  }
  if (modo !== 'data') {
    state.dataEspecifica = null;
    document.getElementById('inputDataEspecifica').value = '';
    document.getElementById('labelDataEspecifica').textContent = 'Selecionar data específica';
  }
  if (modo !== 'intervalo') {
    state.intervalo = { de: null, ate: null };
    document.getElementById('labelIntervalo').textContent = 'Selecionar intervalo de datas';
    const intDiv = document.getElementById('intervaloInputs');
    intDiv.classList.add('hidden');
    intDiv.style.display = '';
  }
}

/* ===== PERIOD ===== */
document.getElementById('periodGroup').addEventListener('click', e => {
  const btn = e.target.closest('.btn-seg');
  if (!btn) return;
  setFiltroModo('periodo');
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
btnDataEsp.addEventListener('click', () => {
  if (inputDataEsp.showPicker) inputDataEsp.showPicker();
  else inputDataEsp.click();
});
inputDataEsp.addEventListener('change', () => {
  if (!inputDataEsp.value) return;
  setFiltroModo('data');
  state.dataEspecifica = inputDataEsp.value;
  document.getElementById('labelDataEspecifica').textContent =
    new Date(inputDataEsp.value + 'T12:00:00').toLocaleDateString('pt-BR');
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
    setFiltroModo('intervalo');
    state.intervalo = { de, ate };
    document.getElementById('labelIntervalo').textContent =
      `${new Date(de + 'T12:00:00').toLocaleDateString('pt-BR')} – ${new Date(ate + 'T12:00:00').toLocaleDateString('pt-BR')}`;
    intervaloDiv.classList.add('hidden');
    intervaloDiv.style.display = '';
    doRefresh();
  }
});

/* ===== FILTROS BRENO ===== */
function setFiltroModoBreno(modo) {
  stateBreno.filtroModo = modo;
  const rowPeriodo   = document.getElementById('bPeriodGroup').closest('.filter-row');
  const rowData      = document.getElementById('bBtnDataEspecifica').closest('.filter-row');
  const rowIntervalo = document.getElementById('bBtnIntervalo').closest('.filter-row');
  rowPeriodo.classList.toggle('filter-disabled', modo !== 'periodo');
  rowData.classList.toggle('filter-disabled', modo !== 'data');
  rowIntervalo.classList.toggle('filter-disabled', modo !== 'intervalo');
  if (modo !== 'periodo') {
    document.querySelectorAll('#bPeriodGroup .btn-seg').forEach(b => b.classList.remove('active'));
    stateBreno.periodo = null;
  }
  if (modo !== 'data') {
    stateBreno.dataEspecifica = null;
    document.getElementById('bInputDataEspecifica').value = '';
    document.getElementById('bLabelDataEspecifica').textContent = 'Selecionar data específica';
  }
  if (modo !== 'intervalo') {
    stateBreno.intervalo = { de: null, ate: null };
    document.getElementById('bLabelIntervalo').textContent = 'Selecionar intervalo de datas';
    const intDiv = document.getElementById('bIntervaloInputs');
    intDiv.classList.add('hidden');
    intDiv.style.display = '';
  }
}

document.getElementById('bPeriodGroup').addEventListener('click', e => {
  const btn = e.target.closest('.btn-seg');
  if (!btn) return;
  setFiltroModoBreno('periodo');
  document.querySelectorAll('#bPeriodGroup .btn-seg').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  stateBreno.periodo = btn.dataset.val;
  stateBreno.data = {
    sede: agregarRows(filtrarPorDataBreno(rawRowsBreno.sede)),
    filial: agregarRows(filtrarPorDataBreno(rawRowsBreno.filial)),
  };
  atualizarTabelaDiariaBreno();
  renderCardsBreno();
});

document.getElementById('bCanalGroup').addEventListener('click', e => {
  const btn = e.target.closest('.btn-seg');
  if (!btn) return;
  document.querySelectorAll('#bCanalGroup .btn-seg').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  stateBreno.canal = btn.dataset.val;
  renderCardsBreno();
});

const bBtnDataEsp = document.getElementById('bBtnDataEspecifica');
const bInputDataEsp = document.getElementById('bInputDataEspecifica');
bBtnDataEsp.addEventListener('click', () => {
  if (bInputDataEsp.showPicker) bInputDataEsp.showPicker();
  else bInputDataEsp.click();
});
bInputDataEsp.addEventListener('change', () => {
  if (!bInputDataEsp.value) return;
  setFiltroModoBreno('data');
  stateBreno.dataEspecifica = bInputDataEsp.value;
  document.getElementById('bLabelDataEspecifica').textContent =
    new Date(bInputDataEsp.value + 'T12:00:00').toLocaleDateString('pt-BR');
  stateBreno.data = {
    sede: agregarRows(filtrarPorDataBreno(rawRowsBreno.sede)),
    filial: agregarRows(filtrarPorDataBreno(rawRowsBreno.filial)),
  };
  atualizarTabelaDiariaBreno();
  renderCardsBreno();
});

const bBtnInt = document.getElementById('bBtnIntervalo');
const bIntervaloDiv = document.getElementById('bIntervaloInputs');
bBtnInt.addEventListener('click', () => {
  bIntervaloDiv.classList.toggle('hidden');
  bIntervaloDiv.style.display = bIntervaloDiv.classList.contains('hidden') ? '' : 'flex';
});
document.getElementById('bBtnAplicarIntervalo').addEventListener('click', () => {
  const de = document.getElementById('bInputDe').value;
  const ate = document.getElementById('bInputAte').value;
  if (de && ate) {
    setFiltroModoBreno('intervalo');
    stateBreno.intervalo = { de, ate };
    document.getElementById('bLabelIntervalo').textContent =
      `${new Date(de + 'T12:00:00').toLocaleDateString('pt-BR')} – ${new Date(ate + 'T12:00:00').toLocaleDateString('pt-BR')}`;
    bIntervaloDiv.classList.add('hidden');
    bIntervaloDiv.style.display = '';
    stateBreno.data = {
      sede: agregarRows(filtrarPorDataBreno(rawRowsBreno.sede)),
      filial: agregarRows(filtrarPorDataBreno(rawRowsBreno.filial)),
    };
    atualizarTabelaDiariaBreno();
    renderCardsBreno();
  }
});

document.getElementById('bRefreshBtn').addEventListener('click', doRefresh);

document.getElementById('bPageSizeSelect').addEventListener('change', e => {
  tableStateBreno.pageSize = parseInt(e.target.value);
  tableStateBreno.page = 1;
  renderTableBreno();
});
document.getElementById('bBtnPrevPage').addEventListener('click', () => {
  if (tableStateBreno.page > 1) { tableStateBreno.page--; renderTableBreno(); }
});
document.getElementById('bBtnNextPage').addEventListener('click', () => {
  const totalPages = Math.ceil(tableStateBreno.rows.length / tableStateBreno.pageSize);
  if (tableStateBreno.page < totalPages) { tableStateBreno.page++; renderTableBreno(); }
});

/* ===== PAINEL VENDAS — FILTROS VISÃO GERAL ===== */
function setFiltroModoVendas(modo) {
  stateVendas.filtroModo = modo;
  const rP = document.getElementById('vPeriodGroup').closest('.filter-row');
  const rD = document.getElementById('vBtnDataEspecifica').closest('.filter-row');
  const rI = document.getElementById('vBtnIntervalo').closest('.filter-row');
  rP.classList.toggle('filter-disabled', modo !== 'periodo');
  rD.classList.toggle('filter-disabled', modo !== 'data');
  rI.classList.toggle('filter-disabled', modo !== 'intervalo');
  if (modo !== 'periodo') { document.querySelectorAll('#vPeriodGroup .btn-seg').forEach(b=>b.classList.remove('active')); stateVendas.periodo=null; }
  if (modo !== 'data') { stateVendas.dataEspecifica=null; document.getElementById('vInputDataEspecifica').value=''; document.getElementById('vLabelDataEspecifica').textContent='Selecionar data específica'; }
  if (modo !== 'intervalo') { stateVendas.intervalo={de:null,ate:null}; document.getElementById('vLabelIntervalo').textContent='Selecionar intervalo de datas'; document.getElementById('vIntervaloInputs').classList.add('hidden'); }
}

document.getElementById('vPeriodGroup').addEventListener('click', e => {
  const btn = e.target.closest('.btn-seg');
  if (!btn) return;
  setFiltroModoVendas('periodo');
  document.querySelectorAll('#vPeriodGroup .btn-seg').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  stateVendas.periodo = btn.dataset.val;
  stateVendas.data = agregarVendas(filtrarPorDataVendas(rawRowsVendas));
  renderCardsVendas();
});

document.getElementById('vBtnDataEspecifica').addEventListener('click', () => {
  setFiltroModoVendas('data');
  document.getElementById('vInputDataEspecifica').showPicker?.() || document.getElementById('vInputDataEspecifica').click();
});
document.getElementById('vInputDataEspecifica').addEventListener('change', e => {
  stateVendas.dataEspecifica = e.target.value;
  document.getElementById('vLabelDataEspecifica').textContent = new Date(e.target.value+'T12:00:00').toLocaleDateString('pt-BR');
  stateVendas.data = agregarVendas(filtrarPorDataVendas(rawRowsVendas));
  renderCardsVendas();
});
document.getElementById('vBtnIntervalo').addEventListener('click', () => {
  setFiltroModoVendas('intervalo');
  document.getElementById('vIntervaloInputs').classList.toggle('hidden');
});
document.getElementById('vBtnAplicarIntervalo').addEventListener('click', () => {
  const de = document.getElementById('vInputDe').value, ate = document.getElementById('vInputAte').value;
  if (!de || !ate) return;
  stateVendas.intervalo = { de, ate };
  document.getElementById('vLabelIntervalo').textContent = `${new Date(de+'T12:00:00').toLocaleDateString('pt-BR')} até ${new Date(ate+'T12:00:00').toLocaleDateString('pt-BR')}`;
  document.getElementById('vIntervaloInputs').classList.add('hidden');
  stateVendas.data = agregarVendas(filtrarPorDataVendas(rawRowsVendas));
  renderCardsVendas();
});
document.getElementById('vRefreshBtn').addEventListener('click', doRefresh);

/* ===== PAINEL VENDAS — FILTROS TABELA POR DIA ===== */
document.getElementById('vTabPeriodGroup').addEventListener('click', e => {
  const btn = e.target.closest('.btn-seg');
  if (!btn) return;
  setFiltroModoVendasTab('periodo');
  document.querySelectorAll('#vTabPeriodGroup .btn-seg').forEach(b=>b.classList.remove('active'));
  btn.classList.add('active');
  stateVendasTab.periodo = btn.dataset.val;
  renderTableVendas();
});
document.getElementById('vTabBtnData').addEventListener('click', () => {
  setFiltroModoVendasTab('data');
  document.getElementById('vTabInputData').showPicker?.() || document.getElementById('vTabInputData').click();
});
document.getElementById('vTabInputData').addEventListener('change', e => {
  stateVendasTab.dataEspecifica = e.target.value;
  document.getElementById('vTabLabelData').textContent = new Date(e.target.value+'T12:00:00').toLocaleDateString('pt-BR');
  renderTableVendas();
});
document.getElementById('vTabBtnIntervalo').addEventListener('click', () => {
  setFiltroModoVendasTab('intervalo');
  document.getElementById('vTabIntervaloInputs').classList.toggle('hidden');
});
document.getElementById('vTabBtnAplicarIntervalo').addEventListener('click', () => {
  const de = document.getElementById('vTabInputDe').value, ate = document.getElementById('vTabInputAte').value;
  if (!de || !ate) return;
  stateVendasTab.intervalo = { de, ate };
  document.getElementById('vTabLabelIntervalo').textContent = `${new Date(de+'T12:00:00').toLocaleDateString('pt-BR')} até ${new Date(ate+'T12:00:00').toLocaleDateString('pt-BR')}`;
  document.getElementById('vTabIntervaloInputs').classList.add('hidden');
  renderTableVendas();
});
document.getElementById('vTabCanalGroup').addEventListener('click', e => {
  const btn = e.target.closest('.btn-seg');
  if (!btn) return;
  document.querySelectorAll('#vTabCanalGroup .btn-seg').forEach(b=>b.classList.remove('active'));
  btn.classList.add('active');
  stateVendasTab.canal = btn.dataset.val;
  tableStateVendas.page = 1;
  renderTableVendas();
});
document.getElementById('vTabAptasGroup').addEventListener('click', e => {
  const btn = e.target.closest('.btn-seg');
  if (!btn) return;
  document.querySelectorAll('#vTabAptasGroup .btn-seg').forEach(b=>b.classList.remove('active'));
  btn.classList.add('active');
  stateVendasTab.aptas = btn.dataset.val;
  tableStateVendas.page = 1;
  renderTableVendas();
});

document.getElementById('vPageSize').addEventListener('change', e => {
  tableStateVendas.pageSize = parseInt(e.target.value);
  tableStateVendas.page = 1;
  renderTableVendas();
});
document.getElementById('vBtnPrevPage').addEventListener('click', () => {
  if (tableStateVendas.page > 1) { tableStateVendas.page--; renderTableVendas(); }
});
document.getElementById('vBtnNextPage').addEventListener('click', () => {
  const tp = Math.ceil(tableStateVendas.rows.length / tableStateVendas.pageSize);
  if (tableStateVendas.page < tp) { tableStateVendas.page++; renderTableVendas(); }
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

/* ===== SESSÃO E TELA DE LOGIN ===== */
// "Lembrar de mim" marcado → localStorage (permanente);
// desmarcado → sessionStorage (apaga ao fechar o navegador)
const lerSessao = chave =>
  localStorage.getItem(chave) || sessionStorage.getItem(chave) || '';

const sessao = {
  usuario: lerSessao('sessaoUsuario'),
  senha: lerSessao('sessaoSenha'),
  ehDev: lerSessao('sessaoEhDev') === '1',
  paineis: (() => {
    try { return JSON.parse(lerSessao('sessaoPaineis') || '{}'); }
    catch { return {}; }
  })(),
};

// Nomes amigáveis dos painéis
const NOMES_PAINEL = { eder: 'Painel Éder', breno: 'Painel Breno', vendas: 'Painel Vendas' };

/* ===== PERMISSÕES (multi-painel) =====
   DEV → acesso total. Senão, o nível por painel decide:
   - Chefe/Administrador → gerencia usuários
   - Consultor → não cria/gerencia logins
   - Agente → não baixa relatórios */
function temAcessoPainel(painel) {
  return sessao.ehDev || !!sessao.paineis[painel];
}
function nivelNoPainel(painel) {
  if (sessao.ehDev) return 'DEV';
  return sessao.paineis[painel] || '';
}
function podeGerenciarUsuarios() {
  if (sessao.ehDev) return true;
  return Object.values(sessao.paineis).some(n => {
    const x = String(n).toLowerCase();
    return x.includes('chefe') || x.includes('adm');
  });
}
function podeBaixarRelatorios(painel) {
  return sessao.ehDev || !!sessao.paineis[painel];
}

/** Texto resumido do nível para o perfil */
function resumoNivel() {
  if (sessao.ehDev) return 'DEV — acesso total';
  return Object.keys(sessao.paineis)
    .map(p => `${NOMES_PAINEL[p] || p}: ${sessao.paineis[p]}`)
    .join(' • ') || 'Sem acesso';
}

function aplicarSessao() {
  // Só o primeiro nome: "erick.s" → "Erick"
  const primeiroNome = sessao.usuario.split('.')[0];
  const nome = primeiroNome.charAt(0).toUpperCase() + primeiroNome.slice(1);

  document.getElementById('perfilUsuario').value = sessao.usuario;
  document.getElementById('perfilSenha').value = sessao.senha;
  document.getElementById('perfilNivel').value = sessao.ehDev ? 'DEV' : 'Padrão';
  document.getElementById('perfilNome').textContent = nome;
  document.getElementById('perfilNivelLabel').textContent = resumoNivel();
  document.getElementById('greetingName').textContent = `Olá, ${nome}`;
  document.getElementById('topbarVersao').textContent = VERSAO;
  renderAvatar();
  renderSeletoresAvatar();

  // Grupos de painel na sidebar conforme acesso
  document.querySelector('.nav-group[data-group="eder"]')
    .classList.toggle('hidden', !temAcessoPainel('eder'));
  document.querySelector('.nav-group[data-group="breno"]')
    .classList.toggle('hidden', !temAcessoPainel('breno'));

  // Painel Vendas: só DEV e Chefe
  const temVendas = sessao.ehDev || Object.values(sessao.paineis).some(n => String(n).toLowerCase().includes('chefe'));
  const navVendas = document.getElementById('navGroupVendas');
  if (navVendas) navVendas.style.display = temVendas ? '' : 'none';

  // Relatório do Éder some para quem é Agente no Éder
  document.querySelector('.nav-item[data-page="importar"]')
    .classList.toggle('hidden', !podeBaixarRelatorios('eder'));
  document.querySelector('.nav-item[data-page="breno-importar"]')
    .classList.toggle('hidden', !podeBaixarRelatorios('breno'));

  // Seções de gestão de usuários
  const gestor = podeGerenciarUsuarios();
  document.getElementById('secaoCriarCredencial').classList.toggle('hidden', !gestor);
  document.getElementById('secaoGerenciarUsuarios').classList.toggle('hidden', !gestor);
  if (gestor) carregarUsuarios();

  // Se a página ativa não é acessível, manda pro primeiro painel disponível
  garantirPaginaValida();
}

/** Garante que o usuário não fique numa página sem permissão */
function garantirPaginaValida() {
  const ativa = document.querySelector('.page.active');
  const idAtiva = ativa ? ativa.id : '';
  const ederOk = temAcessoPainel('eder');
  const brenoOk = temAcessoPainel('breno');

  const ehPaginaEder = ['page-visao-geral', 'page-por-dia', 'page-importar'].includes(idAtiva);
  const ehPaginaBreno = ['page-breno-visao-geral', 'page-breno-por-dia', 'page-breno-importar'].includes(idAtiva);
  const bloqueado =
    (ehPaginaEder && !ederOk) ||
    (ehPaginaBreno && !brenoOk);

  if (idAtiva === 'page-perfil' || (!bloqueado && idAtiva)) return;

  if (ederOk) navegarPara('visao-geral');
  else if (brenoOk) navegarPara('breno-visao-geral');
  else navegarPara('perfil');
}

// Já tem sessão salva? Entra direto. Senão, mostra o login.
// (aplicarSessao roda no INIT, no fim do arquivo)
if (sessao.usuario) {
  document.getElementById('loginScreen').classList.add('hidden');
}

document.getElementById('loginForm').addEventListener('submit', async e => {
  e.preventDefault();
  const usuario = document.getElementById('loginUsuario').value.trim();
  const senha = document.getElementById('loginSenha').value;
  const btn = document.getElementById('loginBtn');
  const erro = document.getElementById('loginErro');

  erro.classList.add('hidden');
  btn.disabled = true;
  btn.textContent = 'Entrando...';

  try {
    const params = new URLSearchParams({ action: 'login', usuario, senha });
    const res = await fetch(`${SHEETS_API_URL}?${params}`);
    const json = await res.json();

    if (json.ok) {
      sessao.usuario = json.usuario;
      sessao.senha = senha;
      sessao.ehDev = !!json.ehDev;
      sessao.paineis = json.paineis || {};
      const lembrar = document.getElementById('loginLembrar').checked;
      const storage = lembrar ? localStorage : sessionStorage;
      storage.setItem('sessaoUsuario', sessao.usuario);
      storage.setItem('sessaoSenha', sessao.senha);
      storage.setItem('sessaoEhDev', sessao.ehDev ? '1' : '0');
      storage.setItem('sessaoPaineis', JSON.stringify(sessao.paineis));
      aplicarSessao();
      document.getElementById('loginScreen').classList.add('hidden');
      enviarPing();
      doRefresh();
    } else {
      erro.textContent = json.erro || 'Usuário ou senha incorretos.';
      erro.classList.remove('hidden');
    }
  } catch {
    erro.textContent = 'Erro de conexão. Tente novamente.';
    erro.classList.remove('hidden');
  } finally {
    btn.disabled = false;
    btn.textContent = 'Entrar';
  }
});

// Delegação: funciona para qualquer olhinho, inclusive os criados dinamicamente
document.addEventListener('click', e => {
  const btn = e.target.closest('.btn-eye');
  if (!btn) return;
  const input = document.getElementById(btn.dataset.target);
  if (!input) return;
  const mostrar = input.type === 'password';
  input.type = mostrar ? 'text' : 'password';
  btn.querySelector('.eye-open').classList.toggle('hidden', mostrar);
  btn.querySelector('.eye-closed').classList.toggle('hidden', !mostrar);
});

/* ===== AVATAR PERSONALIZADO ===== */
const AVATAR_ICONES = {
  inicial: null, // usa a letra inicial do usuário
  pessoa: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>',
  estrela: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>',
  raio: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg>',
  coracao: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/></svg>',
  grafico: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/></svg>',
  diamante: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M6 3h12l4 6-10 12L2 9l4-6z"/></svg>',
  foguete: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4.5 16.5c-1.5 1.26-2 5-2 5s3.74-.5 5-2c.71-.84.7-2.13-.09-2.91a2.18 2.18 0 0 0-2.91-.09z"/><path d="M12 15l-3-3a22 22 0 0 1 2-3.95A12.88 12.88 0 0 1 22 2c0 2.72-.78 7.5-6 11a22.35 22.35 0 0 1-4 2z"/><path d="M9 12H4s.55-3.03 2-4c1.62-1.08 5 0 5 0"/><path d="M12 15v5s3.03-.55 4-2c1.08-1.62 0-5 0-5"/></svg>',
};

const AVATAR_CORES = {
  rosa:    'linear-gradient(135deg, #ec4899, #8b5cf6)',
  azul:    'linear-gradient(135deg, #3b82f6, #60a5fa)',
  verde:   'linear-gradient(135deg, #22c55e, #4ade80)',
  laranja: 'linear-gradient(135deg, #f97316, #fbbf24)',
  vermelho:'linear-gradient(135deg, #ef4444, #f87171)',
  roxo:    'linear-gradient(135deg, #6366f1, #a78bfa)',
  preto:   'linear-gradient(135deg, #0f172a, #475569)',
  ciano:   'linear-gradient(135deg, #06b6d4, #67e8f9)',
};

const avatarPrefs = {
  get icone() { return localStorage.getItem(`avatarIcone_${sessao.usuario}`) || 'inicial'; },
  set icone(v) { localStorage.setItem(`avatarIcone_${sessao.usuario}`, v); },
  get cor() { return localStorage.getItem(`avatarCor_${sessao.usuario}`) || 'rosa'; },
  set cor(v) { localStorage.setItem(`avatarCor_${sessao.usuario}`, v); },
};

function renderAvatar() {
  const grad = AVATAR_CORES[avatarPrefs.cor] || AVATAR_CORES.rosa;
  const icone = AVATAR_ICONES[avatarPrefs.icone];
  const conteudo = icone || (sessao.usuario.charAt(0).toUpperCase() || '?');

  // Avatar grande do Perfil + avatar pequeno da topbar
  for (const id of ['perfilAvatar', 'topbarAvatar']) {
    const el = document.getElementById(id);
    el.style.background = grad;
    el.innerHTML = conteudo;
  }
}

function renderSeletoresAvatar() {
  const divIcones = document.getElementById('avatarIcones');
  const divCores = document.getElementById('avatarCores');

  divIcones.innerHTML = Object.entries(AVATAR_ICONES).map(([nome, svg]) => `
    <div class="avatar-op op-icone ${avatarPrefs.icone === nome ? 'selecionado' : ''}" data-icone="${nome}" title="${nome}">
      ${svg || '<strong>' + (sessao.usuario.charAt(0).toUpperCase() || 'A') + '</strong>'}
    </div>
  `).join('');

  divCores.innerHTML = Object.entries(AVATAR_CORES).map(([nome, grad]) => `
    <div class="avatar-op ${avatarPrefs.cor === nome ? 'selecionado' : ''}" data-cor="${nome}" title="${nome}" style="background:${grad}"></div>
  `).join('');

  divIcones.querySelectorAll('.avatar-op').forEach(op => {
    op.addEventListener('click', () => {
      avatarPrefs.icone = op.dataset.icone;
      renderAvatar();
      renderSeletoresAvatar();
    });
  });
  divCores.querySelectorAll('.avatar-op').forEach(op => {
    op.addEventListener('click', () => {
      avatarPrefs.cor = op.dataset.cor;
      renderAvatar();
      renderSeletoresAvatar();
    });
  });
}

/* ===== GERENCIAR USUÁRIOS ===== */
function gerFeedback(msg, ok) {
  const fb = document.getElementById('gerFeedback');
  fb.textContent = msg;
  fb.style.color = ok ? '#22c55e' : '#ef4444';
  fb.classList.remove('hidden');
  setTimeout(() => fb.classList.add('hidden'), 3500);
}

async function apiGestor(params) {
  const qs = new URLSearchParams({
    admUsuario: sessao.usuario,
    admSenha: sessao.senha,
    ...params,
  });
  const res = await fetch(`${SHEETS_API_URL}?${qs}`);
  return res.json();
}

async function carregarUsuarios() {
  const lista = document.getElementById('listaUsuarios');
  lista.innerHTML = '<p style="color:var(--text-muted);font-size:13px">Carregando usuários...</p>';
  try {
    const json = await apiGestor({ action: 'listarusuarios' });
    if (!json.ok) {
      lista.innerHTML = `<p style="color:#ef4444;font-size:13px">${json.erro}</p>`;
      return;
    }
    renderUsuarios(json.usuarios);
  } catch {
    lista.innerHTML = '<p style="color:#ef4444;font-size:13px">Erro de conexão com a planilha.</p>';
  }
}

/** Cor de avatar determinística baseada no nome do usuário */
function corAvatar(usuario) {
  const paleta = Object.values(AVATAR_CORES);
  let hash = 0;
  for (let i = 0; i < usuario.length; i++) hash = (hash * 31 + usuario.charCodeAt(i)) >>> 0;
  return paleta[hash % paleta.length];
}

/** Badges de painel+nível (ou DEV) de um usuário */
function badgesAcesso(u) {
  if (u.ehDev) return '<span class="badge dev">DEV</span>';
  const paineis = u.paineis || {};
  // Se todos os painéis são Chefe, exibe só "Chefe"
  const niveis = Object.values(paineis);
  const todosChefe = niveis.length > 0 && niveis.every(n => n.toLowerCase().includes('chefe'));
  if (todosChefe) return '<span class="badge chefe">Chefe</span>';
  return Object.keys(paineis).map(p =>
    `<span class="badge painel">${NOMES_PAINEL[p] || p}: ${paineis[p]}</span>`
  ).join('') || '<span class="badge offline">Sem acesso</span>';
}

function renderUsuarios(usuarios) {
  const lista = document.getElementById('listaUsuarios');
  if (!usuarios.length) {
    lista.innerHTML = '<p style="color:var(--text-muted);font-size:13px">Nenhum usuário cadastrado.</p>';
    return;
  }

  lista.innerHTML = usuarios.map((u, i) => {
    const suspenso = u.situacao === 'Suspenso';
    const online = u.status.toLowerCase() === 'online';
    const ehProprio = u.usuario.toLowerCase() === sessao.usuario.toLowerCase();

    return `
    <div class="usuario-row" data-usuario="${u.usuario}">
      <div class="usuario-avatar" style="background:${corAvatar(u.usuario)}">${u.usuario.charAt(0).toUpperCase()}</div>
      <div class="usuario-info">
        <div class="usuario-nome">${u.usuario}${ehProprio ? ' (você)' : ''}</div>
        <div class="usuario-meta">
          ${u.criado ? 'Criado: ' + u.criado : ''}${u.ultimoAcesso ? ' • Último acesso: ' + u.ultimoAcesso : ''}
        </div>
        <div class="usuario-badges" style="margin-top:6px">${badgesAcesso(u)}</div>
      </div>
      <div class="usuario-badges">
        ${suspenso
          ? '<span class="badge suspenso">Suspenso</span>'
          : `<span class="badge ${online ? 'online' : 'offline'}">${online ? 'Online' : 'Offline'}</span>`}
      </div>
      <div class="usuario-acoes">
        <button class="btn-mini" data-acao="editar" data-i="${i}">Editar</button>
        ${ehProprio ? '' : suspenso
          ? `<button class="btn-mini sucesso" data-acao="ativar" data-i="${i}">Reativar</button>`
          : `<button class="btn-mini perigo" data-acao="suspender" data-i="${i}">Suspender</button>`}
      </div>
    </div>`;
  }).join('');

  lista.querySelectorAll('[data-acao]').forEach(btn => {
    btn.addEventListener('click', async () => {
      const u = usuarios[btn.dataset.i];
      const acao = btn.dataset.acao;

      if (acao === 'editar') { abrirModalUsuario(u); return; }

      if (acao === 'suspender' || acao === 'ativar') {
        btn.disabled = true;
        try {
          const json = await apiGestor({
            action: 'situacao',
            usuario: u.usuario,
            situacao: acao === 'suspender' ? 'Suspenso' : 'Ativo',
          });
          gerFeedback(json.ok ? json.mensagem : json.erro, json.ok);
          if (json.ok) carregarUsuarios();
        } catch { gerFeedback('Erro de conexão.', false); }
        btn.disabled = false;
      }
    });
  });
}

/* ===== MODAL DE EDIÇÃO DE USUÁRIO ===== */
let usuarioEditando = null;
const modalEl = document.getElementById('modalUsuario');
const modalPaineisDiv = document.getElementById('modalPaineis');

function fecharModal() {
  modalEl.classList.add('hidden');
  usuarioEditando = null;
}

function modalFeedback(msg, ok) {
  const fb = document.getElementById('modalFeedback');
  fb.textContent = msg;
  fb.style.color = ok ? '#22c55e' : '#ef4444';
  fb.classList.remove('hidden');
  setTimeout(() => fb.classList.add('hidden'), 3500);
}

function abrirModalUsuario(u) {
  usuarioEditando = u;
  document.getElementById('modalNome').textContent = u.usuario;
  document.getElementById('modalStatus').textContent =
    u.ehDev ? 'Conta DEV' : (u.situacao === 'Suspenso' ? 'Suspenso' : u.status);
  document.getElementById('modalAvatar').textContent = u.usuario.charAt(0).toUpperCase();
  document.getElementById('modalSenha').value = '';
  document.getElementById('modalFeedback').classList.add('hidden');

  const infos = [];
  if (u.criado) infos.push(['Criado em', u.criado]);
  if (u.ultimoAcesso) infos.push(['Último acesso', u.ultimoAcesso]);
  infos.push(['Status', u.status]);
  infos.push(['Situação', u.situacao]);
  document.getElementById('modalInfos').innerHTML = infos.map(([k, v]) =>
    `<div class="info-linha"><span>${k}</span><strong>${v}</strong></div>`).join('');

  montarSeletorPaineis(modalPaineisDiv, u.ehDev ? {} : u.paineis);

  modalEl.classList.remove('hidden');
}

document.getElementById('modalFechar').addEventListener('click', fecharModal);
modalEl.addEventListener('click', e => { if (e.target === modalEl) fecharModal(); });
document.getElementById('modalSelTudo').addEventListener('click', () => marcarTodosPaineis(modalPaineisDiv, true));
document.getElementById('modalLimparTudo').addEventListener('click', () => marcarTodosPaineis(modalPaineisDiv, false));

document.getElementById('modalSalvar').addEventListener('click', async () => {
  if (!usuarioEditando) return;
  const novaSenha = document.getElementById('modalSenha').value.trim();
  const ehDev = false;
  const paineis = lerSeletorPaineis(modalPaineisDiv);
  if (!ehDev && !paineis) return modalFeedback('Marque ao menos um painel.', false);

  const btn = document.getElementById('modalSalvar');
  btn.disabled = true;
  try {
    const json = await apiGestor({
      action: 'editarusuario',
      usuario: usuarioEditando.usuario,
      novaSenha, paineis,
      dev: ehDev ? '1' : '0',
    });
    if (json.ok) { fecharModal(); gerFeedback(json.mensagem, true); carregarUsuarios(); }
    else modalFeedback(json.erro, false);
  } catch { modalFeedback('Erro de conexão.', false); }
  btn.disabled = false;
});

document.getElementById('modalExcluir').addEventListener('click', async () => {
  if (!usuarioEditando) return;
  if (!confirm(`Excluir o usuário "${usuarioEditando.usuario}"? Esta ação não pode ser desfeita.`)) return;

  const btn = document.getElementById('modalExcluir');
  btn.disabled = true;
  try {
    const json = await apiGestor({ action: 'excluirusuario', usuario: usuarioEditando.usuario });
    if (json.ok) { fecharModal(); gerFeedback(json.mensagem, true); carregarUsuarios(); }
    else modalFeedback(json.erro, false);
  } catch { modalFeedback('Verificando...', false); setTimeout(() => { fecharModal(); carregarUsuarios(); }, 2000); }
  btn.disabled = false;
});

document.getElementById('btnRecarregarUsuarios').addEventListener('click', carregarUsuarios);

/* Aviso em tempo real: senhas não coincidem */
['novaSenha', 'confirmaSenha'].forEach(id => {
  document.getElementById(id).addEventListener('input', () => {
    const s1 = document.getElementById('novaSenha').value;
    const s2 = document.getElementById('confirmaSenha').value;
    document.getElementById('senhaMismatch')
      .classList.toggle('hidden', !s2 || s1 === s2);
  });
});

/* ===== SAIR ===== */
document.getElementById('btnSair').addEventListener('click', () => {
  if (SHEETS_API_URL && sessao.usuario) {
    fetch(`${SHEETS_API_URL}?action=logout&usuario=${encodeURIComponent(sessao.usuario)}`).catch(() => {});
  }
  ['sessaoUsuario', 'sessaoSenha', 'sessaoEhDev', 'sessaoPaineis'].forEach(k => {
    localStorage.removeItem(k);
    sessionStorage.removeItem(k);
  });
  location.reload();
});

/* ===== PERFIL: criar nova credencial (ADM) ===== */
/* ===== SELETOR DE PAINÉIS (reutilizado em criar e editar) ===== */
const NIVEIS = ['Administrador', 'Consultor', 'Agente'];

/** Monta as linhas de painel num container. `valores` = {eder:'Administrador', ...} */
function montarSeletorPaineis(container, valores) {
  valores = valores || {};
  container.innerHTML = Object.keys(NOMES_PAINEL).map(p => {
    const marcado = !!valores[p];
    const nivelSel = valores[p] || 'Administrador';
    return `
      <label class="painel-linha ${marcado ? 'marcado' : ''}" data-painel="${p}">
        <input type="checkbox" class="painel-check" data-painel="${p}" ${marcado ? 'checked' : ''}>
        <span class="painel-nome">${NOMES_PAINEL[p]}</span>
        <select class="painel-nivel" data-painel="${p}" ${marcado ? '' : 'disabled'}>
          ${NIVEIS.map(n => `<option ${n === nivelSel ? 'selected' : ''}>${n}</option>`).join('')}
        </select>
      </label>`;
  }).join('');

  container.querySelectorAll('.painel-check').forEach(chk => {
    chk.addEventListener('change', () => {
      const linha = chk.closest('.painel-linha');
      linha.querySelector('.painel-nivel').disabled = !chk.checked;
      linha.classList.toggle('marcado', chk.checked);
    });
  });
}

/** Lê o container e devolve "eder=Administrador;breno=Agente" */
function lerSeletorPaineis(container) {
  const partes = [];
  container.querySelectorAll('.painel-linha').forEach(linha => {
    const chk = linha.querySelector('.painel-check');
    if (chk.checked) {
      partes.push(`${chk.dataset.painel}=${linha.querySelector('.painel-nivel').value}`);
    }
  });
  return partes.join(';');
}

function marcarTodosPaineis(container, marcar) {
  container.querySelectorAll('.painel-check').forEach(chk => {
    chk.checked = marcar;
    chk.dispatchEvent(new Event('change'));
  });
}

// Monta o seletor da criação e liga os botões "selecionar/limpar tudo"
const novoPaineisDiv = document.getElementById('novoPaineis');
montarSeletorPaineis(novoPaineisDiv, { eder: 'Administrador' });
document.getElementById('novoSelTudo').addEventListener('click', () => marcarTodosPaineis(novoPaineisDiv, true));
document.getElementById('novoLimparTudo').addEventListener('click', () => marcarTodosPaineis(novoPaineisDiv, false));

document.getElementById('btnCriarCredencial').addEventListener('click', async () => {
  const novoUsuario = document.getElementById('novoUsuario').value.trim();
  const novaSenha = document.getElementById('novaSenha').value.trim();
  const confirmaSenha = document.getElementById('confirmaSenha').value.trim();
  const ehDev = false;
  const paineis = lerSeletorPaineis(novoPaineisDiv);
  const fb = document.getElementById('credFeedback');

  const mostrarFb = (msg, ok) => {
    fb.textContent = msg;
    fb.style.color = ok ? '#22c55e' : '#ef4444';
    fb.classList.remove('hidden');
    setTimeout(() => fb.classList.add('hidden'), 3500);
  };

  if (!novoUsuario || !novaSenha) return mostrarFb('Preencha o novo usuário e a senha.', false);
  if (novaSenha !== confirmaSenha) return mostrarFb('As senhas não coincidem.', false);
  if (!ehDev && !paineis) return mostrarFb('Marque ao menos um painel.', false);
  if (!SHEETS_API_URL) return mostrarFb('Configure a SHEETS_API_URL no script.js primeiro.', false);

  try {
    const json = await apiGestor({
      action: 'criarlogin',
      novoUsuario, novaSenha,
      paineis,
      dev: ehDev ? '1' : '0',
    });
    mostrarFb(json.ok ? json.mensagem : json.erro, json.ok);
    if (json.ok) {
      document.getElementById('novoUsuario').value = '';
      document.getElementById('novaSenha').value = '';
      document.getElementById('confirmaSenha').value = '';
      document.getElementById('novoDev').checked = false;
      montarSeletorPaineis(novoPaineisDiv, { eder: 'Administrador' });
      carregarUsuarios();
    }
  } catch (e) {
    mostrarFb('Verificando operação...', false);
    setTimeout(() => carregarUsuarios(), 2000);
  }
});

/* ===== HISTÓRICO DE ATUALIZAÇÕES ===== */
const LOGS_KEY = 'historicoLogs';
const LOGS_MAX = 50;

function getLogs() {
  try { return JSON.parse(localStorage.getItem(LOGS_KEY)) || []; }
  catch { return []; }
}

function addLog(tipo, msg, hora) {
  const logs = getLogs();
  logs.unshift({
    tipo,
    msg,
    hora: hora || new Date().toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }).replace(',', ' -'),
  });
  localStorage.setItem(LOGS_KEY, JSON.stringify(logs.slice(0, LOGS_MAX)));
  renderLogs();
}

function renderLogs() {
  const lista = document.getElementById('historicoLista');
  const logs = getLogs();
  if (!logs.length) {
    lista.innerHTML = '<div class="historico-vazio">Nenhuma atualização registrada ainda.</div>';
    return;
  }
  lista.innerHTML = logs.map(l => `
    <div class="historico-item">
      <span class="historico-dot ${l.tipo}"></span>
      <div>
        <div class="historico-msg">${l.msg}</div>
        <div class="historico-hora">${l.hora}</div>
      </div>
    </div>
  `).join('');
}

const btnHistorico = document.getElementById('btnHistorico');
const historicoPanel = document.getElementById('historicoPanel');

btnHistorico.addEventListener('click', e => {
  e.stopPropagation();
  historicoPanel.classList.toggle('hidden');
  renderLogs();
});

document.addEventListener('click', e => {
  if (!historicoPanel.classList.contains('hidden') &&
      !historicoPanel.contains(e.target)) {
    historicoPanel.classList.add('hidden');
  }
});

document.getElementById('btnLimparHistorico').addEventListener('click', () => {
  localStorage.removeItem(LOGS_KEY);
  renderLogs();
});

renderLogs();

/* ===== HEARTBEAT (status Online na planilha) =====
   Enquanto o painel estiver aberto, avisa a planilha a cada minuto.
   Quem ficar 2 min sem sinal é marcado Offline pelo Apps Script. */
function enviarPing() {
  if (!SHEETS_API_URL || !sessao.usuario) return;
  fetch(`${SHEETS_API_URL}?action=ping&usuario=${encodeURIComponent(sessao.usuario)}`)
    .catch(() => {});
}
enviarPing();
setInterval(enviarPing, 60000);

/* ===== SAUDAÇÃO E RELÓGIO (topbar) ===== */
function updateGreeting() {
  const now = new Date();
  const data = now.toLocaleDateString('pt-BR', { weekday: 'long', day: '2-digit', month: 'long', year: 'numeric' });
  const hora = now.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  document.getElementById('greetingDateTime').textContent =
    `${data.charAt(0).toUpperCase() + data.slice(1)} — ${hora}`;
}
updateGreeting();
setInterval(updateGreeting, 1000);

/* ===== SIDEBAR TOGGLE ===== */
const ehMobile = () => window.innerWidth <= 768;

document.getElementById('sidebarToggle').addEventListener('click', e => {
  e.stopPropagation();
  document.body.classList.toggle(ehMobile() ? 'sidebar-aberta' : 'sidebar-collapsed');
});

// No mobile: fecha o menu ao navegar ou tocar fora dele
document.addEventListener('click', e => {
  if (!ehMobile() || !document.body.classList.contains('sidebar-aberta')) return;
  const sidebar = document.getElementById('sidebar');
  if (!sidebar.contains(e.target) || e.target.closest('.nav-item')) {
    document.body.classList.remove('sidebar-aberta');
  }
});

/* ===== REFRESH BUTTONS ===== */
document.getElementById('refreshBtn').addEventListener('click', doRefresh);
document.getElementById('topRefreshBtn').addEventListener('click', doRefresh);

/* ===== IMPORTAR RELATÓRIO ===== */
const repState = { tipo: 'consolidado', canal: 'todos', formato: 'excel' };
const bRepState = { tipo: 'consolidado', canal: 'todos', formato: 'excel' };

document.getElementById('repTipoGroup').addEventListener('click', e => {
  const btn = e.target.closest('.btn-seg');
  if (!btn) return;
  document.querySelectorAll('#repTipoGroup .btn-seg').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  repState.tipo = btn.dataset.val;
});

document.getElementById('repCanalGroup').addEventListener('click', e => {
  const btn = e.target.closest('.btn-seg');
  if (!btn) return;
  document.querySelectorAll('#repCanalGroup .btn-seg').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  repState.canal = btn.dataset.val;
});

document.getElementById('repFormatoGroup').addEventListener('click', e => {
  const btn = e.target.closest('.btn-seg');
  if (!btn) return;
  document.querySelectorAll('#repFormatoGroup .btn-seg').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  repState.formato = btn.dataset.val;
});

/** Filtra as linhas diárias cruas pelo intervalo escolhido no relatório */
function repFiltrarRows(rows) {
  const de = document.getElementById('repDe').value;
  const ate = document.getElementById('repAte').value;
  if (!de && !ate) return rows;
  return rows.filter(r =>
    (!de || r.data >= de) && (!ate || r.data <= ate));
}

/** Modo Resumo Consolidado: uma linha por canal + total */
function getRelatorioRowsConsolidado() {
  const linha = (nome, m) => ({
    'Canal': nome,
    'Investimento': fmtBRL(m.investimento),
    'N° Leads': fmtNum(m.leads),
    'N° Potenciais': fmtNum(m.potenciais),
    'N° Potenciais Reais': fmtNum(m.potenciaisReais),
    'N° Leads Aptas': fmtNum(m.leadsAptas),
  });

  // Com API: agrega as linhas reais do intervalo escolhido; sem API: usa os totais atuais
  let sede, filial;
  if (rawRows.sede.length || rawRows.filial.length) {
    sede = agregarRows(repFiltrarRows(rawRows.sede));
    filial = agregarRows(repFiltrarRows(rawRows.filial));
  } else {
    const d = state.data || getMockData();
    sede = d.sede; filial = d.filial;
  }

  const rows = [];
  if (repState.canal === 'todos') {
    rows.push(linha('Éder Sede', sede));
    rows.push(linha('Éder Filial', filial));
    rows.push(linha('Total Geral', calcTotal({ sede, filial })));
  } else if (repState.canal === 'sede') {
    rows.push(linha('Éder Sede', sede));
  } else {
    rows.push(linha('Éder Filial', filial));
  }
  return rows;
}

/** Modo Detalhado por Dia: uma linha por dia/canal no intervalo */
function getRelatorioRowsDiario() {
  let rows = [];
  if (repState.canal === 'todos' || repState.canal === 'sede') {
    rows.push(...repFiltrarRows(rawRows.sede).map(r => ({ ...r, canal: 'Éder Sede' })));
  }
  if (repState.canal === 'todos' || repState.canal === 'filial') {
    rows.push(...repFiltrarRows(rawRows.filial).map(r => ({ ...r, canal: 'Éder Filial' })));
  }
  rows.sort((a, b) => b.data.localeCompare(a.data) || a.canal.localeCompare(b.canal));

  return rows.map(r => ({
    'Data': new Date(r.data + 'T12:00:00').toLocaleDateString('pt-BR'),
    'Canal': r.canal,
    'Investimento': fmtBRL(r.investimento || 0),
    'N° Leads': fmtNum(r.leads || 0),
    'N° Potenciais': fmtNum(r.potenciaisCLT || 0),
    'N° Potenciais Reais': fmtNum(r.potenciaisReais || 0),
    'N° Leads Aptas': fmtNum(r.leadsAptas || 0),
  }));
}

function getRelatorioRows() {
  return repState.tipo === 'diario'
    ? getRelatorioRowsDiario()
    : getRelatorioRowsConsolidado();
}

function getPeriodoLabel() {
  const de = document.getElementById('repDe').value;
  const ate = document.getElementById('repAte').value;
  if (de && ate) {
    const f = v => new Date(v + 'T12:00:00').toLocaleDateString('pt-BR');
    return `${f(de)} a ${f(ate)}`;
  }
  return 'Todo o período';
}

function baixarExcel(rows) {
  const headers = Object.keys(rows[0]);

  // Monta a planilha linha a linha: título, período, geração, vazio, tabela
  const aoa = [
    ['Relatório de Performance — AMO'],
    [`Período: ${getPeriodoLabel()}`],
    [`Gerado em: ${new Date().toLocaleString('pt-BR')}`],
    [],
    headers,
    ...rows.map(r => Object.values(r)),
  ];

  const ws = XLSX.utils.aoa_to_sheet(aoa);
  ws['!cols'] = headers.map(h => ({ wch: Math.max(14, h.length + 4) }));
  // Mescla o título e as linhas de info na largura da tabela
  ws['!merges'] = [
    { s: { r: 0, c: 0 }, e: { r: 0, c: headers.length - 1 } },
    { s: { r: 1, c: 0 }, e: { r: 1, c: headers.length - 1 } },
    { s: { r: 2, c: 0 }, e: { r: 2, c: headers.length - 1 } },
  ];

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Relatório');
  XLSX.writeFile(wb, `relatorio-amo-${new Date().toISOString().slice(0, 10)}.xlsx`);
}

function baixarPDF(rows) {
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF();

  doc.setFontSize(16);
  doc.text('Relatório de Performance — AMO', 14, 18);
  doc.setFontSize(10);
  doc.setTextColor(110);
  doc.text(`Período: ${getPeriodoLabel()}`, 14, 26);
  doc.text(`Gerado em: ${new Date().toLocaleString('pt-BR')}`, 14, 32);

  // Zebrado por dia (modo Detalhado): linhas do mesmo dia com a mesma cor
  const temData = 'Data' in rows[0];
  const altFlags = [];
  if (temData) {
    let ultima = null, alt = false;
    rows.forEach(r => {
      if (r['Data'] !== ultima) {
        if (ultima !== null) alt = !alt;
        ultima = r['Data'];
      }
      altFlags.push(alt);
    });
  }

  doc.autoTable({
    startY: 40,
    head: [Object.keys(rows[0])],
    body: rows.map(r => Object.values(r)),
    styles: { fontSize: 9 },
    headStyles: { fillColor: [99, 102, 241] },
    theme: temData ? 'grid' : 'striped',
    didParseCell: temData ? (data => {
      if (data.section === 'body') {
        data.cell.styles.fillColor = altFlags[data.row.index] ? [234, 236, 240] : [255, 255, 255];
      }
    }) : undefined,
  });

  doc.save(`relatorio-amo-${new Date().toISOString().slice(0, 10)}.pdf`);
}

document.getElementById('btnBaixarRelatorio').addEventListener('click', () => {
  const rows = getRelatorioRows();
  if (!rows.length) {
    const fb = document.getElementById('repFeedback');
    fb.textContent = 'Nenhum dado no período selecionado.';
    fb.style.color = '#ef4444';
    fb.classList.remove('hidden');
    setTimeout(() => fb.classList.add('hidden'), 3000);
    return;
  }
  if (repState.formato === 'excel') baixarExcel(rows);
  else baixarPDF(rows);

  const fb = document.getElementById('repFeedback');
  fb.textContent = 'Relatório gerado!';
  fb.style.color = '#22c55e';
  fb.classList.remove('hidden');
  setTimeout(() => fb.classList.add('hidden'), 2500);
});

document.getElementById('bRepTipoGroup').addEventListener('click', e => {
  const btn = e.target.closest('.btn-seg');
  if (!btn) return;
  document.querySelectorAll('#bRepTipoGroup .btn-seg').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  bRepState.tipo = btn.dataset.val;
});
document.getElementById('bRepCanalGroup').addEventListener('click', e => {
  const btn = e.target.closest('.btn-seg');
  if (!btn) return;
  document.querySelectorAll('#bRepCanalGroup .btn-seg').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  bRepState.canal = btn.dataset.val;
});
document.getElementById('bRepFormatoGroup').addEventListener('click', e => {
  const btn = e.target.closest('.btn-seg');
  if (!btn) return;
  document.querySelectorAll('#bRepFormatoGroup .btn-seg').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  bRepState.formato = btn.dataset.val;
});

function bRepFiltrarRows(rows) {
  const de = document.getElementById('bRepDe').value;
  const ate = document.getElementById('bRepAte').value;
  if (!de && !ate) return rows;
  return rows.filter(r => (!de || r.data >= de) && (!ate || r.data <= ate));
}

function getBRelatorioRows() {
  if (bRepState.tipo === 'diario') {
    let rows = [];
    if (bRepState.canal === 'todos' || bRepState.canal === 'sede')
      rows.push(...bRepFiltrarRows(rawRowsBreno.sede).map(r => ({ ...r, canal: 'Breno Sede' })));
    if (bRepState.canal === 'todos' || bRepState.canal === 'filial')
      rows.push(...bRepFiltrarRows(rawRowsBreno.filial).map(r => ({ ...r, canal: 'Breno Filial' })));
    rows.sort((a, b) => b.data.localeCompare(a.data) || a.canal.localeCompare(b.canal));
    return rows.map(r => ({
      'Data': new Date(r.data + 'T12:00:00').toLocaleDateString('pt-BR'),
      'Canal': r.canal,
      'Investimento': fmtBRL(r.investimento || 0),
      'N° Leads': fmtNum(r.leads || 0),
      'N° Potenciais': fmtNum(r.potenciaisCLT || 0),
      'N° Potenciais Reais': fmtNum(r.potenciaisReais || 0),
      'N° Leads Aptas': fmtNum(r.leadsAptas || 0),
    }));
  }
  // consolidado
  const linha = (nome, m) => ({
    'Canal': nome,
    'Investimento': fmtBRL(m.investimento),
    'N° Leads': fmtNum(m.leads),
    'N° Potenciais': fmtNum(m.potenciais),
    'N° Potenciais Reais': fmtNum(m.potenciaisReais),
    'N° Leads Aptas': fmtNum(m.leadsAptas),
  });
  const sede = agregarRows(bRepFiltrarRows(rawRowsBreno.sede));
  const filial = agregarRows(bRepFiltrarRows(rawRowsBreno.filial));
  const rows = [];
  if (bRepState.canal === 'todos') {
    rows.push(linha('Breno Sede', sede));
    rows.push(linha('Breno Filial', filial));
    rows.push(linha('Total Geral', calcTotal({ sede, filial })));
  } else if (bRepState.canal === 'sede') {
    rows.push(linha('Breno Sede', sede));
  } else {
    rows.push(linha('Breno Filial', filial));
  }
  return rows;
}

function getBPeriodoLabel() {
  const de = document.getElementById('bRepDe').value;
  const ate = document.getElementById('bRepAte').value;
  if (de && ate) {
    const f = v => new Date(v + 'T12:00:00').toLocaleDateString('pt-BR');
    return `${f(de)} a ${f(ate)}`;
  }
  return 'Todo o período';
}

document.getElementById('bBtnBaixarRelatorio').addEventListener('click', () => {
  const rows = getBRelatorioRows();
  const fb = document.getElementById('bRepFeedback');
  if (!rows.length) {
    fb.textContent = 'Nenhum dado no período selecionado.';
    fb.style.color = '#ef4444';
    fb.classList.remove('hidden');
    setTimeout(() => fb.classList.add('hidden'), 3000);
    return;
  }
  if (bRepState.formato === 'excel') {
    const aoa = [
      ['Relatório de Performance — AMO Breno'],
      [`Período: ${getBPeriodoLabel()}`],
      [`Gerado em: ${new Date().toLocaleString('pt-BR')}`],
      [],
      Object.keys(rows[0]),
      ...rows.map(r => Object.values(r)),
    ];
    const ws = XLSX.utils.aoa_to_sheet(aoa);
    ws['!cols'] = Object.keys(rows[0]).map(h => ({ wch: Math.max(14, h.length + 4) }));
    ws['!merges'] = [
      { s: { r: 0, c: 0 }, e: { r: 0, c: Object.keys(rows[0]).length - 1 } },
      { s: { r: 1, c: 0 }, e: { r: 1, c: Object.keys(rows[0]).length - 1 } },
      { s: { r: 2, c: 0 }, e: { r: 2, c: Object.keys(rows[0]).length - 1 } },
    ];
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Relatório');
    XLSX.writeFile(wb, `relatorio-breno-${new Date().toISOString().slice(0, 10)}.xlsx`);
  } else {
    const { jsPDF } = window.jspdf;
    const doc = new jsPDF();
    doc.setFontSize(16);
    doc.text('Relatório de Performance — AMO Breno', 14, 18);
    doc.setFontSize(10);
    doc.setTextColor(110);
    doc.text(`Período: ${getBPeriodoLabel()}`, 14, 26);
    doc.text(`Gerado em: ${new Date().toLocaleString('pt-BR')}`, 14, 32);
    doc.autoTable({
      startY: 40,
      head: [Object.keys(rows[0])],
      body: rows.map(r => Object.values(r)),
      styles: { fontSize: 9 },
      headStyles: { fillColor: [99, 102, 241] },
      theme: 'striped',
    });
    doc.save(`relatorio-breno-${new Date().toISOString().slice(0, 10)}.pdf`);
  }
  fb.textContent = 'Relatório gerado!';
  fb.style.color = '#22c55e';
  fb.classList.remove('hidden');
  setTimeout(() => fb.classList.add('hidden'), 2500);
});

/* ===== VISUALIZAÇÃO POR DIA ===== */
const tableState = {
  rows: [],       // todos os registros diários
  page: 1,
  pageSize: 50,
};

const tableStateBreno = {
  rows: [],
  page: 1,
  pageSize: 50,
};

const tableStateVendas = {
  rows: [],
  page: 1,
  pageSize: 50,
};

// Mock: gera 180 dias × 2 canais (substituir pelos dados do Sheets)
function getMockDaily() {
  const rows = [];
  const hoje = new Date();
  for (let i = 0; i < 180; i++) {
    const dt = new Date(hoje);
    dt.setDate(dt.getDate() - i);
    for (const canal of ['sede', 'filial']) {
      const leads = Math.floor(Math.random() * 120) + 30;
      const potenciais = Math.floor(leads * (0.4 + Math.random() * 0.3));
      const potReais = Math.floor(potenciais * (0.4 + Math.random() * 0.3));
      const aptas = Math.floor(potReais * (0.5 + Math.random() * 0.3));
      rows.push({
        data: dt.toISOString().slice(0, 10),
        canal,
        investimento: 3000 + Math.random() * 3500,
        leads,
        potenciais,
        potenciaisReais: potReais,
        leadsAptas: aptas,
      });
    }
  }
  return rows;
}

function renderTable() {
  const tbody = document.getElementById('tableBody');
  const total = tableState.rows.length;
  const totalPages = Math.max(1, Math.ceil(total / tableState.pageSize));
  if (tableState.page > totalPages) tableState.page = totalPages;

  const ini = (tableState.page - 1) * tableState.pageSize;
  const fim = Math.min(ini + tableState.pageSize, total);
  const pageRows = tableState.rows.slice(ini, fim);

  // Zebrado por dia: linhas do mesmo dia compartilham a cor de fundo
  let ultimaData = null, alt = false;
  tbody.innerHTML = pageRows.map(r => {
    if (r.data !== ultimaData) {
      if (ultimaData !== null) alt = !alt;
      ultimaData = r.data;
    }
    return `
    <tr class="${alt ? 'row-dia-alt' : ''}">
      <td>${new Date(r.data + 'T12:00:00').toLocaleDateString('pt-BR')}</td>
      <td><span class="canal-badge ${r.canal}">${r.canal === 'sede' ? 'Éder Sede' : 'Éder Filial'}</span></td>
      <td>${fmtBRL(r.investimento)}</td>
      <td>${fmtNum(r.leads)}</td>
      <td>${fmtNum(r.potenciais)}</td>
      <td>${fmtNum(r.potenciaisReais)}</td>
      <td>${fmtNum(r.vendasCLT)}</td>
      <td>${fmtNum(r.leadsAptas)}</td>
    </tr>`;
  }).join('');

  document.getElementById('tableCount').textContent =
    total ? `Exibindo ${ini + 1}–${fim} de ${fmtNum(total)} registros` : 'Nenhum registro';
  document.getElementById('pageInfo').textContent =
    `Página ${tableState.page} de ${totalPages}`;
  document.getElementById('btnPrevPage').disabled = tableState.page <= 1;
  document.getElementById('btnNextPage').disabled = tableState.page >= totalPages;
}

function renderTableBreno() {
  const tbody = document.getElementById('bTableBody');
  if (!tbody) return;
  const total = tableStateBreno.rows.length;
  const totalPages = Math.max(1, Math.ceil(total / tableStateBreno.pageSize));
  if (tableStateBreno.page > totalPages) tableStateBreno.page = totalPages;

  const ini = (tableStateBreno.page - 1) * tableStateBreno.pageSize;
  const fim = Math.min(ini + tableStateBreno.pageSize, total);
  const pageRows = tableStateBreno.rows.slice(ini, fim);

  let ultimaData = null, alt = false;
  tbody.innerHTML = pageRows.map(r => {
    if (r.data !== ultimaData) {
      if (ultimaData !== null) alt = !alt;
      ultimaData = r.data;
    }
    return `
    <tr class="${alt ? 'row-dia-alt' : ''}">
      <td>${new Date(r.data + 'T12:00:00').toLocaleDateString('pt-BR')}</td>
      <td><span class="canal-badge ${r.canal}">${r.canal === 'sede' ? 'Breno Sede' : 'Breno Filial'}</span></td>
      <td>${fmtBRL(r.investimento)}</td>
      <td>${fmtNum(r.leads)}</td>
      <td>${fmtNum(r.potenciais)}</td>
      <td>${fmtNum(r.potenciaisReais)}</td>
      <td>${fmtNum(r.vendasCLT)}</td>
      <td>${fmtNum(r.leadsAptas)}</td>
    </tr>`;
  }).join('');

  const countEl = document.getElementById('bTableCount');
  if (countEl) countEl.textContent = total ? `Exibindo ${ini + 1}–${fim} de ${fmtNum(total)} registros` : 'Nenhum registro';
  const pageInfoEl = document.getElementById('bPageInfo');
  if (pageInfoEl) pageInfoEl.textContent = `Página ${tableStateBreno.page} de ${totalPages}`;
  const prevBtn = document.getElementById('bBtnPrevPage');
  const nextBtn = document.getElementById('bBtnNextPage');
  if (prevBtn) prevBtn.disabled = tableStateBreno.page <= 1;
  if (nextBtn) nextBtn.disabled = tableStateBreno.page >= totalPages;
}

document.getElementById('pageSizeSelect').addEventListener('change', e => {
  tableState.pageSize = parseInt(e.target.value);
  tableState.page = 1;
  renderTable();
});

document.getElementById('btnPrevPage').addEventListener('click', () => {
  if (tableState.page > 1) {
    tableState.page--;
    renderTable();
  }
});

document.getElementById('btnNextPage').addEventListener('click', () => {
  const totalPages = Math.ceil(tableState.rows.length / tableState.pageSize);
  if (tableState.page < totalPages) {
    tableState.page++;
    renderTable();
  }
});

tableState.rows = getMockDaily();
renderTable();

/* ===== PAINEL VENDAS — RENDER ===== */
function vMetricas(m) {
  return [
    { label: 'Contratos',     value: fmtNum(m ? m.contratos    : 0) },
    { label: 'Validadas',     value: fmtNum(m ? m.validadas    : 0) },
    { label: 'Canceladas',    value: fmtNum(m ? m.canceladas   : 0) },
    { label: 'Não Validadas', value: fmtNum(m ? m.naoValidadas : 0) },
  ];
}

function renderCardsVendas() {
  const container = document.getElementById('vCardsContainer');
  if (!container) return;

  const d = stateVendas.data;

  if (stateVendas.carregando || !d) {
    const skVal = '<span class="metric-value loading">––––</span>';
    const skCard = (title, sub, wide) => `
      <div class="metric-card${wide ? ' card-total' : ''}" style="margin-bottom:16px">
        <div class="card-header"><div class="card-icon ${wide ? 'total' : ''}"></div>
          <div><div class="card-title">${title}</div>${sub ? `<div class="card-subtitle">${sub}</div>` : ''}</div>
        </div>
        <div class="card-metrics">
          ${['Contratos','Validadas','Canceladas','Não Validadas'].map(l =>
            `<div class="metric-item"><div class="metric-label">${l}</div>${skVal}</div>`).join('')}
        </div>
      </div>`;
    container.innerHTML =
      skCard('Total Geral', 'Sede + Filial · sem Aptas', true) +
      skCard('Aptas', 'Sede + Filial · somente Aptas', true) +
      '<div class="cards-row">' + skCard('Sede','') + skCard('Sede Aptas','') + '</div>' +
      '<div class="cards-row">' + skCard('Filial','') + skCard('Filial Aptas','') + '</div>';
    return;
  }

  const iconTotal = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:18px;height:18px"><ellipse cx="12" cy="5" rx="9" ry="3"/><path d="M21 12c0 1.66-4 3-9 3s-9-1.34-9-3"/><path d="M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5"/></svg>';

  let html = '';

  // Geral sem Aptas
  html += cardHTML({ type: 'total', icon: iconTotal, title: 'Total Geral', subtitle: 'Sede + Filial · sem Aptas', metrics: vMetricas(d.geral), wide: true });

  // Aptas
  html += cardHTML({ type: 'total', icon: iconTotal, title: 'Aptas', subtitle: 'Sede + Filial · somente Aptas', metrics: vMetricas(d.aptas), wide: true, extraClass: 'card-aptas' });

  // Sede + Sede Aptas
  html += '<div class="cards-row">';
  html += cardHTML({ type: 'sede', icon: 'S', title: 'Sede', subtitle: 'Sem Aptas', metrics: vMetricas(d.sede) });
  html += cardHTML({ type: 'sede', icon: 'S', title: 'Sede Aptas', subtitle: 'Somente Aptas', metrics: vMetricas(d.sedeAptas), extraClass: 'card-aptas' });
  html += '</div>';

  // Filial + Filial Aptas
  html += '<div class="cards-row">';
  html += cardHTML({ type: 'filial', icon: 'F', title: 'Filial', subtitle: 'Sem Aptas', metrics: vMetricas(d.filial) });
  html += cardHTML({ type: 'filial', icon: 'F', title: 'Filial Aptas', subtitle: 'Somente Aptas', metrics: vMetricas(d.filialAptas), extraClass: 'card-aptas' });
  html += '</div>';

  container.innerHTML = html;
}

function filtrarTabelaVendas(rows) {
  const hoje = new Date(); hoje.setHours(0,0,0,0);
  const dia = d => { const x = new Date(d+'T00:00:00'); x.setHours(0,0,0,0); return x; };
  const st = stateVendasTab;

  if (st.filtroModo === 'data' && st.dataEspecifica)
    rows = rows.filter(r => r.data === st.dataEspecifica);
  else if (st.filtroModo === 'intervalo' && st.intervalo.de && st.intervalo.ate) {
    const de = dia(st.intervalo.de), ate = dia(st.intervalo.ate);
    rows = rows.filter(r => { const d = dia(r.data); return d >= de && d <= ate; });
  } else {
    const p = st.periodo || '30d';
    if (p === 'hoje') rows = rows.filter(r => +dia(r.data) === +hoje);
    else if (p === 'ontem') { const o = new Date(hoje); o.setDate(o.getDate()-1); rows = rows.filter(r => +dia(r.data) === +o); }
    else { const dias = parseInt(p)||30; const ini = new Date(hoje); ini.setDate(ini.getDate()-(dias-1)); rows = rows.filter(r => { const d=dia(r.data); return d>=ini && d<=hoje; }); }
  }

  if (st.canal !== 'todos') rows = rows.filter(r => r.canal === st.canal);
  if (st.aptas === 'sem') rows = rows.filter(r => !r.isApta);
  if (st.aptas === 'so')  rows = rows.filter(r => r.isApta);
  return rows;
}

function setFiltroModoVendasTab(modo) {
  stateVendasTab.filtroModo = modo;
  const rP = document.getElementById('vTabPeriodGroup').closest('.filter-row');
  const rD = document.getElementById('vTabBtnData').closest('.filter-row');
  const rI = document.getElementById('vTabBtnIntervalo').closest('.filter-row');
  rP.classList.toggle('filter-disabled', modo !== 'periodo');
  rD.classList.toggle('filter-disabled', modo !== 'data');
  rI.classList.toggle('filter-disabled', modo !== 'intervalo');
  if (modo !== 'periodo') { document.querySelectorAll('#vTabPeriodGroup .btn-seg').forEach(b=>b.classList.remove('active')); stateVendasTab.periodo=null; }
  if (modo !== 'data') { stateVendasTab.dataEspecifica=null; document.getElementById('vTabInputData').value=''; document.getElementById('vTabLabelData').textContent='Selecionar data específica'; }
  if (modo !== 'intervalo') { stateVendasTab.intervalo={de:null,ate:null}; document.getElementById('vTabLabelIntervalo').textContent='Selecionar intervalo de datas'; document.getElementById('vTabIntervaloInputs').classList.add('hidden'); }
}

function renderTableVendas() {
  const tbody = document.getElementById('vTableBody');
  if (!tbody) return;

  const rows = filtrarTabelaVendas([...rawRowsVendas])
    .sort((a, b) => b.data.localeCompare(a.data));

  tableStateVendas.rows = rows;
  const total = rows.length;
  const totalPages = Math.max(1, Math.ceil(total / tableStateVendas.pageSize));
  if (tableStateVendas.page > totalPages) tableStateVendas.page = totalPages;

  const ini = (tableStateVendas.page - 1) * tableStateVendas.pageSize;
  const fim = Math.min(ini + tableStateVendas.pageSize, total);
  const pageRows = rows.slice(ini, fim);

  const esc = s => String(s||'').replace(/"/g,'&quot;').replace(/</g,'&lt;');

  let ultimaData = null, alt = false;
  tbody.innerHTML = pageRows.map(r => {
    if (r.data !== ultimaData) { if (ultimaData !== null) alt = !alt; ultimaData = r.data; }
    const statusLabel = r.status === 'VALIDADA' ? 'Validada' : r.status === 'CANCELADA' ? 'Cancelada' : 'Não Validada';
    const statusClass = r.status === 'VALIDADA' ? 'badge-ok' : r.status === 'CANCELADA' ? 'badge-cancel' : 'badge-warn';
    return `<tr class="${alt ? 'row-dia-alt' : ''}">
      <td>${new Date(r.data+'T12:00:00').toLocaleDateString('pt-BR')}</td>
      <td><span class="canal-badge ${r.canal}">${r.canal==='sede'?'Sede':'Filial'}</span></td>
      <td class="td-tooltip" title="${esc(r.cliente)}">${esc(r.cliente)||'—'}</td>
      <td class="td-tooltip td-obs" title="${esc(r.observacao)}">${esc(r.observacao)||'—'}</td>
      <td>${esc(r.validadora)||'—'}</td>
      <td><span class="status-badge ${statusClass}">${statusLabel}</span></td>
      <td>${r.isApta?'<span class="badge chefe" style="font-size:10px">Apta</span>':''}</td>
    </tr>`;
  }).join('');

  const countEl = document.getElementById('vTableCount');
  if (countEl) countEl.textContent = total ? `Exibindo ${ini+1}–${fim} de ${fmtNum(total)} registros` : 'Nenhum registro';
  const pageInfoEl = document.getElementById('vPageInfo');
  if (pageInfoEl) pageInfoEl.textContent = `Página ${tableStateVendas.page} de ${totalPages}`;
  const prevBtn = document.getElementById('vBtnPrevPage');
  const nextBtn = document.getElementById('vBtnNextPage');
  if (prevBtn) prevBtn.disabled = tableStateVendas.page <= 1;
  if (nextBtn) nextBtn.disabled = tableStateVendas.page >= totalPages;
}

/* ===== INIT ===== */
if (sessao.usuario) aplicarSessao();
setFiltroModo('periodo');
document.querySelector('#periodGroup .btn-seg[data-val="hoje"]').classList.add('active');
state.periodo = 'hoje';
doRefresh();
setFiltroModoBreno('periodo');
const bPeriodBtn = document.querySelector('#bPeriodGroup .btn-seg[data-val="hoje"]');
if (bPeriodBtn) bPeriodBtn.classList.add('active');
stateBreno.periodo = 'hoje';
renderCardsBreno();
renderTableBreno();
