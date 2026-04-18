#!/bin/bash
set -e

echo "=== Starting XHS Insight ==="

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

cleanup() {
  echo ""
  echo "Stopping services..."
  kill $BACKEND_PID $FRONTEND_PID 2>/dev/null || true
  wait $BACKEND_PID $FRONTEND_PID 2>/dev/null || true
}
trap cleanup EXIT INT TERM

# Start backend
echo "Starting backend (port 8000)..."
cd "$SCRIPT_DIR/backend"
python3 -m uvicorn main:app --host 0.0.0.0 --port 8000 --reload &
BACKEND_PID=$!
cd "$SCRIPT_DIR"

# Wait for backend to be ready
echo "Waiting for backend..."
for i in $(seq 1 20); do
  if curl -sf http://localhost:8000/api/notes > /dev/null 2>&1; then
    break
  fi
  sleep 0.5
done

# Start frontend
echo "Starting frontend (port 3000)..."
cd "$SCRIPT_DIR/frontend"
npm run dev &
FRONTEND_PID=$!
cd "$SCRIPT_DIR"

echo ""
echo "✓ Backend: http://localhost:8000"
echo "✓ Frontend: http://localhost:3000"
echo ""
echo "Press Ctrl+C to stop all services"

# Open browser
sleep 3
open http://localhost:3000 2>/dev/null || xdg-open http://localhost:3000 2>/dev/null || true

# Wait
wait $FRONTEND_PID
