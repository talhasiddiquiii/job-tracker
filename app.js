/* Job Tracker — plain JavaScript, no build step.
 *
 * Security notes:
 * - The publishable (anon) key below is meant to be public. It only works
 *   together with the Row Level Security policies in schema.sql, which make
 *   the database return a user's own rows and nothing else.
 * - Never put the service_role / secret key in this file. It bypasses RLS.
 * - Everything typed by the user is shown with textContent (never innerHTML),
 *   so text like "<script>" is displayed, not run.
 */
'use strict';

const SUPABASE_URL = 'https://lxgylduzucvrnyxrqsey.supabase.co';
const SUPABASE_KEY = 'sb_publishable_Hz1ydhf6eXREfkMrzEwboQ_4BwdLu3_';

// These lists must match the CHECK constraints in schema.sql.
const STATUSES = ['Saved', 'Applied', 'Interview', 'Offer', 'Rejected', 'Withdrawn'];
const ROLE_TYPES = ['Project coordination', 'Operations', 'Account management', 'Sales', 'Recruitment', 'OD / HR / Consulting'];
const SOURCES = ['SEEK', 'LinkedIn', 'Company site', 'WA Gov Jobs', 'Recruiter', 'Referral'];
const COVER_LETTERS = ['None', 'SEEK short', 'Attachment', 'Formal'];
// Statuses where a follow-up still makes sense (closed ones are ignored).
const FOLLOW_UP_STATUSES = ['Saved', 'Applied', 'Interview'];
const FOLLOW_UP_DAYS = 7;

const db = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY, {
  auth: {
    persistSession: true,      // stay logged in between visits
    autoRefreshToken: true,
    detectSessionInUrl: true,  // pick up the login from the magic link
    flowType: 'implicit',      // magic link works even if opened in a different browser/app
  },
});

// ---------- App state ----------
let applications = [];
let filter = 'All';          // 'All', a status, or 'FollowUps'
let editingId = null;        // null = adding a new one
let followUpTouched = false; // has the user changed "Follow up on" by hand?

// ---------- Element shortcuts ----------
const $ = (id) => document.getElementById(id);
const els = {
  loading: $('loading'),
  loginView: $('login-view'),
  appView: $('app-view'),
  loginForm: $('login-form'),
  loginEmail: $('login-email'),
  loginBtn: $('login-btn'),
  loginMsg: $('login-msg'),
  logoutBtn: $('logout-btn'),
  filters: $('filters'),
  list: $('list'),
  listMsg: $('list-msg'),
  addBtn: $('add-btn'),
  dialog: $('form-dialog'),
  form: $('app-form'),
  formTitle: $('form-title'),
  formMsg: $('form-msg'),
  cancelBtn: $('cancel-btn'),
  deleteBtn: $('delete-btn'),
  saveBtn: $('save-btn'),
  statusPicker: $('status-picker'),
  company: $('f-company'),
  role: $('f-role'),
  dateApplied: $('f-date-applied'),
  followUp: $('f-follow-up'),
  roleType: $('f-role-type'),
  source: $('f-source'),
  cover: $('f-cover'),
  contact: $('f-contact'),
  link: $('f-link'),
  notes: $('f-notes'),
  followupBox: $('s-followup-box'),
};

// ---------- Small helpers ----------

/** Create an element with optional class and text (text is always safe). */
function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = text;
  return node;
}

/** Today's date as YYYY-MM-DD in the user's own time zone (not UTC). */
function todayISO() {
  return toISO(new Date());
}
function toISO(d) {
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
/** Add days to a YYYY-MM-DD string, returning a YYYY-MM-DD string. */
function addDays(iso, days) {
  const [y, m, d] = iso.split('-').map(Number);
  return toISO(new Date(y, m - 1, d + days));
}
/** Show a YYYY-MM-DD date the Australian way, e.g. "11 Nov 2026". */
function formatDate(iso) {
  if (!iso) return '';
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString('en-AU', { day: 'numeric', month: 'short', year: 'numeric' });
}
/** Only allow normal web links, so a "javascript:" link can't sneak in. */
function safeUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' || url.protocol === 'http:' ? url.href : null;
  } catch {
    return null;
  }
}
function isFollowUpDue(app, today = todayISO()) {
  return Boolean(app.follow_up_on) && app.follow_up_on <= today && FOLLOW_UP_STATUSES.includes(app.status);
}
function pillClass(status) {
  return 'pill pill-' + status.toLowerCase();
}
function setMsg(node, text, kind) {
  node.textContent = text || '';
  node.className = 'form-msg' + (kind ? ' ' + kind : '');
}
function fillSelect(select, options) {
  select.replaceChildren(el('option', null, '— Choose —'));
  select.firstChild.value = '';
  for (const opt of options) {
    const o = el('option', null, opt);
    o.value = opt;
    select.append(o);
  }
}

// ---------- Login ----------

function showView(view) {
  els.loading.hidden = view !== 'loading';
  els.loginView.hidden = view !== 'login';
  els.appView.hidden = view !== 'app';
}

els.loginForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const email = els.loginEmail.value.trim();
  if (!els.loginEmail.checkValidity() || !email) {
    setMsg(els.loginMsg, 'Please enter a valid email address.', 'error');
    return;
  }
  els.loginBtn.disabled = true;
  setMsg(els.loginMsg, 'Sending…');
  const { error } = await db.auth.signInWithOtp({
    email,
    options: {
      // Send people back to this exact page (e.g. https://talhasiddiquiii.github.io/job-tracker/).
      // This address must also be in Supabase > Authentication > URL Configuration.
      emailRedirectTo: window.location.origin + window.location.pathname,
    },
  });
  els.loginBtn.disabled = false;
  if (error) {
    setMsg(els.loginMsg, 'Could not send the link: ' + error.message, 'error');
  } else {
    setMsg(els.loginMsg, 'Check your inbox for a login link. You can close this tab once you’ve opened it.', 'ok');
  }
});

els.logoutBtn.addEventListener('click', async () => {
  await db.auth.signOut();
});

// If a magic link has expired or was already used, Supabase puts the error in the URL.
function readAuthErrorFromUrl() {
  const params = new URLSearchParams(window.location.hash.slice(1) || window.location.search.slice(1));
  const description = params.get('error_description');
  if (description) {
    setMsg(els.loginMsg, description.replace(/\+/g, ' ') + ' Please request a new link.', 'error');
    history.replaceState(null, '', window.location.pathname);
  }
}

// ---------- Loading data ----------

async function loadApplications() {
  els.listMsg.textContent = 'Loading your applications…';
  // No "where user_id = me" needed: Row Level Security only returns your rows.
  const { data, error } = await db
    .from('applications')
    .select('*')
    .order('created_at', { ascending: false });
  if (error) {
    els.listMsg.textContent = 'Could not load applications: ' + error.message;
    return;
  }
  applications = data;
  render();
}

// ---------- Rendering ----------

function render() {
  renderSummary();
  renderFilters();
  renderList();
}

function renderSummary() {
  const today = todayISO();
  const applied = applications.filter((a) => a.status !== 'Saved').length;
  // Anything at Interview or Offer has reached the interview stage.
  const interviews = applications.filter((a) => a.status === 'Interview' || a.status === 'Offer').length;
  const offers = applications.filter((a) => a.status === 'Offer').length;
  const due = applications.filter((a) => isFollowUpDue(a, today)).length;
  const rate = applied ? Math.round((interviews / applied) * 100) : 0;

  $('s-applied').textContent = applied;
  $('s-interviews').textContent = interviews;
  $('s-offers').textContent = offers;
  $('s-rate').textContent = rate + '%';
  $('s-followups').textContent = due;
  $('s-followup-label').textContent = due === 1 ? 'Follow-up due' : 'Follow-ups due';
  els.followupBox.classList.toggle('has-due', due > 0);
  els.followupBox.setAttribute('aria-pressed', String(filter === 'FollowUps'));
}

function renderFilters() {
  const counts = {};
  for (const a of applications) counts[a.status] = (counts[a.status] || 0) + 1;

  const chips = ['All', ...STATUSES].map((name) => {
    const count = name === 'All' ? applications.length : counts[name] || 0;
    const chip = el('button', 'chip', `${name} (${count})`);
    chip.type = 'button';
    chip.setAttribute('aria-pressed', String(filter === name));
    chip.addEventListener('click', () => { filter = name; render(); });
    return chip;
  });
  els.filters.replaceChildren(...chips);
}

function renderList() {
  const today = todayISO();
  let shown = applications;
  if (filter === 'FollowUps') shown = applications.filter((a) => isFollowUpDue(a, today));
  else if (filter !== 'All') shown = applications.filter((a) => a.status === filter);

  if (applications.length === 0) {
    els.listMsg.textContent = 'No applications yet. Tap “Add” to record your first one.';
  } else if (shown.length === 0) {
    els.listMsg.textContent = filter === 'FollowUps' ? 'No follow-ups due. Nice work.' : `No applications with status “${filter}”.`;
  } else {
    els.listMsg.textContent = filter === 'FollowUps' ? 'Showing follow-ups due today or overdue.' : '';
  }

  els.list.replaceChildren(...shown.map((a) => renderCard(a, today)));
}

function renderCard(app, today) {
  const li = el('li');
  const card = el('button', 'card');
  card.type = 'button';
  card.setAttribute('aria-label', `Edit ${app.role} at ${app.company}, status ${app.status}`);

  const top = el('div', 'card-top');
  top.append(el('span', 'card-company', app.company), el('span', pillClass(app.status), app.status));

  const meta = el('div', 'card-meta');
  if (app.date_applied) meta.append(el('span', null, 'Applied ' + formatDate(app.date_applied)));
  if (app.source) meta.append(el('span', null, app.source));
  if (app.follow_up_on && FOLLOW_UP_STATUSES.includes(app.status)) {
    const due = isFollowUpDue(app, today);
    const label = due
      ? (app.follow_up_on === today ? 'Follow up today' : 'Follow-up overdue · ' + formatDate(app.follow_up_on))
      : 'Follow up ' + formatDate(app.follow_up_on);
    meta.append(el('span', due ? 'due' : null, label));
  }

  card.append(top, el('span', 'card-role', app.role));
  if (meta.childElementCount) card.append(meta);
  card.addEventListener('click', () => openForm(app));
  li.append(card);
  return li;
}

// ---------- Add / edit form ----------

function buildStatusPicker() {
  for (const status of STATUSES) {
    const input = el('input');
    input.type = 'radio';
    input.name = 'status';
    input.value = status;
    input.id = 'st-' + status;
    const label = el('label', pillClass(status), status);
    label.htmlFor = input.id;
    els.statusPicker.append(input, label);
  }
}

function openForm(app = null) {
  editingId = app ? app.id : null;
  els.form.reset();
  setMsg(els.formMsg, '');
  els.company.removeAttribute('aria-invalid');
  els.role.removeAttribute('aria-invalid');
  els.link.removeAttribute('aria-invalid');

  if (app) {
    els.formTitle.textContent = 'Edit application';
    els.company.value = app.company || '';
    els.role.value = app.role || '';
    els.dateApplied.value = app.date_applied || '';
    els.followUp.value = app.follow_up_on || '';
    els.roleType.value = app.role_type || '';
    els.source.value = app.source || '';
    els.cover.value = app.cover_letter || '';
    els.contact.value = app.contact || '';
    els.link.value = app.job_link || '';
    els.notes.value = app.notes || '';
    $('st-' + app.status).checked = true;
    // Keep auto-filling only if the follow-up still matches the 7-day default.
    followUpTouched = Boolean(app.follow_up_on) &&
      !(app.date_applied && app.follow_up_on === addDays(app.date_applied, FOLLOW_UP_DAYS));
    els.deleteBtn.hidden = false;
  } else {
    els.formTitle.textContent = 'Add application';
    const today = todayISO();
    els.dateApplied.value = today;
    els.followUp.value = addDays(today, FOLLOW_UP_DAYS);
    $('st-Applied').checked = true;
    followUpTouched = false;
    els.deleteBtn.hidden = true;
  }

  els.dialog.showModal();
  if (!app) els.company.focus();
}

function closeForm() {
  els.dialog.close();
  editingId = null;
}

// "Follow up on" = date applied + 7 days, unless you've changed it yourself.
els.dateApplied.addEventListener('change', () => {
  if (followUpTouched) return;
  els.followUp.value = els.dateApplied.value ? addDays(els.dateApplied.value, FOLLOW_UP_DAYS) : '';
});
els.followUp.addEventListener('change', () => { followUpTouched = true; });

els.cancelBtn.addEventListener('click', closeForm);

function readForm() {
  const value = (input) => input.value.trim() || null;
  return {
    company: els.company.value.trim(),
    role: els.role.value.trim(),
    status: els.form.elements.status.value || 'Saved',
    date_applied: els.dateApplied.value || null,
    follow_up_on: els.followUp.value || null,
    role_type: els.roleType.value || null,
    source: els.source.value || null,
    cover_letter: els.cover.value || null,
    contact: value(els.contact),
    job_link: value(els.link),
    notes: value(els.notes),
  };
}

function validate(row) {
  const problems = [];
  els.company.toggleAttribute('aria-invalid', !row.company);
  els.role.toggleAttribute('aria-invalid', !row.role);
  if (!row.company) problems.push('company');
  if (!row.role) problems.push('role');
  if (problems.length) return `Please fill in the ${problems.join(' and ')}.`;

  if (row.job_link) {
    const url = safeUrl(row.job_link);
    els.link.toggleAttribute('aria-invalid', !url);
    if (!url) return 'The job link needs to be a full web address starting with https://';
    row.job_link = url;
  }
  if (row.date_applied && row.follow_up_on && row.follow_up_on < row.date_applied) {
    return '“Follow up on” can’t be before the date applied.';
  }
  return null;
}

els.form.addEventListener('submit', async (e) => {
  e.preventDefault();
  const row = readForm();
  const problem = validate(row);
  if (problem) { setMsg(els.formMsg, problem, 'error'); return; }

  els.saveBtn.disabled = true;
  setMsg(els.formMsg, 'Saving…');

  // user_id isn't sent: the database fills it in from your login (see schema.sql).
  const query = editingId
    ? db.from('applications').update(row).eq('id', editingId).select().single()
    : db.from('applications').insert(row).select().single();
  const { data, error } = await query;

  els.saveBtn.disabled = false;
  if (error) { setMsg(els.formMsg, 'Could not save: ' + error.message, 'error'); return; }

  if (editingId) {
    applications = applications.map((a) => (a.id === data.id ? data : a));
  } else {
    applications = [data, ...applications];
  }
  closeForm();
  render();
});

els.deleteBtn.addEventListener('click', async () => {
  const app = applications.find((a) => a.id === editingId);
  if (!app) return;
  const ok = window.confirm(`Delete “${app.role}” at ${app.company}? This can’t be undone.`);
  if (!ok) return;

  els.deleteBtn.disabled = true;
  const { error } = await db.from('applications').delete().eq('id', app.id);
  els.deleteBtn.disabled = false;
  if (error) { setMsg(els.formMsg, 'Could not delete: ' + error.message, 'error'); return; }

  applications = applications.filter((a) => a.id !== app.id);
  closeForm();
  render();
});

// ---------- Other buttons ----------

els.addBtn.addEventListener('click', () => openForm());
els.followupBox.addEventListener('click', () => {
  filter = filter === 'FollowUps' ? 'All' : 'FollowUps';
  render();
});

// ---------- Start up ----------

fillSelect(els.roleType, ROLE_TYPES);
fillSelect(els.source, SOURCES);
fillSelect(els.cover, COVER_LETTERS);
buildStatusPicker();
readAuthErrorFromUrl();

let currentUserId = null;
db.auth.onAuthStateChange((_event, session) => {
  const userId = session?.user?.id ?? null;
  if (userId === currentUserId && userId !== null) return; // e.g. token refresh — nothing to redo
  currentUserId = userId;

  if (userId) {
    showView('app');
    // Run outside this callback, as Supabase recommends, to avoid a deadlock.
    setTimeout(loadApplications, 0);
  } else {
    applications = [];
    filter = 'All';
    if (els.dialog.open) els.dialog.close();
    els.list.replaceChildren();
    showView('login');
  }
});
