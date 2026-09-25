CREATE TABLE notes (
  id SERIAL PRIMARY KEY,
  owner_id INTEGER NOT NULL,
  title VARCHAR(200) NOT NULL
);
CREATE INDEX notes_owner_id_idx ON notes (owner_id);
