# Mali Metro glob matcher

This is a consumer adapter, not a renamed copy of micromatch or braces. It
implements only `some(list, patterns, options)`, the API imported by the locked
Metro file-map watcher. Picomatch 4.0.7 performs matching directly; this package
contains no brace parser, compiler or expansion AST walkers.

The contract is qualified against observed micromatch 4.0.8 / picomatch 2.3.2
results and through the installed Metro watcher. Unsupported micromatch APIs
are deliberately absent. A future consumer calling another API requires a new
compatibility review. The dependency gate verifies the consumer inventory.

Picomatch upstream: https://github.com/micromatch/picomatch
Micromatch contract: https://github.com/micromatch/micromatch/blob/4.0.8/index.js
Original advisory: https://github.com/advisories/GHSA-vfj7-8cjw-p6xm
