# star-map

Personal marketplace of `cs:*` Claude Code commands, agents, and skills.

## Install (global — works in every project)

This repo is a Claude Code plugin marketplace. Adding it and installing a
plugin defaults to **user scope**, meaning the plugin becomes available in
*every* project on your machine, not just the one you happen to be in:

```bash
/plugin marketplace add avalon-vanguard/star-map
/plugin install caveman@star-map
```

Scope can be overridden at install time if you want it tied to a single
repo instead:

```bash
# Shared with collaborators via that repo's .claude/settings.json
/plugin install caveman@star-map --scope project

# Just for you, in that one repo only (gitignored)
/plugin install caveman@star-map --scope local
```

See [Claude Code plugin installation scopes](https://code.claude.com/docs/en/plugins-reference)
for details on `user` / `project` / `local` scope.

## Plugins

- **caveman** — `/cs:caveman` ultra-compressed communication mode.
  - Command: [`commands/cs/caveman.md`](commands/cs/caveman.md)
  - Agent: [`agents/cs-caveman-mode.md`](agents/cs-caveman-mode.md)
  - Skill: [`skills/caveman/SKILL.md`](skills/caveman/SKILL.md)