import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { aiChat, AiError, textPart, imagePart } from './client';
import { AiConfig } from './types';

const config: AiConfig = {
  enabled: true, provider: 'openrouter', baseUrl: 'https://api.test/v1',
  model: 'test-model', visionModel: 'test-vision', apiKey: 'sk-test', fromEnv: false
};

const realFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = realFetch; });

function stubFetch(handler: (url: string, init: any) => { status?: number; body: any }) {
  globalThis.fetch = (async (url: any, init: any) => {
    const { status = 200, body } = handler(String(url), init);
    return {
      ok: status >= 200 && status < 300,
      status,
      json: async () => body,
      text: async () => JSON.stringify(body)
    } as any;
  }) as any;
}

test('posts to {baseUrl}/chat/completions with a bearer token', async () => {
  let seenUrl = '';
  let seenInit: any = null;
  stubFetch((url, init) => {
    seenUrl = url; seenInit = init;
    return { body: { choices: [{ message: { content: 'hello' } }], model: 'test-model' } };
  });

  const result = await aiChat(config, [{ role: 'user', content: 'hi' }]);

  assert.equal(seenUrl, 'https://api.test/v1/chat/completions');
  assert.equal(seenInit.method, 'POST');
  assert.equal(seenInit.headers.Authorization, 'Bearer sk-test');
  assert.equal(seenInit.headers['Content-Type'], 'application/json');
  const sent = JSON.parse(seenInit.body);
  assert.equal(sent.model, 'test-model');
  assert.deepEqual(sent.messages, [{ role: 'user', content: 'hi' }]);
  assert.equal(result.text, 'hello');
  assert.equal(result.model, 'test-model');
});

test('an options.model overrides the config model', async () => {
  let sent: any = null;
  stubFetch((_url, init) => {
    sent = JSON.parse(init.body);
    return { body: { choices: [{ message: { content: 'ok' } }] } };
  });
  await aiChat(config, [{ role: 'user', content: 'hi' }], { model: 'other-model' });
  assert.equal(sent.model, 'other-model');
});

test('omits the Authorization header when there is no key (local endpoints)', async () => {
  let seenInit: any = null;
  stubFetch((_url, init) => {
    seenInit = init;
    return { body: { choices: [{ message: { content: 'ok' } }] } };
  });
  await aiChat({ ...config, apiKey: '' }, [{ role: 'user', content: 'hi' }]);
  assert.equal(seenInit.headers.Authorization, undefined);
});

test('throws an AiError carrying the status and the provider message', async () => {
  stubFetch(() => ({ status: 401, body: { error: { message: 'Invalid API key' } } }));
  await assert.rejects(
    () => aiChat(config, [{ role: 'user', content: 'hi' }]),
    (err: AiError) => {
      assert.equal(err.status, 401);
      assert.match(err.message, /Invalid API key/);
      return true;
    }
  );
});

test('returns an empty string when the provider sends no choices', async () => {
  stubFetch(() => ({ body: { choices: [] } }));
  const result = await aiChat(config, [{ role: 'user', content: 'hi' }]);
  assert.equal(result.text, '');
});

test('sends multimodal content parts unchanged', async () => {
  let sent: any = null;
  stubFetch((_url, init) => {
    sent = JSON.parse(init.body);
    return { body: { choices: [{ message: { content: 'ok' } }] } };
  });
  await aiChat(config, [{
    role: 'user',
    content: [textPart('what is this'), imagePart('data:image/jpeg;base64,AAAA')]
  }]);
  assert.equal(sent.messages[0].content[0].type, 'text');
  assert.equal(sent.messages[0].content[1].type, 'image_url');
  assert.equal(sent.messages[0].content[1].image_url.url, 'data:image/jpeg;base64,AAAA');
});
