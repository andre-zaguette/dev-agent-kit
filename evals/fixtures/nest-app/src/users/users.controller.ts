import { Body, Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import { RolesGuard, Roles } from '../auth/roles.guard';
import { CreateUserDto } from './create-user.dto';
import { UsersService } from './users.service';

@Controller('users')
export class UsersController {
  constructor(private readonly users: UsersService) {}

  @Post()
  @UseGuards(RolesGuard)
  @Roles('admin')
  create(@Body() dto: CreateUserDto) {
    return this.users.create(dto);
  }

  @Get(':id')
  get(@Param('id') id: string) {
    return this.users.get(id);
  }
}
