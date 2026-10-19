import type { SeedContext } from './context';

/** Bump when this module's seed or record shapes change (invalidates stored demo data). */
export const rev = 0;

/** reports demo data. Runs after earlier modules (see mocks/seed.ts order); tolerate missing upstream data. */
export function seed(_ctx: SeedContext): void {}
