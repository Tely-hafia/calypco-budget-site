export const APPWRITE = Object.freeze({ projectId: '6abbf7c70028fd30e4a2', endpoint: 'https://fra.cloud.appwrite.io/v1' });

export const money = cents => new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR' }).format(cents / 100);
export const monthKey = date => String(date).slice(0, 7);
export const sum = values => values.reduce((total, value) => total + value, 0);
export const uid = () => globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random()}`;

export function seed() {
  return {
    version: 1,
    budgets: {}, commitments: [], expenses: [], incomes: [],
    settings: { notifications: false, reminderTimes: { matin: '08:00', midi: '12:30', soir: '20:00' } }
  };
}

export function installments(totalCents, count, firstMonth) {
  const amount = Math.floor(totalCents / count);
  return Array.from({ length: count }, (_, index) => {
    const [year, month] = firstMonth.split('-').map(Number);
    const date = new Date(Date.UTC(year, month - 1 + index, 1));
    return {
      month: date.toISOString().slice(0, 7),
      cents: index === count - 1 ? totalCents - amount * (count - 1) : amount
    };
  });
}

export function snapshot(data, month) {
  const budget = data.budgets[month] ?? { income: null, categories: {}, target: 0 };
  const personal = data.expenses.filter(x => x.scope === 'Personnel' && monthKey(x.date) === month);
  const project = data.expenses.filter(x => x.scope === 'Calypço' && monthKey(x.date) === month);
  const commitments = data.commitments.filter(x => x.month === month);
  const projectCommitments = commitments.filter(x => x.scope === 'Calypço');
  const personalCommitments = commitments.filter(x => x.scope === 'Personnel');
  const categoryRows = Object.entries(budget.categories).map(([name, planned]) => ({
    name, planned, spent: sum(personal.filter(x => x.category === name).map(x => x.cents))
  }));
  const plannedPersonal = sum(categoryRows.map(x => x.planned));
  const spentPersonal = sum(personal.map(x => x.cents));
  const personalReservation = sum(personalCommitments.map(c => Math.max(0, c.cents - sum(personal.filter(x => x.commitmentId === c.id).map(x => x.cents)))));
  const excessPersonal = sum(categoryRows.map(x => Math.max(0, x.spent - x.planned)))
    + sum(personal.filter(x => !(x.category in budget.categories)).map(x => x.cents));
  const realizedProject = sum(project.map(x => x.cents));
  const reservedProject = sum(projectCommitments.map(x => x.cents));
  const linkedPaid = sum(projectCommitments.map(c => Math.min(c.cents, sum(project.filter(x => x.commitmentId === c.id).map(x => x.cents)))));
  // A planned payment replaces its reservation. Any excess or unlinked project payment adds to it.
  const projectCost = reservedProject + realizedProject - linkedPaid;
  const extraIncome = sum(data.incomes.filter(x => monthKey(x.date) === month).map(x => x.cents));
  const target = budget.income == null ? (budget.target ?? 0) : budget.income - plannedPersonal;
  const projected = target + extraIncome - excessPersonal - personalReservation - projectCost;
  return {
    budget, categoryRows, commitments, personal, project, plannedPersonal, spentPersonal,
    excessPersonal, personalReservation, projectCost, reservedProject, linkedPaid, extraIncome, target, projected,
    delta: projected - target,
    monthHasFullBudget: budget.income != null && Object.keys(budget.categories).length > 0
  };
}

export function monthlySavings(data, month) {
  const s = snapshot(data, month);
  return s.target + s.extraIncome - s.excessPersonal - s.personalReservation;
}

export function externalForMonth(data, month) {
  return sum((data.externalFunding ?? []).filter(entry => entry.month === month).map(entry => entry.cents));
}

export function ganttTimeline(data) {
  const blocks = data.ganttBlocks ?? [];
  const projectExpenses = data.expenses.filter(expense => expense.scope === 'Calypço');
  const events = blocks.map((block, index) => {
    const linked = projectExpenses.filter(expense => expense.ganttBlockId === block.id);
    const lineOverruns = sum((block.items ?? []).map(item => Math.max(0,
      sum(linked.filter(expense => expense.ganttLineId === item.id).map(expense => expense.cents)) - item.plannedCents)));
    const extra = sum(linked.filter(expense => !expense.ganttLineId || !(block.items ?? []).some(item => item.id === expense.ganttLineId)).map(expense => expense.cents));
    const inflow = sum((block.fundingMonths ?? []).map(month => monthlySavings(data, month) + externalForMonth(data, month))) + (block.manualFundingCents ?? 0);
    return { ...block, order: index, inflow, cost: block.plannedCents + lineOverruns + extra,
      actual: sum(linked.map(expense => expense.cents)), overrun: lineOverruns + extra };
  });
  const unassigned = projectExpenses.filter(expense => !blocks.some(block => block.id === expense.ganttBlockId));
  for (const month of [...new Set(unassigned.map(expense => monthKey(expense.date)))]) {
    const cost = sum(unassigned.filter(expense => monthKey(expense.date) === month).map(expense => expense.cents));
    events.push({ id: `extra-${month}`, month, label: 'Autres dépenses Calypço', phase: month,
      note: 'Dépenses non rattachées à un bloc', plannedCents: 0, items: [], inflow: 0,
      actual: cost, overrun: cost, cost, order: blocks.length });
  }
  events.sort((a, b) => a.month.localeCompare(b.month) || a.order - b.order);
  let balance = 0;
  return events.map(event => ({ ...event, balance: balance += event.inflow - event.cost }));
}

export function monthlyTable(data) {
  const events = ganttTimeline(data);
  const months = [...new Set([...Object.keys(data.budgets), ...events.map(event => event.month),
    ...(data.externalFunding ?? []).map(entry => entry.month)])].sort();
  let savingsCumulative = 0, fundingCumulative = 0, spentCumulative = 0, operatingCumulative = 0;
  return months.map(month => {
    const savings = monthlySavings(data, month);
    const funding = externalForMonth(data, month);
    const operating = sum(events.filter(event => event.month === month).map(event => event.manualFundingCents ?? 0));
    const spent = sum(events.filter(event => event.month === month).map(event => event.cost));
    savingsCumulative += savings; fundingCumulative += funding; spentCumulative += spent; operatingCumulative += operating;
    return { month, savings, funding, spent, savingsCumulative,
      totalCumulative: savingsCumulative + fundingCumulative,
      projectBalance: savingsCumulative + fundingCumulative + operatingCumulative - spentCumulative };
  });
}

export function addExpense(data, input) {
  const cents = Math.round(Number(input.amount) * 100);
  if (!Number.isSafeInteger(cents) || cents <= 0) throw new Error('Saisis un montant positif.');
  const count = Number(input.count || 1);
  if (!Number.isInteger(count) || count < 1 || count > 36) throw new Error('Choisis de 1 à 36 échéances.');
  const date = input.date;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(Date.parse(`${date}T12:00:00Z`))) throw new Error('Date invalide.');
  const group = uid();
  const parts = installments(cents, count, monthKey(date));
  const first = parts[0];
  const commitmentId = count === 1 ? (input.commitmentId || null) : `${group}-1`;
  if (count > 1) data.commitments.push(...parts.map((part, index) => ({
    id: `${group}-${index + 1}`, group, month: part.month,
    label: `${input.description || input.category} · ${index + 1}/${count}`,
    scope: input.scope, category: input.category, cents: part.cents
  })));
  const expense = { id: uid(), date, scope: input.scope, category: input.category,
    description: input.description || '', method: input.method || '', cents: first.cents, commitmentId,
    ganttBlockId: input.scope === 'Calypço' ? (input.ganttBlockId || null) : null,
    ganttLineId: input.scope === 'Calypço' ? (input.ganttLineId || null) : null };
  data.expenses.push(expense);
  return expense;
}
