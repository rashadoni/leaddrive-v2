-- Additive, default-deny attendance permission; existing roles are unchanged.
SET lock_timeout = '3s';
ALTER TABLE "users" ADD COLUMN "mtmAttendanceAll" BOOLEAN NOT NULL DEFAULT false;
-- Rollback keeps this column; old application builds ignore it.
