import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';
import { setupTokenAccepted, setupTokenRequired } from '../core/setupToken';

describe('setup token', () => {
  const saved = process.env.SETUP_TOKEN;
  afterEach(() => {
    if (saved === undefined) delete process.env.SETUP_TOKEN;
    else process.env.SETUP_TOKEN = saved;
  });

  it('changes nothing when it is not set', () => {
    delete process.env.SETUP_TOKEN;
    assert.equal(setupTokenRequired(), false);
    assert.equal(setupTokenAccepted(undefined), true);
    process.env.SETUP_TOKEN = '   ';
    assert.equal(setupTokenRequired(), false);
  });

  it('accepts only the configured value', () => {
    process.env.SETUP_TOKEN = 'abc123';
    assert.equal(setupTokenRequired(), true);
    assert.equal(setupTokenAccepted('abc123'), true);
    assert.equal(setupTokenAccepted(' abc123 '), true);
    assert.equal(setupTokenAccepted('abc12'), false);
    assert.equal(setupTokenAccepted(''), false);
    assert.equal(setupTokenAccepted(undefined), false);
    assert.equal(setupTokenAccepted(['abc123']), false);
  });
});
