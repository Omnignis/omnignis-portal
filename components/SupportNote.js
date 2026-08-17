// A quiet, optional support note. Deliberately understated: churches should
// never feel this is a condition of using the portal.
const PAYPAL_URL = 'https://www.paypal.com/donate/?hosted_button_id=EF2GTD68X4JBE';

export default function SupportNote() {
  return (
    <aside className="support reveal d3">
      <div className="support-body">
        <h3>Support Omnignis</h3>
        <p>
          The portal is free for churches and will stay that way. We know budgets are tight,
          so this is entirely at your discretion. If yours has room, a contribution helps cover
          the ongoing maintenance of the software. Your reports work exactly the same either way.
        </p>
      </div>
      <a
        className="btn btn-ghost support-btn"
        href={PAYPAL_URL}
        target="_blank"
        rel="noopener noreferrer"
      >
        Donate via PayPal
      </a>
    </aside>
  );
}
