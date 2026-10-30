import { Link } from 'react-router-dom';

export function Logo({ compact = false }: { compact?: boolean }) {
  return <Link className="brand" to="/" aria-label="Pragya home">
    <img className="brand-mark" src="/assets/pragya-mark.png" alt="" aria-hidden="true" />
    {!compact && <span className="brand-name">Pragya</span>}
  </Link>;
}
