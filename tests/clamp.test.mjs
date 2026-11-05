import test from 'node:test';
import assert from 'node:assert/strict';
import { clamp } from '../src/clamp.js';

test('RF-1: clamp devuelve el valor cuando está dentro del rango', () => {
  assert.equal(clamp(5, 1, 10), 5);
});

test('RF-1: clamp acota por debajo de min', () => {
  assert.equal(clamp(-3, 1, 10), 1);
});

test('RF-1: clamp acota por encima de max', () => {
  assert.equal(clamp(42, 1, 10), 10);
});

test('RF-2: clamp lanza RangeError cuando min > max', () => {
  assert.throws(() => clamp(5, 10, 1), {
    name: 'RangeError',
    message: /min.*max/i,
  });
});
