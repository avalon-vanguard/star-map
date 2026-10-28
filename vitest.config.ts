import { defineConfig } from 'vitest/config';

// Le runner Gitea du VPS, couverture allumée, va 3 à 5 fois moins vite qu'un poste récent :
// les 5 s par défaut de Vitest y font tomber des tests qui passent en 1 s en local.
export default defineConfig({
  test: {
    testTimeout: 20_000,
  },
});
