import test from 'node:test';
import assert from 'node:assert/strict';
import { clamp } from '../src/clamp.js';

test('RF-1: devuelve n cuando está dentro del rango', () => {
  assert.equal(clamp(5, 0, 10), 5);
});

test('RF-1: exporta una función invocable', () => {
  assert.equal(typeof clamp, 'function');
});

test('RF-2: acota por debajo de min', () => {
  assert.equal(clamp(-3, 0, 10), 0);
});

test('RF-3: acota por encima de max', () => {
  assert.equal(clamp(42, 0, 10), 10);
});

test('RF-1: devuelve n cuando es igual a min', () => {
  assert.equal(clamp(0, 0, 10), 0);
});

test('RF-1: devuelve n cuando es igual a max', () => {
  assert.equal(clamp(10, 0, 10), 10);
});
