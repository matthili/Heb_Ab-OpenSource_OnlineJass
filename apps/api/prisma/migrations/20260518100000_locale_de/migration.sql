-- Locale-Code von "de-vlbg" auf "de" umstellen.
--
-- "de-vlbg" war kein BCP-47-konformer Locale-Code — Vorarlbergerisch ist
-- eine Dialekt-Variante von Deutsch, nicht ein eigener Locale. UI-seitig
-- haben wir die Sprach-Auswahl jetzt auf "Deutsch"/"English" umgestellt,
-- die DB folgt nach.
--
-- 1) Default-Wert auf 'de' umstellen
ALTER TABLE "User" ALTER COLUMN "locale" SET DEFAULT 'de';

-- 2) Bestehende Rows migrieren — alles, was bisher 'de-vlbg' hatte, wird 'de'
UPDATE "User" SET "locale" = 'de' WHERE "locale" = 'de-vlbg';
