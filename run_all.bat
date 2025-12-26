@echo off
setlocal

echo [1/5] Checking environment...
where go >nul 2>nul
if %errorlevel% neq 0 (
    echo ERROR: Go is not installed. Please install it from https://go.dev/dl/
    pause
    exit /b
)

echo [2/5] Cleaning up ports...
:: Attempt to kill anything running on port 8080 (backend) or 3000 (frontend)
for /f "tokens=5" %%a in ('netstat -aon ^| find ":8080" ^| find "LISTENING"') do taskkill /f /pid %%a >nul 2>nul
for /f "tokens=5" %%a in ('netstat -aon ^| find ":3000" ^| find "LISTENING"') do taskkill /f /pid %%a >nul 2>nul

if not exist "FrontEnd\node_modules" (
    echo [3/5] Installing Frontend dependencies...
    cd FrontEnd
    call npm install
    cd ..
)

echo [4/5] Opening Browser (Waiting 5s for server start)...
timeout /t 5 >nul
start chrome http://localhost:3000

echo [5/5] Starting Services (Single Terminal Mode)...
echo Press Ctrl+C to stop all services.

:: Use npx concurrently without -k to debug if needed, but keeping -k for clean exit
:: Build Backend
echo [4.5/5] Building Backend...
cd BackEnd
go build -o video-call-backend.exe .
if %errorlevel% neq 0 (
    echo ERROR: Backend build failed.
    pause
    exit /b
)
cd ..

echo [5/5] Starting Services (Single Terminal Mode)...
echo Press Ctrl+C to stop all services.

:: Use npx concurrently to run the built backend executable and frontend
npx -y concurrently -k -n "BACK,FRONT" -c "blue,magenta" "cd BackEnd && video-call-backend.exe" "cd FrontEnd && npm run dev"
pause
