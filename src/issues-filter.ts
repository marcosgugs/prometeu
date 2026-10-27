import type { GitHubItem, Issue } from "./types";

function matches(query: string, fields: string[]) {
  const text = fields.join(" ").toLowerCase();
  return query.trim().toLowerCase().split(/\s+/).every(word => text.includes(word));
}

export function filterLinearIssues(items: Issue[], query: string, team: string, state: string) {
  return items.filter(item => (!team || item.team === team) && (!state || item.state.name === state)
    && matches(query, [item.identifier, item.title, item.project ?? "", item.team,
      item.state.name, item.description ?? "", ...item.labels.map(label => label.name)]));
}

export function filterGitHubItems(items: GitHubItem[], query: string, repository: string, label: string) {
  return items.filter(item => (!repository || item.repository === repository) && (!label || item.labels.includes(label))
    && matches(query, [item.identifier, item.title, item.repository, item.author, ...item.labels]));
}
