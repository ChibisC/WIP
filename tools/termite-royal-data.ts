/** Writes src/sim/termiteRoyalData.ts from the termite model kit (see tools/termiteRoyalSource.ts). Run: npx vite-node tools/termite-royal-data.ts */
import { writeFileSync } from 'node:fs';
import { royalData, royalDataSource } from './termiteRoyalSource';

writeFileSync(new URL('../src/sim/termiteRoyalData.ts', import.meta.url), royalDataSource());
console.log('wrote src/sim/termiteRoyalData.ts', JSON.stringify(royalData()));
