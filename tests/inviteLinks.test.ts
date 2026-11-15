import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { inviteRole, inviteValidityDays, isInviteLive, liveInvites } from '../core/inviteLinks';

describe('invite links', () => {
  it('keeps only the links that have not expired, soonest first', () => {
    const now = new Date('2026-11-11T12:00:00Z');
    const links = [
      { token: 'b', expiresAt: new Date('2026-11-20T00:00:00Z') },
      { token: 'gone', expiresAt: new Date('2026-11-11T11:59:59Z') },
      { token: 'a', expiresAt: new Date('2026-11-12T00:00:00Z') },
    ];
    assert.deepEqual(liveInvites({ inviteLinks: links }, now).map(l => l.token), ['a', 'b']);
    assert.equal(isInviteLive({ expiresAt: now }, now), false);
    assert.equal(isInviteLive(null, now), false);
    assert.deepEqual(liveInvites(null, now), []);
  });

  it('falls back to safe values for a role or a validity it does not know', () => {
    assert.equal(inviteRole('editor'), 'editor');
    assert.equal(inviteRole('owner'), 'viewer');
    assert.equal(inviteValidityDays('30'), 30);
    assert.equal(inviteValidityDays('365'), 7);
  });
});
