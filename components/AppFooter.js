// Shared footer for the signed-in portal pages.
// Keeps a visible route back to the marketing site and the legal pages.

export default function AppFooter() {
  return (
    <footer className="appfoot">
      <a className="home-link" href="https://omnignis.com">
        <span className="arr" aria-hidden="true">&larr;</span>
        Omnignis home
      </a>
      <div className="links">
        <a href="https://omnignis.com/privacy.html">Privacy</a>
        <a href="https://omnignis.com/terms.html">Terms</a>
        <a href="mailto:info@omnignis.com">Support</a>
      </div>
    </footer>
  );
}
