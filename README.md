# Painel Gerencial AMO

Painel web para acompanhamento de leads e investimento das unidades **Éder Sede**, **Éder Filial**, **Breno Sede** e **Breno Filial**, com dados alimentados em tempo real por uma planilha do Google Sheets.

Feito em HTML, CSS e JavaScript puros — sem frameworks, sem build, sem servidor próprio. É só abrir o `index.html` (ou hospedar em qualquer lugar estático, como o GitHub Pages).

---

## 1. Funcionalidades

### Tela de login
- Acesso restrito: só entra quem tem credencial cadastrada na planilha.
- Visual em "vidro fosco" (glassmorphism) com fundo animado nas cores da AMO.
- Olhinho para mostrar/ocultar a senha enquanto digita.
- **Lembrar de mim**: ligado, a sessão sobrevive ao fechar o navegador; desligado, ela expira quando o navegador fecha.
- **Esqueci a senha**: abre o WhatsApp do suporte com a mensagem pronta.
- Usuário suspenso não consegue entrar.

### Painel Éder e Painel Breno

Cada painel funciona de forma independente, com os mesmos recursos:

#### Visão Geral
- Cards de **Total Geral**, **Sede** e **Filial** com: Investimento, N° Leads, N° Potenciais, N° Potenciais Reais e N° Leads Aptas.
- Skeleton animado ao carregar (só em refresh manual ou mudança de filtro — refresh automático é silencioso).
- Filtros de data **mutuamente exclusivos** (ativar um apaga os outros):
  - **Período**: Hoje (padrão), Ontem, 7d, 30d, 60d, 90d
  - **Data**: calendário para um dia específico
  - **Intervalo**: de uma data até outra
- Filtro de **Canal**: Todos / Sede / Filial
- Barra de status com:
  - Horário da última atualização e contagem regressiva para a próxima (1 minuto)
  - **Leads atualizados** e **Investimento atualizado**: última vez que cada dado mudou na planilha, monitorados de forma independente por painel

#### Visualização por Dia
- Tabela com todas as linhas diárias, da data mais recente para a mais antiga.
- **Zebrado por dia**: linhas do mesmo dia compartilham a cor de fundo.
- Paginação configurável: 25 / 50 / 100 / 200 linhas por página.

#### Importar Relatório
- Dois tipos: **Resumo Consolidado** (totais por canal) e **Detalhado por Dia** (uma linha por dia/canal).
- Filtros de período (de/até) e canal.
- Dois formatos: **Excel (.xlsx)** e **PDF** (cabeçalho colorido + zebrado no modo diário).
- Valores formatados em R$ com separador de milhar.

### Perfil
- Credenciais **ofuscadas** (usuário e senha como •••), com olhinho para revelar.
- **Personalização de avatar**: 8 ícones e 8 cores em gradiente, salvas por usuário no localStorage.
- Botão **Sair do painel**.

### Gerenciamento de usuários *(só Chefe e Administrador)*
- **Criar credencial**: usuário, senha, painéis e nível de acesso por painel.
- **Lista de usuários** com badges de acesso, status Online/Offline em tempo real, situação e datas.
- **Editar** (card modal): trocar senha, painéis e níveis.
- **Excluir**: remove a credencial permanentemente.
- **Suspender / Reativar**: usuário suspenso não loga. Ninguém suspende a si mesmo.
- Cor de avatar determinística por nome de usuário na lista.

### Níveis de acesso (por painel)

| Nível | Gerencia usuários | Baixa relatórios | Ver dados |
|---|---|---|---|
| **DEV** | ✅ (todos os painéis) | ✅ | ✅ |
| **Chefe** | ✅ (todos os painéis) | ✅ | ✅ |
| **Administrador** | ✅ (no painel) | ✅ | ✅ |
| **Consultor** | ❌ | ✅ | ✅ |
| **Agente** | ❌ | ✅ | ✅ |

> **DEV** é definido diretamente na planilha (coluna NÍVEL = `DEV`) e tem acesso irrestrito a tudo.
> **Chefe** é atribuído via planilha e equivale ao DEV em permissões, mas com acesso registrado.
> Cada usuário pode ter níveis diferentes em cada painel (ex: Administrador no Éder e Agente no Breno).

### Outros recursos
- **Modo escuro** com um clique, lembrado entre visitas.
- **Histórico de atualizações** (ícone de relógio na topbar): registra quando leads e investimento mudaram; guarda os últimos 50 eventos.
- **Status Online em tempo real**: heartbeat a cada minuto; quem fica 2 min sem sinal aparece como Offline.
- **Menu lateral recolhível** com grupos por painel (Éder e Breno), ambos abertos por padrão.
- Layout **responsivo** para celular (menu vira gaveta deslizante, cards empilham, tabela rola na horizontal).

---

## 2. Parte técnica

### Arquitetura

```
┌─────────────────┐     HTTPS (JSON)      ┌──────────────────────┐
│  Painel (site    │ ◄──────────────────► │  Google Apps Script  │
│  estático:       │                       │      (Web App)        │
│  index.html,     │                       │          │            │
│  style.css,      │                       │          ▼            │
│  script.js)      │                       │  Planilha Google      │
└─────────────────┘                       │  (5 abas)             │
                                           └──────────────────────┘
```

O front-end nunca acessa a planilha diretamente — tudo passa pelo Apps Script, que expõe uma API JSON.

### Arquivos

| Arquivo | O que é |
|---|---|
| `index.html` | Estrutura da página (login + 6 páginas internas). SPA simples via classe `.active`. |
| `style.css` | Todo o visual. Temas claro/escuro com variáveis CSS. |
| `script.js` | Toda a lógica (fetch, filtros, cards, tabelas, sessão, permissões, relatórios). |
| `apps-script-Code.gs` | Backend: colar no editor do Google Apps Script. |
| `icone-amo.png` | Ícone da AMO (sidebar e favicon). |

### A planilha

Cinco abas:

- **EDER SEDE** e **EDER FILIAL** — dados diários do Painel Éder
- **BRENO SEDE** e **BRENO FILIAL** — dados diários do Painel Breno
- **CREDENCIAIS PAINEL** — `USUARIO | SENHA | NÍVEL | CRIADO QUANDO | ÚLTIMO ACESSO | STATUS | SITUAÇÃO | PAINEIS`

Colunas de dados (o Apps Script localiza pelo cabeçalho, a ordem pode mudar):
`Semana | Data | N° de Leads | N° de Potenciais CLT | N° de Potenciais reais | N° de Leads APTAS | N° de Qualificadas | Investimento`

Coluna PAINEIS (formato): `eder=Administrador;breno=Agente`

### A API (Apps Script)

Todas as ações são `GET` na URL `/exec` com o parâmetro `action`:

| Ação | Parâmetros | O que faz |
|---|---|---|
| `dados` | `usuario`, `senha` | Retorna linhas diárias dos 4 canais + timestamps de alteração por painel. Exige credencial válida. |
| `login` | `usuario`, `senha` | Valida login, marca Online, retorna `{ ehDev, paineis }`. |
| `ping` | `usuario` | Heartbeat — mantém status Online. |
| `logout` | `usuario` | Marca Offline. |
| `criarlogin` | `admUsuario`, `admSenha`, `novoUsuario`, `novaSenha`, `paineis`, `dev` | Cria credencial. Só Chefe/Administrador. |
| `listarusuarios` | `admUsuario`, `admSenha` | Lista usuários sem expor senhas. |
| `editarusuario` | `admUsuario`, `admSenha`, `usuario`, `novaSenha?`, `paineis?`, `dev?` | Edita senha e/ou painéis. |
| `excluirusuario` | `admUsuario`, `admSenha`, `usuario` | Remove a linha da planilha. |
| `situacao` | `admUsuario`, `admSenha`, `usuario`, `situacao` | Ativa ou suspende. |

Respostas sempre em JSON: `{ ok: true, ... }` ou `{ ok: false, erro: "mensagem" }`.

**Detecção de mudanças**: a cada chamada de `dados`, o script calcula hashes de leads e investimento separadamente para Éder e Breno, e compara com os anteriores (guardados em `PropertiesService` com prefixo `eder_` / `breno_`). Hash diferente = registra o horário da mudança.

### Como o front funciona (script.js)

- **Estado global por painel**: `state` (Éder) e `stateBreno` com filtros, canal e dados independentes.
- **`fetchData()`**: única chamada que retorna dados dos dois painéis de uma vez. Alimenta `rawRows` e `rawRowsBreno`.
- **`doRefresh(silencioso)`**: quando `silencioso = true` (auto-refresh), não exibe skeleton — atualiza os números sem piscar. Quando `false` (manual ou mudança de filtro), exibe skeleton durante o carregamento.
- **Sessão**: `sessaoUsuario`, `sessaoSenha`, `sessaoEhDev`, `sessaoPaineis` no `localStorage` ou `sessionStorage`.
- **Permissões no front**: ocultam elementos visualmente — a validação real é no Apps Script em toda ação sensível.
- **Relatórios**: gerados no navegador com [SheetJS](https://sheetjs.com/) (Excel) e [jsPDF](https://github.com/parallax/jsPDF) + autoTable (PDF), via CDN.

### Instalação do zero

1. **Planilha**: crie as 5 abas com os cabeçalhos descritos e pelo menos um usuário na CREDENCIAIS PAINEL com `NÍVEL = DEV` ou `PAINEIS = eder=Chefe`.
2. **Apps Script**: Extensões → Apps Script → cole o conteúdo de `apps-script-Code.gs` → salvar.
3. **Implantar**: Implantar → Nova implantação → App da Web → executar como **"Eu"**, acesso **"Qualquer pessoa"** → copie a URL `/exec`.
4. **Conectar**: cole a URL na constante `SHEETS_API_URL` no topo do `script.js`.
5. **Hospedar**: suba os arquivos em qualquer hospedagem estática (GitHub Pages, Netlify, etc.).

> **Atualizou o Apps Script?** Não basta salvar: Implantar → Gerenciar implantações → ✏️ → "Nova versão" → Implantar. A URL não muda.

### Notas de segurança

- A planilha continua privada — o código público não dá acesso direto a ela.
- A API de dados exige credencial válida; sem login, responde "Não autorizado".
- Não há limite de tentativas de login: **use senhas fortes** nas contas DEV e Chefe.
- A senha da sessão fica no navegador com "Lembrar de mim" — evite em computadores compartilhados.
- DEV só pode ser criado/editado por outro DEV — a proteção é validada no Apps Script.
