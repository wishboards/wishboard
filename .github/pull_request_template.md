## Summary

<!-- Provide a concise description of the changes made and the motivation behind them. -->

## Related Issues

<!--
Use auto-closing keywords for issues resolved by this PR (e.g., Fixes #123, Closes #456).
Use reference keywords for related or ongoing tracking issues (e.g., Refs #789).
-->

## Definition of Done Checklist

- [ ] **Shift-Left Testing**: Covered by tests as far to the left as technically possible (`unit` > `integration` > `e2e` > manual hardware).
- [ ] **Code Coverage**: Meets or exceeds the 80% SonarQube threshold on new/modified code.
- [ ] **Code Quality & Verification**:
  - [ ] `npm run lint` passes without errors.
  - [ ] `npm run type-check` passes without errors.
  - [ ] `npm run format:check` passes without errors.
- [ ] **Documentation Hygiene**:
  - [ ] User-facing documentation in `docs/` updated (if user-facing features or workflows changed).
  - [ ] Architecture Decision Records (ADRs) or technical guides updated (if architectural or infrastructure changes made).
- [ ] **Backlog Pruning**: Pruned resolved item(s) from `BACKLOG.md` (if tracked in the backlog).
