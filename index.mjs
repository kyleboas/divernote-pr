// divernote-pr: /merge on an open issue merges its pull request, making one
// from the issue's worktree first if it has none. See merge.mjs.
import { merge } from './merge.mjs';

export default function pullRequests(divernote) {
  divernote.registerIssueCommand('merge', { description: 'Merge the issue\'s PR, making one if needed' }, context => merge(context));
}
