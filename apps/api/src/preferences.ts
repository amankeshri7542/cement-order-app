import { Controller, Inject, Put, Req } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { z } from 'zod';
import { preferencesSchema, type Preferences } from '@shiv/shared';
import { Db } from './db';
import { AuthRequest, Contract, Input, Self } from './http';

/** Only the keys this version knows, so an old or tampered row never reaches a screen. */
export function readPreferences(value: unknown): Preferences {
  const row = value && typeof value === 'object' ? (value as Record<string, unknown>) : {};
  const out: Preferences = {};
  if (row.theme === 'auto' || row.theme === 'light' || row.theme === 'dark') out.theme = row.theme;
  if (row.textSize === 'normal' || row.textSize === 'large' || row.textSize === 'larger')
    out.textSize = row.textSize;
  return out;
}

/**
 * A person's own look: theme and the "Bada akshar" text size (plan v4 B1). Kept on the server so it
 * follows them to another phone or computer. Anyone signed in may set their own; nobody else's.
 */
@ApiTags('Account')
@Controller('me')
export class PreferencesController {
  constructor(@Inject(Db) private db: Db) {}

  @Self()
  @Put('preferences')
  @Contract(preferencesSchema)
  async save(
    @Input(preferencesSchema) input: z.infer<typeof preferencesSchema>,
    @Req() req: AuthRequest,
  ) {
    return this.db.atomic(async (tx) => {
      const me = await tx.user.findUniqueOrThrow({
        where: { id: req.user.id },
        select: { preferences: true },
      });
      const next = { ...readPreferences(me.preferences), ...input };
      await tx.user.update({ where: { id: req.user.id }, data: { preferences: next } });
      return next;
    });
  }
}
