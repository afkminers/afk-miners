BEGIN;

-- Friendships and direct messages core schema

-- Enum for friendship status
CREATE TYPE IF NOT EXISTS friend_status AS ENUM ('PENDING', 'ACCEPTED', 'BLOCKED');

-- Friendships table with canonical pair handling
CREATE TABLE IF NOT EXISTS friendships (
  id BIGSERIAL PRIMARY KEY,
  user_a_id TEXT NOT NULL,
  user_b_id TEXT NOT NULL,
  status friend_status NOT NULL DEFAULT 'PENDING',
  pair_left TEXT GENERATED ALWAYS AS (LEAST(user_a_id, user_b_id)) STORED,
  pair_right TEXT GENERATED ALWAYS AS (GREATEST(user_a_id, user_b_id)) STORED,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (user_a_id <> user_b_id),
  FOREIGN KEY (user_a_id) REFERENCES players(id) ON DELETE CASCADE,
  FOREIGN KEY (user_b_id) REFERENCES players(id) ON DELETE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS friendships_pair_unique
  ON friendships (pair_left, pair_right);

CREATE INDEX IF NOT EXISTS idx_friendships_user_a ON friendships (user_a_id);
CREATE INDEX IF NOT EXISTS idx_friendships_user_b ON friendships (user_b_id);
CREATE INDEX IF NOT EXISTS idx_friendships_status ON friendships (status);

-- Direct messages between two participants
CREATE TABLE IF NOT EXISTS direct_messages (
  id BIGSERIAL PRIMARY KEY,
  sender_id TEXT NOT NULL,
  recipient_id TEXT NOT NULL,
  conversation_left TEXT GENERATED ALWAYS AS (LEAST(sender_id, recipient_id)) STORED,
  conversation_right TEXT GENERATED ALWAYS AS (GREATEST(sender_id, recipient_id)) STORED,
  conversation_id TEXT GENERATED ALWAYS AS (
    CASE
      WHEN sender_id < recipient_id THEN sender_id || ':' || recipient_id
      ELSE recipient_id || ':' || sender_id
    END
  ) STORED,
  body_original TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  delivered_at TIMESTAMPTZ,
  read_at TIMESTAMPTZ,
  blocked_at TIMESTAMPTZ,
  CHECK (sender_id <> recipient_id),
  FOREIGN KEY (sender_id) REFERENCES players(id) ON DELETE CASCADE,
  FOREIGN KEY (recipient_id) REFERENCES players(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_dm_conversation_created_at
  ON direct_messages (conversation_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_dm_sender_created_at
  ON direct_messages (sender_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_dm_recipient_created_at
  ON direct_messages (recipient_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_dm_participant_created_at
  ON direct_messages (conversation_left, conversation_right, created_at DESC);

COMMIT;
