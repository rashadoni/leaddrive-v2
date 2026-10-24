BEGIN READ ONLY;
SET LOCAL app.rls_bypass = 'on';
SELECT json_build_object(
  'bookingCount', (SELECT count(*) FROM public.bookings),
  'invalidHostCount', (SELECT count(*) FROM public.bookings b LEFT JOIN public.users u ON u.id=b."hostUserId" AND u."organizationId"=b."organizationId" WHERE u.id IS NULL),
  'invalidPageCount', (SELECT count(*) FROM public.bookings b LEFT JOIN public.booking_pages p ON p.id=b."bookingPageId" AND p."organizationId"=b."organizationId" WHERE p.id IS NULL),
  'duplicateTaskCount', (SELECT count(*) FROM (SELECT "organizationId", "taskId" FROM public.bookings WHERE "taskId" IS NOT NULL GROUP BY "organizationId", "taskId" HAVING count(*)>1) d),
  'overlapCount', (SELECT count(*) FROM public.bookings a JOIN public.bookings b ON a."organizationId"=b."organizationId" AND a."hostUserId"=b."hostUserId" AND a.id<b.id AND a."startsAt"<b."endsAt" AND a."endsAt">b."startsAt" WHERE a.status='confirmed' AND b.status='confirmed'),
  'invalidIntervalCount', (SELECT count(*) FROM public.bookings WHERE "startsAt">="endsAt"),
  'missingTaskCount', (SELECT count(*) FROM public.bookings WHERE "taskId" IS NULL),
  'missingLeadCount', (SELECT count(*) FROM public.bookings WHERE "leadId" IS NULL),
  'invalidTaskLinkCount', (SELECT count(*) FROM public.bookings b LEFT JOIN public.tasks t ON t.id=b."taskId" AND t."organizationId"=b."organizationId" WHERE b."taskId" IS NOT NULL AND t.id IS NULL),
  'invalidLeadLinkCount', (SELECT count(*) FROM public.bookings b LEFT JOIN public.leads l ON l.id=b."leadId" AND l."organizationId"=b."organizationId" WHERE b."leadId" IS NOT NULL AND l.id IS NULL),
  'btreeGistAvailable', EXISTS(SELECT 1 FROM pg_available_extensions WHERE name='btree_gist'),
  'btreeGistInstalled', EXISTS(SELECT 1 FROM pg_extension WHERE extname='btree_gist'),
  'extensionCreatePrivilege', has_database_privilege(current_user, current_database(), 'CREATE'),
  'migrationRoleSuperuser', (SELECT rolsuper FROM pg_roles WHERE rolname=current_user),
  'readOnly', current_setting('transaction_read_only') = 'on'
);
COMMIT;
