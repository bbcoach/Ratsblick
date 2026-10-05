import { DatabaseSync } from 'node:sqlite';
import { mkdirSync, readFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const schemaPath = fileURLToPath(new URL('./schema.sql', import.meta.url));

/** Öffnet (oder erzeugt) die Datenbank und legt fehlende Tabellen an. `:memory:` für Tests. */
export function openDb(path: string): DatabaseSync {
  if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path);
  // busy_timeout: wartet, wenn ein anderer Prozess gerade schreibt (mehrere Abgleiche nebeneinander)
  db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 60000;');
  db.exec(readFileSync(schemaPath, 'utf8'));
  // Spalten, die später zu bestehenden Tabellen dazukamen (die Datenbank liegt im Actions-Cache und wird weiterverwendet)
  const vorhanden = new Set((db.prepare('PRAGMA table_info(sync_log)').all() as Array<{ name: string }>).map((c) => c.name));
  for (const [name, typ] of [['version', 'TEXT'], ['umleitung', 'TEXT'], ['vergangen', 'INTEGER'], ['mit_tops', 'INTEGER'], ['mit_dok', 'INTEGER']] as const) {
    if (!vorhanden.has(name)) db.exec(`ALTER TABLE sync_log ADD COLUMN ${name} ${typ}`);
  }
  return db;
}

/** Führt `fn` in einer Transaktion aus; bei Fehlern wird zurückgerollt. */
export function tx<T>(db: DatabaseSync, fn: () => T): T {
  db.exec('BEGIN');
  try {
    const result = fn();
    db.exec('COMMIT');
    return result;
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}
