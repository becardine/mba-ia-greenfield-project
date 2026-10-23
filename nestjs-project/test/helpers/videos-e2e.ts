import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { ThrottlerStorage, ThrottlerStorageService } from '@nestjs/throttler';
import request from 'supertest';
import { App } from 'supertest/types';
import { DataSource } from 'typeorm';
import { AppModule } from '../../src/app.module';
import { DomainExceptionFilter } from '../../src/common/filters/domain-exception.filter';
import { ValidationExceptionFilter } from '../../src/common/filters/validation-exception.filter';
import { User } from '../../src/users/entities/user.entity';

export interface ApiErrorBody {
  statusCode: number;
  error: string;
  message: string | string[];
}

export interface VideosTestApp {
  app: INestApplication<App>;
  dataSource: DataSource;
  throttlerStorage: ThrottlerStorageService;
}

// S3_PUBLIC_ENDPOINT and QUEUE_PREFIX are overridden for every test run by
// src/test/test-env.setup.ts (Jest setupFiles).
export async function createVideosTestApp(): Promise<VideosTestApp> {
  const moduleFixture = await Test.createTestingModule({
    imports: [AppModule],
  }).compile();

  const app = moduleFixture.createNestApplication<INestApplication<App>>();
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );
  app.useGlobalFilters(
    new DomainExceptionFilter(),
    new ValidationExceptionFilter(),
  );
  await app.init();

  return {
    app,
    dataSource: moduleFixture.get(DataSource),
    throttlerStorage:
      moduleFixture.get<ThrottlerStorageService>(ThrottlerStorage),
  };
}

let userCounter = 0;

/** Registers a user, confirms it directly in the DB and returns an access token. */
export async function signUpAndLogin(
  ctx: VideosTestApp,
  prefix = 'videos',
): Promise<string> {
  const email = `${prefix}_${Date.now()}_${++userCounter}@example.com`;
  const password = 'password123';
  const server = ctx.app.getHttpServer();

  ctx.throttlerStorage.storage.clear();
  await request(server)
    .post('/auth/register')
    .send({ email, password })
    .expect(201);
  await ctx.dataSource
    .getRepository(User)
    .update({ email }, { is_confirmed: true });
  const res = await request(server)
    .post('/auth/login')
    .send({ email, password })
    .expect(200);
  ctx.throttlerStorage.storage.clear();

  return (res.body as { access_token: string }).access_token;
}

export function errorOf(res: request.Response): string {
  return (res.body as ApiErrorBody).error;
}

export async function putBytes(url: string, size: number): Promise<Response> {
  return fetch(url, { method: 'PUT', body: new Uint8Array(size) });
}
