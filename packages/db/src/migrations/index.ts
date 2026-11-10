import { sql as initial } from './001-initial';
import { sql as organize } from './002-organize';
import { sql as anchorsTranslation } from './003-anchors-translation';
import { sql as imagesText } from './004-images-text';

export interface Migration {
  version: number;
  name: string;
  sql: string;
  /** Runs with foreign keys off, checked before commit (see migrate.ts). */
  foreignKeysOff?: true;
}

export const MIGRATIONS: readonly Migration[] = [
  { version: 1, name: 'initial', sql: initial },
  { version: 2, name: 'organize', sql: organize },
  { version: 3, name: 'anchors-translation', sql: anchorsTranslation },
  { version: 4, name: 'images-text', sql: imagesText, foreignKeysOff: true },
];
export const LATEST_SCHEMA_VERSION = MIGRATIONS.at(-1)!.version;
