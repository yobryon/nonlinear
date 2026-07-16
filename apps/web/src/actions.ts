import type { CreateIssueInput, Issue, Priority } from '@nonlinear/shared';
import { api } from './api.js';
import { useStore } from './store.js';
import { toast, toastError } from './ui.js';

/** Mutation helpers: call REST, merge the response, surface errors. */

export async function patchIssue(id: string, patch: Record<string, unknown>): Promise<void> {
  try {
    const issue = await api.updateIssue(id, patch);
    useStore.getState().putEntity('issue', issue);
  } catch (err) {
    toastError(err);
  }
}

export async function createIssue(input: CreateIssueInput): Promise<Issue | null> {
  try {
    const issue = await api.createIssue(input);
    useStore.getState().putEntity('issue', issue);
    return issue;
  } catch (err) {
    toastError(err);
    return null;
  }
}

export async function deleteIssue(id: string): Promise<void> {
  try {
    await api.deleteIssue(id);
    const { issues } = useStore.getState();
    const next = { ...issues };
    delete next[id];
    useStore.setState({ issues: next });
    toast('Issue deleted');
  } catch (err) {
    toastError(err);
  }
}

export function setPriority(id: string, priority: Priority): void {
  void patchIssue(id, { priority });
}

export function setState(id: string, stateId: string): void {
  void patchIssue(id, { stateId });
}

export function setAssignee(id: string, assigneeId: string | null): void {
  void patchIssue(id, { assigneeId });
}

export function toggleLabel(issue: Issue, labelId: string): void {
  const labelIds = issue.labelIds.includes(labelId)
    ? issue.labelIds.filter((l) => l !== labelId)
    : [...issue.labelIds, labelId];
  void patchIssue(issue.id, { labelIds });
}

export async function toggleFavorite(
  type: 'issue' | 'project' | 'cycle' | 'label',
  targetId: string,
): Promise<void> {
  const { favorites, userId } = useStore.getState();
  const existing = Object.values(favorites).find(
    (f) => f.userId === userId && f.type === type && f.targetId === targetId,
  );
  try {
    if (existing) {
      await api.removeFavorite(existing.id);
      const next = { ...useStore.getState().favorites };
      delete next[existing.id];
      useStore.setState({ favorites: next });
    } else {
      const favorite = await api.addFavorite({ type, targetId });
      useStore.getState().putEntity('favorite', favorite);
    }
  } catch (err) {
    toastError(err);
  }
}
