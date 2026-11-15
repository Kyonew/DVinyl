import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import { execSync } from 'node:child_process';

// A value printed raw into an inline script ends the script at its first "</script>".
// Item fields are not the only way in: a collection dump brings back the labels of added
// fields, type names, slugs and settings as they were written in the file. So every raw
// JSON.stringify output turns '<' into <, which reads back as '<' in JavaScript and
// in JSON alike, whatever it prints.
test('every raw JSON.stringify output escapes "<"', () => {
  // Untracked templates too, so a new page is checked before it is ever added.
  const templates = execSync('git ls-files -co --exclude-standard "*.ejs"', { encoding: 'utf8' }).split('\n').filter(Boolean);
  const offenders: string[] = [];

  for (const file of templates) {
    const source = fs.readFileSync(file, 'utf8');
    for (const match of source.matchAll(/<%-([\s\S]*?)%>/g)) {
      const expression = match[1]!;
      // One escape per call: a block holding two outputs needs both escaped.
      const calls = expression.split('JSON.stringify(').length - 1;
      const escapes = expression.split('replace(/</g').length - 1;
      if (calls === 0 || escapes >= calls) continue;
      const line = source.slice(0, match.index).split('\n').length;
      offenders.push(`${file}:${line}`);
    }
  }

  assert.deepEqual(offenders, []);
});
