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
  archiveBtn: $('archive-btn'),
  statusDialog: $('status-dialog'),
  statusSub: $('status-sub'),
  statusList: $('status-list'),
  statusCancel: $('status-cancel'),
  toast: $('toast'),
  toastText: $('toast-text'),
  toastAction: $('toast-action'),
  tip: $('tip'),
  tipClose: $('tip-close'),
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
  return !app.archived && Boolean(app.follow_up_on) && app.follow_up_on <= today &&
    FOLLOW_UP_STATUSES.includes(app.status);
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
  const active = applications.filter((a) => !a.archived);
  const counts = { All: active.length, Archived: applications.length - active.length };
  for (const a of active) counts[a.status] = (counts[a.status] || 0) + 1;

  const chips = ['All', ...STATUSES, 'Archived'].map((name) => {
    const count = counts[name] || 0;
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
  // Archived applications only appear under the "Archived" filter.
  const active = applications.filter((a) => !a.archived);
  let shown;
  if (filter === 'FollowUps') shown = active.filter((a) => isFollowUpDue(a, today));
  else if (filter === 'Archived') shown = applications.filter((a) => a.archived);
  else if (filter === 'All') shown = active;
  else shown = active.filter((a) => a.status === filter);

  if (applications.length === 0) {
    els.listMsg.textContent = 'No applications yet. Tap “Add” to record your first one.';
  } else if (shown.length === 0) {
    els.listMsg.textContent =
      filter === 'FollowUps' ? 'No follow-ups due. Nice work.'
      : filter === 'Archived' ? 'Nothing archived. Swipe a card left to archive it.'
      : filter === 'All' ? 'Everything is archived. Tap “Archived” to see them.'
      : `No applications with status “${filter}”.`;
  } else {
    els.listMsg.textContent = filter === 'FollowUps' ? 'Showing follow-ups due today or overdue.' : '';
  }

  openRow = null;
  els.list.replaceChildren(...shown.map((a) => renderCard(a, today)));
  showTipIfNeeded(shown.length > 0);
}

function renderCard(app, today) {
  const li = el('li', 'swipe-row');
  const card = el('button', 'card' + (app.archived ? ' card-archived' : ''));
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

  if (app.archived) meta.append(el('span', null, 'Archived'));

  card.append(top, el('span', 'card-role', app.role));
  if (meta.childElementCount) card.append(meta);

  // The buttons hidden underneath the card, revealed by swiping.
  // Swipe right shows the left-hand set; swipe left shows the right-hand set.
  const leftActions = el('div', 'swipe-actions swipe-actions-left');
  leftActions.append(
    actionButton('Edit', 'act-edit', () => { closeRow(li); openForm(app); }),
    actionButton('Status', 'act-status', () => { closeRow(li); openStatusPicker(app); }),
  );
  const rightActions = el('div', 'swipe-actions swipe-actions-right');
  rightActions.append(
    actionButton(app.archived ? 'Unarchive' : 'Archive', 'act-archive', () => { closeRow(li); toggleArchive(app); }),
    actionButton('Delete', 'act-delete', () => { closeRow(li); deleteApplication(app); }),
  );
  leftActions.inert = true;
  rightActions.inert = true;

  li.append(leftActions, rightActions, card);
  enableSwipe(li, card, leftActions, rightActions, () => openForm(app));
  return li;
}

function actionButton(label, className, onClick) {
  const btn = el('button', 'swipe-btn ' + className, label);
  btn.type = 'button';
  btn.addEventListener('click', onClick);
  return btn;
}

// ---------- Swiping ----------
// How it works: we follow the finger sideways and slide the card with it
// (a CSS "transform"). When you let go, it snaps open if you dragged more than
// halfway across the buttons, otherwise it springs back. Up/down movement is
// left alone so the page still scrolls normally.

const ACTION_WIDTH = 176;  // two 88px buttons
const DRAG_START = 10;     // pixels of movement before we decide it's a swipe
let openRow = null;        // only one card is open at a time

function setOffset(row, x, animate = true) {
  const { card, left, right } = row._swipe;
  card.style.transition = animate ? '' : 'none';
  card.style.transform = x ? `translateX(${x}px)` : '';
  row._swipe.offset = x;
  row.classList.toggle('show-left', x > 0);
  row.classList.toggle('show-right', x < 0);
  // Hidden buttons can't be reached by keyboard or screen reader until revealed.
  left.inert = !(x >= ACTION_WIDTH);
  right.inert = !(x <= -ACTION_WIDTH);
  if (x !== 0) openRow = row;
  else if (openRow === row) openRow = null;
}

function closeRow(row) {
  if (row) setOffset(row, 0);
}

function enableSwipe(row, card, left, right, onTap) {
  row._swipe = { card, left, right, offset: 0 };
  let startX = 0, startY = 0, startOffset = 0, x = 0;
  let tracking = false, dragging = false, justDragged = false;

  card.addEventListener('pointerdown', (e) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    if (openRow && openRow !== row) closeRow(openRow);
    tracking = true;
    dragging = false;
    startX = e.clientX;
    startY = e.clientY;
    startOffset = row._swipe.offset;
  });

  card.addEventListener('pointermove', (e) => {
    if (!tracking) return;
    const dx = e.clientX - startX;
    const dy = e.clientY - startY;
    if (!dragging) {
      if (Math.abs(dy) > DRAG_START && Math.abs(dy) > Math.abs(dx)) { tracking = false; return; } // scrolling
      if (Math.abs(dx) < DRAG_START) return;
      dragging = true;
      card.setPointerCapture(e.pointerId);
    }
    // Let it stretch a little past the buttons, then stop.
    const max = ACTION_WIDTH * 1.25;
    x = Math.max(-max, Math.min(max, startOffset + dx));
    setOffset(row, x, false);
  });

  const finish = () => {
    if (!tracking) return;
    tracking = false;
    if (!dragging) return;
    dragging = false;
    justDragged = true; // the "click" that follows a drag isn't a tap
    setTimeout(() => { justDragged = false; }, 50);
    const snap = x > ACTION_WIDTH / 2 ? ACTION_WIDTH : x < -ACTION_WIDTH / 2 ? -ACTION_WIDTH : 0;
    setOffset(row, snap);
    if (snap) dismissTip();
  };
  card.addEventListener('pointerup', finish);
  card.addEventListener('pointercancel', finish);

  card.addEventListener('click', () => {
    if (justDragged) return;
    if (row._swipe.offset !== 0) { closeRow(row); return; } // tapping an open card closes it
    onTap();
  });
}

// Tapping anywhere else closes an open card.
document.addEventListener('pointerdown', (e) => {
  if (openRow && !openRow.contains(e.target)) closeRow(openRow);
});

// ---------- Actions shared by swiping and the form ----------

/** Save some changes to one application and redraw. Returns true if it worked. */
async function updateApplication(id, changes) {
  const { data, error } = await db.from('applications').update(changes).eq('id', id).select().single();
  if (error) { showToast('Could not save: ' + error.message); return false; }
  applications = applications.map((a) => (a.id === data.id ? data : a));
  render();
  return true;
}

async function toggleArchive(app) {
  const archived = !app.archived;
  const ok = await updateApplication(app.id, { archived });
  if (!ok) return;
  showToast(archived ? `Archived ${app.company}` : `Restored ${app.company}`, 'Undo', () => {
    updateApplication(app.id, { archived: !archived });
  });
}

async function deleteApplication(app) {
  const ok = window.confirm(`Delete “${app.role}” at ${app.company}? This can’t be undone.`);
  if (!ok) return false;
  const { error } = await db.from('applications').delete().eq('id', app.id);
  if (error) { showToast('Could not delete: ' + error.message); return false; }
  applications = applications.filter((a) => a.id !== app.id);
  render();
  showToast(`Deleted ${app.company}`);
  return true;
}

// ---------- Quick status picker ----------

let statusTarget = null;

function openStatusPicker(app) {
  statusTarget = app;
  els.statusSub.textContent = `${app.role} at ${app.company}`;
  els.statusList.replaceChildren(...STATUSES.map((status) => {
    const btn = el('button', 'status-option ' + pillClass(status), status);
    btn.type = 'button';
    btn.setAttribute('aria-pressed', String(status === app.status));
    btn.addEventListener('click', () => chooseStatus(status));
    return btn;
  }));
  els.statusDialog.showModal();
}

async function chooseStatus(status) {
  const app = statusTarget;
  els.statusDialog.close();
  if (!app || status === app.status) return;
  const changes = { status };
  // Moving out of "Saved" means you've just applied: fill in today's date and
  // the 7-day follow-up, the same as the form does, if they're empty.
  if (app.status === 'Saved' && status !== 'Saved' && !app.date_applied) {
    changes.date_applied = todayISO();
    if (!app.follow_up_on) changes.follow_up_on = addDays(changes.date_applied, FOLLOW_UP_DAYS);
  }
  if (await updateApplication(app.id, changes)) showToast(`${app.company} moved to ${status}`);
}

els.statusCancel.addEventListener('click', () => els.statusDialog.close());
// Tapping the dark area around the sheet closes it.
els.statusDialog.addEventListener('click', (e) => {
  if (e.target === els.statusDialog) els.statusDialog.close();
});

// ---------- Toast messages ----------

let toastTimer = null;
function showToast(text, actionLabel, onAction) {
  els.toastText.textContent = text;
  els.toastAction.hidden = !actionLabel;
  els.toastAction.textContent = actionLabel || '';
  els.toastAction.onclick = actionLabel ? () => { hideToast(); onAction(); } : null;
  els.toast.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(hideToast, 5000);
}
function hideToast() {
  els.toast.hidden = true;
}

// ---------- First-time tip ----------
// Remembered in this browser only (localStorage), so it's just a convenience.

function tipDismissed() {
  try { return localStorage.getItem('swipeTipDismissed') === '1'; } catch { return false; }
}
function dismissTip() {
  els.tip.hidden = true;
  try { localStorage.setItem('swipeTipDismissed', '1'); } catch { /* private mode: fine */ }
}
function showTipIfNeeded(hasCards) {
  els.tip.hidden = !hasCards || tipDismissed();
}
els.tipClose.addEventListener('click', dismissTip);

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
    els.archiveBtn.hidden = false;
    els.archiveBtn.textContent = app.archived ? 'Unarchive' : 'Archive';
  } else {
    els.formTitle.textContent = 'Add application';
    const today = todayISO();
    els.dateApplied.value = today;
    els.followUp.value = addDays(today, FOLLOW_UP_DAYS);
    $('st-Applied').checked = true;
    followUpTouched = false;
    els.deleteBtn.hidden = true;
    els.archiveBtn.hidden = true;
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
  els.deleteBtn.disabled = true;
  const deleted = await deleteApplication(app);
  els.deleteBtn.disabled = false;
  if (deleted) closeForm();
});

els.archiveBtn.addEventListener('click', async () => {
  const app = applications.find((a) => a.id === editingId);
  if (!app) return;
  closeForm();
  await toggleArchive(app);
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
    if (els.statusDialog.open) els.statusDialog.close();
    hideToast();
    els.list.replaceChildren();
    showView('login');
  }
});
