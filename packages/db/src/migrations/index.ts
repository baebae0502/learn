import { sql as initial } from './001-initial';

export interface Migration {
  version: number;
  name: string;
  sql: string;
}

export const MIGRATIONS: readonly Migration[] = [{ version: 1, name: 'initial', sql: initial }];
export const LATEST_SCHEMA_VERSION = 1;
