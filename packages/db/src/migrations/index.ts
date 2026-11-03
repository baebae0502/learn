import { sql as initial } from './001-initial';
import { sql as organize } from './002-organize';
import { sql as anchorsTranslation } from './003-anchors-translation';

export interface Migration {
  version: number;
  name: string;
  sql: string;
}

export const MIGRATIONS: readonly Migration[] = [
  { version: 1, name: 'initial', sql: initial },
  { version: 2, name: 'organize', sql: organize },
  { version: 3, name: 'anchors-translation', sql: anchorsTranslation },
];
export const LATEST_SCHEMA_VERSION = MIGRATIONS.at(-1)!.version;
