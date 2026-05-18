-- Default-AI für neue Tische ist jetzt "heuristic" (regelbasiert, deutlich
-- stärker als "random"). Bestehende Tische lassen wir unverändert — der Owner
-- hat sich bewusst für seinen aiSeatType entschieden.

ALTER TABLE "LobbyTable" ALTER COLUMN "aiSeatType" SET DEFAULT 'heuristic';
