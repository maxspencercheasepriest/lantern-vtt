@echo off
rem Stops and removes the Lantern Server service. Your campaigns (the data folder) are kept.
powershell -NoProfile -Command "Start-Process powershell -Verb RunAs -ArgumentList '-NoProfile','-ExecutionPolicy','Bypass','-NoExit','-File','\"%~dp0install.ps1\"','-Uninstall'"
