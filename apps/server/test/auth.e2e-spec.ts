import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { ADMIN_EMAIL, ADMIN_PASSWORD, createTestApp, login } from './helpers';

describe('Auth (e2e)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    app = await createTestApp();
  });

  afterAll(async () => {
    await app.close();
  });

  it('GET /api/health is public', () =>
    request(app.getHttpServer())
      .get('/api/health')
      .expect(200)
      .expect({ status: 'ok' }));

  it('rejects a wrong password', () =>
    request(app.getHttpServer())
      .post('/api/auth/login')
      .send({ email: ADMIN_EMAIL, password: 'wrong' })
      .expect(401));

  it('rejects a wrong email', () =>
    request(app.getHttpServer())
      .post('/api/auth/login')
      .send({ email: 'nobody@test.local', password: ADMIN_PASSWORD })
      .expect(401));

  it('rejects a malformed body with 400', () =>
    request(app.getHttpServer())
      .post('/api/auth/login')
      .send({ email: 'not-an-email' })
      .expect(400));

  it('issues a token for valid credentials and authorizes /auth/me', async () => {
    const token = await login(app);
    expect(token.length).toBeGreaterThan(20);
    const res = await request(app.getHttpServer())
      .get('/api/auth/me')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    expect(res.body).toEqual({ email: ADMIN_EMAIL });
  });

  it('guards routes without a token', () =>
    request(app.getHttpServer()).get('/api/themes').expect(401));

  it('guards routes with a garbage token', () =>
    request(app.getHttpServer())
      .get('/api/themes')
      .set('Authorization', 'Bearer garbage')
      .expect(401));
});
