// Server, an die der Weiterleiter Abrufe weitergibt (zusätzlich zu RELAY_HOSTS bei Vercel).
// Nur Ratsinformationssysteme, die aus den USA nicht erreichbar sind und automatische Abrufe erlauben
// (robots.txt vorher prüfen!). Neue Einträge per Commit.
// gremieninfo.trier.de: robots.txt „Disallow: /“, auf ausdrückliche Entscheidung des Projektinhabers
// (01.10.2026) trotzdem freigegeben – siehe CLAUDE.md. Ebenso kirchheimbolanden.ris-portal.de (02.10.2026).
export const ERLAUBT = [
  'ris.kaiserslautern.de', // SessionNet, Ländersperre, unvollständige Zertifikatskette
  'gremieninfo.trier.de', // ALLRIS 4, Ländersperre
  'www.buergerinfo-kreis-duew.de', // SessionNet Kreis Bad Dürkheim, unvollständige Zertifikatskette
  'kirchheimbolanden.ris-portal.de', // regisafe, VG Kirchheimbolanden, außerhalb Europas 403
  'bernkastel-kues.ris-portal.de', // regisafe, VG Bernkastel-Kues, außerhalb Europas 403
  'info.landau.de', // SessionNet Stadt Landau, außerhalb Europas 403
];
