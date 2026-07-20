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

  async login(
    email: string,
    password: string,
  ): Promise<{ accessToken: string }> {
    const adminEmail = this.config.get('ADMIN_EMAIL', { infer: true });
    const passwordHash = this.config.get('ADMIN_PASSWORD_HASH', {
      infer: true,
    });

    const emailMatches = email === adminEmail;
    const passwordMatches = await compare(password, passwordHash);
    if (!emailMatches || !passwordMatches) {
      throw new UnauthorizedException('Invalid credentials');
    }

    const accessToken = await this.jwtService.signAsync({ sub: 'admin' });
    return { accessToken };
  }

  adminEmail(): string {
    return this.config.get('ADMIN_EMAIL', { infer: true });
  }
}
