# Project learnings

Session: 019f1e58-cfb0-7a9f-a899-25717ecd90a9

- discovery: Stable-weekly rotation must score every usage-backed account before untouched filtering; otherwise the selector can pick the wrong account under `selectionStrategy: stable-weekly`.
  source: codebase | scope: project-wide | persist: AGENTS.md
- architecture: Session startup should finish restoration before footer refresh starts; otherwise manual pins and footer state can race and repaint stale status.
  source: session | scope: project-wide | persist: AGENTS.md
- discovery: Pending model-select refreshes need a lifecycle guard so shutdown or restart cannot apply stale footer output after the context changes.
  source: codebase | scope: project-wide | persist: AGENTS.md
