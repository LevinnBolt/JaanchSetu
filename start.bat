@echo off
setlocal
cd /d "%~dp0"
title JaanchSetu launcher (no Docker)

rem ---- no-Docker settings: embedded PostgreSQL, encrypted files on disk, in-process scheduler, mail off
set DATABASE_URL=postgresql://sakshi:sakshi@localhost:54329/sakshi
set STORAGE_DRIVER=local
set MAIL_DISABLED=true
set DEMO_MODE=true

where node >nul 2>nul
if errorlevel 1 ( echo Node.js 20+ is required: https://nodejs.org & pause & exit /b 1 )

if not exist backend\node_modules ( echo Installing backend packages... & call npm --prefix backend install || goto fail )
if not exist frontend\node_modules ( echo Installing frontend packages... & call npm --prefix frontend install || goto fail )
if not exist backend\node_modules\.prisma ( call npm --prefix backend run prisma:generate || goto fail )

echo Starting local PostgreSQL...
if exist backend\.pgdata\.ready del backend\.pgdata\.ready
start "JaanchSetu database (close to stop)" /min cmd /c "cd backend && npm run db:embedded"
:waitdb
if not exist backend\.pgdata\.ready ( timeout /t 2 /nobreak >nul & goto waitdb )

call npm --prefix backend run db:push || goto fail

if exist backend\.pgdata\.seeded goto seeded
echo Seeding demo data and reading the sample receipts with OCR. This takes about a minute...
call npm --prefix backend run seed || goto fail
echo ok> backend\.pgdata\.seeded
:seeded

start "JaanchSetu API" cmd /k "cd backend && npm run dev"
start "JaanchSetu web" cmd /k "cd frontend && npm run dev"

rem ---- the API takes a while to compile: wait until it answers before opening the browser (otherwise the first requests are refused)
echo Waiting for the API to be ready...
set /a tries=0
:waitapi
powershell -NoProfile -Command "try { Invoke-WebRequest -UseBasicParsing -TimeoutSec 3 http://localhost:4000/api/demo/accounts | Out-Null; exit 0 } catch { exit 1 }" >nul 2>nul
if not errorlevel 1 goto apiready
set /a tries+=1
if %tries% geq 75 ( echo The API did not start. Look at the "JaanchSetu API" window for the error. & goto fail )
timeout /t 2 /nobreak >nul
goto waitapi
:apiready
start "" http://localhost:5173
echo.
echo JaanchSetu is running at http://localhost:5173  (password for all demo logins: demo123)
echo To reset the demo data later, run reseed.bat. Close the opened windows to stop.
pause
exit /b 0

:fail
echo.
echo Something failed. See the messages above.
pause
exit /b 1
