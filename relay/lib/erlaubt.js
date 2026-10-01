// Server, an die der Weiterleiter Abrufe weitergibt (zusätzlich zu RELAY_HOSTS bei Vercel).
// Nur Ratsinformationssysteme, die aus den USA nicht erreichbar sind und automatische Abrufe erlauben
// (robots.txt vorher prüfen!). Neue Einträge per Commit.
// Nicht aufnehmen: gremieninfo.trier.de (robots.txt: Disallow: /, geprüft 01.10.2026).
export const ERLAUBT = [
  'ris.kaiserslautern.de', // SessionNet, Ländersperre, unvollständige Zertifikatskette
];
