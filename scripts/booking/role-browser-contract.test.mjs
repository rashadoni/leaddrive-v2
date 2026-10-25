import test from 'node:test';
import assert from 'node:assert/strict';
import { sandboxContract } from './role-browser-contract.mjs';

const valid = () => ({ GITHUB_ACTIONS: 'true', RUNNER_ENVIRONMENT: 'github-hosted', CI: 'true',
  BOOKING_ROLE_SANDBOX: '1', NODE_ENV: 'test', GITHUB_SHA: 'a'.repeat(40), BOOKING_ROLE_HEAD_SHA: 'b'.repeat(40),
  BOOKING_ROLE_BASE_URL: 'http://localhost:3100', ADMIN_DATABASE_URL: 'postgresql://postgres:synthetic@127.0.0.1:5432/booking_role_sandbox',
  DATABASE_URL: 'postgresql://booking_role_sandbox:synthetic@127.0.0.1:5432/booking_role_sandbox',
  EVENT_PLATFORM_TEST_DATABASE_URL: 'postgresql://postgres:synthetic@127.0.0.1:5432/booking_role_sandbox',
  AUTH_URL: 'http://localhost:3100', NEXTAUTH_URL: 'http://localhost:3100', APP_URL: 'http://localhost:3100', NEXT_PUBLIC_APP_URL: 'http://localhost:3100' });
test('accepts only the exact disposable target', () => assert.equal(sandboxContract(valid()).app.pathname, '/booking_role_sandbox'));
for (const [name, replacement] of [
  ['GITHUB_ACTIONS', 'false'], ['RUNNER_ENVIRONMENT', 'self-hosted'], ['CI', 'false'], ['BOOKING_ROLE_SANDBOX', '0'],
  ['NODE_ENV', 'production'], ['GITHUB_SHA', 'main'], ['BOOKING_ROLE_HEAD_SHA', 'abc'],
  ['BOOKING_ROLE_BASE_URL', 'https://app.leaddrivecrm.org'],
  ['BOOKING_ROLE_BASE_URL', 'http://localhost:3100/path'],
  ['ADMIN_DATABASE_URL', 'postgresql://postgres:x@13.140.132.245/booking_role_sandbox'],
  ['DATABASE_URL', 'postgresql://booking_role_sandbox:x@127.0.0.1:5432/production'],
  ['DATABASE_URL', 'postgresql://postgres:x@127.0.0.1:5432/booking_role_sandbox'],
  ['DATABASE_URL', 'postgresql://booking_role_sandbox:x@127.0.0.1:5433/booking_role_sandbox'],
  ['DATABASE_URL', 'postgresql://booking_role_sandbox:x@127.0.0.1:5432/booking_role_sandbox?schema=other'],
  ['EVENT_PLATFORM_TEST_DATABASE_URL', 'postgresql://postgres:x@127.0.0.1:5432/other'],
  ['AUTH_URL', 'https://app.leaddrivecrm.org'],
]) test(`rejects unsafe ${name}: ${replacement}`, () => assert.throws(() => sandboxContract({ ...valid(), [name]: replacement })));
