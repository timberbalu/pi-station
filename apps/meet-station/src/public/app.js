const statusGrid = document.querySelector('#status-grid');
const componentsSection = document.querySelector('#components-section');
const componentsGrid = document.querySelector('#components-grid');
const syncSection = document.querySelector('#sync-section');
const syncPhasesEl = document.querySelector('#sync-phases');
const transcriptEl = document.querySelector('#transcript');
const eventsEl = document.querySelector('#events');
const partialEl = document.querySelector('#partial');
const bannerEl = document.querySelector('#banner');
const bannerTitleEl = document.querySelector('#banner-title');
const bannerCopyEl = document.querySelector('#banner-copy');
const reportLinkEl = document.querySelector('#report-link');
const ingestEl = document.querySelector('#ingest');

async function request(path, options) {
  const response = await fetch(path, {
    headers: {
      'Content-Type': 'application/json',
    },
    ...options,
  });

  if (!response.ok) {
    const body = await response.json().catch(() => ({ error: response.statusText }));
    throw new Error(body.error || response.statusText);
  }

  return response.json();
}

async function refresh() {
  const [status, transcript, events, ingest] = await Promise.all([
    request('/status'),
    request('/transcript'),
    request('/events?limit=12'),
    request('/mock/ingest/segments'),
  ]);

  renderStatus(status);
  renderTranscript(transcript.segments);
  renderEvents(events.events);
  renderIngest(ingest.segments);
}

function renderStatus(status) {
  const timer = Math.floor(status.session.elapsed_ms / 1000);
  const minutes = String(Math.floor(timer / 60)).padStart(2, '0');
  const seconds = String(timer % 60).padStart(2, '0');

  const cards = [
    ['State', status.state],
    ['Timer', `${minutes}:${seconds}`],
    ['Session', status.session.session_code || 'unpaired'],
    ['Mic Source', status.mic.source],
    ['STT', `${status.stt.provider} / ${status.stt.connected ? 'connected' : 'offline'}`],
    ['Relay', status.relay.connected ? 'healthy' : 'queued'],
    ['Queue Depth', String(status.relay.queued_segments)],
    ['WAV Chunks', String(status.buffer.audio_chunks)],
    ['Seconds Safe', status.buffer.seconds_safe.toFixed(1)],
    ['Last Error', status.relay.last_error || 'none'],
  ];

  statusGrid.innerHTML = cards.map(([label, value]) => `
    <article class="status-card">
      <label>${label}</label>
      <strong>${value}</strong>
    </article>
  `).join('');

  partialEl.textContent = status.stt.current_partial ? `Partial: ${status.stt.current_partial}` : '';

  renderComponents(status.components || []);
  renderSync(status.sync);

  if (status.state === 'OFFLINE_BUFFERING') {
    bannerEl.hidden = false;
    bannerEl.className = 'banner banner-offline';
    bannerTitleEl.textContent = 'OFFLINE — AUDIO SAFE';
    bannerCopyEl.textContent = 'Segments queued locally. Recording continues.';
  } else if (status.state === 'SYNCING') {
    bannerEl.hidden = false;
    bannerEl.className = 'banner banner-syncing';
    bannerTitleEl.textContent = 'SYNCING';
    bannerCopyEl.textContent = 'Queued segments delivering in timestamp order.';
  } else if (status.state === 'RECORDING') {
    bannerEl.hidden = false;
    bannerEl.className = 'banner banner-recording';
    bannerTitleEl.textContent = 'Recording in progress.';
    bannerCopyEl.textContent = 'Audio is captured locally on this Station.';
  } else {
    bannerEl.hidden = true;
  }

  if (status.state === 'REPORT_READY' && status.session.session_id) {
    reportLinkEl.innerHTML = `<a href="/report/${status.session.session_id}" target="_blank" rel="noreferrer">Open local session report</a>`;
  } else {
    reportLinkEl.textContent = 'No report generated yet.';
  }
}

function renderComponents(components) {
  if (!components || components.length === 0) {
    componentsSection.hidden = true;
    return;
  }

  componentsSection.hidden = false;
  componentsGrid.innerHTML = components.map((c) => {
    const stateLabel = c.buffering ? 'buffering' : (c.healthy ? 'healthy' : 'degraded');
    const stateClass = c.buffering ? 'component-buffering' : (c.healthy ? 'component-healthy' : 'component-degraded');
    const voiceDetail = c.id === 'voice' && c.detail
      ? `<span class="comp-detail">mic: ${c.detail.mic?.source ?? '—'} &nbsp;|&nbsp; stt: ${c.detail.stt?.provider ?? '—'} &nbsp;|&nbsp; queued: ${c.queued_items}</span>`
      : `<span class="comp-detail">queued: ${c.queued_items}</span>`;
    return `
      <article class="component-card ${stateClass}">
        <div class="comp-header">
          <strong class="comp-label">${c.label}</strong>
          <span class="comp-state">${stateLabel}</span>
        </div>
        ${voiceDetail}
      </article>
    `;
  }).join('');
}

function phaseIcon(status) {
  switch (status) {
    case 'confirmed':
    case 'synced':
    case 'complete':
      return '\u2713'; // check
    case 'in_progress':
      return '\u21bb'; // refresh
    case 'skipped':
      return '\u2014'; // dash
    case 'failed':
      return '\u2715'; // cross
    default:
      return '\u25cb'; // circle
  }
}

function renderSync(sync) {
  if (!sync || !sync.session_id) {
    syncSection.hidden = true;
    return;
  }

  syncSection.hidden = false;

  const rows = [];
  rows.push(phaseRow(phaseIcon(sync.manifest), 'Session manifest', sync.manifest));
  rows.push(phaseRow(
    phaseIcon(sync.segments.status),
    'Transcript segments',
    `${sync.segments.delivered} / ${sync.segments.total} delivered`,
  ));
  rows.push(phaseRow(phaseIcon(sync.audio.status), 'Audio \u2192 S3', sync.audio.status));
  for (const chunk of sync.audio.chunks) {
    rows.push(chunkRow(chunk));
  }
  rows.push(phaseRow(phaseIcon(sync.video.status), 'Video \u2192 S3', sync.video.status));
  for (const chunk of sync.video.chunks) {
    rows.push(chunkRow(chunk));
  }
  rows.push(phaseRow(
    sync.sync_complete ? '\u2713' : '\u25cb',
    'Sync complete',
    sync.sync_complete ? 'done' : 'pending',
  ));
  if (sync.last_error) {
    rows.push(`<div class="sync-error">${sync.last_error}</div>`);
  }

  syncPhasesEl.innerHTML = rows.join('');
}

function phaseRow(icon, label, detail) {
  return `
    <div class="sync-phase">
      <span class="sync-icon">${icon}</span>
      <span class="sync-label">${label}</span>
      <span class="sync-detail">${detail}</span>
    </div>
  `;
}

function chunkRow(chunk) {
  const name = chunk.s3_key.split('/').pop();
  const detail = chunk.status === 'uploaded'
    ? 'uploaded'
    : `${chunk.status} (part ${chunk.parts_done}/${chunk.parts_total})`;
  return `
    <div class="sync-phase sync-chunk">
      <span class="sync-icon">${phaseIcon(chunk.status === 'uploaded' ? 'complete' : chunk.status)}</span>
      <span class="sync-label">${name}</span>
      <span class="sync-detail">${detail}</span>
    </div>
  `;
}

function renderTranscript(segments) {
  transcriptEl.innerHTML = segments.map((segment) => `
    <article class="transcript-entry">
      <strong>${segment.speakerLabel || 'Speaker'}</strong>
      <div>${segment.text}</div>
    </article>
  `).join('') || '<p>No transcript yet.</p>';
}

function renderEvents(events) {
  eventsEl.innerHTML = events.map((event) => `
    <article class="event-entry">
      <strong>${event.type}</strong>
      <div>${event.message}</div>
      <small>${event.createdAt}</small>
    </article>
  `).join('') || '<p>No events yet.</p>';
}

function renderIngest(segments) {
  ingestEl.innerHTML = segments.slice(-6).reverse().map((segment) => `
    <article class="ingest-entry">
      <strong>#${segment.sequence}</strong>
      <div>${segment.text}</div>
    </article>
  `).join('') || '<p>No segments delivered yet.</p>';
}

async function handleAction(action) {
  switch (action) {
    case 'pair': {
      const sessionCode = document.querySelector('#session-code').value;
      const sessionTitle = document.querySelector('#session-title').value;
      await request('/pair', {
        method: 'POST',
        body: JSON.stringify({ session_code: sessionCode, title: sessionTitle }),
      });
      break;
    }
    case 'mark':
      await request('/mark', { method: 'POST', body: JSON.stringify({}) });
      break;
    case 'start':
    case 'pause':
    case 'resume':
    case 'stop':
      await request(`/${action}`, { method: 'POST' });
      break;
    case 'network-down':
      await request('/simulate/network/down', { method: 'POST' });
      break;
    case 'network-up':
      await request('/simulate/network/up', { method: 'POST' });
      break;
    case 'stt-drop':
      await request('/simulate/stt/drop', { method: 'POST' });
      break;
    case 'stt-up':
      await request('/simulate/stt/reconnect', { method: 'POST' });
      break;
    default:
      break;
  }

  await refresh();
}

document.querySelectorAll('button[data-action]').forEach((button) => {
  button.addEventListener('click', async () => {
    const action = button.getAttribute('data-action');
    if (!action) {
      return;
    }

    try {
      await handleAction(action);
    } catch (error) {
      window.alert(error instanceof Error ? error.message : 'Request failed');
    }
  });
});

refresh().catch((error) => {
  console.error(error);
});
setInterval(() => {
  void refresh();
}, 1500);
