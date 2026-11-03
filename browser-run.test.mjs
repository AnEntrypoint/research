import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { sessionIdFrom } = require('./browser-run.js');

test('sessionIdFrom reads the labelled session line', () => {
    const text = 'Waiting for extension to connect...\nExtension connected\nSession 3 created. Use with: playwriter -s 3 -e "..."\n';
    assert.equal(sessionIdFrom(text), '3');
});

test('sessionIdFrom falls back to a bare session id line', () => {
    assert.equal(sessionIdFrom('\nabc-123\n'), 'abc-123');
});

test('sessionIdFrom returns undefined when no session was created', () => {
    assert.equal(sessionIdFrom('Waiting for extension to connect...\nTip: run playwriter skill\n'), undefined);
});
