# Painel AMO — Painel de Performance

Painel web para acompanhamento de leads e investimento das unidades **AMO Sede** e **AMO Filial**, com dados alimentados em tempo real por uma planilha do Google Sheets.

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

### Visão Geral
- Cards de **Total Geral** (Sede + Filial), **AMO Sede** e **AMO Filial** com:
  Investimento, N° Leads, N° Potenciais, N° Potenciais Reais e N° Leads Aptas.
- Filtros de data **mutuamente exclusivos** (ativar um apaga os outros):
  - **Período**: Hoje (padrão), Ontem, 7d, 30d, 60d, 90d
  - **Data**: calendário para um dia específico
  - **Intervalo**: de uma data até outra
- Filtro de **Canal**: Todos / AMO Sede / AMO Filial — o botão selecionado fica azul (Sede) ou verde (Filial).
- Barra de status com:
  - Horário da última atualização do painel e contagem regressiva para a próxima (automática, a cada 1 minuto)
  - **Leads atualizados**: última vez que os números de leads mudaram na planilha
  - **Investimento atualizado**: idem, para a coluna de investimento (monitorados separadamente)
- Botões "Atualizar agora" para forçar a atualização na hora.

### Visualização por Dia
- Tabela com todas as linhas diárias das duas unidades, da data mais recente para a mais antiga.
- **Zebrado por dia**: as linhas do mesmo dia (Sede e Filial) compartilham a cor de fundo, alternando entre branco e cinza a cada dia — fica fácil ler os pares.
- Paginação: 50 linhas por página por padrão, com opções de 25 / 50 / 100 / 200.

### Importar Relatório
- Dois tipos de relatório:
  - **Resumo Consolidado**: uma linha por canal + Total Geral, somando o período escolhido
  - **Detalhado por Dia**: uma linha por dia e por canal
- Filtros de período (de/até) e canal (Sede + Filial, só Sede ou só Filial).
- Dois formatos de arquivo:
  - **Excel (.xlsx)** — com título, período e data/hora de geração no topo
  - **PDF** — tabela formatada com cabeçalho colorido; no modo Detalhado, o mesmo zebrado por dia do painel
- Valores já formatados (R$ com separador de milhar).

### Perfil
- Credenciais do usuário **ofuscadas** (usuário e senha como •••), com olhinho para revelar.
- **Personalização de avatar**: 8 ícones e 8 cores em gradiente; a escolha aparece no perfil e na topbar, e é salva por usuário.
- Botão **Sair do painel**.

### Gerenciamento de usuários *(só Chefe e Administrador)*
- **Criar credencial**: usuário, senha + confirmação de senha, e nível de acesso.
- **Lista de usuários** com nível, status (Online/Offline em tempo real), situação e datas de criação/último acesso.
- **Editar**: trocar senha e/ou nível de qualquer usuário.
- **Suspender / Reativar**: usuário suspenso não loga e é desconectado na hora. Ninguém consegue suspender a si mesmo.

### Níveis de acesso

| Nível | Permissões |
|---|---|
| **Chefe** | Acesso total |
| **Administrador** | Acesso total |
| **Consultor** | Não cria/gerencia logins |
| **Agente** | Não baixa relatórios (e não gerencia logins) |

### Outros recursos
- **Modo escuro** com um clique, lembrado entre visitas.
- **Histórico de atualizações** (ícone de relógio na topbar): registra quando os leads e o investimento mudaram na planilha; guarda os últimos 50 eventos.
- **Status Online em tempo real**: enquanto o painel está aberto, ele "dá sinal de vida" a cada minuto; quem fica 2 minutos sem sinal aparece como Offline na planilha.
- **Menu lateral recolhível** e layout **responsivo** para celular (menu vira gaveta deslizante, cards empilham, tabela rola na horizontal).

---

## 2. Parte técnica

### Arquitetura

```
┌─────────────────┐     HTTPS (JSON)      ┌──────────────────┐
│  Painel (site    │ ◄──────────────────► │  Google Apps     │
│  estático:       │                       │  Script (Web App) │
│  index.html,     │                       │        │          │
│  style.css,      │                       │        ▼          │
│  script.js)      │                       │  Planilha Google  │
└─────────────────┘                       │  (3 abas)         │
                                           └──────────────────┘
```

O front-end nunca acessa a planilha diretamente — tudo passa pelo Apps Script, que roda na conta Google dona da planilha e expõe uma API JSON.

### Arquivos

| Arquivo | O que é |
|---|---|
| `index.html` | Estrutura da página (login + 4 páginas internas). SPA simples: a troca de página é via classe `.active`. |
| `style.css` | Todo o visual. Temas claro/escuro com variáveis CSS. Bloco responsivo no final. |
| `script.js` | Toda a lógica (detalhada abaixo). |
| `apps-script-Code.gs` | Código do backend, para colar no editor do Google Apps Script. |
| `icone-amo.png` / `logo-amo.png` | Marca da AMO (ícone para sidebar/favicon e logo completo). |

### A planilha

Três abas:

- **EDER SEDE** e **EDER FILIAL** — uma linha por dia, com as colunas:
  `Semana | Data | N° de Leads | N° de Potenciais CLT | N° de Potenciais reais | N° de Leads APTAS | N° de Qualificadas | Investimento`
  *(o Apps Script localiza as colunas pelo texto do cabeçalho, então a ordem pode mudar sem quebrar nada)*
- **CREDENCIAIS PAINEL** — `USUARIO | SENHA | NÍVEL | CRIADO QUANDO | ÚLTIMO ACESSO | STATUS | SITUAÇÃO`
  *(a coluna SITUAÇÃO é criada automaticamente pelo script na primeira vez)*

### A API (Apps Script)

Todas as ações são `GET` na URL `/exec` da implantação, com o parâmetro `action`:

| Ação | Parâmetros | O que faz |
|---|---|---|
| `dados` | `usuario`, `senha` | Devolve as linhas diárias das duas abas + horários de última alteração. **Exige credencial válida.** |
| `login` | `usuario`, `senha` | Valida o login, marca Online e registra o último acesso. |
| `ping` | `usuario` | Heartbeat — mantém o status Online. |
| `logout` | `usuario` | Marca Offline. |
| `criarlogin` | `admUsuario`, `admSenha`, `novoUsuario`, `novaSenha`, `nivel` | Cria credencial. Só Chefe/Administrador. |
| `listarusuarios` | `admUsuario`, `admSenha` | Lista os usuários (**sem expor senhas**). Só Chefe/Administrador. |
| `editarusuario` | `admUsuario`, `admSenha`, `usuario`, `novaSenha?`, `novoNivel?` | Edita senha e/ou nível. Só Chefe/Administrador. |
| `situacao` | `admUsuario`, `admSenha`, `usuario`, `situacao` | Ativa ou suspende. Só Chefe/Administrador. |

Respostas sempre em JSON: `{ ok: true, ... }` ou `{ ok: false, erro: "mensagem" }`.

**Detecção de mudanças**: a cada chamada de `dados`, o script calcula um hash dos valores de leads e outro do investimento e compara com os anteriores (guardados em `PropertiesService`). Hash diferente = registra o horário da mudança. É assim que o painel sabe quando a planilha foi atualizada pela última vez, separando leads de investimento.

### Como o front funciona (script.js)

- **Estado global** (`state`): modo de filtro ativo, período, canal, dados agregados.
- **`fetchData()`**: busca as linhas cruas da API, aplica o filtro de data ativo, agrega nos totais dos cards e alimenta a tabela diária. Roda a cada 1 minuto e nos botões de atualizar.
- **Sessão**: usuário/senha/nível ficam no `localStorage` (Lembrar de mim) ou `sessionStorage`. Se a API responder "Não autorizado" no meio do uso (senha trocada ou usuário suspenso), o painel limpa a sessão e volta pro login sozinho.
- **Permissões no front**: esconder seções por nível é cosmético — a regra de verdade é validada **no Apps Script** em toda ação sensível.
- **Relatórios**: gerados no navegador com [SheetJS](https://sheetjs.com/) (Excel) e [jsPDF](https://github.com/parallax/jsPDF) + autoTable (PDF), carregados via CDN.
- **Avatar e histórico**: salvos no `localStorage` do navegador (por usuário, no caso do avatar).

### Instalação do zero

1. **Planilha**: crie as 3 abas com os cabeçalhos descritos acima e pelo menos um usuário Chefe/Administrador na CREDENCIAIS PAINEL.
2. **Apps Script**: na planilha, Extensões → Apps Script → cole o conteúdo de `apps-script-Code.gs` → salvar.
3. **Implantar**: Implantar → Nova implantação → App da Web → executar como **"Eu"**, acesso **"Qualquer pessoa"** → copie a URL `/exec`.
4. **Conectar**: cole a URL na constante `SHEETS_API_URL` no topo do `script.js`.
5. **Hospedar**: suba os arquivos em qualquer hospedagem estática (GitHub Pages, Netlify, etc.) — ou abra o `index.html` localmente.

> **Atualizou o código do Apps Script?** Não basta salvar: vá em Implantar → Gerenciar implantações → ✏️ → Versão: "Nova versão" → Implantar. Editando a implantação existente, a URL não muda.

### Notas de segurança

- A planilha continua privada — o código público não dá acesso a ela.
- A API de dados exige credencial válida; sem login, responde "Não autorizado".
- A API não tem limite de tentativas de login: **use senhas fortes**, principalmente nas contas Chefe/Administrador.
- A senha da sessão fica armazenada no navegador de quem usa "Lembrar de mim" — evitar em computadores compartilhados.
- Os níveis controlam funcionalidades; todo usuário ativo enxerga os dados das duas unidades.
