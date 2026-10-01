import './style.css';
import { currentUser, signIn, signOut, readBudget, writeBudget } from './cloud.js';
import { addExpense, ganttTimeline, money, monthKey, monthlySavings, monthlyTable, removeGanttBlock, seed, snapshot, uid, updateGanttBlock, updateGanttLine } from './budget.js';
import { makePinRecord, verifyPin } from './pin.js';

const STORAGE = 'calypco-budget-v2';
const projectCategories = ['Voyage Guinée', 'Piscine', 'Toboggan', 'Plateforme', 'Plomberie', 'Électricité', 'Carrelage', 'Main-d’œuvre', 'Transport', 'Matériaux', 'Administratif', 'Autres travaux'];
const today = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
const safe = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
const prettyMonth = key => new Intl.DateTimeFormat('fr-FR', { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(new Date(`${key}-01T12:00:00Z`));
let data = seed();
let user = null;
let syncError = '';
let pendingSync = Promise.resolve();
let locked = false;
let pinFailures = 0;
let retryAt = 0;
let hiddenAt = 0;
let month = monthKey(today()) < '2026-10' ? '2026-10' : monthKey(today());
let view = 'accueil';
let dialog = false;
let selectedBlock = '';
let selectedCategory = '';
let expandedBlocks = new Set();
let matrixPosition = { left: 0, top: 0 };
let matrixInitialized = false;
const app = document.querySelector('#app');
localStorage.removeItem(STORAGE);
const pinKey = id => `calypco-pin-${id}`;
const pinRecord = () => { try { return JSON.parse(localStorage.getItem(pinKey(user.$id))); } catch { return null; } };
const save = () => {
  if (!user) return;
  const copy = structuredClone(data);
  pendingSync = pendingSync.catch(() => {}).then(() => writeBudget(user.$id, copy)).then(() => { syncError = ''; }).catch(error => { syncError = error.message; render(); });
};
const line = (label, value, className = '') => `<div class="line ${className}"><span>${safe(label)}</span><strong>${money(value)}</strong></div>`;

function budgetMatrix() {
  const table = monthlyTable(data);
  const months = table.map(row => row.month);
  const states = months.map(key => snapshot(data, key));
  const categories = [...new Set(states.flatMap(state => Object.keys(state.budget.categories ?? {})))];
  const values = (label, pick, kind = '') => ({ label, kind, amounts: states.map((state, index) => pick(state, table[index], index)) });
  const rows = [
    values('Salaire prévu', state => state.salary, 'income'),
    values('Objectif Uber', state => state.uberTarget, 'income'),
    values('Uber saisi', state => state.uberActual, 'income'),
    values('Autres revenus saisis', state => state.extraIncome, 'income'),
    values('Revenus prévus', state => state.salary + Math.max(state.uberTarget, state.uberActual) + state.extraIncome, 'total'),
    values('Revenus avec Uber saisi', state => state.salary + state.uberActual + state.extraIncome, 'total'),
    ...categories.map(category => values(category, state => state.budget.categories?.[category] ?? 0, 'expense')),
    values('Total dépenses prévues', state => state.plannedPersonal, 'total'),
    values('Dépenses saisies', state => state.spentPersonal, 'expense'),
    values('Dépassements et engagements', state => state.excessPersonal + state.personalReservation, 'expense'),
    values('Économie prévue', (_, row) => row.forecastSavings, 'highlight'),
    values('Économie avec Uber saisi', (_, row) => row.savings, 'highlight'),
    values('Cumul personnel prévu', (_, row) => row.forecastSavingsCumulative, 'total'),
    values('Cumul personnel avec Uber saisi', (_, row) => row.savingsCumulative, 'total'),
    values('Apports externes', (_, row) => row.funding, 'income'),
    values('Total cumulé prévu', (_, row) => row.forecastTotalCumulative, 'total'),
    values('Total cumulé avec Uber saisi', (_, row) => row.totalCumulative, 'total'),
    values('Solde Gantt prévu', (_, row) => row.forecastProjectBalance, 'highlight'),
    values('Solde Gantt avec Uber saisi', (_, row) => row.projectBalance, 'highlight')
  ];
  return `<section class="panel matrix-panel"><h2>Budget mois par mois</h2><p class="note">Fais défiler le tableau dans ce cadre. Appuie sur un mois pour le suivre juste en dessous. Les objectifs Uber sont des prévisions ; seuls les gains saisis entrent dans le calcul « avec Uber saisi ».</p>
    <div class="matrix-scroll" role="region" aria-label="Tableau du budget défilant" tabindex="0"><table class="matrix-table"><thead><tr><th scope="col">Poste</th>${months.map(key => `<th scope="col" class="${key === month ? 'selected-month' : ''}"><button type="button" data-month="${key}" ${key === month ? 'aria-current="date"' : ''}>${safe(prettyMonth(key))}</button></th>`).join('')}</tr></thead><tbody>
    ${rows.map(row => `<tr class="${row.kind}"><th scope="row">${safe(row.label)}</th>${row.amounts.map((amount, index) => `<td class="${months[index] === month ? 'selected-month' : ''} ${amount < 0 ? 'negative' : ''}">${money(amount)}${row.kind === 'expense' && !row.label.startsWith('Total') && !['Dépenses saisies', 'Dépassements et engagements'].includes(row.label) && states[index].categoryRows.some(item => item.name === row.label && item.spent) ? `<small>Saisi ${money(states[index].categoryRows.find(item => item.name === row.label).spent)}</small>` : ''}</td>`).join('')}</tr>`).join('')}</tbody></table></div></section>`;
}

function dashboard() {
  const s = snapshot(data, month);
  const savings = monthlySavings(data, month);
  const row = monthlyTable(data).find(item => item.month === month);
  const chosen = s.categoryRows.some(item => item.name === selectedCategory) ? selectedCategory : (s.categoryRows[0]?.name ?? 'Autre dépense personnelle');
  const categories = s.categoryRows.map(item => `<button type="button" class="category-chip ${item.name === chosen ? 'active' : ''}" data-category-chip="${safe(item.name)}"><strong>${safe(item.name)}</strong><small>Prévu ${money(item.planned)} · Dépensé ${money(item.spent)}</small><b class="${item.spent > item.planned ? 'negative' : ''}">Reste ${money(item.planned - item.spent)}</b></button>`).join('');
  const budget = s.budget;
  return `${budgetMatrix()}
    <section class="panel month-control"><label for="budget-month">Mois à suivre</label><select id="budget-month">${monthlyTable(data).map(item => `<option value="${item.month}" ${item.month === month ? 'selected' : ''}>${safe(prettyMonth(item.month))}</option>`).join('')}</select>
      <div class="month-totals"><div><small>Économie prévue</small><strong>${money(row?.forecastSavings ?? 0)}</strong></div><div><small>Avec Uber saisi</small><strong class="${savings < 0 ? 'negative' : ''}">${money(savings)}</strong></div><div><small>Cumul avec apports</small><strong>${money(row?.totalCumulative ?? 0)}</strong></div></div></section>
    ${!Object.keys(data.budgets).length ? '<p class="notice">Aucune prévision dans ce compte. Vérifie l’adresse dans Réglages, puis <button type="button" data-refresh-budget>actualise les données</button>.</p>' : ''}
    <section class="panel"><h2>Ajouter une dépense</h2><label for="category-filter">Choisir un poste</label><input id="category-filter" type="search" placeholder="Filtrer les postes" aria-label="Filtrer les postes" /><div class="category-chips">${categories || '<p class="muted">Aucun poste prévu pour ce mois.</p>'}</div>
      <form id="quick-expense-form" class="quick-entry"><label>Poste <select name="category">${[...s.categoryRows.map(item => item.name), 'Autre dépense personnelle'].map(name => `<option value="${safe(name)}" ${name === chosen ? 'selected' : ''}>${safe(name)}</option>`).join('')}</select></label><label>Montant dépensé (€) <input name="amount" type="number" min="0.01" step="0.01" inputmode="decimal" required /></label><label>Date <input name="date" type="date" value="${month === monthKey(today()) ? today() : `${month}-01`}" required /></label><label>Description (facultatif) <input name="description" maxlength="120" /></label><p id="quick-error" class="error" role="alert"></p><button type="submit">Enregistrer la dépense</button></form>
      <p class="note">Une dépense prévue diminue le reste du poste. Seul un dépassement ou un nouveau poste réduit l’économie calculée.</p></section>
    <section class="panel"><h2>Gains Uber du mois</h2><p class="note">${money(s.uberActual)} encaissés sur ${money(s.uberTarget)} prévus · ${money(Math.max(0, s.uberTarget - s.uberActual))} encore à gagner.</p><form id="income-form" class="quick-entry"><label>Gain Uber (€) <input name="amount" type="number" min="0.01" step="0.01" inputmode="decimal" required /></label><label>Date du gain <input name="date" type="date" value="${month === monthKey(today()) ? today() : `${month}-01`}" required /></label><button type="submit">Ajouter ce gain</button><p id="income-error" class="error" role="alert"></p></form>
      ${data.incomes.filter(x => monthKey(x.date) === month).sort((a, b) => b.date.localeCompare(a.date)).map(x => `<div class="transaction"><div><b>${safe(x.kind === 'uber' || (!x.kind && /uber/i.test(x.label ?? '')) ? 'Uber' : (x.label || 'Autre revenu'))}</b><small>${safe(x.date)}</small></div><strong>${money(x.cents)}</strong><button class="icon-button" data-edit-income="${safe(x.id)}" aria-label="Corriger ce gain">✎</button><button class="icon-button" data-delete-income="${safe(x.id)}" aria-label="Supprimer ce gain">×</button></div>`).join('')}</section>
    ${history()}
    <details class="panel budget-details"><summary>Modifier les prévisions de ${safe(prettyMonth(month))}</summary><form id="budget-form">
      <label>Salaire prévu (€) <input name="salary" type="number" step="0.01" min="0" value="${(s.salary/100).toFixed(2)}" required /></label><label>Objectif Uber (€) <input name="uberTarget" type="number" step="0.01" min="0" value="${(s.uberTarget/100).toFixed(2)}" required /></label>
      ${Object.entries(budget.categories ?? {}).map(([name, cents]) => `<label>${safe(name)} (€) <input data-category="${safe(name)}" type="number" step="0.01" min="0" value="${(cents/100).toFixed(2)}" required /></label>`).join('')}
      <div class="inline-form"><input name="newCategory" placeholder="Nouveau poste" aria-label="Nouveau poste" /><input name="newAmount" type="number" step="0.01" min="0" placeholder="Montant €" aria-label="Montant du nouveau poste" /></div>
      <button type="submit">Mettre à jour le budget</button></form></details>`;
}

function history() {
  const rows = data.expenses.filter(x => monthKey(x.date) === month).sort((a, b) => b.date.localeCompare(a.date));
  return `<section class="panel"><h2>Dépenses de ${safe(prettyMonth(month))}</h2>${rows.length ? rows.map(x => `<div class="transaction"><div><b>${safe(x.description || x.category)}</b><small>${safe(x.date)} · ${safe(x.scope)} · ${safe(x.category)}${x.commitmentId ? ' · échéance liée' : ''}</small></div><strong>${money(x.cents)}</strong><button class="icon-button" data-edit-expense="${safe(x.id)}" aria-label="Corriger cette dépense">✎</button><button class="icon-button" data-delete="${safe(x.id)}" aria-label="Supprimer cette dépense">×</button></div>`).join('') : '<p class="muted">Aucune dépense saisie ce mois-ci.</p>'}</section>`;
}

function forecasts() {
  const gantt = ganttTimeline(data, { forecastUber: true });
  const withLoggedUber = new Map(ganttTimeline(data).map(block => [block.id, block]));
  return `<section class="panel"><h2>Gantt lié au budget</h2><p class="note">Le tableau du budget est sur l’Accueil. Ici, chaque bloc reçoit les économies prévues et les apports, puis déduit son coût. « Avec Uber saisi » utilise uniquement les gains enregistrés. Ouvre un bloc pour modifier sa date, son coût ou le prix d’une ligne.</p>
    ${gantt.length ? gantt.map(block => `<details class="gantt-block" data-block-details="${safe(block.id)}" ${expandedBlocks.has(block.id) ? 'open' : ''}><summary><span><small>${safe(block.phase || prettyMonth(block.month))}</small><strong>${safe(block.label)}</strong></span><span class="gantt-values"><b class="${block.balance < 0 ? 'negative' : ''}">Prévu ${money(block.balance)}</b><small>Avec Uber saisi : ${money(withLoggedUber.get(block.id)?.balance ?? block.balance)}</small><small>+ ${money(block.inflow)} · − ${money(block.cost)}</small></span></summary>
      ${block.note ? `<p class="note">${safe(block.note)}</p>` : ''}<div class="line"><span>Coût prévu</span><strong>${money(block.plannedCents)}</strong></div><div class="line"><span>Dépenses saisies</span><strong>${money(block.actual)}</strong></div>${block.overrun ? line('En plus du prévu', block.overrun) : ''}
      ${(block.items ?? []).map(item => { const paid = data.expenses.filter(x => x.ganttLineId === item.id).reduce((n, x) => n + x.cents, 0); return `<form class="gantt-item" data-edit-line="${safe(block.id)}" data-line="${safe(item.id)}"><span>${safe(item.label)}${item.note ? `<small>${safe(item.note)}</small>` : ''}<small>Saisi ${money(paid)}</small></span><span class="gantt-line-edit"><label>Prévu (€) <input name="amount" type="number" min="0" step="0.01" value="${(item.plannedCents / 100).toFixed(2)}" required /></label><button type="submit" aria-label="Enregistrer ${safe(item.label)}">Enregistrer</button></span></form>`; }).join('')}
      ${block.kind ? '' : `<form class="gantt-edit" data-edit-block="${safe(block.id)}"><h3>Modifier ce bloc</h3><label>Mois <input name="month" type="month" value="${safe(block.month)}" required /></label><label>Nom <input name="label" value="${safe(block.label)}" maxlength="120" required /></label><label>Coût total prévu (€) <input name="amount" type="number" min="0" step="0.01" value="${(block.plannedCents / 100).toFixed(2)}" required /></label><button type="submit">Enregistrer le bloc</button></form><div class="actions"><button type="button" data-add-block-expense="${safe(block.id)}">+ Dépense pour ce bloc</button><button type="button" data-remove-block="${safe(block.id)}">Retirer ce bloc</button></div>`}</details>`).join('') : '<p class="muted">Aucun bloc dans ce compte. Vérifie l’adresse dans Réglages, puis <button type="button" data-refresh-budget>actualise les données</button>.</p>'}
    <form id="block-form" class="stack-form"><h3>Ajouter un bloc au Gantt</h3><label>Mois <input name="month" type="month" value="${month}" required /></label><label>Nom du bloc <input name="label" required maxlength="120" /></label><label>Coût prévu (€) <input name="amount" type="number" min="0" step="0.01" required /></label><button type="submit">Ajouter le bloc</button></form></section>`;
}

function settings() {
  const times = { matin: '08:00', midi: '12:30', soir: '20:00', ...data.settings.reminderTimes };
  const hasPin = Boolean(pinRecord());
  return `<section class="panel"><h2>Rappels sur téléphone</h2><p class="note">Trois rappels par jour, aux heures locales choisies, lorsque l’application est ouverte. Pour recevoir des alertes quand elle est fermée, il faut encore configurer un service push.</p>
    <label class="check"><input id="notifications" type="checkbox" ${data.settings.notifications ? 'checked' : ''}/> Activer les notifications</label>
    ${Object.entries(times).map(([slot, value]) => `<label>${safe(slot[0].toUpperCase() + slot.slice(1))} <input type="time" data-reminder="${slot}" value="${safe(value)}" /></label>`).join('')}</section>
    <section class="panel"><h2>Code d’accès</h2><p class="note">Le PIN verrouille l’affichage sur cet appareil tant que la session Appwrite reste active. Choisis un code privé, jamais communiqué. Une nouvelle connexion est nécessaire si la session expire ou si tu changes d’appareil.</p>
      ${hasPin ? '<p>Code PIN activé sur cet appareil.</p><div class="actions"><button id="lock-now">Verrouiller maintenant</button><button id="change-pin">Changer le code PIN</button></div>' : ''}</section>
    <section class="panel"><h2>Compte et sauvegarde</h2><p class="note">Connecté : ${safe(user?.email)}. Les modifications se synchronisent avec Appwrite. ${syncError ? `Erreur de synchronisation : ${safe(syncError)}` : ''}</p><div class="actions"><button id="sync-now">Synchroniser</button><button id="sign-out">Déconnexion</button><button id="export-json">Exporter une sauvegarde</button></div><details><summary>Changer de compte sur cet appareil</summary><p class="note">Cette action ferme la session Appwrite. La prochaine connexion demandera l’adresse e-mail et le mot de passe.</p><button id="switch-account">Fermer la session Appwrite</button></details></section>`;
}

function pinSetup() {
  app.innerHTML = `<header><div class="brand"><span class="brand-icon">∿</span><div><small>PROJET CALYPÇO</small><h1>Mon budget</h1></div></div></header><main><section class="panel login"><h2>Créer ton code d’accès</h2><p class="note">Choisis sur cet appareil un nouveau code PIN de 6 chiffres. Le code envoyé dans la conversation est déjà connu et ne peut pas protéger tes données. Tu saisiras ce nouveau code à chaque ouverture et après « Déconnexion ».</p><form id="pin-setup-form"><label>Nouveau code PIN <input name="pin" type="password" inputmode="numeric" autocomplete="new-password" pattern="[0-9]{6}" maxlength="6" required autofocus /></label><label>Confirmer le code <input name="confirm" type="password" inputmode="numeric" autocomplete="new-password" pattern="[0-9]{6}" maxlength="6" required /></label><p id="pin-error" class="error" role="alert"></p><button type="submit">Activer le code PIN</button></form><p><button id="setup-other-account" type="button">Utiliser un autre compte</button></p></section></main>`;
  document.querySelector('#pin-setup-form').onsubmit = async event => {
    event.preventDefault();
    const form = event.currentTarget;
    if (form.elements.pin.value !== form.elements.confirm.value) { form.querySelector('#pin-error').textContent = 'Les deux codes diffèrent.'; return; }
    const button = form.querySelector('button[type="submit"]'); button.disabled = true;
    try {
      localStorage.setItem(pinKey(user.$id), JSON.stringify(await makePinRecord(form.elements.pin.value, user.$id)));
      form.reset();
      await loadBudget();
    } catch (error) { form.querySelector('#pin-error').textContent = error.message; button.disabled = false; }
  };
  document.querySelector('#setup-other-account').onclick = async () => {
    try { await signOut(); user = null; data = seed(); render(); }
    catch (error) { document.querySelector('#pin-error').textContent = error.message; }
  };
}

function login() {
  app.innerHTML = `<header><div class="brand"><span class="brand-icon">∿</span><div><small>PROJET CALYPÇO</small><h1>Mon budget</h1></div></div></header><main><section class="panel login"><h2>Connexion Appwrite</h2><p class="note">Connecte-toi avec le compte existant pour afficher tes prévisions privées et suivre tes dépenses.</p><form id="login-form"><label>Adresse e-mail <input name="email" type="email" autocomplete="username" required /></label><label>Mot de passe <input name="password" type="password" autocomplete="current-password" minlength="8" required /></label><p id="login-error" class="error" role="alert"></p><div class="actions"><button type="submit">Se connecter</button></div></form></section></main>`;
  document.querySelector('#login-form').onsubmit = async event => {
    event.preventDefault();
    const form = event.currentTarget;
    const { email, password } = Object.fromEntries(new FormData(form));
    form.querySelectorAll('button').forEach(item => item.disabled = true);
    try {
      await signIn(email, password);
      await initialize(true);
    } catch (error) {
      form.querySelector('#login-error').textContent = error.message;
      form.querySelectorAll('button').forEach(item => item.disabled = false);
    }
  };
}

async function loadBudget() {
  if (!user) return;
  let remote = await readBudget(user.$id);
  if (!remote) {
    remote = seed();
    await writeBudget(user.$id, remote, true);
  }
  data = remote;
  locked = false;
  render();
}

async function initialize(justSignedIn = false) {
  user = await currentUser();
  if (!pinRecord()) { pinSetup(); return; }
  if (!justSignedIn) { lock(); return; }
  await loadBudget();
}

function lock() {
  if (!user || !pinRecord()) return;
  data = seed();
  dialog = false;
  locked = true;
  render();
}

function lockScreen() {
  app.innerHTML = `<header><div class="brand"><span class="brand-icon">∿</span><div><small>PROJET CALYPÇO</small><h1>Mon budget</h1></div></div></header><main><section class="panel login"><h2>Déverrouiller</h2><p class="note">Session de ${safe(user.email)}. Saisis ton code de cet appareil.</p><form id="unlock-form"><label>Code PIN <input name="pin" type="password" inputmode="numeric" autocomplete="off" pattern="[0-9]{6}" maxlength="6" required autofocus /></label><p id="unlock-error" class="error" role="alert"></p><button type="submit">Déverrouiller</button></form><p><button id="email-login">Se connecter avec e-mail et mot de passe</button></p></section></main>`;
  document.querySelector('#unlock-form').onsubmit = async event => {
    event.preventDefault();
    const form = event.currentTarget;
    if (Date.now() < retryAt) { form.querySelector('#unlock-error').textContent = 'Patiente quelques instants avant de réessayer.'; return; }
    const button = form.querySelector('button'); button.disabled = true;
    try {
      if (!await verifyPin(form.elements.pin.value, user.$id, pinRecord())) {
        pinFailures++;
        if (pinFailures >= 5) { retryAt = Date.now() + 30_000; pinFailures = 0; }
        form.querySelector('#unlock-error').textContent = 'Code incorrect.';
        form.elements.pin.value = '';
        return;
      }
      pinFailures = 0;
      await loadBudget();
    } catch (error) { form.querySelector('#unlock-error').textContent = error.message; }
    finally { button.disabled = false; }
  };
  document.querySelector('#email-login').onclick = async () => {
    try { await signOut(); user = null; data = seed(); locked = false; render(); }
    catch (error) { document.querySelector('#unlock-error').textContent = error.message; }
  };
}

function expenseDialog() {
  if (!dialog) return '';
  const s = snapshot(data, month);
  const categories = Object.keys(s.budget.categories);
  const options = s.commitments.map(c => `<option value="${safe(c.id)}" data-scope="${safe(c.scope)}">${safe(c.label)} — ${money(c.cents)}</option>`).join('');
  const blocks = data.ganttBlocks ?? [];
  const currentBlock = blocks.find(block => block.id === selectedBlock);
  return `<div class="modal-backdrop"><form id="expense-form" class="modal"><div class="modal-top"><h2>Ajouter une dépense</h2><button type="button" id="close-modal" class="icon-button" aria-label="Fermer">×</button></div>
    <label>Montant total (€) <input name="amount" type="number" min="0.01" step="0.01" required autofocus /></label>
    <label>Date de la première échéance <input name="date" type="date" value="${month === monthKey(today()) ? today() : `${month}-01`}" required /></label>
    <label>Budget <select name="scope" id="expense-scope"><option ${currentBlock ? "" : "selected"}>Personnel</option><option ${currentBlock ? "selected" : ""}>Calypço</option></select></label>
    <label>Catégorie <select name="category" id="expense-category">${categories.map(c => `<option>${safe(c)}</option>`).join('')}<option>Autre dépense personnelle</option></select></label>
    <label>Description (facultatif) <input name="description" maxlength="120" /></label>
    <label>Moyen de paiement (facultatif) <input name="method" maxlength="60" /></label>
    <label>Paiement en <select name="count"><option value="1">Une fois</option><option value="2">2 fois</option><option value="3">3 fois</option><option value="4">4 fois</option><option value="6">6 fois</option><option value="12">12 fois</option></select></label>
    <label>Échéance déjà prévue (si applicable) <select name="commitmentId"><option value="">Nouvelle dépense</option>${options}</select></label>
    <div id="gantt-link" ${currentBlock ? '' : 'hidden'}><label>Bloc du Gantt <select name="ganttBlockId" id="gantt-block"><option value="">Nouvelle dépense hors bloc</option>${blocks.map(block => `<option value="${safe(block.id)}" ${block.id === selectedBlock ? 'selected' : ''}>${safe(prettyMonth(block.month))} · ${safe(block.label)}</option>`).join('')}</select></label>
    <label>Ligne prévue (facultatif) <select name="ganttLineId" id="gantt-line"><option value="">Dépense supplémentaire du bloc</option>${(currentBlock?.items ?? []).map(item => `<option value="${safe(item.id)}">${safe(item.label)} — prévu ${money(item.plannedCents)}</option>`).join('')}</select></label></div>
    <p class="note">Lier un paiement à une échéance prévue évite de le déduire deux fois. Pour un nouvel achat en plusieurs fois, les échéances futures sont créées automatiquement.</p>
    <p id="form-error" class="error" role="alert"></p><button class="primary" type="submit">Enregistrer la dépense</button></form></div>`;
}

function render() {
  if (!user) { login(); return; }
  if (!pinRecord()) { pinSetup(); return; }
  if (locked) { lockScreen(); return; }
  if (view === 'previsions') expandedBlocks = new Set([...document.querySelectorAll('[data-block-details][open]')].map(item => item.dataset.blockDetails));
  const previousMatrix = document.querySelector('.matrix-scroll');
  if (previousMatrix) matrixPosition = { left: previousMatrix.scrollLeft, top: previousMatrix.scrollTop };
  app.innerHTML = `<header><div class="brand"><span class="brand-icon">∿</span><div><small>PROJET CALYPÇO</small><h1>Mon budget</h1></div></div><button id="add-expense" class="primary">+ Dépense</button></header>
    <main>${view === 'accueil' ? dashboard() : view === 'previsions' ? forecasts() : settings()}</main>
    <nav aria-label="Navigation principale">${[['accueil', 'Accueil'], ['previsions', 'Gantt'], ['reglages', 'Réglages']].map(([id, label]) => `<button data-view="${id}" class="${view === id ? 'active' : ''}">${label}</button>`).join('')}</nav>${expenseDialog()}`;
  const matrix = document.querySelector('.matrix-scroll');
  if (matrix) {
    if (!matrixInitialized) {
      const selected = matrix.querySelector('th.selected-month');
      matrixPosition.left = selected ? selected.offsetLeft - matrix.clientWidth / 2 : 0;
      matrixInitialized = true;
    }
    matrix.scrollLeft = matrixPosition.left;
    matrix.scrollTop = matrixPosition.top;
  }
  bind();
}

function announce(message) {
  if (!data.settings.notifications || !('Notification' in window) || Notification.permission !== 'granted') return;
  if ('serviceWorker' in navigator) navigator.serviceWorker.ready.then(reg => reg.showNotification('Calypço Budget', { body: message, icon: `${import.meta.env.BASE_URL}icon.svg`, tag: 'calypco-budget' })).catch(() => {});
}
function bind() {
  document.querySelector('#budget-month')?.addEventListener('change', event => {
    month = event.target.value;
    render();
    const matrix = document.querySelector('.matrix-scroll');
    const selected = matrix?.querySelector('th.selected-month');
    if (selected) matrix.scrollLeft = selected.offsetLeft - matrix.clientWidth / 2;
  });
  document.querySelector('#add-expense').onclick = () => { selectedBlock = ''; dialog = true; render(); };
  document.querySelectorAll('[data-view]').forEach(button => button.onclick = () => { view = button.dataset.view; render(); });
  document.querySelector('#close-modal')?.addEventListener('click', () => { dialog = false; selectedBlock = ''; render(); });
  document.querySelector('.modal-backdrop')?.addEventListener('click', event => { if (event.target.classList.contains('modal-backdrop')) { dialog = false; selectedBlock = ''; render(); } });
  const quickExpense = document.querySelector('#quick-expense-form');
  document.querySelectorAll('[data-category-chip]').forEach(button => button.onclick = () => {
    selectedCategory = button.dataset.categoryChip;
    quickExpense.elements.category.value = selectedCategory;
    document.querySelectorAll('[data-category-chip]').forEach(chip => chip.classList.toggle('active', chip === button));
    quickExpense.elements.amount.focus();
  });
  document.querySelector('#category-filter')?.addEventListener('input', event => {
    const term = event.target.value.trim().toLocaleLowerCase('fr-FR');
    document.querySelectorAll('[data-category-chip]').forEach(chip => { chip.hidden = !chip.dataset.categoryChip.toLocaleLowerCase('fr-FR').includes(term); });
  });
  if (quickExpense) quickExpense.onsubmit = event => {
    event.preventDefault();
    const values = Object.fromEntries(new FormData(quickExpense));
    try {
      addExpense(data, { ...values, scope: 'Personnel', count: '1' });
      selectedCategory = values.category;
      month = monthKey(values.date);
      save(); render();
      announce(`Dépense enregistrée. Reste du poste actualisé, économie du mois : ${money(monthlySavings(data, month))}.`);
    } catch (error) { quickExpense.querySelector('#quick-error').textContent = error.message; }
  };
  const form = document.querySelector('#expense-form');
  if (form) {
    const scope = form.querySelector('#expense-scope');
    const category = form.querySelector('#expense-category');
    const blockSelect = form.querySelector('#gantt-block');
    const lineSelect = form.querySelector('#gantt-line');
    blockSelect.onchange = () => { const block = (data.ganttBlocks ?? []).find(item => item.id === blockSelect.value); lineSelect.innerHTML = '<option value="">Dépense supplémentaire du bloc</option>' + (block?.items ?? []).map(item => `<option value="${safe(item.id)}">${safe(item.label)} — prévu ${money(item.plannedCents)}</option>`).join(''); };
    scope.onchange = () => { form.querySelector('#gantt-link').hidden = scope.value !== 'Calypço'; category.innerHTML = (scope.value === 'Calypço' ? projectCategories : [...Object.keys(snapshot(data, month).budget.categories), 'Autre dépense personnelle']).map(c => `<option>${safe(c)}</option>`).join(''); };
    form.onsubmit = event => {
      event.preventDefault();
      const values = Object.fromEntries(new FormData(form));
      try {
        const commitment = data.commitments.find(c => c.id === values.commitmentId);
        if (commitment && (commitment.scope !== values.scope || commitment.month !== monthKey(values.date) || Number(values.count) !== 1)) throw new Error('Choisis une échéance du même budget et du même mois, avec un paiement unique.');
        if (values.ganttLineId && !(data.ganttBlocks ?? []).find(b => b.id === values.ganttBlockId)?.items.some(item => item.id === values.ganttLineId)) throw new Error('La ligne choisie doit appartenir au bloc du Gantt.');
        const before = monthlySavings(data, monthKey(values.date));
        addExpense(data, values); save(); dialog = false; selectedBlock = ''; month = monthKey(values.date); render();
        const after = monthlySavings(data, month);
        announce(`Dépense enregistrée. Économie mensuelle prévue : ${money(after)}. Variation : ${money(after - before)}.`);
      } catch (error) { form.querySelector('#form-error').textContent = error.message; }
    };
  }
  document.querySelectorAll('[data-delete]').forEach(button => button.onclick = () => {
    if (!confirm('Supprimer cette dépense ?')) return;
    data.expenses = data.expenses.filter(x => x.id !== button.dataset.delete); save(); render();
  });
  document.querySelectorAll('[data-delete-income]').forEach(button => button.onclick = () => {
    data.incomes = data.incomes.filter(x => x.id !== button.dataset.deleteIncome); save(); render();
  });
  for (const [attribute, entries] of [['data-edit-expense', data.expenses], ['data-edit-income', data.incomes]]) {
    document.querySelectorAll(`[${attribute}]`).forEach(button => button.onclick = () => {
      const item = entries.find(entry => entry.id === button.getAttribute(attribute));
      if (!item) return;
      const row = button.closest('.transaction');
      row.nextElementSibling?.classList.contains('correction-form') && row.nextElementSibling.remove();
      const edit = document.createElement('form');
      edit.className = 'correction-form';
      edit.innerHTML = `<label>Corriger le montant (€) <input name="amount" type="number" min="0.01" step="0.01" inputmode="decimal" value="${(item.cents / 100).toFixed(2)}" required /></label><button type="submit">Enregistrer</button><button type="button" class="cancel-edit">Annuler</button><p class="error" role="alert"></p>`;
      row.after(edit);
      edit.querySelector('input').focus();
      edit.querySelector('.cancel-edit').onclick = () => edit.remove();
      edit.onsubmit = event => {
        event.preventDefault();
        const cents = Math.round(Number(edit.elements.amount.value) * 100);
        if (!Number.isSafeInteger(cents) || cents <= 0) { edit.querySelector('.error').textContent = 'Saisis un montant positif.'; return; }
        item.cents = cents; save(); render();
      };
    });
  }
  document.querySelectorAll('[data-month]').forEach(button => button.onclick = () => { month = button.dataset.month; view = 'accueil'; render(); });
  document.querySelectorAll('[data-add-block-expense]').forEach(button => button.onclick = () => { selectedBlock = button.dataset.addBlockExpense; month = (data.ganttBlocks ?? []).find(block => block.id === selectedBlock)?.month ?? month; dialog = true; render(); });
  document.querySelectorAll('[data-edit-line]').forEach(edit => edit.onsubmit = event => {
    event.preventDefault();
    try {
      updateGanttLine(data, edit.dataset.editLine, edit.dataset.line, Math.round(Number(edit.elements.amount.value) * 100));
      save(); render();
    } catch (error) { alert(error.message); }
  });
  document.querySelectorAll('[data-edit-block]').forEach(edit => edit.onsubmit = event => {
    event.preventDefault();
    try {
      updateGanttBlock(data, edit.dataset.editBlock, {
        month: edit.elements.month.value, label: edit.elements.label.value,
        plannedCents: Math.round(Number(edit.elements.amount.value) * 100)
      });
      save(); render();
    } catch (error) { alert(error.message); }
  });
  document.querySelectorAll('[data-remove-block]').forEach(button => button.onclick = () => {
    if (!confirm('Retirer ce bloc du Gantt ? Les apports restent au mois prévu et les dépenses déjà saisies restent dans le suivi.')) return;
    try { removeGanttBlock(data, button.dataset.removeBlock); expandedBlocks.delete(button.dataset.removeBlock); save(); render(); }
    catch (error) { alert(error.message); }
  });
  document.querySelectorAll('[data-refresh-budget]').forEach(button => button.onclick = async () => {
    try { await pendingSync; await loadBudget(); syncError = ''; }
    catch (error) { syncError = error.message; alert(error.message); }
  });
  const budgetForm = document.querySelector('#budget-form');
  if (budgetForm) budgetForm.onsubmit = event => {
    event.preventDefault();
    const cents = input => Math.round(Number(input) * 100);
    const salaryCents = cents(budgetForm.elements.salary.value);
    const uberTargetCents = cents(budgetForm.elements.uberTarget.value);
    if (![salaryCents, uberTargetCents].every(value => Number.isSafeInteger(value) && value >= 0)) return;
    const categories = {};
    for (const input of budgetForm.querySelectorAll('[data-category]')) {
      const value = cents(input.value);
      if (!Number.isSafeInteger(value) || value < 0) return;
      categories[input.dataset.category] = value;
    }
    const name = budgetForm.elements.newCategory.value.trim();
    if (name) {
      const value = cents(budgetForm.elements.newAmount.value);
      if (!Number.isSafeInteger(value) || value < 0) return;
      categories[name] = value;
    }
    data.budgets[month] = { income: salaryCents + uberTargetCents, salaryCents, uberTargetCents, categories };
    save(); render();
  };
  const blockForm = document.querySelector('#block-form');
  if (blockForm) blockForm.onsubmit = event => {
    event.preventDefault(); const values = Object.fromEntries(new FormData(blockForm));
    const plannedCents = Math.round(Number(values.amount) * 100);
    if (!Number.isSafeInteger(plannedCents) || plannedCents < 0) return;
    data.ganttBlocks ??= [];
    data.ganttBlocks.push({ id: uid(), month: values.month, phase: prettyMonth(values.month), label: values.label.trim(), plannedCents,
      fundingMonths: [], manualFundingCents: 0, items: [], note: 'Bloc ajouté dans l’application.' });
    save(); render();
  };
  const income = document.querySelector('#income-form');
  if (income) income.onsubmit = event => {
    event.preventDefault(); const values = Object.fromEntries(new FormData(income)); const cents = Math.round(Number(values.amount) * 100);
    if (!Number.isSafeInteger(cents) || cents <= 0 || !/^\d{4}-\d{2}-\d{2}$/.test(values.date) || Number.isNaN(Date.parse(`${values.date}T12:00:00Z`))) {
      income.querySelector('#income-error').textContent = 'Vérifie le montant et la date.'; return;
    }
    data.incomes.push({ id: uid(), kind: 'uber', date: values.date, label: 'Uber', cents });
    month = monthKey(values.date); save(); render();
  };
  const notifications = document.querySelector('#notifications');
  if (notifications) notifications.onchange = async () => {
    if (notifications.checked) {
      if (!('Notification' in window) || await Notification.requestPermission() !== 'granted') { notifications.checked = false; return; }
    }
    data.settings.notifications = notifications.checked; save();
  };
  document.querySelectorAll('[data-reminder]').forEach(input => input.onchange = () => {
    data.settings.reminderTimes = { matin: '08:00', midi: '12:30', soir: '20:00', ...data.settings.reminderTimes, [input.dataset.reminder]: input.value }; save();
  });
  document.querySelector('#sync-now')?.addEventListener('click', async () => { try { await pendingSync; data = await readBudget(user.$id); syncError = ''; render(); } catch (error) { syncError = error.message; render(); } });
  document.querySelector('#sign-out')?.addEventListener('click', async () => { try { await pendingSync; lock(); } catch (error) { syncError = error.message; render(); } });
  document.querySelector('#switch-account')?.addEventListener('click', async () => { try { await pendingSync; await signOut(); user = null; data = seed(); localStorage.removeItem(STORAGE); render(); } catch (error) { syncError = error.message; render(); } });
  document.querySelector('#change-pin')?.addEventListener('click', () => { localStorage.removeItem(pinKey(user.$id)); data = seed(); pinSetup(); });
  document.querySelector('#lock-now')?.addEventListener('click', lock);
  document.querySelector('#export-json')?.addEventListener('click', () => {
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob); const link = document.createElement('a'); link.href = url; link.download = `calypco-budget-${today()}.json`; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  });
}

app.innerHTML = '<main><section class="panel login"><h2>Ouverture de Calypço Budget…</h2></section></main>';
initialize().catch(() => login());
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') hiddenAt = Date.now();
  else if (hiddenAt && Date.now() - hiddenAt > 60_000) lock();
});
if ('serviceWorker' in navigator) navigator.serviceWorker.register(`${import.meta.env.BASE_URL}sw.js`).catch(() => {});
setInterval(() => {
  if (!user || !data.settings.notifications || document.visibilityState !== 'visible') return;
  const now = new Date();
  const current = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
  for (const [slot, time] of Object.entries({ matin: '08:00', midi: '12:30', soir: '20:00', ...data.settings.reminderTimes })) {
    const key = `calypco-reminder-${user.$id}-${today()}-${slot}`;
    const minutes = value => { const [hours, minute] = value.split(':').map(Number); return hours * 60 + minute; };
    if (minutes(current) >= minutes(time) && minutes(current) - minutes(time) < 2 && localStorage.getItem(key) !== 'sent') {
      announce(`Rappel ${slot} : as-tu saisi tes dépenses aujourd’hui ?`);
      localStorage.setItem(key, 'sent');
    }
  }
}, 60_000);
