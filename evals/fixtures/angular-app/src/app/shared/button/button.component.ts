import { Component, Input } from '@angular/core';

@Component({
  selector: 'app-button',
  standalone: true,
  template: `<a [attr.href]="href" class="btn btn--primary"><ng-content /></a>`
})
export class ButtonComponent {
  @Input({ required: true }) href!: string;
}
