import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { createApp } from '../src/app';

describe('GET /notes', () => {
  it('requires authentication', async () => {
    const res = await request(createApp()).get('/notes');
    expect(res.status).toBe(401);
  });
});
