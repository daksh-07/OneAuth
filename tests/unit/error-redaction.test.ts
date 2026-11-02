import { afterEach, expect, it, vi } from 'vitest';
import { errorResponse } from '@/lib/server/http';

afterEach(() => vi.restoreAllMocks());

it('returns a generic error and keeps sensitive exception text out of logs', async () => {
  const log = vi.spyOn(console, 'error').mockImplementation(() => {});
  const error = new Error('postgres://owner:SECRET_SENTINEL@database/private');
  error.name = 'SECRET_SENTINEL';
  const response = errorResponse(error);
  expect(response.status).toBe(500);
  expect(await response.json()).toEqual({ error: 'internal', message: 'Something went wrong. Please try again.' });
  expect(log).toHaveBeenCalledOnce();
  expect(JSON.stringify(log.mock.calls)).not.toContain('SECRET_SENTINEL');
});
