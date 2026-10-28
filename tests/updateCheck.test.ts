import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { isNewer } from '../core/updateCheck';

describe('update check', () => {
  it('compares versions part by part, a leading v or a pre-release aside', () => {
    assert.equal(isNewer('4.0.1', '4.0.0'), true);
    assert.equal(isNewer('v4.10.0', '4.9.9'), true);
    assert.equal(isNewer('4.0.0', '4.0.0'), false);
    assert.equal(isNewer('3.9.0', '4.0.0'), false);
    assert.equal(isNewer('5.0.0-beta.1', '4.2.0'), true);
  });

  it('never calls something unreadable newer', () => {
    assert.equal(isNewer('latest', '4.0.0'), false);
    assert.equal(isNewer('', '4.0.0'), false);
    assert.equal(isNewer('4.1', '4.0.0'), false);
  });
});
