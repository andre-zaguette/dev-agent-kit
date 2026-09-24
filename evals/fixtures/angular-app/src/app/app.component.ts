import { Component } from '@angular/core';
import { ButtonComponent } from './shared/button/button.component';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [ButtonComponent],
  template: `<main><h1>Acme</h1><app-button href="/about">Sobre</app-button></main>`
})
export class AppComponent {}
