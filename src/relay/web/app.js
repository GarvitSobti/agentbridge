const byId = id => document.getElementById(id);
const gate = byId('gate');
const gateMessage = byId('gate-message');
const account = byId('account');
const workspace = byId('workspace');
const list = byId('requests');
const detail = byId('detail');
const signIn = byId('sign-in');
const retry = byId('try-again');
const refreshButton = byId('refresh');
const signOut = byId('sign-out');
const feedback = byId('feedback');

let invite = new URLSearchParams(location.hash.slice(1)).get('invite');
if (location.hash) history.replaceState(null, '', location.pathname);

const states = {
  pending: 'Needs approval',
  accepted: 'Accepted',
  in_progress: 'In progress',
  completed: 'Completed',
  declined: 'Declined',
  cancelled: 'Cancelled',
};
const eventLabels = {
  'request.create': 'Requested handoff',
  'request.accept': 'Accepted request',
  'request.decline': 'Declined request',
  'request.start': 'Started work',
  'request.complete': 'Reported completion',
  'request.cancel': 'Cancelled request',
  'request.reply': 'Replied',
  'decision.propose': 'Proposed a decision revision',
  'decision.agree': 'Agreed to a revision',
};
const timeFormat = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' });

let view;
let selectedId;
let load;
let acting = false;
let pendingDecision;
let listSignature;
let detailSignature;

function element(tag, text, className) {
  const node = document.createElement(tag);
  if (text !== undefined) node.textContent = text;
  if (className) node.className = className;
  return node;
}

function chip(status) {
  const node = element('span', states[status] ?? status, 'chip');
  node.dataset.status = status;
  return node;
}

function timestamp(value) {
  const node = element('time', timeFormat.format(new Date(value)));
  node.dateTime = value;
  return node;
}

async function api(route, { data, signal } = {}) {
  const timeout = AbortSignal.timeout(10_000);
  const response = await fetch('/workspace/api/' + route, {
    method: data ? 'POST' : 'GET',
    signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
    credentials: 'same-origin',
    redirect: 'error',
    ...(data ? { headers: { 'content-type': 'application/json' }, body: JSON.stringify(data) } : {}),
  });
  const type = response.headers.get('content-type') || '';
  if (!type.startsWith('application/json')) throw new Error('The relay returned an unexpected response. Check your connection and try again.');
  const result = await response.json();
  if (!response.ok) throw Object.assign(new Error(result.error?.message || 'Request failed. Try again.'), {
    code: result.error?.code,
    status: response.status,
  });
  return result;
}

function showGate(message, canRetry = false) {
  view = undefined;
  selectedId = undefined;
  pendingDecision = undefined;
  listSignature = undefined;
  detailSignature = undefined;
  list.replaceChildren();
  detail.replaceChildren();
  workspace.hidden = true;
  account.hidden = true;
  gate.hidden = false;
  gateMessage.textContent = message;
  signIn.hidden = !invite;
  retry.hidden = !canRetry;
}

function renderList(snapshot) {
  const signature = JSON.stringify([snapshot.requests, snapshot.request?.id]);
  if (signature === listSignature) return;
  listSignature = signature;
  const focusedId = list.contains(document.activeElement) ? document.activeElement.dataset.id : undefined;
  list.replaceChildren();
  for (const request of snapshot.requests) {
    const button = element('button', undefined, 'request-row');
    button.type = 'button';
    button.dataset.id = request.id;
    if (request.id === snapshot.request?.id) button.setAttribute('aria-current', 'true');
    const people = request.recipientId === snapshot.participant ? 'From ' + request.requesterId : 'To ' + request.recipientId;
    const meta = element('span', undefined, 'row-meta');
    meta.append(element('span', people), chip(request.status));
    button.append(element('span', request.title, 'row-title'), meta);
    const row = element('li');
    row.append(button);
    list.append(row);
    if (request.id === focusedId) button.focus({ preventScroll: true });
  }
  byId('empty-list').hidden = snapshot.requests.length !== 0;
}

function section(title, className) {
  const node = element('section', undefined, className);
  node.append(element('h3', title));
  return node;
}

function notesFor(request) {
  if (!request.messages.length && !request.decisions.length && !request.references.length) return null;
  const notes = section('Handoff context', 'notes');
  if (request.references.length) {
    const refs = element('ul');
    for (const ref of request.references) refs.append(element('li', ref.path + (ref.commit ? ' · ' + ref.commit : '')));
    notes.append(refs);
  }
  for (const { revisions } of request.decisions) {
    const latest = revisions.at(-1);
    if (!latest) continue;
    const acknowledged = latest.acknowledgments.map(item => item.participantId).join(', ');
    const heading = 'Decision revision ' + latest.revision + (acknowledged ? ' · Agreed by ' + acknowledged : ' · Awaiting agreement');
    notes.append(element('p', heading, 'muted'), element('p', latest.text));
  }
  for (const message of request.messages.slice(-20)) {
    notes.append(element('p', message.author.participantId + ' · ' + message.author.role, 'muted'), element('p', message.body));
  }
  return notes;
}

function completionFor(completion) {
  const block = section('Reported completion', 'evidence');
  block.append(element('p', completion.summary));
  const meta = element('dl');
  for (const [label, value] of [['Branch', completion.branch], ['Commit', completion.commit]]) {
    const data = element('dd');
    data.append(element('code', value));
    meta.append(element('dt', label), data);
  }
  block.append(meta);
  const checks = element('ul');
  const outcomes = { passed: 'Passed', failed: 'Failed', not_run: 'Not run' };
  for (const check of completion.checks) {
    const item = element('li');
    item.append(element('code', check.command), ' · ' + outcomes[check.outcome]);
    if (check.details) item.append(element('p', check.details, 'muted'));
    checks.append(item);
  }
  block.append(checks);
  return block;
}

function renderDetail(snapshot) {
  const { request, events, participant } = snapshot;
  const signature = JSON.stringify([participant, request, events]);
  if (signature === detailSignature) return;
  detailSignature = signature;
  const focusInside = detail.contains(document.activeElement);
  detail.replaceChildren();
  if (!request) {
    detail.append(element('h2', 'No requests yet', 'request-title'),
      element('p', 'New handoffs from your agents will appear here.', 'detail-meta'));
    return;
  }
  const heading = element('h2', request.title, 'request-title');
  heading.tabIndex = -1;
  detail.append(chip(request.status), heading,
    element('p', request.requesterId + ' → ' + request.recipientId + ' · Version ' + request.version, 'detail-meta'),
    element('p', request.body, 'detail-body'));

  if (request.status === 'pending' && request.recipientId === participant) {
    const approval = section('Your approval is needed', 'approval');
    approval.append(element('p', 'Accept to let your agent pick up this request.'));
    const bar = element('div', undefined, 'action-bar');
    for (const [action, label, style] of [
      ['accept', 'Accept request', 'primary'],
      ['decline', 'Decline', 'secondary'],
    ]) {
      const button = element('button', label, style);
      button.type = 'button';
      button.dataset.action = action;
      button.disabled = acting;
      bar.append(button);
    }
    approval.append(bar);
    detail.append(approval);
  }
  if (request.completion) detail.append(completionFor(request.completion));
  const notes = notesFor(request);
  if (notes) detail.append(notes);

  const activity = section('Activity');
  const timeline = element('ol', undefined, 'timeline');
  for (const event of events.toReversed()) {
    const item = element('li');
    const meta = element('span', event.actor.participantId + ' · ' + event.actor.role + ' · ', 'timeline-meta');
    meta.append(timestamp(event.at));
    item.append(element('strong', eventLabels[event.operation] ?? event.operation), meta);
    timeline.append(item);
  }
  activity.append(timeline);
  detail.append(activity);
  if (focusInside) heading.focus({ preventScroll: true });
}

async function refresh({ focus = false } = {}) {
  load?.abort();
  const controller = new AbortController();
  load = controller;
  refreshButton.disabled = true;
  try {
    const query = selectedId ? '?request=' + encodeURIComponent(selectedId) : '';
    const next = await api('inbox' + query, { signal: controller.signal });
    if (load !== controller) return;
    view = next;
    gate.hidden = true;
    workspace.hidden = false;
    account.hidden = false;
    byId('identity').textContent = view.participant;
    byId('repo-name').textContent = view.workspace.repository;
    selectedId ??= view.request?.id;

    renderList(view);
    renderDetail(view);
    if (feedback.dataset.connection === 'interrupted') {
      feedback.textContent = '';
      delete feedback.dataset.connection;
    }
    if (focus) {
      detail.querySelector('h2')?.focus({ preventScroll: true });
      if (matchMedia('(max-width: 43rem)').matches) detail.scrollIntoView({ block: 'start' });
    }
  } catch (error) {
    if (load !== controller || controller.signal.aborted) return;
    if (error.code === 'SESSION_REQUIRED') {
      showGate(invite ? 'You have an invite to this workspace.' : 'Open a current invite to sign in.');
    } else if (view) {
      feedback.dataset.connection = 'interrupted';
      feedback.textContent = 'Could not refresh the inbox. Try again when your connection is back.';
    } else {
      showGate('Could not reach the workspace. Try again.', true);
    }
  } finally {
    if (load === controller) {
      load = undefined;
      refreshButton.disabled = false;
    }
  }
}

function setActing(value) {
  acting = value;
  signOut.disabled = value;
  for (const button of detail.querySelectorAll('button[data-action]')) button.disabled = value;
}

async function decide(action) {
  const request = view?.request;
  if (acting || !request || request.id !== selectedId || request.status !== 'pending') return;
  const type = 'request.' + action;
  if (pendingDecision?.type !== type || pendingDecision?.requestId !== request.id || pendingDecision.expectedVersion !== request.version) {
    pendingDecision = { type, requestId: request.id, expectedVersion: request.version, retryKey: crypto.randomUUID() };
  }
  setActing(true);
  delete feedback.dataset.connection;
  feedback.textContent = 'Saving your decision…';
  try {
    await api('decision', { data: pendingDecision });
    pendingDecision = undefined;
    feedback.textContent = action === 'accept' ? 'Request accepted.' : 'Request declined.';
    await refresh();
  } catch (error) {
    if (error.status === 409 || error.code === 'SESSION_REQUIRED') {
      pendingDecision = undefined;
      await refresh();
      feedback.textContent = error.status === 409 ? 'The request changed. Review the updated version before deciding.' : 'Your session ended. Open a new invite.';
    } else {
      feedback.textContent = 'Could not confirm your decision. Refresh to check its status or retry.';
    }
  } finally {
    setActing(false);
  }
}

signIn.addEventListener('click', async () => {
  if (!invite) return;
  signIn.disabled = true;
  try {
    await api('sign-in', { data: { invite } });
    invite = null;
    await refresh();
  } catch (error) {
    if (error.code === 'INVITE_INVALID') {
      invite = null;
      showGate(error.message, true);
    } else gateMessage.textContent = 'Could not open the workspace. Try again.';
  } finally {
    signIn.disabled = false;
  }
});

signOut.addEventListener('click', async () => {
  if (acting) return;
  setActing(true);
  try {
    await api('sign-out', { data: {} });
    const active = load;
    load = undefined;
    active?.abort();
    showGate('Signed out. Open a new invite to return.');
    feedback.textContent = '';
  } catch {
    feedback.textContent = 'Could not sign out. Try again.';
  } finally {
    setActing(false);
  }
});

list.addEventListener('click', event => {
  const button = event.target.closest('button[data-id]');
  if (!button || acting) return;
  selectedId = button.dataset.id;
  void refresh({ focus: true });
});
detail.addEventListener('click', event => {
  const button = event.target.closest('button[data-action]');
  if (button) void decide(button.dataset.action);
});
retry.addEventListener('click', () => { void refresh(); });
refreshButton.addEventListener('click', () => { if (!acting) void refresh(); });

function backgroundRefresh() {
  if (view && !acting && !load && !document.hidden) void refresh();
}
document.addEventListener('visibilitychange', backgroundRefresh);
setInterval(backgroundRefresh, 5_000);

if (invite) showGate('You have an invite to this workspace.');
else void refresh();
