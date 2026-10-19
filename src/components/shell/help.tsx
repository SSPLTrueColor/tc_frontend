/** Contextual help registry (page-level) + prototype boundary disclosure. */
const PAGE_HELP: Record<string, { title: string; body: string[] }> = {
  home: { title: 'Overview', body: ['The overview adapts to your role.', 'Every number links to the list it summarizes.'] },
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
          <li>All data is fictional and stored only in this browser’s local storage.</li>
          <li>Role switching simulates sign-in. Permissions are enforced in the browser — a model of server rules, not a security boundary.</li>
          <li>No messages, emails, WhatsApp messages or payments are sent. Buttons that would do so are disabled and say why.</li>
          <li>The AI assistant entry is present for layout only and is not enabled.</li>
        </ul>
      </section>
      <section>
        <h3>Keyboard</h3>
        <ul className="plain-list bullets">
          <li>
            <kbd>Ctrl</kbd>/<kbd>⌘</kbd> + <kbd>K</kbd> — search pages
          </li>
          <li>
            <kbd>Esc</kbd> closes the topmost panel or dialog
          </li>
        </ul>
      </section>
    </div>
  );
}
