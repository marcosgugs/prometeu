import { expect, it } from "vitest";
import { githubIssue } from "./github-issues-model";
import { filterGitHubItems, filterLinearIssues } from "./issues-filter";
import type { GitHubItem } from "./types";

const issue: GitHubItem = {
  id: "github:acme/app/issues/12", identifier: "acme/app#12", title: "Restore terminal state",
  url: "https://github.com/acme/app/issues/12", description: "Keep sessions after restart",
  repository: "acme/app", number: 12, kind: "issue", author: "alex", draft: false,
  updated_at: "2026-10-25T00:00:00Z", labels: ["bug", "desktop"],
};

it("combines GitHub search, repository and label filters without changing source order", () => {
  const other = { ...issue, id: "other", repository: "acme/web", labels: ["enhancement"] };
  const items = [other, issue];
  expect(filterGitHubItems(items, "  TERMINAL alex  ", "acme/app", "bug")).toEqual([issue]);
  expect(filterGitHubItems(items, "terminal", "acme/app", "enhancement")).toEqual([]);
  expect(filterGitHubItems(items, "terminal missing", "", "")).toEqual([]);
  expect(filterGitHubItems(items, "", "", "")).toEqual(items);
});

it("combines Linear team and state filters with text and label search", () => {
  const linear = { ...githubIssue(issue), team: "APP", project: "Desktop", state: { name: "In progress", kind: "started", color: "#fff" } };
  const other = { ...linear, id: "other", team: "WEB", project: null, description: null, state: { ...linear.state, name: "Todo" } };
  const items = [linear, other];
  expect(filterLinearIssues(items, "BUG restart", "APP", "In progress")).toEqual([linear]);
  expect(filterLinearIssues(items, "", "APP", "Todo")).toEqual([]);
  expect(filterLinearIssues(items, "terminal", "WEB", "Todo")).toEqual([other]);
  expect(filterLinearIssues(items, "", "", "")).toEqual(items);
});
