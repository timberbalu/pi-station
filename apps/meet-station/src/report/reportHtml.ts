import type { SessionReport } from '../types.js';

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

export function renderReportHtml(report: SessionReport): string {
  const transcriptHtml = report.transcript.map((segment) => `
    <article class="transcript-item">
      <strong>${escapeHtml(segment.speakerLabel ?? 'Speaker')}</strong>
      <p>${escapeHtml(segment.text)}</p>
    </article>
  `).join('');

  const marksHtml = report.insight_marks.map((mark) => `
    <article class="mark-item">
      <strong>${Math.round(mark.atMs / 1000)}s</strong>
      <p>${escapeHtml(mark.note ?? 'Insight mark')}</p>
      <small>${escapeHtml(mark.transcriptExcerpt ?? 'No excerpt available')}</small>
    </article>
  `).join('');

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${escapeHtml(report.title)} | MeetPaper Station Report</title>
    <style>
      :root {
        --paper: #F3ECD9;
        --paper-2: #ECE3CC;
        --ink: #1A1815;
        --accent: #7A1F2B;
        --teal: #00C49A;
      }
      body {
        margin: 0;
        font-family: Georgia, serif;
        color: var(--ink);
        background: linear-gradient(160deg, var(--paper), var(--paper-2));
      }
      main {
        max-width: 980px;
        margin: 0 auto;
        padding: 40px 20px 80px;
      }
      h1 {
        font-size: clamp(2.8rem, 8vw, 4.8rem);
        margin-bottom: 0.2em;
      }
      h1 span {
        color: var(--accent);
      }
      .deck, .transcript-item, .mark-item {
        background: rgba(255,255,255,0.55);
        border: 1px solid rgba(26,24,21,0.08);
        border-radius: 18px;
        padding: 18px 20px;
        margin-bottom: 16px;
      }
      .health {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
        gap: 12px;
      }
      .health div {
        padding: 16px;
        border-radius: 16px;
        background: rgba(0, 196, 154, 0.12);
      }
      strong {
        color: var(--accent);
      }
      small {
        color: #5f584f;
      }
    </style>
  </head>
  <body>
    <main>
      <h1>Meet<span>Paper</span> Report</h1>
      <section class="deck">
        <p><strong>Session:</strong> ${escapeHtml(report.title)}</p>
        <p><strong>Started:</strong> ${escapeHtml(report.started_at ?? 'Unknown')}</p>
        <p><strong>Stopped:</strong> ${escapeHtml(report.stopped_at ?? 'Unknown')}</p>
        <p><strong>Summary:</strong> ${escapeHtml(report.summary.note)}</p>
      </section>
      <section class="health">
        <div><strong>Segments</strong><br />${report.health.transcript_segments}</div>
        <div><strong>Queued Remaining</strong><br />${report.health.queued_segments_remaining}</div>
        <div><strong>Network Interruptions</strong><br />${report.health.network_interruptions}</div>
        <div><strong>STT Interruptions</strong><br />${report.health.stt_interruptions}</div>
      </section>
      <h2>Insight Marks</h2>
      ${marksHtml || '<p>No insight marks recorded.</p>'}
      <h2>Transcript</h2>
      ${transcriptHtml || '<p>No transcript available.</p>'}
    </main>
  </body>
</html>`;
}
