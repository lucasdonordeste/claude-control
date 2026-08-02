// Data layer barrel — the single import surface for extension.js. The actual
// implementation lives in the focused modules below; this just re-exports the
// public API so callers don't depend on the internal file layout.
const settings = require('./settings');
const usage = require('./usage');
const project = require('./project');
const primitives = require('./primitives');
const config = require('./config');
const hooklib = require('./hooklib');
const doctor = require('./doctor');
const actions = require('./actions');
const metrics = require('./metrics');
const registry = require('./registry');
const agents = require('./agents');

module.exports = {
  // settings + fs helpers
  SETTINGS_PATH: settings.SETTINGS_PATH,
  CLAUDE_DIR: settings.CLAUDE_DIR,
  flagOff: settings.flagOff,
  toggleFlag: settings.toggleFlag,
  hooksReady: settings.hooksReady,
  fileExists: settings.fileExists,
  dirExists: settings.dirExists,
  // plugins / marketplace / mcp / hooks / skills / agents / commands
  listPlugins: primitives.listPlugins,
  togglePlugin: primitives.togglePlugin,
  listMcp: primitives.listMcp,
  listMarketplacePlugins: primitives.listMarketplacePlugins,
  listSkills: primitives.listSkills,
  listAllHooks: primitives.listAllHooks,
  addHook: primitives.addHook,
  removeHook: primitives.removeHook,
  installNotificationHooks: primitives.installNotificationHooks,
  addMcpServer: primitives.addMcpServer,
  createSkill: primitives.createSkill,
  createAgent: primitives.createAgent,
  createCommand: primitives.createCommand,
  listAgents: primitives.listAgents,
  listCommands: primitives.listCommands,
  listPlans: primitives.listPlans,
  // usage
  getUsage: usage.getUsage,
  readUsageHistory: usage.readUsageHistory,
  // project scope
  projectPaths: project.projectPaths,
  listMarkdown: project.listMarkdown,
  listProjectSkills: project.listProjectSkills,
  listProjectMcp: project.listProjectMcp,
  // editable settings (model / effort / permissions / env)
  config,
  // hook events + one-click hook templates
  hooklib,
  // health checks and disk usage
  doctor,
  // session actions and destructive operations
  actions,
  // token analytics
  metrics,
  // live session registry + subagent trees
  registry,
  agentTree: agents.listAgents,
  runningAgents: agents.runningCount,
};
