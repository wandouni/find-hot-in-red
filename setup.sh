#!/bin/bash
set -e

echo "=== XHS Insight Setup ==="

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# Check Python 3.10+
if ! command -v python3 &>/dev/null; then
  echo "ERROR: Python 3 not found. Install from https://python.org"
  exit 1
fi
python3 -c "import sys; sys.exit(0 if sys.version_info >= (3, 10) else 1)" || {
  echo "ERROR: Python 3.10+ required (found $(python3 --version))"
  exit 1
}
echo "✓ Python $(python3 --version)"

# Check Node + npm
if ! command -v node &>/dev/null; then
  echo "ERROR: Node.js not found. Install from https://nodejs.org"
  exit 1
fi
if ! command -v npm &>/dev/null; then
  echo "ERROR: npm not found. It should come with Node.js."
  exit 1
fi
echo "✓ Node $(node --version)"

# Backend deps
echo "Installing backend dependencies..."
cd "$SCRIPT_DIR/backend"
python3 -m pip install -r requirements.txt -q
cd "$SCRIPT_DIR"

# Frontend deps
echo "Installing frontend dependencies..."
cd "$SCRIPT_DIR/frontend"
npm install -q
cd "$SCRIPT_DIR"

# Create data dir
mkdir -p "$SCRIPT_DIR/data"

echo ""
echo "✓ Setup complete! Run ./start.sh to launch."
