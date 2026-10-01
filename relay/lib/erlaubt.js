// Server, an die der Weiterleiter Abrufe weitergibt (zusätzlich zu RELAY_HOSTS bei Vercel).
// Nur Ratsinformationssysteme, die aus den USA nicht erreichbar sind und automatische Abrufe erlauben
// (robots.txt vorher prüfen!). Neue Einträge per Commit.
// gremieninfo.trier.de: robots.txt „Disallow: /“, auf ausdrückliche Entscheidung des Projektinhabers
// (01.10.2026) trotzdem freigegeben – siehe CLAUDE.md.
export const ERLAUBT = [
  'ris.kaiserslautern.de', // SessionNet, Ländersperre, unvollständige Zertifikatskette
  'gremieninfo.trier.de', // ALLRIS 4, Ländersperre
];
