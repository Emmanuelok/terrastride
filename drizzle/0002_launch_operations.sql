CREATE TABLE request_messages (
  id TEXT PRIMARY KEY NOT NULL,
  request_id TEXT NOT NULL REFERENCES requests(id) ON DELETE CASCADE,
  author_role TEXT NOT NULL CHECK (author_role IN ('staff', 'customer')),
  author_id TEXT NOT NULL,
  body TEXT NOT NULL CHECK (length(body) BETWEEN 1 AND 3000),
  created TEXT NOT NULL
);
--> statement-breakpoint
CREATE INDEX request_messages_request_created ON request_messages(request_id, created, id);
--> statement-breakpoint
CREATE TABLE request_operations (
  id TEXT PRIMARY KEY NOT NULL,
  request_id TEXT NOT NULL REFERENCES requests(id) ON DELETE CASCADE,
  actor_id TEXT NOT NULL,
  action TEXT NOT NULL CHECK (action IN ('status', 'customer-reply')),
  payload_hash TEXT NOT NULL,
  applied INTEGER NOT NULL DEFAULT 0 CHECK (applied IN (0, 1)),
  created TEXT NOT NULL
);
--> statement-breakpoint
CREATE INDEX request_operations_request_created ON request_operations(request_id, created);
--> statement-breakpoint
CREATE TABLE notifications_outbox (
  id TEXT PRIMARY KEY NOT NULL,
  request_id TEXT NOT NULL REFERENCES requests(id) ON DELETE CASCADE,
  message_id TEXT REFERENCES request_messages(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('request-received', 'request-status', 'request-reply')),
  payload TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'sending', 'sent', 'failed')),
  attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  available_at TEXT NOT NULL,
  created TEXT NOT NULL,
  sent_at TEXT,
  lease_id TEXT,
  lease_expires TEXT,
  provider_message_id TEXT,
  last_error_code TEXT
);
--> statement-breakpoint
CREATE INDEX notifications_outbox_pending ON notifications_outbox(status, available_at, id);
--> statement-breakpoint
CREATE INDEX requests_created_id ON requests(created, id);
