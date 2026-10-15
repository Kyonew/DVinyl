import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import { execSync } from 'node:child_process';

// A stored value printed raw into an inline script ends the script at its first
// "</script>", so every unescaped JSON.stringify output reading an item field must turn
// '<' into <. An item's _id is an ObjectId and carries no markup, so it is exempt.
test('raw JSON outputs reading an item field escape "<"', () => {
  const templates = execSync('git ls-files "*.ejs"', { encoding: 'utf8' }).split('\n').filter(Boolean);
  const offenders: string[] = [];

  for (const file of templates) {
    const source = fs.readFileSync(file, 'utf8');
    for (const match of source.matchAll(/<%-([\s\S]*?)%>/g)) {
      const expression = match[1]!;
      if (!expression.includes('JSON.stringify(')) continue;
      const readsItemField = /\bitem(?:\[|\.(?!_id\b))/.test(expression);
      if (!readsItemField || expression.includes('replace(/</g')) continue;
      const line = source.slice(0, match.index).split('\n').length;
      offenders.push(`${file}:${line}`);
    }
  }

  assert.deepEqual(offenders, []);
});
