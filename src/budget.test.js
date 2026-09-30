import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { addExpense, ganttTimeline, installments, monthlySavings, monthlyTable, removeGanttBlock, seed, updateGanttBlock, updateGanttLine } from './budget.js';

const example = () => {
  const data = seed();
  data.budgets['2026-10'] = { income: 200000, categories: { Nourriture: 10000 } };
  data.budgets['2026-11'] = { income: 150000, categories: { Nourriture: 50000 } };
  data.externalFunding = [{ id: 'f', month: '2026-10', label: 'Apport', cents: 50000 }];
  data.ganttBlocks = [
    { id: 'b1', month: '2026-10', label: 'Piscine', plannedCents: 30000, fundingMonths: ['2026-10'], items: [{ id: 'l1', label: 'Carreau', plannedCents: 30000 }] },
    { id: 'b2', month: '2026-11', label: 'Plateforme', plannedCents: 40000, fundingMonths: ['2026-11'], items: [] }
  ];
  return data;
};

test('une dépense personnelle prévue entame le poste sans déduire deux fois l’économie', () => {
  const data = example();
  addExpense(data, { amount: '75', date: '2026-10-05', scope: 'Personnel', category: 'Nourriture' });
  assert.equal(monthlySavings(data, '2026-10'), 190000);
  addExpense(data, { amount: '50', date: '2026-10-06', scope: 'Personnel', category: 'Nourriture' });
  assert.equal(monthlySavings(data, '2026-10'), 187500);
  assert.equal(ganttTimeline(data)[0].balance, 207500);
  assert.equal(ganttTimeline(data)[1].balance, 267500);
});

test('une ligne payée et une dépense ajoutée affectent les blocs suivants', () => {
  const data = example();
  addExpense(data, { amount: '250', date: '2026-10-05', scope: 'Calypço', category: 'Piscine', ganttBlockId: 'b1', ganttLineId: 'l1' });
  assert.equal(ganttTimeline(data)[0].cost, 30000);
  addExpense(data, { amount: '100', date: '2026-10-06', scope: 'Calypço', category: 'Piscine', ganttBlockId: 'b1' });
  assert.equal(ganttTimeline(data)[0].cost, 40000);
  assert.equal(ganttTimeline(data)[1].balance, 260000);
  assert.equal(monthlyTable(data)[0].projectBalance, 200000);
});

test('les centimes du dernier paiement préservent le montant total', () => {
  assert.deepEqual(installments(52000, 3, '2026-10'), [
    { month: '2026-10', cents: 17333 }, { month: '2026-11', cents: 17333 }, { month: '2026-12', cents: 17334 }
  ]);
});

test('le nouveau prix du ciment change le bloc et tous les soldes suivants', () => {
  const data = example();
  updateGanttLine(data, 'b1', 'l1', 35000);
  assert.equal(data.ganttBlocks[0].plannedCents, 35000);
  assert.equal(ganttTimeline(data)[0].cost, 35000);
  assert.equal(ganttTimeline(data)[1].balance, 265000);
});

test('décaler ou retirer un bloc conserve ses apports à la date initiale', () => {
  const data = example();
  updateGanttBlock(data, 'b1', { month: '2026-12', label: 'Piscine reportée', plannedCents: 30000 });
  assert.equal(ganttTimeline(data).find(x => x.month === '2026-10').inflow, 240000);
  assert.equal(monthlyTable(data).find(x => x.month === '2026-10').projectBalance, 240000);
  assert.equal(ganttTimeline(data).at(-1).balance, 270000);
  removeGanttBlock(data, 'b1');
  assert.equal(ganttTimeline(data).at(-1).balance, 300000);
  assert.equal(monthlyTable(data).find(x => x.month === '2026-10').projectBalance, 240000);
});
