# Bind design approval to exact inputs

Design approval binds to exact authored files, saved comments, and declared map contributions. Parsed-content versions still locate review files. YAML formatting changes invalidate approval without separating existing comments from their design.

## Consequences

- Relative source paths, YAML comments, and supporting Markdown participate in the full source hash
- Project-relative review references preserve acceptance when an unchanged checkout moves
- Presentation regeneration preserves approval when its authored inputs remain unchanged
- Reconciliation records explain how the agent handled comments and proposals before approval
- Earlier feedback and approval evidence remain available after a revision invalidates acceptance
- Approval includes selected feedback histories, so reconciling edited comments cannot reactivate earlier acceptance
- Whitespace-only source edits require another review; the stricter check avoids guessing which edits matter
