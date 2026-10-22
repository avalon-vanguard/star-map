<!-- Synced from avalon-vanguard/ci (templates/angular/); change it there, not here. -->

# Angular rules

- Standalone components only, zoneless change detection, `OnPush`, signals for state.
- Component selectors use the `app-` prefix.
- Pages live under `src/app/<feature>/`, reusable UI under `shared/`, services under `core/`.
- i18n uses `@angular/localize` with custom `@@ID` message ids.
- `messages.json` is generated only by `ng extract-i18n`; never edit it by hand.
- Bundle budgets are mandatory in `angular.json`; a budget error fails the build.
- jsdom has no WebGL: stub the renderer in specs.
