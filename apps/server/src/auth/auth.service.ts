import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { compare } from 'bcryptjs';
import type { Env } from '../config/env';

@Injectable()
export class AuthService {
  constructor(
    private readonly config: ConfigService<Env, true>,
    private readonly jwtService: JwtService,
  ) {}

  async login(id: string, password: string): Promise<{ accessToken: string }> {
    const adminId = this.config.get('ADMIN_ID', { infer: true });
    const passwordHash = this.config.get('ADMIN_PASSWORD_HASH', {
      infer: true,
    });

    const idMatches = id === adminId;
    const passwordMatches = await compare(password, passwordHash);
    if (!idMatches || !passwordMatches) {
      throw new UnauthorizedException('Invalid credentials');
    }

    const accessToken = await this.jwtService.signAsync({ sub: 'admin' });
    return { accessToken };
  }

  adminId(): string {
    return this.config.get('ADMIN_ID', { infer: true });
  }
}
