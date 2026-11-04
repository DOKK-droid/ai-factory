import test from 'node:test';
import assert from 'node:assert/strict';
import { clamp } from '../src/clamp.js';

test('devuelve el valor dentro del rango', () => {
  assert.equal(clamp(5, 1, 10), 5);
});

test('devuelve min cuando el valor está por debajo', () => {
  assert.equal(clamp(-3, 1, 10), 1);
});

test('devuelve max cuando el valor está por encima', () => {
  assert.equal(clamp(42, 1, 10), 10);
});

test('conserva el valor igual a min', () => {
  assert.equal(clamp(1, 1, 10), 1);
});

test('conserva el valor igual a max', () => {
  assert.equal(clamp(10, 1, 10), 10);
});
