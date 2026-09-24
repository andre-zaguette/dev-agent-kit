---
name: angular
description: Baseline conventions for implementing Figma designs in Angular.
status: baseline
---

## Princípio

Prefer standalone components over NgModules for new UI (current Angular default); keep templates declarative, push data-fetching into services/resolvers rather than component constructors; use `@Input()`/`@Output()` with explicit types for component contracts.

## Quando aplicar

Projects whose `package.json` lists `@angular/core` as a dependency.

## Quando não aplicar

Non-Angular projects — see the matching stack reference instead.

## Exemplo

```ts
@Component({
  selector: 'app-card',
  standalone: true,
  template: `
    <article class="card">
      <h3 class="card__title">{{ title }}</h3>
      <p class="card__description">{{ description }}</p>
      <button class="card__action" type="button" (click)="select.emit()">
        Select
      </button>
    </article>
  `
})
export class CardComponent {
  @Input({ required: true }) title!: string;
  @Input({ required: true }) description!: string;
  @Output() select = new EventEmitter<void>();
}
```

## Fonte

Angular docs (standalone components, current recommended patterns); refined per-project via auto-bootstrap.
