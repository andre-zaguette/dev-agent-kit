package com.example.notes;

import java.util.List;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/notes")
class NoteController {
    private final NoteService notes;

    NoteController(NoteService notes) {
        this.notes = notes;
    }

    @GetMapping
    List<Note> list(@AuthenticationPrincipal UserPrincipal user) {
        return notes.listOwned(user.id());
    }
}
