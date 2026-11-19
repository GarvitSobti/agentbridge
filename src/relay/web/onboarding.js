export function bindOnboarding(api, refresh) {
  const byId = id => document.getElementById(id);
  const form = byId('create-workspace');
  const setup = byId('workspace-setup');
  const inviteButton = byId('issue-invite');
  const pairButton = byId('issue-pair');
  const status = byId('setup-status');
  const inviteOutput = byId('invite-output');
  const pairOutput = byId('pair-output');
  const client = byId('assistant-client');
  let owner;
  let snapshot;
  let pending = false;
  let order = 0;

  function hideOutput(output) {
    output.hidden = true;
    for (const field of output.querySelectorAll('input')) field.value = '';
  }

  function reset() {
    order += 1;
    owner = undefined;
    snapshot = undefined;
    pending = false;
    form.hidden = true;
    form.reset();
    byId('create-error').textContent = '';
    setup.hidden = true;
    setup.open = false;
    hideOutput(inviteOutput);
    hideOutput(pairOutput);
    status.textContent = '';
    inviteButton.disabled = false;
    pairButton.disabled = false;
  }

  function start(token) {
    owner = token;
    form.hidden = false;
  }

  function command() {
    byId('setup-command').value = 'node src/cli/connect.ts --origin ' + JSON.stringify(location.origin) + ' --client ' + client.value;
  }

  function render(view) {
    const previous = snapshot;
    snapshot = view.setup;
    if (!snapshot) return;
    form.hidden = true;
    setup.hidden = false;
    if (!previous) setup.open = snapshot.paired.length < 2;
    const paired = snapshot.paired.includes(view.participant);
    if (paired && previous && !previous.paired.includes(view.participant) && !pairOutput.hidden) {
      hideOutput(pairOutput);
      status.textContent = 'Your agent is paired. Open or restart your assistant to load the connector.';
    }
    byId('teammate-invite').hidden = !snapshot.canInvite;
    byId('teammate-label').textContent = snapshot.teammate;
    const members = [snapshot.owner, snapshot.teammate];
    byId('setup-members').replaceChildren(...members.map(name => {
      const item = document.createElement('li');
      const member = document.createElement('strong');
      const connection = document.createElement('span');
      member.textContent = name + (name === view.participant ? ' (you)' : '');
      connection.textContent = snapshot.paired.includes(name) ? 'Agent paired' : 'Agent setup pending';
      item.append(member, connection);
      return item;
    }));
    pairButton.textContent = paired ? 'Replace paired device' : 'Generate pairing code';
    command();
  }

  form.addEventListener('submit', async event => {
    event.preventDefault();
    if (!owner || pending) return;
    pending = true;
    const current = ++order;
    const submit = form.querySelector('button[type=submit]');
    submit.disabled = true;
    byId('create-error').textContent = 'Creating workspace…';
    const fields = Object.fromEntries(new FormData(form));
    try {
      await api('create', { data: { ...fields, invite: owner } });
      if (current !== order) return;
      owner = undefined;
      form.hidden = true;
      byId('gate-message').textContent = 'Opening your workspace…';
      await refresh();
    } catch (error) {
      if (current !== order) return;
      byId('create-error').textContent = error.code ? error.message : 'Could not create the workspace. Check your connection and try again.';
      if (error.code === 'WORKSPACE_EXISTS') await refresh();
    } finally {
      if (current === order) pending = false;
      submit.disabled = false;
    }
  });

  async function issue(route, output, field, key) {
    if (pending || !snapshot) return;
    pending = true;
    const current = order;
    inviteButton.disabled = true;
    pairButton.disabled = true;
    hideOutput(output);
    status.textContent = route === 'invite' ? 'Creating invite…' : 'Creating pairing code…';
    try {
      const result = await api(route, { data: {} });
      if (current !== order) return;
      field.value = result[key];
      if (route !== 'invite') command();
      output.hidden = false;
      field.focus();
      field.select();
      status.textContent = route === 'invite' ? 'Invite ready. Share it privately with your teammate.' : 'The code expires in 10 minutes. Pairing replaces your previous device.';
    } catch (error) {
      if (current !== order) return;
      status.textContent = error.code === 'SESSION_REQUIRED'
        ? 'Your session expired. Open a current invite to continue.'
        : 'Could not make a new link or code. Check the connection and try again.';
    } finally {
      if (current === order) {
        pending = false;
        inviteButton.disabled = false;
        pairButton.disabled = false;
      }
    }
  }

  inviteButton.addEventListener('click', () => issue('invite', inviteOutput, byId('teammate-link'), 'url'));
  pairButton.addEventListener('click', () => issue('pair-code', pairOutput, byId('pairing-code'), 'code'));
  client.addEventListener('change', command);
  for (const button of setup.querySelectorAll('button[data-copy]')) {
    button.addEventListener('click', async () => {
      const field = byId(button.dataset.copy);
      if (!field.value) return;
      const current = order;
      try {
        await navigator.clipboard.writeText(field.value);
        if (current === order) status.textContent = 'Copied to clipboard.';
      } catch {
        if (current !== order) return;
        field.focus();
        field.select();
        status.textContent = 'Copy the selected text.';
      }
    });
  }
  return { reset, start, render };
}
