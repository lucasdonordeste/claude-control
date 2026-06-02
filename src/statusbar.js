'use strict';

// Pure decision for how to color a usage status-bar item, given the user's
// `claudeControl.statusBar.colorMode` setting and the utilization percentage.
// Returns a descriptor that extension.js maps onto the VS Code status-bar API:
//   color      — a hex string for `item.color`, or null to use the theme default
//   background — a ThemeColor id for `item.backgroundColor` (one of VS Code's
//                statusBarItem.{warning,error}Background), or null for none
//
// Modes:
//   adaptive (default) — neutral while healthy, then a native warning/error
//                        "pill" at higher usage. VS Code always renders those
//                        with correct contrast, so it never clashes with a
//                        colored status bar (the reason fixed hex looked broken).
//   usage              — fixed green → amber → red ramp (the original behavior).
//   custom             — a single fixed color the user picks.
//   none               — always the theme's default status-bar foreground.

const RAMP = (p) => (p < 50 ? '#3fb950' : p < 80 ? '#e8b339' : '#e0706b');

// Accepts #rgb or #rrggbb (case-insensitive). Used to validate the custom color.
function isHexColor(s) {
  return typeof s === 'string' && /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(s.trim());
}

function usageStyle(mode, util, customColor) {
  const p = Math.max(0, Math.min(100, Number(util) || 0));
  switch (mode) {
    case 'usage':
      return { color: RAMP(p), background: null };
    case 'custom':
      return { color: isHexColor(customColor) ? customColor.trim() : null, background: null };
    case 'none':
      return { color: null, background: null };
    case 'adaptive':
    default:
      if (p >= 80) return { color: null, background: 'statusBarItem.errorBackground' };
      if (p >= 50) return { color: null, background: 'statusBarItem.warningBackground' };
      return { color: null, background: null };
  }
}

module.exports = { usageStyle, isHexColor };
