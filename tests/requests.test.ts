import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { dueDateOf, holderOf, isOut, isOverdue, nextStep, readRequestData, requestsEnabled } from '../core/requests';
import { cleanRequestType, requestTemplates } from '../core/requestTypes';
import { boardGamesPlugin } from '../plugins/boardgames';

const loanLike = (over: Record<string, any> = {}) => ({
  sender: 'aaaaaaaaaaaaaaaaaaaaaaaa',
  recipient: 'bbbbbbbbbbbbbbbbbbbbbbbb',
  status: 'accepted',
  step: 0,
  data: { due: '2026-11-30' },
  snapshot: {
    holder: 'sender',
    fields: [{ key: 'due', label: 'Due', type: 'date', deadline: true }],
    steps: [{ key: 'out', label: 'Handed over', out: true }, { key: 'back', label: 'Given back', out: false }]
  },
  ...over
});

describe('requests', () => {
  it('stays off until the collection turns it on', () => {
    assert.equal(requestsEnabled({}), false);
    assert.equal(requestsEnabled({ requests: { enabled: 'yes' } }), false);
    assert.equal(requestsEnabled({ requests: { enabled: true } }), true);
  });

  it('reads only the questions a type asks, and checks the answers', () => {
    const fields: any[] = [
      { key: 'when', label: 'When', type: 'date', required: true },
      { key: 'players', label: 'Players', type: 'number' },
      { key: 'mood', label: 'Mood', type: 'select', options: ['calm', 'loud'] },
      { key: 'bring', label: 'Bring snacks', type: 'boolean' },
      { key: 'note', label: 'Note', type: 'text' }
    ];
    const ok = readRequestData(fields, { f_when: '2026-12-24', f_players: '4', f_mood: 'calm', f_bring: 'on', f_note: '  hi  ', f_other: 'nope' });
    assert.equal(ok.error, null);
    assert.deepEqual(ok.data, { when: '2026-12-24', players: 4, mood: 'calm', bring: true, note: 'hi' });
    assert.equal(readRequestData(fields, {}).error?.key, 'requests.err_field_required');
    assert.equal(readRequestData(fields, { f_when: '24/12/2026' }).error?.key, 'requests.err_field_invalid');
    assert.equal(readRequestData(fields, { f_when: '2026-12-24', f_mood: 'angry' }).error?.field.key, 'mood');
  });

  it('knows who has the item, until when, and what comes next', () => {
    const away = loanLike();
    assert.equal(isOut(away), true);
    assert.equal(holderOf(away), 'aaaaaaaaaaaaaaaaaaaaaaaa');
    assert.equal(holderOf(loanLike({ snapshot: { ...away.snapshot, holder: 'recipient' } })), 'bbbbbbbbbbbbbbbbbbbbbbbb');
    assert.equal(dueDateOf(away), '2026-11-30');
    assert.equal(isOverdue(away, new Date('2026-11-30T23:00:00Z')), false);
    assert.equal(isOverdue(away, new Date('2026-12-01T00:30:00Z')), true);
    assert.equal(nextStep(away)?.label, 'Given back');

    assert.equal(isOut(loanLike({ step: -1 })), false, 'accepted, not handed over yet');
    assert.equal(isOut(loanLike({ status: 'done', step: 1 })), false);
    assert.equal(isOut(loanLike({ snapshot: { ...away.snapshot, holder: 'none' } })), false);
    assert.equal(nextStep(loanLike({ status: 'pending' })), null);
  });

  it('puts a type in shape, and refuses what makes no sense', () => {
    const { type, errors } = cleanRequestType({
      name: ' Come <and> listen ', icon: 'headphones', minRole: 'owner', visibility: 'private', holder: 'nobody',
      fields: [
        { label: 'When', type: 'date', required: true, deadline: true },
        { label: 'When', type: 'nonsense', deadline: true },
        { label: 'Mood', type: 'select', options: 'calm\n\nloud\ncalm' }
      ],
      steps: [{ label: 'Done', out: true }]
    });
    assert.deepEqual(errors, []);
    assert.equal(type!.name, 'Come and listen');
    assert.equal(type!.minRole, 'viewer');
    assert.equal(type!.visibility, 'private');
    assert.equal(type!.holder, 'none');
    assert.deepEqual(type!.fields.map((f: any) => [f.key, f.type, !!f.deadline]), [['when', 'date', true], ['when_2', 'text', false], ['mood', 'select', false]]);
    assert.deepEqual(type!.fields[2].options, ['calm', 'loud']);
    assert.equal(type!.steps[0].out, false, 'nothing moves without someone to have it');

    assert.deepEqual(cleanRequestType({ name: '' }).errors, ['requests.builder.err_name']);
    assert.ok(cleanRequestType({ name: 'x', holder: 'sender', steps: [{ label: 'a' }, { label: 'b' }] }).errors.includes('requests.builder.err_holder_step'));
    assert.ok(cleanRequestType({ name: 'x', holder: 'sender', steps: [{ label: 'a', out: true }] }).errors.includes('requests.builder.err_last_step_out'));
    assert.ok(cleanRequestType({ name: 'x', fields: [{ label: 'a', type: 'date', deadline: true }, { label: 'b', type: 'date', deadline: true }] }).errors.includes('requests.builder.err_one_deadline'));
  });

  it('offers templates the builder accepts as they are, the plugins\' among them', () => {
    const templates = requestTemplates(k => k, [boardGamesPlugin]);
    assert.ok(templates['boardgames.play'], 'a plugin\'s, under its own id');
    for (const template of Object.values(templates)) {
      assert.deepEqual(cleanRequestType(template).errors, []);
    }
  });

  it('reads a plugin template\'s words as keys, or as written', () => {
    const plugin = { id: 'x', requestTemplates: [{ id: 'swap', name: 'Swap it', icon: 'no-such-icon', steps: [{ label: 'Swapped' }] }] };
    const swap = requestTemplates((k: string, o?: any) => o?.defaultValue ?? k, [plugin])['x.swap']!;
    assert.equal(swap.name, 'Swap it');
    assert.equal(swap.icon, 'paper-plane', 'an icon off the grid shows the first');
    assert.equal(swap.steps[0]!.label, 'Swapped');
  });
});
