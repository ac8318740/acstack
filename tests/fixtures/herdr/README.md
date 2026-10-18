# Herdr reporter fixture

This directory preserves the unmodified Pi reporter from herdr v0.8.2 for offline patch regression tests.

- Source: https://github.com/herdrdev/herdr/blob/v0.8.2/src/integration/assets/pi/herdr-agent-state.ts
- Commit: `9eb521456ac0d19d3ab3d9d7cea3cca10baa8a4c`
- Integration version: 8
- License: Apache-2.0, reproduced in `LICENSE` from the same upstream checkout
- The tests patch temporary copies and exercise the reporter's socket output
