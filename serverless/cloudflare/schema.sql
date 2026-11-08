CREATE TABLE IF NOT EXISTS conversion_counts (
 day TEXT NOT NULL, event_name TEXT NOT NULL, page TEXT NOT NULL,
 journey TEXT NOT NULL DEFAULT '', offer TEXT NOT NULL DEFAULT '',
 status TEXT NOT NULL DEFAULT '', source TEXT NOT NULL DEFAULT '',
 campaign TEXT NOT NULL DEFAULT '', count INTEGER NOT NULL DEFAULT 0,
 PRIMARY KEY(day,event_name,page,journey,offer,status,source,campaign)
);
