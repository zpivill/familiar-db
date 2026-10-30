@echo off
rem Familiar battle sim. Double-click for the standard 200k meta chain, saved as results-seedN.json
rem (open it on the Simulator page with Load results). Or run it with familiar-sim arguments, e.g.
rem   run-sim.bat 1000000 comp 2 --draft --hp=3 --forms=all --search=meta --arch --json=big.json
cd /d "%~dp0"
if not "%~1"=="" goto args
set SEED=1
set /p SEED="Seed (any whole number, Enter for 1): "
familiar-sim.exe 200000 comp %SEED% --draft --hp=3 --forms=all --search=meta --arch --json=results-seed%SEED%.json
echo.
echo Saved results-seed%SEED%.json
goto end
:args
familiar-sim.exe %*
:end
pause
