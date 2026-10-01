/**
 * Request-shape tests for the two prologue routes (Phase 14, plan 14-01, R36):
 * both run Sonnet 5.5 at 'low' effort and send no `system` key at all. Also
 * pins that the pre-existing routes' effort did not move.
 *
 * Same mock boundary as anthropic.test.ts: spy on
 * `Anthropic.Messages.prototype.create`, so the real helper builds the real
 * request. Nothing reaches the network; the key below is a fake.
 */

import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import Anthropic from '@anthropic-ai/sdk';
import type { Message } from '@anthropic-ai/sdk/resources/messages';
import { z } from 'zod';
import { PrologueNarrationSchema, PrologueProfileSchema } from '@soulbound/shared';
import { callWorldVoice, type WorldVoiceRoute } from '../anthropic.js';

const FAKE_KEY = 'sk-ant-test-fake-key-never-sent-mocked-only';
const FAKE_PASSPHRASE = 'test-passphrase-not-real';

const TrivialSchema = z.strictObject({ answer: z.string() });

function makeMessage(model: string, payload: unknown): Message {
  return {
    id: 'msg_test_0001',
    type: 'message',
    role: 'assistant',
    model,
    content: [{ type: 'text', text: JSON.stringify(payload), citations: null }],
    stop_reason: 'end_turn',
    stop_sequence: null,
    usage: {
      input_tokens: 100,
      output_tokens: 50,
      cache_creation_input_tokens: 0,
      cache_read_input_tokens: 0,
      cache_creation: null,
      server_tool_use: null,
      service_tier: null,
    },
  } as Message;
}

describe('prologue routes request shape', () => {
  let createSpy: ReturnType<typeof vi.spyOn>;

  beforeAll(() => {
    process.env.ANTHROPIC_API_KEY = FAKE_KEY;
    process.env.SOULBOUND_PASSPHRASE = FAKE_PASSPHRASE;
  });

  beforeEach(() => {
    createSpy = vi.spyOn(Anthropic.Messages.prototype, 'create');
  });

  afterEach(() => {
    createSpy.mockRestore();
  });

  async function capture(
    route: WorldVoiceRoute,
    model: string,
    useSystem: boolean,
    schema: z.ZodType,
    payload: unknown,
  ) {
    createSpy.mockResolvedValueOnce(makeMessage(model, payload));
    await callWorldVoice({ route, model, content: 'x', useSystem, schema });
    expect(createSpy).toHaveBeenCalledTimes(1);
    return createSpy.mock.calls[0]![0] as Record<string, any>;
  }

  it.each([
    ['prologueBeat', PrologueNarrationSchema, { narration: 'The dark moves.' }],
    [
      'prologueProfile',
      PrologueProfileSchema,
      { nature: 'a', drive: 'b', flaw: 'c', memory: 'd', bond: 'e' },
    ],
  ] as const)('%s runs sonnet-5-5 at low, system-free, one user message', async (route, schema, payload) => {
    const { MODELS } = await import('../config.js');
    const request = await capture(route, MODELS[route], false, schema, payload);

    expect(request.output_config.effort).toBe('low');
    expect('system' in request).toBe(false);
    expect(request.max_tokens).toBe(16000);
    expect(request.model).toBe('claude-sonnet-5-5');
    expect('budget_tokens' in request.output_config).toBe(false);
    expect(request.messages).toHaveLength(1);
    expect(request.messages[0].role).toBe('user');
  });

  it.each([
    ['worldEngine', true],
    ['introScene', true],
    ['uniqueSkill', false],
  ] as const)('%s effort is still medium', async (route, useSystem) => {
    const { MODELS } = await import('../config.js');
    const request = await capture(route, MODELS[route], useSystem, TrivialSchema, { answer: 'x' });
    expect(request.output_config.effort).toBe('medium');
  });
});
