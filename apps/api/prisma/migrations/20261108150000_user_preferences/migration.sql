-- Plan v4 B1: theme and text size, saved per person.
ALTER TABLE "User" ADD COLUMN "preferences" JSONB NOT NULL DEFAULT '{}';
