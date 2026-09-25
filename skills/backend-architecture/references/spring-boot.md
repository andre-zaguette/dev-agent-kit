---
name: spring-boot
description: Baseline conventions for Spring Boot services: layered controllers, Bean Validation, ProblemDetail, method security, Spring Data JPA and migrations.
status: baseline
---

## Princípio

Layer the service (controller, service, repository), inject with constructors, validate request DTOs with Bean Validation, map exceptions to `ProblemDetail` in one advice, secure methods, and put transaction boundaries on services.

## Quando aplicar

Projects whose build depends on `spring-boot`. Load `java.md` for language conventions and the database reference (`postgresql.md`, `mysql.md` or `sqlserver.md`).

## Quando não aplicar

Non-Spring Java projects. Do not add Lombok, MapStruct or Testcontainers if the build does not already use them.

## Exemplo

```java
@RestController
@RequestMapping("/notes")
class NoteController {
    private final NoteService notes;

    NoteController(NoteService notes) { this.notes = notes; }

    @PostMapping("/{id}/archive")
    @PreAuthorize("hasAuthority('notes:write')")
    ResponseEntity<Void> archive(@PathVariable UUID id, @AuthenticationPrincipal UserPrincipal user) {
        return notes.archive(id, user.id()) ? ResponseEntity.ok().build() : ResponseEntity.notFound().build();
    }
}

@Service
class NoteService {
    @Transactional
    boolean archive(UUID id, UUID userId) {
        return notes.findByIdAndOwnerId(id, userId).map(n -> { n.archive(clock.instant()); return true; }).orElse(false);
    }
}

@RestControllerAdvice
class ApiErrors {
    @ExceptionHandler(ConstraintViolationException.class)
    ProblemDetail invalid(ConstraintViolationException e) {
        var problem = ProblemDetail.forStatusAndDetail(HttpStatus.BAD_REQUEST, "Invalid input");
        problem.setProperty("code", "INVALID_INPUT");
        return problem;
    }
}
```

Avoid N+1 with `@EntityGraph` or `join fetch`, and project to DTOs for reads. Manage schema with Flyway or Liquibase and never edit an applied migration. Bind settings with `@ConfigurationProperties` and take secrets from the environment. Test slices with `@WebMvcTest` and `@DataJpaTest`.

## Fonte

Spring Boot and Spring Data reference documentation (web, validation, security, data access, testing); refined per project conventions.
