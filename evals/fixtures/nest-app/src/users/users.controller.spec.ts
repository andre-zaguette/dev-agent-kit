import { Test } from '@nestjs/testing';
import { UsersController } from './users.controller';
import { UsersService } from './users.service';

describe('UsersController', () => {
  it('creates and reads a user', async () => {
    const module = await Test.createTestingModule({ controllers: [UsersController], providers: [UsersService] }).compile();
    const controller = module.get(UsersController);
    const created = controller.create({ email: 'a@example.test', name: 'Ana' });
    expect(controller.get(created.id).email).toBe('a@example.test');
  });
});
