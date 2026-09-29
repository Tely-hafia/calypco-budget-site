import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { addExpense, installments, seed, snapshot } from './budget.js';

test('le budget d’octobre réserve le billet et les accessoires une seule fois', () => {
  const data = seed();
  data.budgets['2026-10'] = { income: 200000, target: 50000, categories: { Nourriture: 10000 } };
  data.commitments.push({ id: 'slide-accessories', month: '2026-10', label: 'Accessoires', scope: 'Calypço', category: 'Toboggan', cents: 27500 });
  assert.equal(snapshot(data, '2026-10').projected, 22500);
  addExpense(data, { amount: '275', date: '2026-10-05', scope: 'Calypço', category: 'Toboggan', commitmentId: 'slide-accessories' });
  assert.equal(snapshot(data, '2026-10').projected, 22500);
});

test('les dépassements personnels affectent Calypço, pas les achats prévus dans la limite', () => {
  const data = seed();
  data.budgets['2026-10'] = { income: 200000, target: 50000, categories: { Nourriture: 10000 } };
  addExpense(data, { amount: '75', date: '2026-10-03', scope: 'Personnel', category: 'Nourriture' });
  assert.equal(snapshot(data, '2026-10').projected, 50000);
  addExpense(data, { amount: '50', date: '2026-10-04', scope: 'Personnel', category: 'Nourriture' });
  assert.equal(snapshot(data, '2026-10').projected, 47500);
});

test('les centimes du dernier paiement préservent le montant total', () => {
  assert.deepEqual(installments(52000, 3, '2026-10'), [
    { month: '2026-10', cents: 17333 }, { month: '2026-11', cents: 17333 }, { month: '2026-12', cents: 17334 }
  ]);
});
