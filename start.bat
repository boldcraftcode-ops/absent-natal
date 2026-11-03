@echo off
rem ===========================================================================
rem  start.bat - menjalankan aplikasi Absensi Natal di localhost (Windows)
rem ---------------------------------------------------------------------------
rem  Cara pakai: klik dua kali berkas ini. Browser terbuka otomatis.
rem  Hentikan server dengan menekan Ctrl+C di jendela ini.
rem
rem  PENTING: jangan membuka index.html dengan klik dua kali (alamat file://).
rem  Aplikasi ini memakai ES module + service worker + fetch ke Supabase,
rem  semuanya hanya berjalan lewat http://localhost.
rem ===========================================================================
setlocal EnableExtensions EnableDelayedExpansion
chcp 65001 >nul 2>nul
title Absensi Natal - server lokal
cd /d "%~dp0"

echo.
echo  ============================================================
echo   Absensi Natal - menjalankan server lokal
echo  ============================================================
echo.

rem --- pastikan kita berada di folder aplikasi (ada index.html) --------------
if not exist "index.html" goto :bukan_folder
if not exist "js" goto :bukan_folder

rem --- pilih port (bisa diganti: start.bat 8080) ---------------------------
set "PORT=%~1"
if "%PORT%"=="" set "PORT=4173"

rem --- cari Node.js ---------------------------------------------------------
where node >nul 2>nul
if errorlevel 1 goto :coba_python

for /f "tokens=*" %%v in ('node -v 2^>nul') do set "NODEV=%%v"
echo  [1/2] Node.js ditemukan: !NODEV!
echo  [2/2] Menjalankan server (header kamera + cache sama seperti Netlify)...
echo.
node "tools\lokal-server.mjs" --port=%PORT%
goto :selesai_node

:coba_python
rem --- cadangan: Python (tanpa dependensi tambahan) -------------------------
echo  Node.js tidak ditemukan, mencoba Python...
where python >nul 2>nul
if errorlevel 1 goto :coba_py
set "PY=python"
goto :jalankan_python

:coba_py
where py >nul 2>nul
if errorlevel 1 goto :tanpa_runtime
set "PY=py -3"

:jalankan_python
echo.
echo  ------------------------------------------------------------------
echo   Mode cadangan memakai Python: memakai port %PORT%.
echo   http://localhost:%PORT%/index.html
echo  ------------------------------------------------------------------
echo.
start "" "http://localhost:%PORT%/index.html"
%PY% -m http.server %PORT% --bind 0.0.0.0
goto :selesai

:bukan_folder
echo  [X] index.html tidak ditemukan di folder ini:
echo      %CD%
echo.
echo  Taruh start.bat di dalam folder aplikasi (satu folder dengan
echo  index.html, admin.html, undian.html, dan folder js).
echo.
goto :selesai

:tanpa_runtime
echo.
echo  [X] Node.js dan Python tidak ditemukan di komputer ini.
echo.
echo  Pilih salah satu (sekali saja, lalu start.bat bisa dipakai terus):
echo.
echo    1. Node.js  (disarankan)  https://nodejs.org  - pilih LTS
echo    2. Python                 https://www.python.org/downloads/
echo                              ^(centang "Add python.exe to PATH"^)
echo.
echo  Alternatif tanpa memasang apa pun: pakai VS Code lalu
echo  ekstensi "Live Server" (klik kanan index.html - Open with Live Server).
echo.
goto :selesai

:selesai_node
echo.
echo  Server lokal sudah berhenti.

:selesai
echo.
pause
endlocal
exit /b 0
