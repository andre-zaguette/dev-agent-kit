import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { CreateUserDto } from './create-user.dto';

export interface User {
  id: string;
  email: string;
  name: string;
  active: boolean;
}

@Injectable()
export class UsersService {
  private readonly users = new Map<string, User>();

  create(dto: CreateUserDto): User {
    if ([...this.users.values()].some((u) => u.email === dto.email)) throw new ConflictException({ code: 'EMAIL_ALREADY_EXISTS' });
    const user: User = { id: String(this.users.size + 1), ...dto, active: true };
    this.users.set(user.id, user);
    return user;
  }

  get(id: string): User {
    const user = this.users.get(id);
    if (!user) throw new NotFoundException({ code: 'USER_NOT_FOUND' });
    return user;
  }
}
