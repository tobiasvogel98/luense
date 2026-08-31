---
name: release
description: Sauberer Stand raus — Prüfungen, Commit, Push, Update am Handy
disable-model-invocation: true
---
Bring den aktuellen Stand sauber raus:

1. Prüfe: git status (nichts Halbfertiges?), Konsole fehlerfrei, App startet,
   ein schneller Kernablauf funktioniert (Baustelle wählen, Ereignis
   erfassen, neu laden).
2. Falls ein Service-Worker existiert: Versionsstempel erhöhen, damit das
   Handy das Update sicher zieht.
3. Commit (falls offen) mit sprechender Message, dann push.
4. Sag mir in 2–3 Sätzen, was dieses Release enthält (mein Update-Protokoll)
   und woran ich am Handy erkenne, dass die neue Version geladen ist.
5. Wenn irgendein Prüfpunkt scheitert: KEIN Push — erst Befund, dann Fix
   nach Freigabe.
