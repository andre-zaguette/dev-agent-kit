<?php

namespace Tests\Feature;

use Tests\TestCase;

class NoteTest extends TestCase
{
    public function test_listing_notes_requires_authentication(): void
    {
        $this->getJson('/api/notes')->assertUnauthorized();
    }
}
