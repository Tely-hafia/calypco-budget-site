import './style.css';
import { currentUser, signIn, signUp, signOut, readBudget, writeBudget } from './cloud.js';
import { addExpense, money, monthKey, seed, snapshot, uid } from './budget.js';

const STORAGE = 'calypco-budget-v2';
const projectCategories = ['Voyage Guinée', 'Piscine', 'Toboggan', 'Plateforme', 'Plomberie', 'Électricité', 'Carrelage', 'Main-d’œuvre', 'Transport', 'Matériaux', 'Administratif', 'Autres travaux'];
const today = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
const safe = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
const prettyMonth = key => new Intl.DateTimeFormat('fr-FR', { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(new Date(`${key}-01T12:00:00Z`));
const changeMonth = (key, offset) => {
  const [y, m] = key.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1 + offset, 1)).toISOString().slice(0, 7);
};
let data = seed();
let user = null;
let syncError = '';
let pendingSync = Promise.resolve();
let month = monthKey(today()) < '2026-10' ? '2026-10' : monthKey(today());
let view = 'accueil';
let dialog = false;
const app = document.querySelector('#app');
const save = () => {
  localStorage.setItem(STORAGE, JSON.stringify(data));
  if (!user) return;
  const copy = structuredClone(data);
  pendingSync = pendingSync.catch(() => {}).then(() => writeBudget(user.$id, copy)).then(() => { syncError = ''; render(); }).catch(error => { syncError = error.message; render(); });
};
const line = (label, value, className = '') => `<div class="line ${className}"><span>${safe(label)}</span><strong>${money(value)}</strong></div>`;

function dashboard() {
  const s = snapshot(data, month);
  const tone = s.projected < 0 ? 'danger' : s.projected < 5000 ? 'critical' : s.projected < 10000 ? 'warning' : 'good';
  const categories = s.categoryRows.map(row => `<div class="category-row"><div><strong>${safe(row.name)}</strong><small>Prévu ${money(row.planned)} · Dépensé ${money(row.spent)}</small></div><b class="${row.spent > row.planned ? 'negative' : ''}">${money(row.planned - row.spent)}</b></div>`).join('');
  const commitments = s.commitments.map(c => {
    const paid = data.expenses.filter(x => x.commitmentId === c.id).reduce((n, x) => n + x.cents, 0);
    return `<div class="category-row"><div><strong>${safe(c.label)}</strong><small>${safe(c.scope)} · ${paid >= c.cents ? 'Payé' : `À payer ${money(c.cents - paid)}`}</small></div><b>${money(c.cents)}</b></div>`;
  }).join('');
  return `<section class="hero ${tone}"><div class="eyebrow">ÉPARGNE CALYPÇO PROJETÉE</div><div class="big">${money(s.projected)}</div><div class="hero-foot"><span>Objectif initial ${money(s.target)}</span><span>Écart ${s.delta >= 0 ? '+' : ''}${money(s.delta)}</span></div></section>
    <div class="summary-grid"><article><small>Prévu personnel</small><b>${money(s.plannedPersonal)}</b></article><article><small>Dépensé réel</small><b>${money(s.spentPersonal)}</b></article><article><small>Reste autorisé</small><b>${money(s.plannedPersonal - s.spentPersonal)}</b></article></div>
    <section class="panel"><h2>Impact sur Calypço</h2>${line('Économie initiale', s.target)}${line('Engagements du projet', -s.projectCost)}${line('Dépassement personnel', -s.excessPersonal - s.personalReservation)}${line('Revenus supplémentaires', s.extraIncome)}${line('Économie projetée', s.projected, 'total')}
      <p class="note">Une dépense déjà comprise dans son poste ne réduit pas une deuxième fois l’épargne. Les engagements du projet déjà payés restent comptés une seule fois.</p></section>
    ${!s.monthHasFullBudget ? '<p class="notice">Prévision provisoire : détail des revenus et postes personnels à renseigner pour ce mois.</p>' : ''}
    <section class="panel"><h2>Postes personnels</h2>${categories || '<p class="muted">Aucun poste détaillé pour ce mois.</p>'}</section>
    <section class="panel"><h2>Échéances prévues</h2>${commitments || '<p class="muted">Aucune échéance prévue.</p>'}</section>`;
}

function history() {
  const rows = data.expenses.filter(x => monthKey(x.date) === month).sort((a, b) => b.date.localeCompare(a.date));
  return `<section class="panel"><h2>Dépenses de ${safe(prettyMonth(month))}</h2>${rows.length ? rows.map(x => `<div class="transaction"><div><b>${safe(x.description || x.category)}</b><small>${safe(x.date)} · ${safe(x.scope)} · ${safe(x.category)}${x.commitmentId ? ' · échéance liée' : ''}</small></div><strong>${money(x.cents)}</strong><button class="icon-button" data-delete="${safe(x.id)}" aria-label="Supprimer cette dépense">×</button></div>`).join('') : '<p class="muted">Aucune dépense saisie ce mois-ci.</p>'}</section>
    <section class="panel"><h2>Revenus supplémentaires</h2><form id="income-form" class="inline-form"><input name="label" aria-label="Description du revenu" placeholder="Ex. Uber supplémentaire" required /><input name="amount" type="number" min="0.01" step="0.01" placeholder="Montant €" aria-label="Montant du revenu" required /><button type="submit">Ajouter</button></form>
    ${data.incomes.filter(x => monthKey(x.date) === month).map(x => `<div class="transaction"><span>${safe(x.label)}</span><b>${money(x.cents)}</b><button class="icon-button" data-delete-income="${safe(x.id)}" aria-label="Supprimer ce revenu">×</button></div>`).join('')}</section>`;
}

function forecasts() {
  let cumulative = 0;
  const months = Array.from({ length: 8 }, (_, index) => changeMonth(month, index));
  return `<section class="panel"><h2>Prévisions et Gantt</h2><p class="note">L’écart cumulé indique l’effet des nouvelles dépenses sur le financement initial de Calypço. Il ne remplace pas le Gantt détaillé des travaux.</p><div class="forecast-head"><span>Mois</span><span>Économie</span><span>Écart cumulé</span></div>${months.map(key => {
    const s = snapshot(data, key); cumulative += s.delta;
    return `<div class="forecast-row"><span>${safe(prettyMonth(key))}${!s.monthHasFullBudget ? '<small>prévision partielle</small>' : ''}</span><b>${money(s.projected)}</b><b class="${cumulative < 0 ? 'negative' : ''}">${money(cumulative)}</b></div>`;
  }).join('')}</section>`;
}

function settings() {
  const times = { matin: '08:00', midi: '12:30', soir: '20:00', ...data.settings.reminderTimes };
  return `<section class="panel"><h2>Rappels sur téléphone</h2><p class="note">Trois rappels par jour, aux heures locales choisies, lorsque l’application est ouverte. Pour recevoir des alertes quand elle est fermée, il faut encore configurer un service push.</p>
    <label class="check"><input id="notifications" type="checkbox" ${data.settings.notifications ? 'checked' : ''}/> Activer les notifications</label>
    ${Object.entries(times).map(([slot, value]) => `<label>${safe(slot[0].toUpperCase() + slot.slice(1))} <input type="time" data-reminder="${slot}" value="${safe(value)}" /></label>`).join('')}</section>
    <section class="panel"><h2>Compte et sauvegarde</h2><p class="note">Connecté : ${safe(user?.email)}. Les modifications se synchronisent avec Appwrite. ${syncError ? `Erreur de synchronisation : ${safe(syncError)}` : ''}</p><div class="actions"><button id="sync-now">Synchroniser</button><button id="sign-out">Déconnexion</button><button id="export-json">Exporter JSON</button><label class="file-label">Importer JSON<input id="import-json" type="file" accept="application/json,.json" hidden /></label></div></section>`;
}

function login() {
  app.innerHTML = `<header><div class="brand"><span class="brand-icon">∿</span><div><small>PROJET CALYPÇO</small><h1>Mon budget</h1></div></div></header><main><section class="panel login"><h2>Connexion Appwrite</h2><p class="note">Connecte-toi pour retrouver ton budget sur tes appareils. Si tu n’as pas encore de compte pour cette application, crée-en un avec ton adresse et un nouveau mot de passe.</p><form id="login-form"><label>Adresse e-mail <input name="email" type="email" autocomplete="username" required /></label><label>Mot de passe <input name="password" type="password" autocomplete="current-password" minlength="8" required /></label><p id="login-error" class="error" role="alert"></p><div class="actions"><button type="submit" name="action" value="login">Se connecter</button><button type="submit" name="action" value="signup">Créer un compte</button></div></form></section></main>`;
  document.querySelector('#login-form').onsubmit = async event => {
    event.preventDefault();
    const form = event.currentTarget;
    const button = event.submitter;
    const { email, password } = Object.fromEntries(new FormData(form));
    form.querySelectorAll('button').forEach(item => item.disabled = true);
    try {
      if (button.value === 'signup') await signUp(email, password);
      await signIn(email, password);
      await initialize();
    } catch (error) {
      form.querySelector('#login-error').textContent = error.message;
      form.querySelectorAll('button').forEach(item => item.disabled = false);
    }
  };
}

async function initialize() {
  user = await currentUser();
  let remote = await readBudget(user.$id);
  if (!remote) {
    remote = seed();
    await writeBudget(user.$id, remote, true);
  }
  data = remote;
  localStorage.setItem(STORAGE, JSON.stringify(data));
  render();
}

function expenseDialog() {
  if (!dialog) return '';
  const s = snapshot(data, month);
  const categories = Object.keys(s.budget.categories);
  const options = s.commitments.map(c => `<option value="${safe(c.id)}" data-scope="${safe(c.scope)}">${safe(c.label)} — ${money(c.cents)}</option>`).join('');
  return `<div class="modal-backdrop"><form id="expense-form" class="modal"><div class="modal-top"><h2>Ajouter une dépense</h2><button type="button" id="close-modal" class="icon-button" aria-label="Fermer">×</button></div>
    <label>Montant total (€) <input name="amount" type="number" min="0.01" step="0.01" required autofocus /></label>
    <label>Date de la première échéance <input name="date" type="date" value="${month === monthKey(today()) ? today() : `${month}-01`}" required /></label>
    <label>Budget <select name="scope" id="expense-scope"><option>Personnel</option><option>Calypço</option></select></label>
    <label>Catégorie <select name="category" id="expense-category">${categories.map(c => `<option>${safe(c)}</option>`).join('')}<option>Autre dépense personnelle</option></select></label>
    <label>Description (facultatif) <input name="description" maxlength="120" /></label>
    <label>Moyen de paiement (facultatif) <input name="method" maxlength="60" /></label>
    <label>Paiement en <select name="count"><option value="1">Une fois</option><option value="2">2 fois</option><option value="3">3 fois</option><option value="4">4 fois</option><option value="6">6 fois</option><option value="12">12 fois</option></select></label>
    <label>Échéance déjà prévue (si applicable) <select name="commitmentId"><option value="">Nouvelle dépense</option>${options}</select></label>
    <p class="note">Lier un paiement à une échéance prévue évite de le déduire deux fois. Pour un nouvel achat en plusieurs fois, les échéances futures sont créées automatiquement.</p>
    <p id="form-error" class="error" role="alert"></p><button class="primary" type="submit">Enregistrer la dépense</button></form></div>`;
}

function render() {
  if (!user) { login(); return; }
  app.innerHTML = `<header><div class="brand"><span class="brand-icon">∿</span><div><small>PROJET CALYPÇO</small><h1>Mon budget</h1></div></div><button id="add-expense" class="primary">+ Dépense</button></header>
    <main><div class="month-nav"><button id="prev-month" aria-label="Mois précédent">‹</button><h2>${safe(prettyMonth(month))}</h2><button id="next-month" aria-label="Mois suivant">›</button></div>
    ${view === 'accueil' ? dashboard() : view === 'depenses' ? history() : view === 'previsions' ? forecasts() : settings()}</main>
    <nav aria-label="Navigation principale">${[['accueil', 'Accueil'], ['depenses', 'Dépenses'], ['previsions', 'Prévisions'], ['reglages', 'Réglages']].map(([id, label]) => `<button data-view="${id}" class="${view === id ? 'active' : ''}">${label}</button>`).join('')}</nav>${expenseDialog()}`;
  bind();
}

function announce(message) {
  if (!data.settings.notifications || !('Notification' in window) || Notification.permission !== 'granted') return;
  if ('serviceWorker' in navigator) navigator.serviceWorker.ready.then(reg => reg.showNotification('Calypço Budget', { body: message, icon: `${import.meta.env.BASE_URL}icon.svg`, tag: 'calypco-budget' })).catch(() => {});
}
function bind() {
  document.querySelector('#prev-month').onclick = () => { month = changeMonth(month, -1); render(); };
  document.querySelector('#next-month').onclick = () => { month = changeMonth(month, 1); render(); };
  document.querySelector('#add-expense').onclick = () => { dialog = true; render(); };
  document.querySelectorAll('[data-view]').forEach(button => button.onclick = () => { view = button.dataset.view; render(); });
  document.querySelector('#close-modal')?.addEventListener('click', () => { dialog = false; render(); });
  document.querySelector('.modal-backdrop')?.addEventListener('click', event => { if (event.target.classList.contains('modal-backdrop')) { dialog = false; render(); } });
  const form = document.querySelector('#expense-form');
  if (form) {
    const scope = form.querySelector('#expense-scope');
    const category = form.querySelector('#expense-category');
    scope.onchange = () => { category.innerHTML = (scope.value === 'Calypço' ? projectCategories : [...Object.keys(snapshot(data, month).budget.categories), 'Autre dépense personnelle']).map(c => `<option>${safe(c)}</option>`).join(''); };
    form.onsubmit = event => {
      event.preventDefault();
      const values = Object.fromEntries(new FormData(form));
      try {
        const commitment = data.commitments.find(c => c.id === values.commitmentId);
        if (commitment && (commitment.scope !== values.scope || commitment.month !== monthKey(values.date) || Number(values.count) !== 1)) throw new Error('Choisis une échéance du même budget et du même mois, avec un paiement unique.');
        const before = snapshot(data, monthKey(values.date)).projected;
        addExpense(data, values); save(); dialog = false; month = monthKey(values.date); render();
        const after = snapshot(data, month).projected;
        announce(`Dépense enregistrée. Épargne Calypço projetée : ${money(after)}. Impact de cette saisie : ${money(after - before)}.`);
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
  const income = document.querySelector('#income-form');
  if (income) income.onsubmit = event => {
    event.preventDefault(); const values = Object.fromEntries(new FormData(income)); const cents = Math.round(Number(values.amount) * 100);
    if (!Number.isSafeInteger(cents) || cents <= 0) return;
    data.incomes.push({ id: uid(), date: `${month}-01`, label: values.label.trim(), cents }); save(); render();
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
  document.querySelector('#sign-out')?.addEventListener('click', async () => { try { await pendingSync; await signOut(); user = null; data = seed(); localStorage.removeItem(STORAGE); render(); } catch (error) { syncError = error.message; render(); } });
  document.querySelector('#export-json')?.addEventListener('click', () => {
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob); const link = document.createElement('a'); link.href = url; link.download = `calypco-budget-${today()}.json`; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  });
  document.querySelector('#import-json')?.addEventListener('change', async event => {
    try {
      const value = JSON.parse(await event.target.files[0].text());
      if (value.version !== 1 || !value.budgets || !Array.isArray(value.expenses) || !Array.isArray(value.commitments) || !Array.isArray(value.incomes)) throw Error('Format de sauvegarde invalide.');
      if (!confirm('Remplacer les données actuelles par cette sauvegarde ?')) return;
      data = value; save(); render();
    } catch (error) { alert(error.message); }
  });
}

login();
initialize().catch(() => login());
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
