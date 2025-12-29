@echo off
echo Starting Backend...
cd backend
start /b go run cmd/server/main.go
cd ..

echo Starting Frontend...
cd frontend
start /b npm run dev
cd ..

echo Waiting for services to start...
timeout /t 5 >nul

echo Opening Chrome...
start chrome http://localhost:3000
