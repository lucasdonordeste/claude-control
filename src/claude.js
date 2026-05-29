// Data layer barrel — the single import surface for extension.js. The actual
// implementation lives in the focused modules below; this just re-exports the
// public API so callers don't depend on the internal file layout.
const settings = require('./settings');
const usage = require('./usage');
const project = require('./project');
const primitives = require('./primitives');

module.exports = {
  // settings + fs helpers
  SETTINGS_PATH: settings.SETTINGS_PATH,
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
  // usage
  getUsage: usage.getUsage,
  readUsageHistory: usage.readUsageHistory,
  // project scope
  projectPaths: project.projectPaths,
  listMarkdown: project.listMarkdown,
  listProjectSkills: project.listProjectSkills,
  listProjectMcp: project.listProjectMcp,
};
