export interface Note {
  id: number;
  ownerId: number;
  title: string;
}

const store: Note[] = [];

export const notes = {
  async listOwned(ownerId: number): Promise<Note[]> {
    return store.filter((n) => n.ownerId === ownerId);
  }
};
