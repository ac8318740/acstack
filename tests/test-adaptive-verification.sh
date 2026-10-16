#!/usr/bin/env bash
# Keep the cross-cutting contract suite discoverable by tests/run-all.sh.
set -eu
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
python3 "$SCRIPT_DIR/integration/test_adaptive_verification.py"
