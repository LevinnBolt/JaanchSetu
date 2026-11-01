@echo off
cd /d "%~dp0"
set DATABASE_URL=postgresql://sakshi:sakshi@localhost:54329/sakshi
set STORAGE_DRIVER=local
set MAIL_DISABLED=true
echo Database must be running (start.bat). Resetting demo data...
call npm --prefix backend run seed
pause
