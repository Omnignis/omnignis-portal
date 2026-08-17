// The single source of truth for the Omnignis mark in the portal.
// Same flame paths and same wordmark treatment as omnignis.com, so the two
// properties are visibly one product.
export default function Brand({ sub = 'CHURCH PORTAL', small = false, href = null }) {
  const mark = (
    <>
      <svg
        className="flame"
        viewBox="0 0 22 28"
        fill="none"
        aria-hidden="true"
        width={small ? 19 : 24}
        height={small ? 24 : 30}
      >
        <path
          d="M11 0c1.4 4.6 5.6 6.9 8 10.4 2.6 3.8 2.6 9.2-.6 12.9C15.6 26.6 13.4 28 11 28c-2.4 0-4.6-1.4-7.4-4.7-3.2-3.7-3.2-9.1-.6-12.9C5.4 6.9 9.6 4.6 11 0Z"
          fill="var(--ember)"
        />
        <path
          d="M11 10c.8 2.5 3 3.7 4.2 5.6 1.3 2 1.3 4.9-.3 6.8-1 1.2-2.4 1.6-3.9 1.6s-2.9-.4-3.9-1.6c-1.6-1.9-1.6-4.8-.3-6.8C8 13.7 10.2 12.5 11 10Z"
          fill="var(--ink)"
        />
      </svg>
      <span className="name">
        <b>OMNIGNIS</b>
        {sub ? <span className="sub">{sub}</span> : null}
      </span>
    </>
  );

  if (href) {
    return (
      <a className={'brand' + (small ? ' brand-sm' : '')} href={href} aria-label="Omnignis">
        {mark}
      </a>
    );
  }
  return <div className={'brand' + (small ? ' brand-sm' : '')}>{mark}</div>;
}
