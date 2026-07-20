import { Body, Controller, Get, HttpCode, Post } from '@nestjs/common';
import { z } from 'zod';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { AuthService } from './auth.service';
import { Public } from './public.decorator';

const LoginInputSchema = z.object({
  email: z.email(),
  password: z.string().min(1),
});
type LoginInput = z.infer<typeof LoginInputSchema>;

@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Public()
  @Post('login')
  @HttpCode(200)
  login(@Body(new ZodValidationPipe(LoginInputSchema)) input: LoginInput) {
    return this.authService.login(input.email, input.password);
  }

  @Get('me')
  me() {
    return { email: this.authService.adminEmail() };
  }
}
