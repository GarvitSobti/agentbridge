import { DatabaseSync } from 'node:sqlite';

// The parent kills this process with an uncommitted write transaction open.
const db = new DatabaseSync(process.argv[2]);
db.exec('BEGIN IMMEDIATE');
db.prepare("UPDATE requests SET data_json = json_set(data_json, '$.body', 'uncommitted edit') WHERE workspace_id = ?").run('crm');
db.prepare('UPDATE workspaces SET revision = revision + 100 WHERE id = ?').run('crm');
process.send({ staged: true });
setInterval(() => {}, 1_000);
