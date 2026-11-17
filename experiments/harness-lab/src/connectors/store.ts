import { DatabaseSync } from 'node:sqlite';
import { RequestError } from '../contracts/errors.js';
import { capabilityDigest } from '../capabilities/service.js';
import type { ConnectorBusinessSlot, ConnectorRevision } from '../contracts/connectors.js';

export interface ConnectorAsset { connectorId: string; currentRevisionId: string; state: 'enabled' | 'disabled'; stateRevision: number }
export interface ConnectorBinding { slot: ConnectorBusinessSlot; connectorId: string; systemIds: string[]; sourceIds: string[]; envRefs: Record<string, string> }
export function initializeConnectorSchema(db: DatabaseSync): void {
  db.exec(`BEGIN IMMEDIATE;
    CREATE TABLE IF NOT EXISTS r4_connector_meta(id INTEGER PRIMARY KEY CHECK(id=1),version INTEGER NOT NULL);
    INSERT OR IGNORE INTO r4_connector_meta VALUES(1,1);
    CREATE TABLE IF NOT EXISTS r4_connections(id TEXT PRIMARY KEY,current_revision_id TEXT NOT NULL,data TEXT NOT NULL CHECK(json_valid(data)));
    CREATE TABLE IF NOT EXISTS r4_connection_revisions(id TEXT PRIMARY KEY,connection_id TEXT NOT NULL,revision INTEGER NOT NULL,digest TEXT NOT NULL,data TEXT NOT NULL CHECK(json_valid(data)),UNIQUE(connection_id,revision));
    CREATE TABLE IF NOT EXISTS r4_connection_bindings(slot TEXT PRIMARY KEY CHECK(slot IN ('information','situation','simulation-control','ingress')),connection_id TEXT UNIQUE NOT NULL REFERENCES r4_connections(id),data TEXT NOT NULL CHECK(json_valid(data)));
    CREATE TABLE IF NOT EXISTS r4_connection_credentials(connection_id TEXT NOT NULL REFERENCES r4_connections(id),subject_id TEXT NOT NULL,version INTEGER NOT NULL,data TEXT NOT NULL CHECK(json_valid(data)),PRIMARY KEY(connection_id,subject_id));
    CREATE TABLE IF NOT EXISTS r4_connection_catalogs(connection_id TEXT NOT NULL,revision_id TEXT NOT NULL,subject_id TEXT NOT NULL,credential_version INTEGER NOT NULL,data TEXT NOT NULL CHECK(json_valid(data)),PRIMARY KEY(connection_id,revision_id,subject_id,credential_version));
    CREATE TABLE IF NOT EXISTS r4_connection_actions(principal TEXT NOT NULL,id TEXT NOT NULL,input_digest TEXT NOT NULL,data TEXT NOT NULL CHECK(json_valid(data)),PRIMARY KEY(principal,id));
    CREATE TABLE IF NOT EXISTS r4_connection_audit(id TEXT PRIMARY KEY,connection_id TEXT NOT NULL,data TEXT NOT NULL CHECK(json_valid(data)));
    CREATE TABLE IF NOT EXISTS r4_connection_intents(id TEXT PRIMARY KEY,principal TEXT NOT NULL,input_digest TEXT NOT NULL,data TEXT NOT NULL CHECK(json_valid(data)));
    CREATE TABLE IF NOT EXISTS r4_connection_legacy(id INTEGER PRIMARY KEY CHECK(id=1),data TEXT NOT NULL CHECK(json_valid(data)));
    COMMIT;`);
}
export const connectorStateError = () => new RequestError('CONNECTOR_STATE_INVALID', '连接记录或固定映射异常，请核对数据及迁移。', 409);
export function connectorTransaction<T>(db: DatabaseSync, work: () => T): T { db.exec('BEGIN IMMEDIATE'); try { const result = work(); db.exec('COMMIT'); return result; } catch (error) { db.exec('ROLLBACK'); throw error; } }
export function insertConnectorRevision(db: DatabaseSync, revision: ConnectorRevision): void { db.prepare('INSERT INTO r4_connection_revisions VALUES(?,?,?,?,?)').run(revision.revisionId, revision.connectorId, revision.revision, capabilityDigest(revision), JSON.stringify(revision)); }
export function writeConnectorAsset(db: DatabaseSync, asset: ConnectorAsset): void { db.prepare('INSERT INTO r4_connections VALUES(?,?,?) ON CONFLICT(id) DO UPDATE SET current_revision_id=excluded.current_revision_id,data=excluded.data').run(asset.connectorId, asset.currentRevisionId, JSON.stringify(asset)); }
