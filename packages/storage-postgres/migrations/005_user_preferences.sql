-- Per-user interface preferences (theme, font size, home view, name format, week start).
UPDATE users SET data = data || jsonb_build_object(
  'preferences', jsonb_build_object(
    'theme', 'system',
    'fontSize', 'default',
    'home', 'my-issues',
    'displayNames', 'full',
    'firstDayOfWeek', 'monday'
  )
) WHERE NOT data ? 'preferences';
