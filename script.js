/* ===== CONFIG DA API (Google Apps Script) =====
   Depois de implantar o Apps Script (ver apps-script-Code.gs),
   cole aqui a URL que termina em /exec                          */
const SHEETS_API_URL = 'https://script.google.com/macros/s/AKfycbzCbNRSL9vyBpYI3rjNxz8a5cybZfh5t9e-vzc2dq9ZplbEw2bQT6L1i8gqykFLv5f_UA/exec';

/* ===== STATE ===== */
const state = {
  filtroModo: 'periodo', // 'periodo' | 'data' | 'intervalo'
  periodo: 'hoje',
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
  };
}

/* ===== FETCH ===== */
// Linhas diárias cruas vindas da planilha (uma por dia, por canal)
let rawRows = { sede: [], filial: [] };

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

/** Soma as linhas diárias nos totais dos cards */
function agregarRows(rows) {
  return rows.reduce((acc, r) => ({
    investimento: acc.investimento + (r.investimento || 0),
    leads: acc.leads + (r.leads || 0),
    potenciais: acc.potenciais + (r.potenciaisCLT || 0),
    potenciaisReais: acc.potenciaisReais + (r.potenciaisReais || 0),
    leadsAptas: acc.leadsAptas + (r.leadsAptas || 0),
  }), { investimento: 0, leads: 0, potenciais: 0, potenciaisReais: 0, leadsAptas: 0 });
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
    leadsAptas: r.leadsAptas || 0,
  }));
  tableState.page = 1;
  renderTable();
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
      icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:18px;height:18px"><ellipse cx="12" cy="5" rx="9" ry="3"/><path d="M21 12c0 1.66-4 3-9 3s-9-1.34-9-3"/><path d="M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5"/></svg>',
      title: 'Total Geral',
      subtitle: 'AMO Sede + AMO Filial',
      metrics: [
        { label: 'Investimento', value: fmtBRL(total.investimento) },
        { label: 'N° Leads', value: fmtNum(total.leads) },
        { label: 'N° Potenciais', value: fmtNum(total.potenciais) },
        { label: 'N° Potenciais Reais', value: fmtNum(total.potenciaisReais) },
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
        title: 'AMO Sede',
        subtitle: '',
        metrics: [
          { label: 'Investimento', value: fmtBRL(d.sede.investimento) },
          { label: 'N° Leads', value: fmtNum(d.sede.leads) },
          { label: 'N° Potenciais', value: fmtNum(d.sede.potenciais) },
          { label: 'N° Potenciais Reais', value: fmtNum(d.sede.potenciaisReais) },
          { label: 'N° Leads Aptas', value: fmtNum(d.sede.leadsAptas) },
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
          { label: 'N° Leads', value: fmtNum(d.filial.leads) },
          { label: 'N° Potenciais', value: fmtNum(d.filial.potenciais) },
          { label: 'N° Potenciais Reais', value: fmtNum(d.filial.potenciaisReais) },
          { label: 'N° Leads Aptas', value: fmtNum(d.filial.leadsAptas) },
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
  nivel: lerSessao('sessaoNivel'),
};

/* Permissões por nível:
   Chefe / Administrador → tudo
   Consultor             → não cria logins
   Agente                → não baixa relatórios */
function podeCriarLogins() {
  const n = sessao.nivel.toLowerCase();
  return n.includes('chefe') || n.includes('adm');
}
function podeBaixarRelatorios() {
  return !sessao.nivel.toLowerCase().includes('agente');
}

function aplicarSessao() {
  // Só o primeiro nome: "erick.s" → "Erick"
  const primeiroNome = sessao.usuario.split('.')[0];
  const nome = primeiroNome.charAt(0).toUpperCase() + primeiroNome.slice(1);

  document.getElementById('perfilUsuario').value = sessao.usuario;
  document.getElementById('perfilSenha').value = sessao.senha;
  document.getElementById('perfilNivel').value = sessao.nivel;
  document.getElementById('perfilNome').textContent = nome;
  document.getElementById('perfilNivelLabel').textContent = sessao.nivel;
  document.getElementById('greetingName').textContent = `Olá, ${nome}`;
  renderAvatar();
  renderSeletoresAvatar();

  // Permissões
  const gestor = podeCriarLogins();
  document.getElementById('secaoCriarCredencial')
    .classList.toggle('hidden', !gestor);
  document.getElementById('secaoGerenciarUsuarios')
    .classList.toggle('hidden', !gestor);
  document.querySelector('.nav-item[data-page="importar"]')
    .classList.toggle('hidden', !podeBaixarRelatorios());
  if (gestor) carregarUsuarios();
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
      sessao.nivel = json.nivel;
      const lembrar = document.getElementById('loginLembrar').checked;
      const storage = lembrar ? localStorage : sessionStorage;
      storage.setItem('sessaoUsuario', sessao.usuario);
      storage.setItem('sessaoSenha', sessao.senha);
      storage.setItem('sessaoNivel', sessao.nivel);
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
    const nivelClasse = 'nivel-' + u.nivel.toLowerCase()
      .normalize('NFD').replace(/[̀-ͯ]/g, '');

    return `
    <div class="usuario-row" data-usuario="${u.usuario}">
      <div class="usuario-avatar">${u.usuario.charAt(0).toUpperCase()}</div>
      <div class="usuario-info">
        <div class="usuario-nome">${u.usuario}${ehProprio ? ' (você)' : ''}</div>
        <div class="usuario-meta">
          ${u.criado ? 'Criado: ' + u.criado : ''}${u.ultimoAcesso ? ' • Último acesso: ' + u.ultimoAcesso : ''}
        </div>
      </div>
      <div class="usuario-badges">
        <span class="badge ${nivelClasse}">${u.nivel}</span>
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
    </div>
    <div class="usuario-editar hidden" id="editar-${i}">
      <div class="config-field">
        <label class="config-label">Nova senha (vazio = manter)</label>
        <div class="input-eye-wrap">
          <input type="password" class="config-input" id="editSenha-${i}" placeholder="••••••••" />
          <button type="button" class="btn-eye" data-target="editSenha-${i}" title="Mostrar/ocultar">
            <svg class="eye-open" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
            <svg class="eye-closed hidden" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/></svg>
          </button>
        </div>
      </div>
      <div class="config-field">
        <label class="config-label">Nível</label>
        <select class="config-input" id="editNivel-${i}">
          ${['Chefe', 'Administrador', 'Consultor', 'Agente'].map(n =>
            `<option value="${n}" ${u.nivel === n ? 'selected' : ''}>${n}</option>`).join('')}
        </select>
      </div>
      <button class="btn-mini sucesso" data-acao="salvar" data-i="${i}">Salvar</button>
      <button class="btn-mini" data-acao="cancelar" data-i="${i}">Cancelar</button>
    </div>`;
  }).join('');

  // Ações
  lista.querySelectorAll('[data-acao]').forEach(btn => {
    btn.addEventListener('click', async () => {
      const i = btn.dataset.i;
      const u = usuarios[i];
      const acao = btn.dataset.acao;

      if (acao === 'editar' || acao === 'cancelar') {
        document.getElementById(`editar-${i}`).classList.toggle('hidden', acao === 'cancelar');
        return;
      }

      if (acao === 'salvar') {
        const novaSenha = document.getElementById(`editSenha-${i}`).value.trim();
        const novoNivel = document.getElementById(`editNivel-${i}`).value;
        btn.disabled = true;
        try {
          const json = await apiGestor({ action: 'editarusuario', usuario: u.usuario, novaSenha, novoNivel });
          gerFeedback(json.ok ? json.mensagem : json.erro, json.ok);
          if (json.ok) carregarUsuarios();
        } catch { gerFeedback('Erro de conexão.', false); }
        btn.disabled = false;
        return;
      }

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
  ['sessaoUsuario', 'sessaoSenha', 'sessaoNivel'].forEach(k => {
    localStorage.removeItem(k);
    sessionStorage.removeItem(k);
  });
  location.reload();
});

/* ===== PERFIL: criar nova credencial (ADM) ===== */
document.getElementById('btnCriarCredencial').addEventListener('click', async () => {
  const novoUsuario = document.getElementById('novoUsuario').value.trim();
  const novaSenha = document.getElementById('novaSenha').value.trim();
  const confirmaSenha = document.getElementById('confirmaSenha').value.trim();
  const fb = document.getElementById('credFeedback');

  const mostrarFb = (msg, ok) => {
    fb.textContent = msg;
    fb.style.color = ok ? '#22c55e' : '#ef4444';
    fb.classList.remove('hidden');
    setTimeout(() => fb.classList.add('hidden'), 3500);
  };

  if (!novoUsuario || !novaSenha) {
    mostrarFb('Preencha o novo usuário e a senha.', false);
    return;
  }
  if (novaSenha !== confirmaSenha) {
    mostrarFb('As senhas não coincidem.', false);
    return;
  }
  if (!SHEETS_API_URL) {
    mostrarFb('Configure a SHEETS_API_URL no script.js primeiro.', false);
    return;
  }

  try {
    const params = new URLSearchParams({
      action: 'criarlogin',
      admUsuario: sessao.usuario,
      admSenha: sessao.senha,
      novoUsuario, novaSenha,
      nivel: document.getElementById('novoNivel').value,
    });
    const res = await fetch(`${SHEETS_API_URL}?${params}`);
    const json = await res.json();
    mostrarFb(json.ok ? json.mensagem : json.erro, json.ok);
    if (json.ok) {
      document.getElementById('novoUsuario').value = '';
      document.getElementById('novaSenha').value = '';
      document.getElementById('confirmaSenha').value = '';
      carregarUsuarios();
    }
  } catch (e) {
    mostrarFb('Erro de conexão com a planilha.', false);
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
document.getElementById('sidebarToggle').addEventListener('click', () => {
  document.body.classList.toggle('sidebar-collapsed');
});

/* ===== REFRESH BUTTONS ===== */
document.getElementById('refreshBtn').addEventListener('click', doRefresh);
document.getElementById('topRefreshBtn').addEventListener('click', doRefresh);

/* ===== IMPORTAR RELATÓRIO ===== */
const repState = { tipo: 'consolidado', canal: 'todos', formato: 'excel' };

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
    rows.push(linha('AMO Sede', sede));
    rows.push(linha('AMO Filial', filial));
    rows.push(linha('Total Geral', calcTotal({ sede, filial })));
  } else if (repState.canal === 'sede') {
    rows.push(linha('AMO Sede', sede));
  } else {
    rows.push(linha('AMO Filial', filial));
  }
  return rows;
}

/** Modo Detalhado por Dia: uma linha por dia/canal no intervalo */
function getRelatorioRowsDiario() {
  let rows = [];
  if (repState.canal === 'todos' || repState.canal === 'sede') {
    rows.push(...repFiltrarRows(rawRows.sede).map(r => ({ ...r, canal: 'AMO Sede' })));
  }
  if (repState.canal === 'todos' || repState.canal === 'filial') {
    rows.push(...repFiltrarRows(rawRows.filial).map(r => ({ ...r, canal: 'AMO Filial' })));
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

/* ===== VISUALIZAÇÃO POR DIA ===== */
const tableState = {
  rows: [],       // todos os registros diários
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
      <td><span class="canal-badge ${r.canal}">${r.canal === 'sede' ? 'AMO Sede' : 'AMO Filial'}</span></td>
      <td>${fmtBRL(r.investimento)}</td>
      <td>${fmtNum(r.leads)}</td>
      <td>${fmtNum(r.potenciais)}</td>
      <td>${fmtNum(r.potenciaisReais)}</td>
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

/* ===== INIT ===== */
if (sessao.usuario) aplicarSessao();
setFiltroModo('periodo');
document.querySelector('#periodGroup .btn-seg[data-val="hoje"]').classList.add('active');
state.periodo = 'hoje';
doRefresh();
