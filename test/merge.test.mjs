import assert from 'node:assert/strict';
import test from 'node:test';
import { merge, title } from '../merge.mjs';
import pullRequests from '../index.mjs';

const SHA = 'a'.repeat(40);

function issue(overrides = {}) {
  return { projectSlug: 'site', sessionId: 's1', kind: 'feature', state: 'review', text: 'Fix the header\nmore', reviewedPr: null, worktree: '/wt', ...overrides };
}

/** A fake git and gh: `answers` maps "command args…" prefixes to results. */
function fake(answers) {
  const calls = [];
  const exec = async (command, args) => {
    const line = [command, ...args].join(' ');
    calls.push(line);
    const key = Object.keys(answers).find(prefix => line.startsWith(prefix));
    const answer = key === undefined ? '' : answers[key];
    return typeof answer === 'object' ? answer : { code: 0, stdout: answer, stderr: '' };
  };
  return { exec, calls };
}

function helpers() {
  const closed = [];
  return { closed, divernote: { mergeIssue: async () => ({ outcome: 'merged', status: 'closed' }), closeMerged: async pr => { closed.push(pr); } } };
}

const repo = {
  'git symbolic-ref': 'feature/header',
  'gh repo view': JSON.stringify({ defaultBranchRef: { name: 'main' } }),
  'git status': '',
  'git rev-list': '2',
  'git rev-parse': SHA,
  'gh pr view': JSON.stringify({ state: 'MERGED', mergedAt: '2026-10-14T00:00:00Z' }),
};

test('registers /merge on issues', () => {
  const registered = [];
  pullRequests({ registerIssueCommand: (name, options, handler) => registered.push({ name, options, handler }) });
  assert.equal(registered[0].name, 'merge');
  assert.equal(typeof registered[0].handler, 'function');
});

test('an issue with no pull request gets one, then it is merged and the issue closed', async () => {
  const { exec, calls } = fake({ ...repo, 'gh pr list': '[]', 'gh pr create': 'https://github.com/o/r/pull/42\n', 'git status': ' M a.js' });
  const { closed, divernote } = helpers();
  const result = await merge({ args: '', issue: issue({ state: 'blocked' }), divernote }, { exec, exists: () => true });
  assert.equal(result.status, 'Opened and merged #42 and closed the issue.');
  assert.deepEqual(closed, [{ number: 42, url: 'https://github.com/o/r/pull/42' }]);
  assert.ok(calls.includes('git commit -m Fix the header'));
  assert.ok(calls.some(line => line.startsWith('gh pr create --base main --head feature/header --title Fix the header')));
  assert.ok(calls.includes(`gh pr merge 42 --merge --match-head-commit ${SHA}`));
});

test('an open pull request for the branch is merged, not duplicated', async () => {
  const { exec, calls } = fake({ ...repo, 'gh pr list': JSON.stringify([{ number: 7, url: 'https://github.com/o/r/pull/7' }]) });
  const { closed, divernote } = helpers();
  const result = await merge({ issue: issue(), divernote }, { exec, exists: () => true });
  assert.equal(result.status, 'Merged #7 and closed the issue.');
  assert.equal(closed[0].number, 7);
  assert.ok(!calls.some(line => line.startsWith('gh pr create')));
  assert.ok(!calls.some(line => line.startsWith('git commit')));
});

test('a reviewed pull request merges through Divernote', async () => {
  const { exec, calls } = fake({});
  const { divernote } = helpers();
  const result = await merge({ issue: issue({ reviewedPr: { number: 3 } }), divernote }, { exec });
  assert.equal(result.status, 'Merged the pull request and closed the issue.');
  assert.deepEqual(calls, []);
});

test('a working, closed, or empty issue is not merged', async () => {
  const { divernote } = helpers();
  assert.match((await merge({ issue: issue({ state: 'working' }), divernote })).status, /still working/);
  assert.match((await merge({ issue: issue({ state: 'closed' }), divernote })).status, /closed/);
  const { exec } = fake({ ...repo, 'git rev-list': '0' });
  assert.match((await merge({ issue: issue(), divernote }, { exec, exists: () => true })).status, /nothing that is not already on main/);
});

test('a conflict leaves the issue open and says so', async () => {
  const { exec } = fake({ ...repo, 'gh pr list': '[]', 'gh pr create': 'https://github.com/o/r/pull/9', 'gh pr merge': { code: 1, stdout: '', stderr: 'not mergeable' }, 'gh pr view': JSON.stringify({ state: 'OPEN', mergeable: 'CONFLICTING' }) });
  const { closed, divernote } = helpers();
  const result = await merge({ issue: issue(), divernote }, { exec, exists: () => true });
  assert.match(result.status, /Opened #9, but it conflicts with main/);
  assert.deepEqual(closed, []);
});

test('titles are the first line, kept short', () => {
  assert.equal(title('\n  Hello  \nworld'), 'Hello');
  assert.equal(title('x'.repeat(100)).length, 72);
  assert.equal(title(''), 'Divernote issue');
});
