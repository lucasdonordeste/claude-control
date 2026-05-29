// Lightweight localization for the extension-host strings and the webview bundle.
// English is the default; Portuguese (pt-br) is offered as a locale. Any key
// missing from a locale falls back to English. package.json contributions are
// localized separately via package.nls.json / package.nls.pt-br.json.
const vscode = require('vscode');

const en = {
  // webview chrome
  'boot.loading': 'loading…',
  'tab.global': 'Global',
  'tab.project': 'Project',
  'tab.usage': 'Usage',
  'search.placeholder': 'filter…',
  'refresh.title': 'Refresh',
  'app.subtitle': 'cockpit',
  // scopes
  'scope.global': 'Global',
  'scope.project': 'Project',
  'scope.usage': 'Plan usage',
  'scope.trend': 'Trend',
  'scope.projectTag': 'project',
  'usage.live': 'live · {0}s',
  'trend.points': '{0} pts',
  // sections
  'sec.config': 'Config',
  'sec.plugins': 'Plugins',
  'sec.market': 'Marketplace',
  'sec.skills': 'Skills',
  'sec.agents': 'Agents',
  'sec.commands': 'Commands',
  'sec.mcp': 'MCP servers',
  'sec.hooks': 'Hooks',
  'sec.files': 'Files',
  // toggles + actions
  'toggle.sound': 'Sound',
  'toggle.notify': 'Notifications',
  'toggle.statusBar': 'Status bar',
  'act.installHooks': 'Install notifications',
  'act.newSkill': 'New skill',
  'act.newAgent': 'New agent',
  'act.newCommand': 'New command',
  'act.addMcp': 'Add MCP',
  'act.newHook': 'New hook',
  // empty states
  'empty.generic': 'empty',
  'empty.plugins': 'no plugins',
  'empty.market': 'all installed',
  'empty.skills': 'no skills found',
  'empty.agents': 'no agents',
  'empty.commands': 'no commands',
  'empty.mcp': 'no MCP servers',
  'empty.hooks': 'no hooks',
  'empty.notifyUnset': 'sound & notifications not set up yet',
  'empty.openFolder': 'open a folder to see project scope',
  'empty.projectFiles': 'no CLAUDE.md / settings.json',
  'empty.usageData': 'no data',
  'empty.collecting': 'collecting history… check back in a few minutes',
  // usage states
  'usage.session': 'session',
  'usage.week': 'week',
  'usage.sessionTrend': 'session (5h)',
  'usage.weekTrend': 'week (7d)',
  'usage.ratelimited': 'API usage limit reached — will retry soon',
  'usage.error': 'unavailable right now (network error)',
  'usage.notoken': 'unavailable (no Claude Code token)',
  'tooltip.resetsIn': 'resets in {0}',
  'err.prefix': 'error: ',
  // curated MCP descriptions
  'mcp.filesystem': 'Local file access',
  'mcp.github': 'GitHub repos, issues and PRs',
  'mcp.fetch': 'Fetch and read web pages',
  'mcp.memory': 'Persistent memory / knowledge graph',
  'mcp.sequential-thinking': 'Step-by-step reasoning',
  'mcp.puppeteer': 'Browser automation',
  'mcp.playwright': 'Browser automation / testing',
  'mcp.context7': 'Up-to-date library docs',
  // extension-host: messages
  'msg.pluginToggled': 'Plugin "{0}" {1}. ↻ Restart your Claude Code session to apply.',
  'state.enabled': 'enabled',
  'state.disabled': 'disabled',
  'msg.hooksInstalled':
    'Notification hooks installed ({0}). ↻ Restart your Claude Code session to activate.',
  'msg.installingPlugin': 'Installing "{0}" in the terminal. Then click ↻ to refresh.',
  'term.installPlugin': 'Claude · install plugin',
  'msg.mcpAdded': 'MCP "{0}" added. Edit any placeholders (<token>/<path>). ↻ Restart your session.',
  'btn.openConfig': 'Open config',
  'msg.hookAdded': 'Hook added on {0}. ↻ Restart your Claude Code session.',
  'prompt.removeHook': 'Remove hook on "{0}"?',
  'btn.remove': 'Remove',
  'host.err.prefix': 'Claude Control: ',
  // extension-host: scaffolding prompts
  'input.name': 'Name of the new {0}',
  'input.namePlaceholder': 'e.g. review-pr',
  'pick.scopeWhere': 'Where to create the {0}?',
  'pick.scopeGlobal': 'Global (~/.claude)',
  'pick.scopeProject': 'Project (.claude)',
  // extension-host: hooks
  'pick.hookEvent': 'On which event does the hook fire?',
  'input.hookCommand': 'Shell command for the "{0}" hook',
  'input.hookCommandPlaceholder': 'e.g. ~/.claude/hooks/my-script.sh',
  // extension-host: mcp
  'pick.mcpChoose': 'Choose an MCP server to add',
  'pick.mcpWhere': 'Where to add it?',
  'pick.mcpGlobal': 'Global (settings.json)',
  'pick.mcpProject': 'Project (.mcp.json)',
  // noun used in the scaffolding prompts
  'noun.skill': 'skill',
  'noun.agent': 'agent',
  'noun.command': 'command',
};

const ptBr = {
  'boot.loading': 'carregando…',
  'tab.project': 'Projeto',
  'tab.usage': 'Uso',
  'search.placeholder': 'filtrar…',
  'refresh.title': 'Atualizar',
  'scope.project': 'Projeto',
  'scope.usage': 'Uso do plano',
  'scope.trend': 'Tendência',
  'scope.projectTag': 'projeto',
  'sec.files': 'Arquivos',
  'toggle.sound': 'Som',
  'toggle.notify': 'Notificação',
  'toggle.statusBar': 'Barra de status',
  'act.installHooks': 'Instalar notificações',
  'act.newSkill': 'Nova skill',
  'act.newAgent': 'Novo agent',
  'act.newCommand': 'Novo command',
  'act.addMcp': 'Adicionar MCP',
  'act.newHook': 'Novo hook',
  'empty.generic': 'vazio',
  'empty.plugins': 'nenhum plugin',
  'empty.market': 'tudo já instalado',
  'empty.skills': 'nenhuma skill encontrada',
  'empty.agents': 'nenhum agent',
  'empty.commands': 'nenhum command',
  'empty.mcp': 'nenhum MCP server',
  'empty.hooks': 'nenhum hook',
  'empty.notifyUnset': 'som & notificação ainda não configurados',
  'empty.openFolder': 'abra uma pasta para ver o escopo do projeto',
  'empty.projectFiles': 'sem CLAUDE.md / settings.json',
  'empty.usageData': 'sem dados',
  'empty.collecting': 'coletando histórico… volte em alguns minutos',
  'usage.session': 'sessão',
  'usage.week': 'semana',
  'usage.sessionTrend': 'sessão (5h)',
  'usage.weekTrend': 'semana (7d)',
  'usage.ratelimited': 'limite de uso da API atingido — tentando de novo em breve',
  'usage.error': 'indisponível no momento (erro de rede)',
  'usage.notoken': 'indisponível (sem token do Claude Code)',
  'tooltip.resetsIn': 'reseta em {0}',
  'err.prefix': 'erro: ',
  'mcp.filesystem': 'Acesso a arquivos locais',
  'mcp.github': 'Repos, issues e PRs do GitHub',
  'mcp.fetch': 'Buscar e ler páginas da web',
  'mcp.memory': 'Memória / knowledge graph persistente',
  'mcp.sequential-thinking': 'Raciocínio passo a passo',
  'mcp.puppeteer': 'Automação de navegador',
  'mcp.playwright': 'Automação / testes de browser',
  'mcp.context7': 'Docs atualizadas de bibliotecas',
  'msg.pluginToggled': 'Plugin "{0}" {1}. ↻ Reinicie a sessão do Claude Code para aplicar.',
  'state.enabled': 'ativado',
  'state.disabled': 'desativado',
  'msg.hooksInstalled':
    'Hooks de notificação instalados ({0}). ↻ Reinicie a sessão do Claude Code para ativar.',
  'msg.installingPlugin': 'Instalando "{0}" no terminal. Depois clique em ↻ para atualizar.',
  'msg.mcpAdded':
    'MCP "{0}" adicionado. Edite os placeholders (<token>/<caminho>) se houver. ↻ Reinicie a sessão.',
  'btn.openConfig': 'Abrir config',
  'msg.hookAdded': 'Hook adicionado em {0}. ↻ Reinicie a sessão do Claude Code.',
  'prompt.removeHook': 'Remover hook de "{0}"?',
  'btn.remove': 'Remover',
  'input.name': 'Nome do novo {0}',
  'input.namePlaceholder': 'ex: revisar-pr',
  'pick.scopeWhere': 'Onde criar o {0}?',
  'pick.scopeProject': 'Projeto (.claude)',
  'pick.hookEvent': 'Em qual evento o hook dispara?',
  'input.hookCommand': 'Comando shell para o hook "{0}"',
  'input.hookCommandPlaceholder': 'ex: ~/.claude/hooks/meu-script.sh',
  'pick.mcpChoose': 'Escolha um MCP server para adicionar',
  'pick.mcpWhere': 'Onde adicionar?',
  'pick.mcpProject': 'Projeto (.mcp.json)',
  'noun.skill': 'skill',
  'noun.agent': 'agente',
  'noun.command': 'comando',
};

function pickLang() {
  const l = (vscode.env.language || 'en').toLowerCase();
  return l === 'pt-br' || l.startsWith('pt') ? 'pt-br' : 'en';
}

// English base merged with the active locale's overrides (English fallback).
function resolveBundle() {
  return pickLang() === 'pt-br' ? Object.assign({}, en, ptBr) : en;
}
let _bundle = resolveBundle();

function format(str, args) {
  return str.replace(/\{(\d+)\}/g, (m, i) => (args[i] == null ? m : String(args[i])));
}

// Localized string for the extension host.
function t(key, ...args) {
  const s = _bundle[key] != null ? _bundle[key] : key;
  return args.length ? format(s, args) : s;
}

module.exports = {
  t,
  lang: pickLang,
  // resolved flat dictionary sent to the webview
  bundle: () => _bundle,
};
