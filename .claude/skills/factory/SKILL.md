---
name: factory
description: Factory status, init or migrate per docs/Software_Factory_Playbook.md (§6 migrate, §7 init, §9 versions).
disable-model-invocation: true
---
Args: `status` | `migrate` | `init <name>`.
- **status**: print `.factory/manifest.json` playbook_version + applied_migrations; list `## Migration from` entries in
  `docs/Software_Factory_Playbook.md` newer than it; line counts of CLAUDE.md and DECISIONS.md vs caps; run
  `bash scripts/factory-check.sh gates`.
- **migrate**: apply only pending migration entries, in order. Replace factory-owned files (hooks/guard*, stop-gate.sh,
  session-context.sh, skills/factory|change|verify|ship, agents/reviewer.md, scripts/factory-check.sh,
  scripts/gates.mjs, changes/TEMPLATE.md); merge project-owned files. Prove each hook fires by piping tool JSON into it.
  Record version in manifest; write a change artifact.
- **init**: playbook §7.
