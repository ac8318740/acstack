#!/usr/bin/env bash
# Register the isolated hook and generator checks with tests/run-all.sh.
set -eu
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
python3 "$SCRIPT_DIR/integration/test_communication_standard.py"
