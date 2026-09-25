CREATE TABLE note (
  id UUID PRIMARY KEY,
  owner_id UUID NOT NULL,
  title VARCHAR(200) NOT NULL
);
CREATE INDEX note_owner_id_idx ON note (owner_id);
