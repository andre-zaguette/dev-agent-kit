package com.example.notes;

import java.util.List;
import java.util.UUID;
import org.springframework.stereotype.Service;

@Service
public class NoteService {
    private final NoteRepository notes;

    public NoteService(NoteRepository notes) {
        this.notes = notes;
    }

    public List<Note> listOwned(UUID ownerId) {
        return notes.findByOwnerIdOrderByTitle(ownerId);
    }
}
