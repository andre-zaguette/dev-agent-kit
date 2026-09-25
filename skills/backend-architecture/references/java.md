---
name: java
description: Baseline conventions for Java backend work: modern language features, constructor injection, immutability, build tooling and tests.
status: baseline
---

## Princípio

Write Java 17+ in its modern style: records for data, immutability by default, constructor injection, `Optional` only at API boundaries, and the project's Maven or Gradle wrapper as the source of truth for building and testing.

## Quando aplicar

Any Java backend with a `pom.xml` or `build.gradle(.kts)`, with or without Spring. Load `spring-boot.md` for Spring projects.

## Quando não aplicar

Android projects. Do not add Lombok, MapStruct or a new test library the build does not already use; follow the project's exception policy.

## Exemplo

```java
public record ArchiveNote(UUID noteId, UUID userId) {}

public final class NoteService {
    private final NoteRepository notes;
    private final Clock clock;

    public NoteService(NoteRepository notes, Clock clock) {
        this.notes = notes;
        this.clock = clock;
    }

    public boolean archive(ArchiveNote command) {
        return notes.findOwned(command.noteId(), command.userId())
                .map(note -> {
                    note.archiveAt(clock.instant()); // idempotent inside the entity
                    notes.save(note);
                    return true;
                })
                .orElse(false);
    }
}
```

Run `./mvnw test` or `./gradlew test` (the wrapper when present). Close resources with try-with-resources, never swallow exceptions, and keep configuration and secrets outside the code. Test with JUnit 5 and the assertion/mocking libraries already in the build.

## Fonte

Java language documentation and effective-Java style guidance; refined per project build files.
