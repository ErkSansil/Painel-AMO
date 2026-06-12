/**
 * API do Painel AMO — Google Apps Script
 * Planilha: DB. LEADS EDER PLATAFORMA
 *
 * COMO INSTALAR:
 * 1. Abra a planilha → Extensões → Apps Script
 * 2. Apague o conteúdo do Code.gs e cole este arquivo inteiro
 * 3. Clique em "Implantar" → "Nova implantação"
 * 4. Tipo: "App da Web"
 *    - Executar como: "Eu" (sua conta)
 *    - Quem pode acessar: "Qualquer pessoa"
 * 5. Clique em "Implantar" e copie a URL gerada (termina em /exec)
 * 6. Cole essa URL no script.js do painel, na constante SHEETS_API_URL
 *
 * AÇÕES:
 *   ?action=dados                          → linhas diárias de SEDE e FILIAL
 *   ?action=login&usuario=&senha=          → valida login, marca Online
 *   ?action=ping&usuario=                  → heartbeat (mantém Online)
 *   ?action=logout&usuario=                → marca Offline
 *   ?action=criarlogin&admUsuario=&admSenha=&novoUsuario=&novaSenha=&nivel=
 */

const ABA_SEDE = 'EDER SEDE';
const ABA_FILIAL = 'EDER FILIAL';
const ABA_CREDENCIAIS = 'CREDENCIAIS PAINEL';
const MINUTOS_PARA_OFFLINE = 2;

function doGet(e) {
  const action = (e.parameter.action || 'dados').toLowerCase();
  let result;

  try {
    if (action === 'dados') {
      // Exige credenciais válidas para ver os dados
      const auth = validarCredencial(e.parameter.usuario, e.parameter.senha);
      result = auth.ok ? getDados() : { ok: false, erro: 'Não autorizado' };
    } else if (action === 'login') {
      result = login(e.parameter.usuario, e.parameter.senha);
    } else if (action === 'ping') {
      result = ping(e.parameter.usuario);
    } else if (action === 'logout') {
      result = logout(e.parameter.usuario);
    } else if (action === 'criarlogin') {
      result = criarLogin(
        e.parameter.admUsuario, e.parameter.admSenha,
        e.parameter.novoUsuario, e.parameter.novaSenha, e.parameter.nivel
      );
    } else if (action === 'listarusuarios') {
      result = listarUsuarios(e.parameter.admUsuario, e.parameter.admSenha);
    } else if (action === 'editarusuario') {
      result = editarUsuario(
        e.parameter.admUsuario, e.parameter.admSenha,
        e.parameter.usuario, e.parameter.novaSenha, e.parameter.novoNivel
      );
    } else if (action === 'situacao') {
      result = mudarSituacao(
        e.parameter.admUsuario, e.parameter.admSenha,
        e.parameter.usuario, e.parameter.situacao
      );
    } else {
      result = { ok: false, erro: 'Ação desconhecida' };
    }
  } catch (err) {
    result = { ok: false, erro: String(err) };
  }

  return ContentService
    .createTextOutput(JSON.stringify(result))
    .setMimeType(ContentService.MimeType.JSON);
}

/* ================= DADOS DIÁRIOS ================= */

/** Normaliza cabeçalho: minúsculas, sem acentos, só letras */
function normHeader(h) {
  return String(h).toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z]/g, '');
}

/** Identifica a métrica de cada coluna pelo cabeçalho */
function mapearColuna(h) {
  const n = normHeader(h);
  if (!n) return null;
  if (n.includes('semana')) return 'semana';
  if (n === 'data' || n.includes('data')) return 'data';
  if (n.includes('aptas')) return 'leadsAptas';
  if (n.includes('potenciaisclt') || (n.includes('potenciais') && n.includes('clt'))) return 'potenciaisCLT';
  if (n.includes('potenciaisreais') || (n.includes('potenciais') && n.includes('reais'))) return 'potenciaisReais';
  if (n.includes('qualificadas')) return 'qualificadas';
  if (n.includes('investimento')) return 'investimento';
  if (n.includes('leads')) return 'leads';
  return null;
}

/** Converte valor da célula em número (aceita "R$ 3.839,28") */
function paraNumero(v) {
  if (typeof v === 'number') return v;
  if (v === '' || v == null) return 0;
  const s = String(v).replace(/[R$\s.]/g, '').replace(',', '.');
  return parseFloat(s) || 0;
}

/** Converte data da célula em "yyyy-mm-dd" */
function paraDataISO(v) {
  if (v instanceof Date) {
    return Utilities.formatDate(v, Session.getScriptTimeZone(), 'yyyy-MM-dd');
  }
  // texto "12/06/2026"
  const m = String(v).match(/(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (m) return m[3] + '-' + m[2].padStart(2, '0') + '-' + m[1].padStart(2, '0');
  return null;
}

/** Lê uma aba de dados diários e devolve linhas normalizadas */
function lerDiario(nomeAba) {
  const sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(nomeAba);
  if (!sh) throw new Error('Aba não encontrada: ' + nomeAba);
  const values = sh.getDataRange().getValues();
  if (values.length < 2) return [];

  // mapeia colunas pelo cabeçalho da linha 1
  const cols = values[0].map(mapearColuna);

  const rows = [];
  for (let i = 1; i < values.length; i++) {
    const row = { semana: '', data: null, leads: 0, potenciaisCLT: 0, potenciaisReais: 0, leadsAptas: 0, qualificadas: 0, investimento: 0 };
    let temData = false;

    for (let j = 0; j < cols.length; j++) {
      const campo = cols[j];
      if (!campo) continue;
      const v = values[i][j];
      if (campo === 'semana') row.semana = String(v).trim();
      else if (campo === 'data') {
        row.data = paraDataISO(v);
        if (row.data) temData = true;
      } else {
        row[campo] = paraNumero(v);
      }
    }
    if (temData) rows.push(row);
  }
  return rows;
}

function getDados() {
  const sede = lerDiario(ABA_SEDE);
  const filial = lerDiario(ABA_FILIAL);
  const alteracoes = detectarAlteracoes(sede, filial);

  return {
    ok: true,
    sede: sede,
    filial: filial,
    ultimaAttLeads: alteracoes.leads,
    ultimaAttInvestimento: alteracoes.investimento,
    geradoEm: new Date().toISOString(),
  };
}

/** Detecta quando os dados de leads e de investimento mudaram pela última vez.
 *  Guarda um hash de cada grupo em PropertiesService; quando o hash muda,
 *  registra o horário. */
function detectarAlteracoes(sede, filial) {
  const props = PropertiesService.getScriptProperties();
  const todas = sede.concat(filial);

  const hashLeads = String(todas.map(r =>
    [r.data, r.leads, r.potenciaisCLT, r.potenciaisReais, r.leadsAptas, r.qualificadas].join('|')
  ).join(';')).split('').reduce((a, c) => (a * 31 + c.charCodeAt(0)) >>> 0, 0);

  const hashInvest = String(todas.map(r =>
    [r.data, r.investimento].join('|')
  ).join(';')).split('').reduce((a, c) => (a * 31 + c.charCodeAt(0)) >>> 0, 0);

  const agora = agoraTexto();
  const resultado = {};

  if (props.getProperty('hashLeads') !== String(hashLeads)) {
    props.setProperty('hashLeads', String(hashLeads));
    props.setProperty('attLeads', agora);
  }
  if (props.getProperty('hashInvest') !== String(hashInvest)) {
    props.setProperty('hashInvest', String(hashInvest));
    props.setProperty('attInvest', agora);
  }

  resultado.leads = props.getProperty('attLeads') || agora;
  resultado.investimento = props.getProperty('attInvest') || agora;
  return resultado;
}

/* ================= CREDENCIAIS ================= */
/* Colunas esperadas: USUARIO | SENHA | NIVEL | CRIADO QUANDO | ULTIMO ACESSO | STATUS */

function abaCred() {
  const sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(ABA_CREDENCIAIS);
  if (!sh) throw new Error('Aba não encontrada: ' + ABA_CREDENCIAIS);
  return sh;
}

/** Localiza índices das colunas pela linha 1 */
function colunasCred(sh) {
  const headers = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0];
  const idx = {};
  headers.forEach((h, i) => {
    const n = normHeader(h);
    if (n.includes('usuario')) idx.usuario = i + 1;
    else if (n.includes('senha')) idx.senha = i + 1;
    else if (n.includes('nivel')) idx.nivel = i + 1;
    else if (n.includes('criado')) idx.criado = i + 1;
    else if (n.includes('ultimo') || n.includes('acesso')) idx.ultimoAcesso = i + 1;
    else if (n.includes('status')) idx.status = i + 1;
    else if (n.includes('situacao') || n.includes('suspens')) idx.situacao = i + 1;
  });

  // Cria a coluna SITUAÇÃO automaticamente se não existir
  if (!idx.situacao) {
    const novaCol = sh.getLastColumn() + 1;
    sh.getRange(1, novaCol).setValue('SITUAÇÃO');
    idx.situacao = novaCol;
  }
  return idx;
}

/** Valida que quem chama é Chefe ou Administrador */
function autenticarGestor(admUsuario, admSenha) {
  const auth = login(admUsuario, admSenha);
  if (!auth.ok) return { ok: false, erro: 'Credenciais inválidas' };
  const n = normHeader(auth.nivel);
  if (!n.includes('chefe') && !n.includes('adm')) {
    return { ok: false, erro: 'Seu nível de acesso não permite gerenciar usuários' };
  }
  return auth;
}

/** Encontra a linha (número) de um usuário; 0 se não achar */
function linhaDoUsuario(sh, idx, usuario) {
  if (!idx.usuario) return 0;
  const lastRow = sh.getLastRow();
  if (lastRow < 2) return 0;
  const vals = sh.getRange(2, idx.usuario, lastRow - 1, 1).getValues();
  const alvo = String(usuario).trim().toLowerCase();
  for (let i = 0; i < vals.length; i++) {
    if (String(vals[i][0]).trim().toLowerCase() === alvo) return i + 2;
  }
  return 0;
}

function agoraTexto() {
  return Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'dd/MM/yyyy - HH:mm');
}

/** Marca Offline quem está sem heartbeat há mais de MINUTOS_PARA_OFFLINE */
function atualizarStatusOffline(sh, idx) {
  if (!idx.status || !idx.ultimoAcesso) return;
  const lastRow = sh.getLastRow();
  if (lastRow < 2) return;

  const acessos = sh.getRange(2, idx.ultimoAcesso, lastRow - 1, 1).getValues();
  const status = sh.getRange(2, idx.status, lastRow - 1, 1).getValues();
  const agora = new Date();

  for (let i = 0; i < acessos.length; i++) {
    if (String(status[i][0]).trim().toLowerCase() !== 'online') continue;
    const m = String(acessos[i][0]).match(/(\d{1,2})\/(\d{1,2})\/(\d{4})\s*-\s*(\d{1,2}):(\d{2})/);
    let stale = true;
    if (m) {
      const dt = new Date(m[3], m[2] - 1, m[1], m[4], m[5]);
      stale = (agora - dt) / 60000 > MINUTOS_PARA_OFFLINE;
    }
    if (stale) sh.getRange(i + 2, idx.status).setValue('Offline');
  }
}

/** Confere usuário/senha sem efeitos colaterais (não mexe em status/acesso).
 *  Usada para proteger a leitura dos dados. */
function validarCredencial(usuario, senha) {
  if (!usuario || !senha) return { ok: false };

  const sh = abaCred();
  const idx = colunasCred(sh);
  const linha = linhaDoUsuario(sh, idx, usuario);
  if (!linha) return { ok: false };

  const senhaPlanilha = String(sh.getRange(linha, idx.senha).getValue()).trim();
  if (senhaPlanilha !== String(senha).trim()) return { ok: false };

  if (idx.situacao) {
    const sit = normHeader(sh.getRange(linha, idx.situacao).getValue());
    if (sit.includes('suspens')) return { ok: false };
  }
  return { ok: true };
}

function login(usuario, senha) {
  if (!usuario || !senha) return { ok: false, erro: 'Informe usuário e senha' };

  const sh = abaCred();
  const idx = colunasCred(sh);
  const linha = linhaDoUsuario(sh, idx, usuario);
  if (!linha) return { ok: false, erro: 'Usuário ou senha incorretos' };

  const senhaPlanilha = String(sh.getRange(linha, idx.senha).getValue()).trim();
  if (senhaPlanilha !== String(senha).trim()) {
    return { ok: false, erro: 'Usuário ou senha incorretos' };
  }

  // Usuário suspenso não entra
  if (idx.situacao) {
    const sit = normHeader(sh.getRange(linha, idx.situacao).getValue());
    if (sit.includes('suspens')) {
      return { ok: false, erro: 'Usuário suspenso. Fale com um administrador.' };
    }
  }

  // marca Online e registra acesso
  if (idx.ultimoAcesso) sh.getRange(linha, idx.ultimoAcesso).setValue(agoraTexto());
  if (idx.status) sh.getRange(linha, idx.status).setValue('Online');
  atualizarStatusOffline(sh, idx);

  return {
    ok: true,
    usuario: String(sh.getRange(linha, idx.usuario).getValue()).trim(),
    nivel: idx.nivel ? String(sh.getRange(linha, idx.nivel).getValue()).trim() : 'Administrador',
  };
}

/** Heartbeat: o painel chama a cada minuto enquanto aberto */
function ping(usuario) {
  if (!usuario) return { ok: false, erro: 'Informe o usuário' };
  const sh = abaCred();
  const idx = colunasCred(sh);
  const linha = linhaDoUsuario(sh, idx, usuario);
  if (!linha) return { ok: false, erro: 'Usuário não encontrado' };

  if (idx.ultimoAcesso) sh.getRange(linha, idx.ultimoAcesso).setValue(agoraTexto());
  if (idx.status) sh.getRange(linha, idx.status).setValue('Online');
  atualizarStatusOffline(sh, idx);
  return { ok: true };
}

function logout(usuario) {
  if (!usuario) return { ok: false, erro: 'Informe o usuário' };
  const sh = abaCred();
  const idx = colunasCred(sh);
  const linha = linhaDoUsuario(sh, idx, usuario);
  if (linha && idx.status) sh.getRange(linha, idx.status).setValue('Offline');
  return { ok: true };
}

function criarLogin(admUsuario, admSenha, novoUsuario, novaSenha, nivel) {
  const auth = login(admUsuario, admSenha);
  if (!auth.ok) return { ok: false, erro: 'Credenciais inválidas' };
  // Apenas Chefe e Administrador podem criar logins
  const nivelAuth = normHeader(auth.nivel);
  if (!nivelAuth.includes('chefe') && !nivelAuth.includes('adm')) {
    return { ok: false, erro: 'Seu nível de acesso não permite criar logins' };
  }
  if (!novoUsuario || !novaSenha) return { ok: false, erro: 'Informe o novo usuário e senha' };

  const sh = abaCred();
  const idx = colunasCred(sh);
  if (linhaDoUsuario(sh, idx, novoUsuario)) return { ok: false, erro: 'Usuário já existe' };

  const novaLinha = sh.getLastRow() + 1;
  if (idx.usuario) sh.getRange(novaLinha, idx.usuario).setValue(String(novoUsuario).trim());
  if (idx.senha) sh.getRange(novaLinha, idx.senha).setValue(String(novaSenha).trim());
  // Níveis válidos: Chefe, Administrador, Consultor, Agente
  const niveisValidos = ['Chefe', 'Administrador', 'Consultor', 'Agente'];
  const nivelFinal = niveisValidos.find(n =>
    normHeader(n) === normHeader(nivel || '')) || 'Administrador';
  if (idx.nivel) sh.getRange(novaLinha, idx.nivel).setValue(nivelFinal);
  if (idx.criado) sh.getRange(novaLinha, idx.criado).setValue(agoraTexto());
  if (idx.status) sh.getRange(novaLinha, idx.status).setValue('Offline');

  return { ok: true, mensagem: 'Credencial criada com sucesso' };
}

/* ================= GERENCIAMENTO DE USUÁRIOS ================= */

/** Lista todos os usuários (sem expor as senhas) */
function listarUsuarios(admUsuario, admSenha) {
  const auth = autenticarGestor(admUsuario, admSenha);
  if (!auth.ok) return auth;

  const sh = abaCred();
  const idx = colunasCred(sh);
  const lastRow = sh.getLastRow();
  if (lastRow < 2) return { ok: true, usuarios: [] };

  const dados = sh.getRange(2, 1, lastRow - 1, sh.getLastColumn()).getValues();
  const get = (row, col) => col ? String(row[col - 1] || '').trim() : '';

  const usuarios = dados
    .filter(row => get(row, idx.usuario))
    .map(row => ({
      usuario: get(row, idx.usuario),
      nivel: get(row, idx.nivel) || 'Administrador',
      criado: get(row, idx.criado),
      ultimoAcesso: get(row, idx.ultimoAcesso),
      status: get(row, idx.status) || 'Offline',
      situacao: normHeader(get(row, idx.situacao)).includes('suspens') ? 'Suspenso' : 'Ativo',
    }));

  return { ok: true, usuarios: usuarios };
}

/** Edita senha e/ou nível de um usuário */
function editarUsuario(admUsuario, admSenha, usuario, novaSenha, novoNivel) {
  const auth = autenticarGestor(admUsuario, admSenha);
  if (!auth.ok) return auth;

  const sh = abaCred();
  const idx = colunasCred(sh);
  const linha = linhaDoUsuario(sh, idx, usuario);
  if (!linha) return { ok: false, erro: 'Usuário não encontrado' };

  if (novaSenha && idx.senha) {
    sh.getRange(linha, idx.senha).setValue(String(novaSenha).trim());
  }
  if (novoNivel && idx.nivel) {
    const niveisValidos = ['Chefe', 'Administrador', 'Consultor', 'Agente'];
    const nivelFinal = niveisValidos.find(n => normHeader(n) === normHeader(novoNivel));
    if (nivelFinal) sh.getRange(linha, idx.nivel).setValue(nivelFinal);
  }
  return { ok: true, mensagem: 'Usuário atualizado com sucesso' };
}

/** Ativa ou suspende um usuário */
function mudarSituacao(admUsuario, admSenha, usuario, situacao) {
  const auth = autenticarGestor(admUsuario, admSenha);
  if (!auth.ok) return auth;

  // Ninguém pode suspender a si mesmo
  if (String(usuario).trim().toLowerCase() === String(admUsuario).trim().toLowerCase()) {
    return { ok: false, erro: 'Você não pode suspender a si mesmo' };
  }

  const sh = abaCred();
  const idx = colunasCred(sh);
  const linha = linhaDoUsuario(sh, idx, usuario);
  if (!linha) return { ok: false, erro: 'Usuário não encontrado' };

  const nova = normHeader(situacao).includes('suspens') ? 'Suspenso' : 'Ativo';
  sh.getRange(linha, idx.situacao).setValue(nova);
  // Suspendeu? Derruba o status online também
  if (nova === 'Suspenso' && idx.status) {
    sh.getRange(linha, idx.status).setValue('Offline');
  }
  return { ok: true, mensagem: nova === 'Suspenso' ? 'Usuário suspenso' : 'Usuário reativado' };
}
