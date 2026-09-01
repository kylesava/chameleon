/* Put the demo accounts back to a first-ever-visit state. Used before a run
   through, because completing the baseline is exactly what a test does. */
const { open } = require('../server/db.js');
const db = open();
db.exec('PRAGMA foreign_keys = OFF');
for (const t of ['quiz_attempt', 'plan_task', 'plan', 'artifact', 'source', 'message', 'signal', 'session']) {
  try { db.prepare('DELETE FROM ' + t).run(); } catch { /* table may not exist */ }
}
db.prepare("UPDATE user SET profile_json = '{}'").run();
db.exec('PRAGMA foreign_keys = ON');
console.log('demo accounts reset:', db.prepare('SELECT username FROM user').all().map(u => u.username).join(', '));
