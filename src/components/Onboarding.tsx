/** The right pane before there is a team (after OpenMausBot's onboarding): what a teammate is, and the one button that matters. */
export function Onboarding({ onAdd, error }: { onAdd: () => void; error: string | null }) {
  return (
    <section className="thread placeholder">
      <div className="onboarding">
        <div className="glyph">👋</div>
        <h2>Your team, in your messages</h2>
        <p className="muted">
          A teammate is one of your Fountain agents with its own computer and one ongoing conversation with you. Message it
          like a coworker; it keeps working after you close the tab.
        </p>
        <ol className="steps">
          <li>
            <b>Add a teammate</b> — a name (we suggest one), a brain, one line about what they do. That's it.
          </li>
          <li>
            <b>Say hello</b> — the first message starts its computer (a few seconds).
          </li>
          <li>
            <b>Keep going</b> — queue notes while it works, paste screenshots, set a routine, search everything with <kbd>⌘K</kbd>.
          </li>
        </ol>
        {error ? <div className="error">{error}</div> : <button onClick={onAdd}>Add your first teammate</button>}
      </div>
    </section>
  );
}
