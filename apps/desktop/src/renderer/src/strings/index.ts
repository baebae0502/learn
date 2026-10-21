// UI copy by area (design-spec 9: 합니다체, verb buttons, U+00A0 groups). strings.test.ts lints all of it.
import { common } from './common';
import { library } from './library';
import { shell } from './shell';
import { sheets } from './sheets';
import { toast } from './toast';

export const t = { common, shell, library, toast, sheets } as const;
