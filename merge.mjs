// /merge on an open issue: merge its pull request, making one first if the
// issue has none, then close the issue as merged.
import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';

const SHA = /^[a-f0-9]{40,64}$/i;

export function run(command, args, { cwd, timeout = 120_000 } = {}) {
  return new Promise(resolve => {
    execFile(command, args, { cwd, timeout, maxBuffer: 4 * 1024 * 1024 }, (error, stdout, stderr) => {
      resolve({ code: error ? (typeof error.code === 'number' ? error.code : 1) : 0, stdout: String(stdout), stderr: String(stderr) });
    });
  });
}

function failure(what, result) {
  const detail = (result.stderr || result.stdout).trim().split('\n').at(-1) ?? '';
  return new Error(detail ? `${what}: ${detail}` : what);
}

/** The first line of the issue, short enough for a commit subject or PR title. */
export function title(text) {
  const line = String(text ?? '').split('\n').map(part => part.trim()).find(Boolean) ?? 'Divernote issue';
  return line.length > 72 ? `${line.slice(0, 71).trimEnd()}…` : line;
}

/** What the core merge returned, as one line for the status. */
function mergedStatus(result) {
  if (result?.outcome === 'merged') return result.status === 'closed' ? 'Merged the pull request and closed the issue.' : 'Merged the pull request, but the issue could not be closed.';
  return result?.diagnostic || 'The pull request merge could not be verified.';
}

export async function merge({ args = '', issue, divernote }, { exec = run, exists = existsSync } = {}) {
  if (issue.state === 'working') return { status: 'The agent is still working. Stop it or wait, then /merge.' };
  if (issue.state === 'closed') return { status: 'This issue is closed.' };
  // A pull request Divernote already reviewed merges the way Enter does.
  if (issue.state === 'review' && issue.reviewedPr) return { status: mergedStatus(await divernote.mergeIssue()) };

  const cwd = issue.worktree;
  if (!cwd || !exists(cwd)) return { status: 'This issue has no worktree to make a pull request from.' };
  const git = async (gitArgs, what) => {
    const result = await exec('git', gitArgs, { cwd });
    if (result.code !== 0) throw failure(what, result);
    return result.stdout.trim();
  };
  const gh = async (ghArgs, what) => {
    const result = await exec('gh', ghArgs, { cwd });
    if (result.code !== 0) throw failure(what, result);
    return result.stdout.trim();
  };

  const branch = await git(['symbolic-ref', '--quiet', '--short', 'HEAD'], 'The worktree is not on a branch');
  const base = JSON.parse(await gh(['repo', 'view', '--json', 'defaultBranchRef'], 'Could not read the repository')).defaultBranchRef?.name;
  if (!base) throw new Error('Could not find the repository\'s default branch.');
  if (branch === base) return { status: `The worktree is on ${base}, so there is nothing to merge.` };

  if (await git(['status', '--porcelain'], 'Could not read the worktree')) {
    await git(['add', '--all'], 'Could not stage the changes');
    await git(['commit', '-m', args.trim() || title(issue.text)], 'Could not commit the changes');
  }
  await git(['fetch', 'origin', base], `Could not fetch ${base}`);
  if (await git(['rev-list', '--count', `origin/${base}..HEAD`], 'Could not compare with the base') === '0') {
    return { status: `${branch} has nothing that is not already on ${base}.` };
  }
  await git(['push', '--set-upstream', 'origin', 'HEAD'], `Could not push ${branch}`);
  const head = await git(['rev-parse', 'HEAD'], 'Could not read the commit');
  if (!SHA.test(head)) throw new Error('Could not read the commit.');

  const open = JSON.parse(await gh(['pr', 'list', '--head', branch, '--base', base, '--state', 'open', '--json', 'number,url', '--limit', '2'], 'Could not look for a pull request'));
  if (open.length > 1) return { status: `${branch} has more than one open pull request. Merge one on GitHub.` };
  let pullRequest = open[0];
  let created = false;
  if (!pullRequest) {
    const url = (await gh(['pr', 'create', '--base', base, '--head', branch, '--title', title(issue.text), '--body', issue.text || title(issue.text)], 'Could not create the pull request'))
      .split(/\s+/).find(value => value.startsWith('https://'));
    const number = Number(url?.match(/\/pull\/(\d+)/)?.[1]);
    if (!Number.isSafeInteger(number) || number < 1) throw new Error('The pull request was created, but its number could not be read.');
    pullRequest = { number, url };
    created = true;
  }

  const merged = await exec('gh', ['pr', 'merge', String(pullRequest.number), '--merge', '--match-head-commit', head], { cwd });
  const after = JSON.parse(await gh(['pr', 'view', String(pullRequest.number), '--json', 'state,mergedAt,mergeable'], 'Could not check the pull request'));
  if (after.state !== 'MERGED' || !after.mergedAt) {
    const opened = created ? `Opened #${pullRequest.number}, but it` : `#${pullRequest.number}`;
    if (after.mergeable === 'CONFLICTING') return { status: `${opened} conflicts with ${base}. Ask the agent to update it, then /merge.` };
    const reason = (merged.stderr || merged.stdout).trim().split('\n').at(-1) || 'GitHub did not say why.';
    return { status: `${opened} did not merge: ${reason}` };
  }
  await divernote.closeMerged({ number: pullRequest.number, url: pullRequest.url });
  return { status: `${created ? 'Opened and merged' : 'Merged'} #${pullRequest.number} and closed the issue.` };
}
