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
  const incomes = data.incomes.filter(x => monthKey(x.date) === month);
  const uberActual = sum(incomes.filter(x => x.kind === 'uber' || (!x.kind && /uber/i.test(x.label ?? ''))).map(x => x.cents));
  const extraIncome = sum(incomes.filter(x => x.kind !== 'uber' && (x.kind || !/uber/i.test(x.label ?? ''))).map(x => x.cents));
  const salary = budget.salaryCents ?? budget.income ?? 0;
  const uberTarget = budget.uberTargetCents ?? 0;
  const target = budget.income == null ? (budget.target ?? 0) : salary + uberTarget - plannedPersonal;
  const realizedSavings = budget.income == null ? target + uberActual + extraIncome : salary + uberActual + extraIncome - plannedPersonal;
  const projected = realizedSavings - excessPersonal - personalReservation - projectCost;
  return {
    budget, categoryRows, commitments, personal, project, plannedPersonal, spentPersonal,
    excessPersonal, personalReservation, projectCost, reservedProject, linkedPaid, salary, uberTarget, uberActual,
    extraIncome, target, projected,
    delta: projected - target,
    monthHasFullBudget: budget.income != null && Object.keys(budget.categories).length > 0
  };
}

export function monthlySavings(data, month) {
  const s = snapshot(data, month);
  return s.projected + s.projectCost;
}

export function forecastSavings(data, month) {
  const s = snapshot(data, month);
  // An Uber target belongs in the forecast, but only logged gains belong in the available balance.
  return s.projected + s.projectCost + Math.max(0, s.uberTarget - s.uberActual);
}

export function externalForMonth(data, month) {
  return sum((data.externalFunding ?? []).filter(entry => entry.month === month).map(entry => entry.cents));
}

export function ganttTimeline(data, { forecastUber = false } = {}) {
  const blocks = [...(data.ganttBlocks ?? []), ...(data.ganttFundingEvents ?? [])];
  const projectExpenses = data.expenses.filter(expense => expense.scope === 'Calypço');
  const events = blocks.map((block, index) => {
    const linked = projectExpenses.filter(expense => expense.ganttBlockId === block.id);
    const lineOverruns = sum((block.items ?? []).map(item => Math.max(0,
      sum(linked.filter(expense => expense.ganttLineId === item.id).map(expense => expense.cents)) - item.plannedCents)));
    const extra = sum(linked.filter(expense => !expense.ganttLineId || !(block.items ?? []).some(item => item.id === expense.ganttLineId)).map(expense => expense.cents));
    const inflow = sum((block.fundingMonths ?? []).map(month =>
      (forecastUber ? forecastSavings(data, month) : monthlySavings(data, month)) + externalForMonth(data, month))) + (block.manualFundingCents ?? 0);
    return { ...block, order: block.orderHint ?? index, inflow, cost: block.plannedCents + lineOverruns + extra,
      actual: sum(linked.map(expense => expense.cents)), overrun: lineOverruns + extra };
  });
  const unassigned = projectExpenses.filter(expense => !blocks.some(block => block.id === expense.ganttBlockId));
  for (const month of [...new Set(unassigned.map(expense => monthKey(expense.date)))]) {
    const cost = sum(unassigned.filter(expense => monthKey(expense.date) === month).map(expense => expense.cents));
    events.push({ id: `extra-${month}`, kind: 'unassigned', month, label: 'Autres dépenses Calypço', phase: month,
      note: 'Dépenses non rattachées à un bloc', plannedCents: 0, items: [], inflow: 0,
      actual: cost, overrun: cost, cost, order: blocks.length });
  }
  events.sort((a, b) => a.month.localeCompare(b.month) || a.order - b.order);
  let balance = 0;
  return events.map(event => ({ ...event, balance: balance += event.inflow - event.cost }));
}

function assertCents(cents) {
  if (!Number.isSafeInteger(cents) || cents < 0) throw new Error('Saisis un montant valide.');
}

export function updateGanttLine(data, blockId, lineId, plannedCents) {
  assertCents(plannedCents);
  const block = (data.ganttBlocks ?? []).find(entry => entry.id === blockId);
  const item = block?.items?.find(entry => entry.id === lineId);
  if (!item) throw new Error('Ligne du Gantt introuvable.');
  const total = block.plannedCents + plannedCents - item.plannedCents;
  assertCents(total);
  block.plannedCents = total;
  item.plannedCents = plannedCents;
}

function preserveFunding(data, block, orderHint) {
  if (!(block.fundingMonths?.length || block.manualFundingCents)) return;
  data.ganttFundingEvents ??= [];
  data.ganttFundingEvents.push({ id: uid(), kind: 'funding', month: block.month,
    phase: 'Financement conservé', label: `Apports de ${block.label}`,
    note: 'Les économies et apports restent à leur date initiale.', plannedCents: 0, items: [],
    fundingMonths: [...(block.fundingMonths ?? [])], manualFundingCents: block.manualFundingCents ?? 0,
    orderHint });
  block.fundingMonths = [];
  block.manualFundingCents = 0;
}

export function updateGanttBlock(data, blockId, { month, label, plannedCents }) {
  assertCents(plannedCents);
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month) || !label?.trim()) throw new Error('Mois ou nom du bloc invalide.');
  const blocks = data.ganttBlocks ?? [];
  const block = blocks.find(entry => entry.id === blockId);
  if (!block) throw new Error('Bloc du Gantt introuvable.');
  if (month !== block.month) preserveFunding(data, block, blocks.indexOf(block));
  block.month = month;
  block.phase = new Intl.DateTimeFormat('fr-FR', { month: 'short', year: 'numeric', timeZone: 'UTC' }).format(new Date(`${month}-01T12:00:00Z`));
  block.label = label.trim();
  block.plannedCents = plannedCents;
}

export function removeGanttBlock(data, blockId) {
  const blocks = data.ganttBlocks ?? [];
  const index = blocks.findIndex(entry => entry.id === blockId);
  if (index < 0) throw new Error('Bloc du Gantt introuvable.');
  preserveFunding(data, blocks[index], index);
  blocks.splice(index, 1);
  for (const expense of data.expenses) if (expense.ganttBlockId === blockId) {
    expense.ganttBlockId = null;
    expense.ganttLineId = null;
  }
}

export function monthlyTable(data) {
  const events = ganttTimeline(data);
  const months = [...new Set([...Object.keys(data.budgets), ...events.map(event => event.month),
    ...(data.externalFunding ?? []).map(entry => entry.month)])].sort();
  let savingsCumulative = 0, forecastSavingsCumulative = 0, fundingCumulative = 0, spentCumulative = 0, operatingCumulative = 0;
  return months.map(month => {
    const savings = monthlySavings(data, month);
    const forecast = forecastSavings(data, month);
    const funding = externalForMonth(data, month);
    const operating = sum(events.filter(event => event.month === month).map(event => event.manualFundingCents ?? 0));
    const spent = sum(events.filter(event => event.month === month).map(event => event.cost));
    savingsCumulative += savings; forecastSavingsCumulative += forecast; fundingCumulative += funding; spentCumulative += spent; operatingCumulative += operating;
    return { month, savings, forecastSavings: forecast, funding, spent, savingsCumulative, forecastSavingsCumulative,
      totalCumulative: savingsCumulative + fundingCumulative,
      forecastTotalCumulative: forecastSavingsCumulative + fundingCumulative,
      projectBalance: savingsCumulative + fundingCumulative + operatingCumulative - spentCumulative,
      forecastProjectBalance: forecastSavingsCumulative + fundingCumulative + operatingCumulative - spentCumulative };
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
