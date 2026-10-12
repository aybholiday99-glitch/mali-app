'use strict';
const picomatch = require('picomatch');

// Metro file-map's only micromatch API is some(list, patterns, options).
// Match each pattern independently, preserving the existing OR semantics,
// including negation, rather than treating a pattern array as exclusions.
function some(list, patterns, options) {
  const candidates = Array.isArray(list) ? list : [list];
  const globs = Array.isArray(patterns) ? patterns : [patterns];
  return globs.some(pattern => {
    const matches = picomatch(String(pattern), options);
    return candidates.some(candidate => matches(candidate));
  });
}

module.exports = Object.freeze({ some });
