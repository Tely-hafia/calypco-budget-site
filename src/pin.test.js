import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { makePinRecord, validPin, verifyPin } from './pin.js';

test('le PIN local ne mémorise pas le code et reste lié au compte', async () => {
  assert.equal(validPin('031994'), false);
  assert.equal(validPin('123456'), false);
  const record = await makePinRecord('826539', 'compte-A');
  assert.equal(JSON.stringify(record).includes('826539'), false);
  assert.equal(await verifyPin('826539', 'compte-A', record), true);
  assert.equal(await verifyPin('826538', 'compte-A', record), false);
  assert.equal(await verifyPin('826539', 'compte-B', record), false);
});
