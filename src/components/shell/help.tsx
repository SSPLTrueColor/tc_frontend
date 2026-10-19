/** Contextual help registry (module-level) + prototype boundary disclosure (COM-12). */
const PAGE_HELP: Record<string, { title: string; body: string[] }> = {
  home: {
    title: 'Home',
    body: [
      'The overview adapts to your role: your tasks, approvals waiting for you and your team’s workload.',
      'Work inbox keeps notifications, approvals and your tasks apart: reading a notification or completing a task never approves anything.',
    ],
  },
  admin: {
    title: 'Administration',
    body: [
      'Employees and their reporting manager decide who sees which records: own → team → division → company-wide.',
      'Configuration changes follow Draft → Validate → Publish. Published versions are recorded and cannot be edited.',
      'Audit log, event trace and message outbox are local simulations of server-side records.',
    ],
  },
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
          <li>All customers, people and numbers are fictional and stored only in this browser’s local storage.</li>
          <li>Sign-in is simulated: pick a demo user. Administrators and management confirm a one-time code that is shown on screen.</li>
          <li>Permissions are enforced by an in-browser service layer — a model of the server rules, not a security boundary.</li>
          <li>No email, WhatsApp, SMS or push message is sent and nothing reaches the ERP. Messages that would be sent are listed in Administration → Message outbox.</li>
          <li>Screens wait a short, simulated network delay so loading states are visible. An administrator can change the delay, simulate failures and move the clock forward in Settings.</li>
          <li>The AI assistant entry is present for layout only and is not enabled.</li>
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
