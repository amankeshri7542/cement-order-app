import { Controller, Inject, Put, Req } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { z } from 'zod';
import { isLanguage } from '@shiv/i18n';
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
  if (isLanguage(row.language)) out.language = row.language;
  return out;
}

/**
 * A person's own look and language: theme, the "Bada akshar" text size (plan v4 B1) and the
 * language (B2). Kept on the server so they follow them to another phone or computer, and so the
 * shop's messages to them use that language. Anyone signed in may set their own; nobody else's.
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
      const preferences = { ...readPreferences(me.preferences), ...input };
      // The language is kept twice: in preferences, as the person's own choice that their screens
      // follow, and in User.language, which every message the shop sends them reads.
      await tx.user.update({
        where: { id: req.user.id },
        data: { preferences, ...(input.language ? { language: input.language } : {}) },
      });
      return preferences;
    });
  }
}
