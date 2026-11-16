# Management Skill interface

- Trusted deployed IDs/names: `expert-manager` → expert, `skill-creator` → skill. Standard SkillInfo/SkillFile fields, version1 and hash of exact deployed SKILL.md. No writable asset/publication/schema.
- `GET /api/admin/capabilities/authoring-skills` → SkillInfo[]; `GET /api/admin/capabilities/authoring-skills/:id` → SkillFile. Current administrator only, usable before workspace selection.
- Existing own-personal `/workspaces/:id/resources` appends the same method metadata; `/skills/:id` resolves same content. Ordinary users/foreign/business scopes do not receive methods.
- Normal browser `skill:{id,hash}` selects the method. Server derives AuthoringIntent; extra legacy `authoring` is accepted for an edit target/baseline only when consistent with selected method. Clearing/switching chip clears old target; no mode select.
- Explicit method body is delivered and projected through original resolved selections/history, with a new native composer v8 and resource schema3 for management skills; existing v1-v7/schema1-2 keep exact old semantics. Old R3A intent-only requests remain compatible/on-demand.
- Six management tools and original confirmation/receipt continue unchanged; registered method identity is never inferred from user package name. Explicit method selection does not grant authority without current admin own personal request guards.
