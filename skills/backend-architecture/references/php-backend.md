---
name: php-backend
description: Baseline conventions for modern PHP backend work: strict types, typed code, Composer, PSR standards and static analysis.
status: baseline
---

## Princípio

Write PHP 8 as a typed language: strict types, typed properties, enums and readonly value objects, autoload with Composer (PSR-4), and let the project's own scripts define how tests and static analysis run.

## Quando aplicar

Any PHP backend with a `composer.json`, with or without a framework. Load the framework reference (for example `laravel.md`) as well.

## Quando não aplicar

Template-only or front-end PHP tasks. Do not introduce PHPStan, Psalm, a formatter or a new dependency the project does not already use.

## Exemplo

```php
<?php

declare(strict_types=1);

namespace App\Billing;

final readonly class Money
{
    public function __construct(public int $cents, public string $currency)
    {
        if ($cents < 0) {
            throw new \InvalidArgumentException('cents must not be negative');
        }
    }
}

final class InvoiceService
{
    public function __construct(private readonly InvoiceRepository $invoices, private readonly Clock $clock) {}

    public function markSent(int $invoiceId): void
    {
        $invoice = $this->invoices->get($invoiceId);
        $invoice->markSent($this->clock->now()); // idempotent inside the entity
        $this->invoices->save($invoice);
    }
}
```

Use `composer test`/`composer lint` when the manifest defines them, otherwise the tools the manifest requires (`vendor/bin/phpunit`, `vendor/bin/pint`, `vendor/bin/phpstan`). Never build SQL, shell commands or file paths from input; use prepared statements and allowlists. Keep secrets in environment variables, not in the repository.

## Fonte

PHP manual (language reference), PHP-FIG PSR-4 and PSR-12; refined per project tooling.
