// Server, an die der Weiterleiter Abrufe weitergibt (zusätzlich zu RELAY_HOSTS bei Vercel).
// Nur Ratsinformationssysteme, die aus den USA nicht erreichbar sind. Neue Einträge per Commit.
export const ERLAUBT = [
  'ris.kaiserslautern.de', // SessionNet, Ländersperre, unvollständige Zertifikatskette
  'gremieninfo.trier.de', // Ländersperre (Prüfung des Systems)
];
