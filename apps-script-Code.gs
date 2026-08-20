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
 * AÇÕES (POST, mas doGet aceita os mesmos parâmetros por compatibilidade):
 *   ?action=dados&usuario=&token=          → linhas diárias de SEDE e FILIAL
 *   ?action=login&usuario=&senha=          → valida login, marca Online, devolve um token de sessão
 *   ?action=ping&usuario=&token=           → heartbeat (mantém Online)
 *   ?action=logout&usuario=&token=         → marca Offline, invalida o token
 *   ?action=minhasenha&usuario=&token=     → devolve a senha real do próprio usuário (Perfil)
 *   ?action=criarlogin&...&paineis=eder=Administrador;breno=Agente&dev=
 *   ?action=editarusuario&...&paineis=&dev=
 *   ?action=excluirusuario&...&usuario=
 *   ?action=listarusuarios / situacao      → usam admUsuario+admToken em vez de admSenha
 *
 * SESSÃO: login() devolve um token opaco (não a senha) que o front-end guarda e
 * reenvia em toda chamada autenticada. A senha real nunca fica salva no navegador.
 *
 * PERMISSÕES (multi-painel):
 *   - Coluna PAINEIS guarda "eder=Administrador;breno=Agente" (nível por painel)
 *   - Nível DEV (coluna NÍVEL = "DEV"): acesso total a todos os painéis
 *   - Retrocompat: usuário com NÍVEL preenchido e sem PAINEIS é tratado
 *     como aquele nível no Painel Éder
 */

const ABA_SEDE = 'EDER SEDE';
const ABA_FILIAL = 'EDER FILIAL';
const ABA_BRENO_SEDE = 'BRENO SEDE';
const ABA_BRENO_FILIAL = 'BRENO FILIAL';
const ABA_CREDENCIAIS = 'CREDENCIAIS PAINEL';
const MINUTOS_PARA_OFFLINE = 2;
const TOKEN_DIAS_VALIDADE = 90;

// Painéis e níveis reconhecidos pelo sistema
const PAINEIS_VALIDOS = ['eder', 'breno', 'vendas'];
const NIVEIS_VALIDOS = ['Chefe', 'Administrador', 'Consultor', 'Agente'];

/** "eder=Administrador;breno=Agente" → { eder:'Administrador', breno:'Agente' } */
function parsePaineis(texto) {
  const obj = {};
  String(texto || '').split(/[;,]/).forEach(par => {
    const pedacos = par.split('=');
    const painel = PAINEIS_VALIDOS.find(p => normHeader(p) === normHeader(pedacos[0]));
    const nivel = NIVEIS_VALIDOS.find(n => normHeader(n) === normHeader(pedacos[1]));
    if (painel && nivel) obj[painel] = nivel;
  });
  return obj;
}

/** { eder:'Administrador' } → "eder=Administrador" */
function serializaPaineis(obj) {
  return Object.keys(obj).map(p => p + '=' + obj[p]).join(';');
}

/** Descobre o acesso de um usuário (ehDev + mapa painel→nível) a partir da linha */
function resolverAcesso(sh, idx, linha) {
  const nivelCol = idx.nivel ? String(sh.getRange(linha, idx.nivel).getValue()).trim() : '';
  const ehDev = normHeader(nivelCol) === 'dev';

  if (ehDev) {
    const paineis = {};
    PAINEIS_VALIDOS.forEach(p => paineis[p] = 'DEV'); // acesso total
    return { ehDev: true, paineis: paineis };
  }

  let paineis = idx.paineis
    ? parsePaineis(sh.getRange(linha, idx.paineis).getValue())
    : {};

  // Retrocompat: sem coluna PAINEIS, mas com NÍVEL antigo → vale no Painel Éder
  if (Object.keys(paineis).length === 0) {
    const nivelAntigo = NIVEIS_VALIDOS.find(n => normHeader(n) === normHeader(nivelCol));
    if (nivelAntigo) paineis = { eder: nivelAntigo };
  }

  // Chefe em qualquer painel = acesso total ilimitado a TODOS os painéis
  const temChefe = Object.keys(paineis).some(p => normHeader(paineis[p]).includes('chefe'));
  if (temChefe) {
    const todos = {};
    PAINEIS_VALIDOS.forEach(p => todos[p] = 'Chefe');
    return { ehDev: false, paineis: todos };
  }

  return { ehDev: false, paineis: paineis };
}

/** Gestor = DEV, ou Chefe/Administrador em pelo menos um painel */
function ehGestor(acesso) {
  if (acesso.ehDev) return true;
  return Object.keys(acesso.paineis).some(p => {
    const n = normHeader(acesso.paineis[p]);
    return n.includes('chefe') || n.includes('adm');
  });
}

/** true se o acesso já contém nível Chefe em algum painel (Chefe = superusuário, ver resolverAcesso) */
function ehChefe(acesso) {
  return Object.keys(acesso.paineis).some(p => normHeader(acesso.paineis[p]).includes('chefe'));
}

/** Painéis onde o gestor tem poder de gerenciar usuários. DEV/Chefe gerenciam todos. */
function paineisGeridos(acesso) {
  if (acesso.ehDev) return PAINEIS_VALIDOS.slice();
  return Object.keys(acesso.paineis).filter(p => {
    const n = normHeader(acesso.paineis[p]);
    return n.includes('chefe') || n.includes('adm');
  });
}

function doGet(e) {
  const action = (e.parameter.action || 'dados').toLowerCase();
  let result;

  try {
    if (action === 'dados') {
      // Exige um token de sessão válido para ver os dados
      const ok = validarToken(e.parameter.usuario, e.parameter.token);
      result = ok ? getDados() : { ok: false, erro: 'Não autorizado' };
    } else if (action === 'login') {
      result = login(e.parameter.usuario, e.parameter.senha);
    } else if (action === 'ping') {
      result = ping(e.parameter.usuario, e.parameter.token);
    } else if (action === 'logout') {
      result = logout(e.parameter.usuario, e.parameter.token);
    } else if (action === 'minhasenha') {
      result = minhaSenha(e.parameter.usuario, e.parameter.token);
    } else if (action === 'criarlogin') {
      result = criarLogin(
        e.parameter.admUsuario, e.parameter.admToken,
        e.parameter.novoUsuario, e.parameter.novaSenha,
        e.parameter.paineis, e.parameter.dev
      );
    } else if (action === 'listarusuarios') {
      result = listarUsuarios(e.parameter.admUsuario, e.parameter.admToken);
    } else if (action === 'editarusuario') {
      result = editarUsuario(
        e.parameter.admUsuario, e.parameter.admToken,
        e.parameter.usuario, e.parameter.novaSenha,
        e.parameter.paineis, e.parameter.dev
      );
    } else if (action === 'excluirusuario') {
      result = excluirUsuario(
        e.parameter.admUsuario, e.parameter.admToken, e.parameter.usuario
      );
    } else if (action === 'situacao') {
      result = mudarSituacao(
        e.parameter.admUsuario, e.parameter.admToken,
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

/** POST usa os mesmos parâmetros que GET (Apps Script preenche e.parameter do corpo
 *  form-urlencoded também) — usado para não mandar usuário/senha/token na URL. */
function doPost(e) {
  return doGet(e);
}

/* ================= TOKEN DE SESSÃO =================
 * Substitui a senha nas chamadas do dia a dia: o front-end guarda esse token
 * (não a senha) e ele pode ser revogado a qualquer momento sem trocar a senha real. */

/** Gera e guarda um token novo para o usuário; não invalida tokens de outros dispositivos. */
function gerarToken(usuario) {
  const token = Utilities.getUuid();
  const expira = new Date(Date.now() + TOKEN_DIAS_VALIDADE * 24 * 60 * 60 * 1000).toISOString();
  PropertiesService.getScriptProperties().setProperty(
    'tok_' + token,
    JSON.stringify({ usuario: String(usuario).trim().toLowerCase(), expira: expira })
  );
  return token;
}

/** true se o token existe, pertence a esse usuário e não expirou */
function validarToken(usuario, token) {
  if (!usuario || !token) return false;
  const chave = 'tok_' + token;
  const props = PropertiesService.getScriptProperties();
  const bruto = props.getProperty(chave);
  if (!bruto) return false;

  try {
    const dados = JSON.parse(bruto);
    if (dados.usuario !== String(usuario).trim().toLowerCase()) return false;
    if (new Date(dados.expira) < new Date()) {
      props.deleteProperty(chave);
      return false;
    }
    return true;
  } catch (err) {
    return false;
  }
}

function invalidarToken(token) {
  if (token) PropertiesService.getScriptProperties().deleteProperty('tok_' + token);
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
  if (n.includes('vendas')) return 'vendasCLT';
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
    const row = { semana: '', data: null, leads: 0, potenciaisCLT: 0, potenciaisReais: 0, leadsAptas: 0, qualificadas: 0, vendasCLT: 0, investimento: 0 };
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

/** Lê a aba VENDAS E VALIDAÇÃO e devolve linhas individuais normalizadas.
 *  Sede: A=data, B=A/F, D=status | Filial: G=data, H=A/F, J=status */
function lerVendas() {
  const sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('VENDAS E VALIDAÇÃO');
  if (!sh) return [];
  const values = sh.getDataRange().getValues();
  if (values.length < 3) return [];

  function normStatus(v) {
    const s = String(v).trim().toUpperCase()
      .normalize('NFD').replace(/[̀-ͯ]/g, '');
    if (s === 'VALIDADA') return 'VALIDADA';
    if (s === 'CANCELADA') return 'CANCELADA';
    if (s.includes('NAO VALIDADA') || s.includes('NÃO VALIDADA') || s === 'NAO VALIDADA') return 'NAO_VALIDADA';
    return '';
  }

  const rows = [];
  for (let i = 2; i < values.length; i++) {
    const r = values[i];

    // SEDE: A(0)=data, B(1)=A/F, C(2)=cliente, D(3)=status, E(4)=observacao, F(5)=validadora
    const dataSede = paraDataISO(r[0]);
    if (dataSede) {
      const af = String(r[1]).trim();
      const status = normStatus(r[3]);
      if (status) rows.push({
        data: dataSede, canal: 'sede', isApta: af === 'Apta FUTURA', status: status,
        cliente: String(r[2] || '').trim(),
        observacao: String(r[4] || '').trim(),
        validadora: String(r[5] || '').trim(),
      });
    }

    // FILIAL: G(6)=data, H(7)=A/F, I(8)=cliente, J(9)=status, K(10)=observacao, L(11)=validadora
    const dataFilial = paraDataISO(r[6]);
    if (dataFilial) {
      const af = String(r[7]).trim();
      const status = normStatus(r[9]);
      if (status) rows.push({
        data: dataFilial, canal: 'filial', isApta: af === 'Apta FUTURA', status: status,
        cliente: String(r[8] || '').trim(),
        observacao: String(r[10] || '').trim(),
        validadora: String(r[11] || '').trim(),
      });
    }
  }
  return rows;
}

function getDados() {
  const sede = lerDiario(ABA_SEDE);
  const filial = lerDiario(ABA_FILIAL);
  const alteracoes = detectarAlteracoes('eder', sede, filial);

  let brenoSede = [], brenoFilial = [];
  try { brenoSede = lerDiario(ABA_BRENO_SEDE); } catch(e) {}
  try { brenoFilial = lerDiario(ABA_BRENO_FILIAL); } catch(e) {}
  const alteracoesBreno = detectarAlteracoes('breno', brenoSede, brenoFilial);

  let vendas = [];
  try { vendas = lerVendas(); } catch(e) {}

  return {
    ok: true,
    sede: sede,
    filial: filial,
    brenoSede: brenoSede,
    brenoFilial: brenoFilial,
    vendas: vendas,
    ultimaAttLeads: alteracoes.leads,
    ultimaAttInvestimento: alteracoes.investimento,
    brenoAttLeads: alteracoesBreno.leads,
    brenoAttInvestimento: alteracoesBreno.investimento,
    geradoEm: new Date().toISOString(),
  };
}

/** Detecta quando os dados de leads e de investimento mudaram pela última vez.
 *  Guarda um hash de cada grupo em PropertiesService; quando o hash muda,
 *  registra o horário. */
function detectarAlteracoes(prefixo, sede, filial) {
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

  if (props.getProperty(prefixo + '_hashLeads') !== String(hashLeads)) {
    props.setProperty(prefixo + '_hashLeads', String(hashLeads));
    props.setProperty(prefixo + '_attLeads', agora);
  }
  if (props.getProperty(prefixo + '_hashInvest') !== String(hashInvest)) {
    props.setProperty(prefixo + '_hashInvest', String(hashInvest));
    props.setProperty(prefixo + '_attInvest', agora);
  }

  resultado.leads = props.getProperty(prefixo + '_attLeads') || agora;
  resultado.investimento = props.getProperty(prefixo + '_attInvest') || agora;
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
    else if (n.includes('paineis') || n.includes('painel')) idx.paineis = i + 1;
  });

  // Cria colunas que faltarem automaticamente
  if (!idx.situacao) {
    const novaCol = sh.getLastColumn() + 1;
    sh.getRange(1, novaCol).setValue('SITUAÇÃO');
    idx.situacao = novaCol;
  }
  if (!idx.paineis) {
    const novaCol = sh.getLastColumn() + 1;
    sh.getRange(1, novaCol).setValue('PAINEIS');
    idx.paineis = novaCol;
  }
  return idx;
}

/** Valida que quem chama pode gerenciar usuários (DEV, ou Chefe/Adm em algum painel). */
function autenticarGestor(admUsuario, admToken) {
  if (!validarToken(admUsuario, admToken)) return { ok: false, erro: 'Sessão inválida' };
  const sh = abaCred();
  const idx = colunasCred(sh);
  const linha = linhaDoUsuario(sh, idx, admUsuario);
  if (!linha) return { ok: false, erro: 'Credenciais inválidas' };

  // Suspenso não pode gerenciar usuários mesmo com um token ainda válido
  if (idx.situacao) {
    const sit = normHeader(sh.getRange(linha, idx.situacao).getValue());
    if (sit.includes('suspens')) return { ok: false, erro: 'Usuário suspenso' };
  }

  const acesso = resolverAcesso(sh, idx, linha);
  if (!ehGestor(acesso)) {
    return { ok: false, erro: 'Seu nível de acesso não permite gerenciar usuários' };
  }
  return {
    ok: true,
    ehDev: acesso.ehDev,
    paineis: acesso.paineis,
    geridos: paineisGeridos(acesso),
    podeConcederChefe: acesso.ehDev || ehChefe(acesso),
  };
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

  const acesso = resolverAcesso(sh, idx, linha);
  const usuarioReal = String(sh.getRange(linha, idx.usuario).getValue()).trim();
  return {
    ok: true,
    usuario: usuarioReal,
    ehDev: acesso.ehDev,
    paineis: acesso.paineis,
    token: gerarToken(usuarioReal),
  };
}

/** Heartbeat: o painel chama a cada minuto enquanto aberto */
function ping(usuario, token) {
  if (!validarToken(usuario, token)) return { ok: false, erro: 'Sessão inválida' };
  const sh = abaCred();
  const idx = colunasCred(sh);
  const linha = linhaDoUsuario(sh, idx, usuario);
  if (!linha) return { ok: false, erro: 'Usuário não encontrado' };

  if (idx.ultimoAcesso) sh.getRange(linha, idx.ultimoAcesso).setValue(agoraTexto());
  if (idx.status) sh.getRange(linha, idx.status).setValue('Online');
  atualizarStatusOffline(sh, idx);
  return { ok: true };
}

function logout(usuario, token) {
  if (!usuario) return { ok: false, erro: 'Informe o usuário' };
  invalidarToken(token);
  const sh = abaCred();
  const idx = colunasCred(sh);
  const linha = linhaDoUsuario(sh, idx, usuario);
  if (linha && idx.status) sh.getRange(linha, idx.status).setValue('Offline');
  return { ok: true };
}

/** Devolve a senha real do próprio usuário autenticado (usada pelo olhinho no Perfil) */
function minhaSenha(usuario, token) {
  if (!validarToken(usuario, token)) return { ok: false, erro: 'Sessão inválida' };
  const sh = abaCred();
  const idx = colunasCred(sh);
  const linha = linhaDoUsuario(sh, idx, usuario);
  if (!linha) return { ok: false, erro: 'Usuário não encontrado' };
  return { ok: true, senha: String(sh.getRange(linha, idx.senha).getValue()).trim() };
}

function criarLogin(admUsuario, admToken, novoUsuario, novaSenha, paineisStr, dev) {
  const auth = autenticarGestor(admUsuario, admToken);
  if (!auth.ok) return auth;
  if (!novoUsuario || !novaSenha) return { ok: false, erro: 'Informe o novo usuário e senha' };

  const querDev = String(dev) === '1' || normHeader(dev) === 'true';
  if (querDev && !auth.ehDev) {
    return { ok: false, erro: 'Apenas DEV pode criar outro DEV' };
  }

  const paineis = parsePaineis(paineisStr);
  if (!querDev && Object.keys(paineis).length === 0) {
    return { ok: false, erro: 'Selecione ao menos um painel para o usuário' };
  }

  if (!querDev) {
    const foraDoEscopo = Object.keys(paineis).find(p => auth.geridos.indexOf(p) === -1);
    if (foraDoEscopo) return { ok: false, erro: 'Você não gerencia o painel "' + foraDoEscopo + '"' };

    const querChefe = Object.keys(paineis).some(p => normHeader(paineis[p]).includes('chefe'));
    if (querChefe && !auth.podeConcederChefe) {
      return { ok: false, erro: 'Apenas Chefe ou DEV pode conceder nível Chefe' };
    }
  }

  const sh = abaCred();
  const idx = colunasCred(sh);
  if (linhaDoUsuario(sh, idx, novoUsuario)) return { ok: false, erro: 'Usuário já existe' };

  const novaLinha = sh.getLastRow() + 1;
  sh.getRange(novaLinha, idx.usuario).setValue(String(novoUsuario).trim());
  sh.getRange(novaLinha, idx.senha).setValue(String(novaSenha).trim());
  if (idx.nivel) sh.getRange(novaLinha, idx.nivel).setValue(querDev ? 'DEV' : 'Padrão');
  if (idx.paineis) sh.getRange(novaLinha, idx.paineis).setValue(querDev ? '' : serializaPaineis(paineis));
  if (idx.criado) sh.getRange(novaLinha, idx.criado).setValue(agoraTexto());
  if (idx.status) sh.getRange(novaLinha, idx.status).setValue('Offline');

  return { ok: true, mensagem: 'Credencial criada com sucesso' };
}

/* ================= GERENCIAMENTO DE USUÁRIOS ================= */

/** Lista todos os usuários (sem expor as senhas) */
function listarUsuarios(admUsuario, admToken) {
  const auth = autenticarGestor(admUsuario, admToken);
  if (!auth.ok) return auth;

  const sh = abaCred();
  const idx = colunasCred(sh);
  const lastRow = sh.getLastRow();
  if (lastRow < 2) return { ok: true, usuarios: [] };

  const verTudo = auth.ehDev || auth.podeConcederChefe;
  const get = (row, col) => col ? String(row[col - 1] || '').trim() : '';
  const usuarios = [];

  for (let linha = 2; linha <= lastRow; linha++) {
    const row = sh.getRange(linha, 1, 1, sh.getLastColumn()).getValues()[0];
    if (!get(row, idx.usuario)) continue;

    const acesso = resolverAcesso(sh, idx, linha);

    // Administrador só enxerga usuários com quem compartilha ao menos um painel
    if (!verTudo && !Object.keys(acesso.paineis).some(p => auth.geridos.indexOf(p) !== -1)) continue;

    usuarios.push({
      usuario: get(row, idx.usuario),
      ehDev: acesso.ehDev,
      paineis: acesso.paineis,
      criado: get(row, idx.criado),
      // DEV não expõe a hora de acesso — só o status
      ultimoAcesso: acesso.ehDev ? '' : get(row, idx.ultimoAcesso),
      status: get(row, idx.status) || 'Offline',
      situacao: normHeader(get(row, idx.situacao)).includes('suspens') ? 'Suspenso' : 'Ativo',
    });
  }

  return { ok: true, usuarios: usuarios, solicitanteEhDev: auth.ehDev };
}

/** Edita senha e/ou painéis (níveis) e/ou flag DEV de um usuário */
function editarUsuario(admUsuario, admToken, usuario, novaSenha, paineisStr, dev) {
  const auth = autenticarGestor(admUsuario, admToken);
  if (!auth.ok) return auth;

  const sh = abaCred();
  const idx = colunasCred(sh);
  const linha = linhaDoUsuario(sh, idx, usuario);
  if (!linha) return { ok: false, erro: 'Usuário não encontrado' };

  const alvo = resolverAcesso(sh, idx, linha);
  const querDev = String(dev) === '1' || normHeader(dev) === 'true';

  // Mexer em conta DEV (ou tornar alguém DEV) exige ser DEV
  if ((alvo.ehDev || querDev) && !auth.ehDev) {
    return { ok: false, erro: 'Apenas DEV pode alterar uma conta DEV' };
  }
  // Mexer em conta Chefe exige ser Chefe ou DEV (Chefe = acesso quase total, ver resolverAcesso)
  if (ehChefe(alvo) && !auth.ehDev && !auth.podeConcederChefe) {
    return { ok: false, erro: 'Apenas Chefe ou DEV pode alterar uma conta Chefe' };
  }
  // Ninguém (exceto DEV) pode alterar o próprio nível de acesso — evita autopromoção
  const ehAutoedicao = String(usuario).trim().toLowerCase() === String(admUsuario).trim().toLowerCase();
  if (ehAutoedicao && !auth.ehDev && (querDev || paineisStr !== undefined)) {
    return { ok: false, erro: 'Você não pode alterar seu próprio nível de acesso' };
  }

  if (novaSenha && idx.senha) {
    sh.getRange(linha, idx.senha).setValue(String(novaSenha).trim());
  }

  // paineis só é atualizado se veio no pedido (string não-undefined)
  if (paineisStr !== undefined && paineisStr !== null) {
    const paineisPedidos = parsePaineis(paineisStr);

    if (!querDev) {
      const foraDoEscopo = Object.keys(paineisPedidos).find(p => auth.geridos.indexOf(p) === -1);
      if (foraDoEscopo) return { ok: false, erro: 'Você não gerencia o painel "' + foraDoEscopo + '"' };

      const querChefe = Object.keys(paineisPedidos).some(p => normHeader(paineisPedidos[p]).includes('chefe'));
      if (querChefe && !auth.podeConcederChefe) {
        return { ok: false, erro: 'Apenas Chefe ou DEV pode conceder nível Chefe' };
      }
    }

    // Um gestor escopado só pode alterar os painéis que ele mesmo administra;
    // o acesso do usuário nos demais painéis é preservado.
    let paineisFinal = {};
    if (!querDev) {
      paineisFinal = Object.assign({}, alvo.paineis);
      auth.geridos.forEach(p => delete paineisFinal[p]);
      Object.assign(paineisFinal, paineisPedidos);
    }

    if (!querDev && Object.keys(paineisFinal).length === 0) {
      return { ok: false, erro: 'O usuário precisa de ao menos um painel' };
    }
    if (idx.nivel) sh.getRange(linha, idx.nivel).setValue(querDev ? 'DEV' : 'Padrão');
    if (idx.paineis) sh.getRange(linha, idx.paineis).setValue(querDev ? '' : serializaPaineis(paineisFinal));
  }

  return { ok: true, mensagem: 'Usuário atualizado com sucesso' };
}

/** Exclui um usuário (apaga a linha). Não pode excluir a si mesmo. */
function excluirUsuario(admUsuario, admToken, usuario) {
  const auth = autenticarGestor(admUsuario, admToken);
  if (!auth.ok) return auth;

  if (String(usuario).trim().toLowerCase() === String(admUsuario).trim().toLowerCase()) {
    return { ok: false, erro: 'Você não pode excluir a si mesmo' };
  }

  const sh = abaCred();
  const idx = colunasCred(sh);
  const linha = linhaDoUsuario(sh, idx, usuario);
  if (!linha) return { ok: false, erro: 'Usuário não encontrado' };

  // Só DEV pode excluir uma conta DEV
  const alvo = resolverAcesso(sh, idx, linha);
  if (alvo.ehDev && !auth.ehDev) {
    return { ok: false, erro: 'Apenas DEV pode excluir uma conta DEV' };
  }
  // Só Chefe ou DEV pode excluir uma conta Chefe
  if (ehChefe(alvo) && !auth.ehDev && !auth.podeConcederChefe) {
    return { ok: false, erro: 'Apenas Chefe ou DEV pode excluir uma conta Chefe' };
  }
  // Administrador só exclui usuários com quem compartilha ao menos um painel
  if (!auth.ehDev && !auth.podeConcederChefe) {
    const temPainelComum = Object.keys(alvo.paineis).some(p => auth.geridos.indexOf(p) !== -1);
    if (!temPainelComum) return { ok: false, erro: 'Você não gerencia nenhum painel desse usuário' };
  }

  sh.deleteRow(linha);
  return { ok: true, mensagem: 'Usuário excluído' };
}

/** Ativa ou suspende um usuário */
function mudarSituacao(admUsuario, admToken, usuario, situacao) {
  const auth = autenticarGestor(admUsuario, admToken);
  if (!auth.ok) return auth;

  // Ninguém pode suspender a si mesmo
  if (String(usuario).trim().toLowerCase() === String(admUsuario).trim().toLowerCase()) {
    return { ok: false, erro: 'Você não pode suspender a si mesmo' };
  }

  const sh = abaCred();
  const idx = colunasCred(sh);
  const linha = linhaDoUsuario(sh, idx, usuario);
  if (!linha) return { ok: false, erro: 'Usuário não encontrado' };

  // Só DEV pode suspender/reativar uma conta DEV
  const alvo = resolverAcesso(sh, idx, linha);
  if (alvo.ehDev && !auth.ehDev) {
    return { ok: false, erro: 'Apenas DEV pode alterar uma conta DEV' };
  }
  // Só Chefe ou DEV pode suspender/reativar uma conta Chefe
  if (ehChefe(alvo) && !auth.ehDev && !auth.podeConcederChefe) {
    return { ok: false, erro: 'Apenas Chefe ou DEV pode alterar uma conta Chefe' };
  }
  // Administrador só altera usuários com quem compartilha ao menos um painel
  if (!auth.ehDev && !auth.podeConcederChefe) {
    const temPainelComum = Object.keys(alvo.paineis).some(p => auth.geridos.indexOf(p) !== -1);
    if (!temPainelComum) return { ok: false, erro: 'Você não gerencia nenhum painel desse usuário' };
  }

  const nova = normHeader(situacao).includes('suspens') ? 'Suspenso' : 'Ativo';
  sh.getRange(linha, idx.situacao).setValue(nova);
  // Suspendeu? Derruba o status online também
  if (nova === 'Suspenso' && idx.status) {
    sh.getRange(linha, idx.status).setValue('Offline');
  }
  return { ok: true, mensagem: nova === 'Suspenso' ? 'Usuário suspenso' : 'Usuário reativado' };
}
