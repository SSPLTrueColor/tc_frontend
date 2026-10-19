/** Contextual help registry (page-level) + prototype boundary disclosure. */
const PAGE_HELP: Record<string, { title: string; body: string[] }> = {
  home: { title: 'Overview', body: ['The overview adapts to your role: front desk sees today’s arrivals, billing sees balances, managers see everything they can access.', 'Every number links to the list it summarizes.'] },
  scheduling: {
    title: 'Scheduling',
    body: [
      'Rooms are exclusive: overlapping in-person bookings in the same room are rejected.',
      'Clinician double-booking and non-working days are warnings that only a practice manager can override, with an audited reason.',
      'Use Day schedule or the Room calendar view and click an empty slot to book.',
    ],
  },
  patients: { title: 'Patients', body: ['Register patients with the step-by-step wizard (drafts autosave locally) or Quick add.', 'Phone and email are masked by default. Roles with sensitive-data access can reveal them with the eye icon; others see masked values everywhere, including exports and search.'] },
  billing: { title: 'Billing', body: ['Invoices are created on a full-page form with line items.', '“Record payment” records money you already received — nothing is charged.', 'Write-offs require approval by a different person (separation of duties).'] },
  work: { title: 'Work', body: ['Tasks, approvals and notifications are separate: completing a task never approves a request, and reading a notification never completes anything.'] },
  resources: { title: 'Staff & rooms', body: ['Rooms set to maintenance cannot be booked. Staff working days drive scheduling warnings.'] },
  admin: { title: 'Administration', body: ['Configuration changes follow Draft → Validate → Publish. Published versions are recorded and cannot be edited.', 'Audit log and Event trace are local simulations of server-side ledgers.'] },
};

export function HelpContent({ mod }: { mod: string }) {
  const h = PAGE_HELP[mod] ?? PAGE_HELP.home;
  return (
    <div className="help">
      <section>
        <h3>{h.title}</h3>
        <ul className="plain-list bullets">
          {h.body.map((b) => (
            <li key={b}>{b}</li>
          ))}
        </ul>
      </section>
      <section>
        <h3>What is real in this prototype</h3>
        <ul className="plain-list bullets">
          <li>All data is fictional and generated from a fixed seed. It is stored only in this browser’s local storage.</li>
          <li>Role switching simulates sign-in. Permissions are enforced by an in-browser service layer — a model of server rules, not a security boundary.</li>
          <li>No messages, emails, payments, payer claims or external referrals are sent. Buttons that would do so are disabled and say why.</li>
          <li>The audit log and event trace are local simulations; they are not tamper-evident and nothing is delivered to other systems.</li>
          <li>The AI assistant entry is present for layout only and is not enabled.</li>
          <li>This is administrative software only. It provides no clinical advice or decision support.</li>
        </ul>
      </section>
      <section>
        <h3>Keyboard</h3>
        <ul className="plain-list bullets">
          <li>
            <kbd>Ctrl</kbd>/<kbd>⌘</kbd> + <kbd>K</kbd> — search pages, views and records
          </li>
          <li>
            <kbd>↑</kbd>/<kbd>↓</kbd> move between grid rows, <kbd>Enter</kbd> opens, <kbd>Space</kbd> selects
          </li>
          <li>
            <kbd>Esc</kbd> closes the topmost panel or dialog
          </li>
          <li>
            <kbd>Ctrl</kbd> + <kbd>Enter</kbd> sends a quick comment
          </li>
        </ul>
      </section>
    </div>
  );
}
